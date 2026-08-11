begin;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id),
  target_kind text not null
    constraint report_target_kind check (target_kind in ('WRAP', 'COMMENT', 'USER')),
  target_id uuid not null,
  target_ref text not null
    constraint report_target_ref check (
      target_ref = btrim(target_ref) and char_length(target_ref) between 1 and 120
    ),
  reason text not null
    constraint report_reason check (
      reason in (
        'COPYRIGHT',
        'OFFENSIVE_CONTENT',
        'SPAM',
        'STOLEN_CONTENT',
        'WRONG_VEHICLE_OR_TEMPLATE',
        'INVALID_DOWNLOAD',
        'OTHER'
      )
    ),
  detail text
    constraint report_detail check (
      detail is null or (
        detail = btrim(detail) and char_length(detail) between 1 and 1000
      )
    ),
  idempotency_key uuid not null,
  status text not null default 'OPEN'
    constraint report_status check (
      status in ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED')
    ),
  outcome_category text
    constraint report_outcome check (
      outcome_category is null or outcome_category in (
        'NO_ACTION',
        'CONTENT_HIDDEN',
        'CONTENT_REMOVED',
        'USER_SUSPENDED',
        'USER_DEACTIVATED',
        'DUPLICATE'
      )
    ),
  admin_note text
    constraint report_admin_note check (
      admin_note is null or (
        admin_note = btrim(admin_note) and char_length(admin_note) between 1 and 2000
      )
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  constraint report_final_consistency check (
    (status in ('OPEN', 'REVIEWING') and resolved_at is null and outcome_category is null)
    or (
      status in ('RESOLVED', 'DISMISSED')
      and resolved_at is not null
      and outcome_category is not null
    )
  )
);

create unique index reports_reporter_idempotency_idx
  on public.reports (reporter_id, idempotency_key);
create unique index reports_active_target_idx
  on public.reports (reporter_id, target_kind, target_id, reason)
  where status in ('OPEN', 'REVIEWING');
create index reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc, id desc);
create index reports_queue_idx
  on public.reports (status, created_at asc, id asc);

alter table public.reports enable row level security;
revoke all on public.reports from public, anon, authenticated;
revoke all on public.reports from service_role;
grant select, insert on public.reports to service_role;
grant update (status, outcome_category, admin_note, updated_at, resolved_at)
  on public.reports to service_role;

create table private.report_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  operation_count integer not null default 0 check (operation_count >= 0)
);
revoke all on private.report_rate_limits from public;

create or replace function private.resolve_report_target(
  p_target_kind text,
  p_target text,
  p_reporter_id uuid
)
returns table (target_id uuid, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := upper(btrim(coalesce(p_target_kind, '')));
  v_target text := lower(btrim(coalesce(p_target, '')));
  v_target_id uuid;
  v_owner_id uuid;
begin
  if v_kind not in ('WRAP', 'COMMENT', 'USER') or v_target = '' then
    raise exception using errcode = 'P0001', message = 'report_target_unavailable';
  end if;

  if v_kind = 'WRAP' then
    select w.id, w.creator_id
    into v_target_id, v_owner_id
    from public.wraps w
    where w.slug = v_target
      and private.comment_target_eligible(w.id)
    for update of w;
  elsif v_kind = 'COMMENT' then
    if v_target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'report_target_unavailable';
    end if;
    select c.id, c.author_id
    into v_target_id, v_owner_id
    from public.wrap_comments c
    join public.profiles author
      on author.user_id = c.author_id
     and author.participation_state = 'ACTIVE'
     and author.onboarding_completed_at is not null
    where c.id = v_target::uuid
      and c.status = 'PUBLISHED'
      and private.comment_target_eligible(c.wrap_id)
    for update of c;
  else
    select p.user_id, p.user_id
    into v_target_id, v_owner_id
    from public.profiles p
    left join public.profile_username_aliases a
      on a.profile_id = p.user_id and a.alias = v_target
    where (p.username = v_target or a.alias is not null)
      and p.participation_state = 'ACTIVE'
      and p.onboarding_completed_at is not null
    order by (p.username = v_target) desc, p.username
    limit 1
    for update of p;
  end if;

  if not found then
    raise exception using errcode = 'P0001', message = 'report_target_unavailable';
  end if;
  if v_owner_id = p_reporter_id then
    raise exception using errcode = 'P0001', message = 'report_self_target';
  end if;
  return query select v_target_id, v_owner_id;
end;
$$;

revoke all on function private.resolve_report_target(text, text, uuid) from public;

create or replace function private.consume_report_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 71));
  select window_started_at, operation_count
  into v_started_at, v_count
  from private.report_rate_limits
  where user_id = p_user_id
  for update;

  if not found or v_started_at <= clock_timestamp() - interval '1 hour' then
    insert into private.report_rate_limits (user_id, window_started_at, operation_count)
    values (p_user_id, clock_timestamp(), 1)
    on conflict (user_id) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;

  if v_count >= 10 then
    raise exception using errcode = 'P0001', message = 'report_rate_limited';
  end if;

  update private.report_rate_limits
  set operation_count = operation_count + 1
  where user_id = p_user_id;
end;
$$;

revoke all on function private.consume_report_slot(uuid) from public;

create or replace function public.create_report(
  p_target_kind text,
  p_target text,
  p_reason text,
  p_detail text,
  p_idempotency_key uuid
)
returns table (
  id uuid,
  target_kind text,
  target_id uuid,
  reason text,
  detail text,
  status text,
  outcome_category text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_kind text := upper(btrim(coalesce(p_target_kind, '')));
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_target_ref text := lower(btrim(coalesce(p_target, '')));
  v_detail text := nullif(btrim(p_detail), '');
  v_target_id uuid;
  v_owner_id uuid;
  v_report public.reports%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = 'P0001', message = 'report_auth_required';
  end if;
  if v_kind not in ('WRAP', 'COMMENT', 'USER')
    or v_reason not in (
      'COPYRIGHT', 'OFFENSIVE_CONTENT', 'SPAM', 'STOLEN_CONTENT',
      'WRONG_VEHICLE_OR_TEMPLATE', 'INVALID_DOWNLOAD', 'OTHER'
    )
    or v_target_ref = ''
    or char_length(v_target_ref) > 120
    or p_idempotency_key is null
    or v_detail is not null and char_length(v_detail) > 1000
    or v_reason = 'OTHER' and v_detail is null
  then
    raise exception using errcode = 'P0001', message = 'invalid_report_request';
  end if;

  perform 1
  from public.profiles
  where user_id = v_actor_id
    and participation_state = 'ACTIVE'
    and onboarding_completed_at is not null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'report_actor_unavailable';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_id::text || ':' || p_idempotency_key::text, 73)
  );
  select * into v_report
  from public.reports
  where reporter_id = v_actor_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_report.target_kind <> v_kind
      or v_report.target_ref <> v_target_ref
      or v_report.reason <> v_reason
      or v_report.detail is distinct from v_detail
    then
      raise exception using errcode = 'P0001', message = 'report_idempotency_mismatch';
    end if;
    return query
    select v_report.id, v_report.target_kind, v_report.target_id, v_report.reason,
      v_report.detail, v_report.status, v_report.outcome_category,
      v_report.created_at, v_report.updated_at, v_report.resolved_at, false;
    return;
  end if;

  select resolved.target_id, resolved.owner_id
  into v_target_id, v_owner_id
  from private.resolve_report_target(v_kind, v_target_ref, v_actor_id) as resolved;
  if v_target_id is null then
    raise exception using errcode = 'P0001', message = 'report_target_unavailable';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_actor_id::text || ':' || v_kind || ':' || v_target_id::text || ':' || v_reason,
      79
    )
  );
  select r.* into v_report
  from public.reports r
  where r.reporter_id = v_actor_id
    and r.target_kind = v_kind
    and r.target_id = v_target_id
    and r.reason = v_reason
    and r.status in ('OPEN', 'REVIEWING')
  order by r.created_at desc, r.id desc
  limit 1
  for update;
  if found then
    return query
    select v_report.id, v_report.target_kind, v_report.target_id, v_report.reason,
      v_report.detail, v_report.status, v_report.outcome_category,
      v_report.created_at, v_report.updated_at, v_report.resolved_at, false;
    return;
  end if;

  perform private.consume_report_slot(v_actor_id);
  insert into public.reports (
    reporter_id, target_kind, target_id, target_ref, reason, detail, idempotency_key
  ) values (
    v_actor_id, v_kind, v_target_id, v_target_ref, v_reason, v_detail, p_idempotency_key
  )
  returning * into v_report;

  return query
  select v_report.id, v_report.target_kind, v_report.target_id, v_report.reason,
    v_report.detail, v_report.status, v_report.outcome_category,
    v_report.created_at, v_report.updated_at, v_report.resolved_at, true;
end;
$$;

revoke all on function public.create_report(text, text, text, text, uuid)
  from public, anon;
grant execute on function public.create_report(text, text, text, text, uuid)
  to authenticated;

create or replace function public.get_my_report(p_report_id uuid)
returns table (
  id uuid,
  target_kind text,
  target_id uuid,
  reason text,
  detail text,
  status text,
  outcome_category text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.target_kind, r.target_id, r.reason, r.detail, r.status,
    r.outcome_category, r.created_at, r.updated_at, r.resolved_at
  from public.reports r
  where r.id = p_report_id
    and r.reporter_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.user_id = r.reporter_id
        and p.participation_state = 'ACTIVE'
        and p.onboarding_completed_at is not null
    );
$$;

revoke all on function public.get_my_report(uuid) from public, anon;
grant execute on function public.get_my_report(uuid) to authenticated;

commit;
