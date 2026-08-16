begin;

create table private.admin_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active boolean not null default true,
  granted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint admin_membership_state check (active or revoked_at is not null)
);

revoke all on private.admin_memberships from public;
grant select, insert, update, delete on private.admin_memberships to service_role;

create table private.moderation_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  operation_count integer not null default 0 check (operation_count >= 0)
);

revoke all on private.moderation_rate_limits from public;

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id),
  report_id uuid references public.reports (id),
  target_kind text not null
    constraint moderation_action_target_kind check (target_kind in ('WRAP', 'COMMENT', 'USER')),
  target_id uuid not null,
  action_kind text not null
    constraint moderation_action_kind check (
      action_kind in ('REVIEW', 'RESOLVE', 'DISMISS', 'HIDE', 'REMOVE', 'SUSPEND', 'REINSTATE')
    ),
  previous_state text not null,
  new_state text not null,
  reason text not null
    constraint moderation_action_reason check (
      reason in (
        'COPYRIGHT', 'OFFENSIVE_CONTENT', 'SPAM', 'STOLEN_CONTENT',
        'WRONG_VEHICLE_OR_TEMPLATE', 'INVALID_DOWNLOAD', 'OTHER',
        'NO_VIOLATION', 'DUPLICATE', 'RESTORED'
      )
    ),
  private_note text
    constraint moderation_action_note check (
      private_note is null or (
        private_note = btrim(private_note) and char_length(private_note) between 1 and 2000
      )
    ),
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint moderation_action_idempotency unique (actor_id, idempotency_key)
);

create index moderation_actions_report_idx
  on public.moderation_actions (report_id, created_at desc, id desc);
create index moderation_actions_target_idx
  on public.moderation_actions (target_kind, target_id, created_at desc, id desc);

alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from public, anon, authenticated, service_role;
grant select on public.moderation_actions to service_role;

create function private.reject_moderation_action_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'moderation_action_immutable';
end;
$$;

revoke all on function private.reject_moderation_action_mutation() from public;
create trigger moderation_action_immutable
before update or delete on public.moderation_actions
for each row execute function private.reject_moderation_action_mutation();

create or replace function private.assert_current_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  perform 1
  from public.profiles p
  join private.admin_memberships m on m.user_id = p.user_id
  where p.user_id = v_user_id
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
    and m.active
    and m.revoked_at is null
  for update of p, m;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  return v_user_id;
end;
$$;

revoke all on function private.assert_current_admin() from public;

create or replace function private.consume_moderation_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 407));
  select window_started_at, operation_count
  into v_started_at, v_count
  from private.moderation_rate_limits
  where user_id = p_user_id
  for update;
  if not found or v_started_at <= clock_timestamp() - interval '1 hour' then
    insert into private.moderation_rate_limits (user_id, window_started_at, operation_count)
    values (p_user_id, clock_timestamp(), 1)
    on conflict (user_id) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;
  if v_count >= 10 then
    raise exception using errcode = 'P0001', message = 'moderation_rate_limited';
  end if;
  update private.moderation_rate_limits
  set operation_count = operation_count + 1
  where user_id = p_user_id;
end;
$$;

revoke all on function private.consume_moderation_slot(uuid) from public;

create function public.set_admin_membership(p_user_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.admin_memberships (user_id, active, revoked_at)
  values (p_user_id, coalesce(p_active, false), case when coalesce(p_active, false) then null else clock_timestamp() end)
  on conflict (user_id) do update
    set active = excluded.active,
        revoked_at = excluded.revoked_at;
  return true;
end;
$$;

revoke all on function public.set_admin_membership(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_admin_membership(uuid, boolean) to service_role;

create or replace function public.list_admin_reports(p_status text default null)
returns table (
  id uuid,
  target_kind text,
  target_id uuid,
  target_ref text,
  target_summary text,
  target_state text,
  reporter_ref text,
  reason text,
  detail text,
  status text,
  outcome_category text,
  admin_note text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  last_action_kind text,
  last_action_reason text,
  last_action_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_current_admin();
  if p_status is not null and p_status not in ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED') then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_status';
  end if;
  return query
  select r.id, r.target_kind, r.target_id, r.target_ref,
    case r.target_kind
      when 'WRAP' then left(w.title, 160)
      when 'COMMENT' then left(c.body, 240)
      when 'USER' then coalesce(p.display_name, p.username, 'Unavailable User')
    end,
    case r.target_kind
      when 'WRAP' then w.status
      when 'COMMENT' then c.status
      when 'USER' then p.participation_state
    end,
    left(r.reporter_id::text, 8), r.reason, r.detail, r.status,
    r.outcome_category, r.admin_note, r.created_at, r.updated_at, r.resolved_at,
    latest.action_kind, latest.reason, latest.created_at
  from public.reports r
  left join public.wraps w
    on r.target_kind = 'WRAP' and w.id = r.target_id
  left join public.wrap_comments c
    on r.target_kind = 'COMMENT' and c.id = r.target_id
  left join public.profiles p
    on r.target_kind = 'USER' and p.user_id = r.target_id
  left join lateral (
    select a.action_kind, a.reason, a.created_at
    from public.moderation_actions a
    where a.report_id = r.id
    order by a.created_at desc, a.id desc
    limit 1
  ) latest on true
  where p_status is null or r.status = p_status
  order by r.created_at asc, r.id asc;
end;
$$;

revoke all on function public.list_admin_reports(text) from public, anon;
grant execute on function public.list_admin_reports(text) to authenticated;

create or replace function public.moderate_report(
  p_report_id uuid,
  p_action_kind text,
  p_reason text,
  p_private_note text,
  p_outcome_category text,
  p_idempotency_key uuid
)
returns table (
  report_id uuid,
  report_status text,
  outcome_category text,
  action_id uuid,
  action_created boolean,
  target_kind text,
  target_id uuid,
  target_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_action_kind text := upper(btrim(coalesce(p_action_kind, '')));
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_note text := nullif(btrim(p_private_note), '');
  v_outcome text := upper(btrim(coalesce(p_outcome_category, '')));
  v_report public.reports%rowtype;
  v_existing public.moderation_actions%rowtype;
  v_action public.moderation_actions%rowtype;
  v_wrap public.wraps%rowtype;
  v_comment public.wrap_comments%rowtype;
  v_profile public.profiles%rowtype;
  v_previous_state text;
  v_target_state text;
  v_result_target_state text;
  v_changed boolean := false;
begin
  v_admin_id := private.assert_current_admin();
  if p_report_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_request';
  end if;
  if v_action_kind not in ('REVIEW', 'RESOLVE', 'DISMISS', 'HIDE', 'REMOVE', 'SUSPEND', 'REINSTATE')
    or v_reason not in (
      'COPYRIGHT', 'OFFENSIVE_CONTENT', 'SPAM', 'STOLEN_CONTENT',
      'WRONG_VEHICLE_OR_TEMPLATE', 'INVALID_DOWNLOAD', 'OTHER',
      'NO_VIOLATION', 'DUPLICATE', 'RESTORED'
    )
    or v_note is not null and char_length(v_note) > 2000
  then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_admin_id::text || ':' || p_idempotency_key::text, 401)
  );
  select r.* into v_report
  from public.reports r
  where r.id = p_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_report_not_found';
  end if;

  if not (
    v_action_kind in ('REVIEW', 'RESOLVE', 'DISMISS')
    or (v_report.target_kind in ('WRAP', 'COMMENT')
      and v_action_kind in ('HIDE', 'REMOVE'))
    or (v_report.target_kind = 'USER'
      and v_action_kind in ('SUSPEND', 'REINSTATE'))
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_target_action';
  end if;

  select a.* into v_existing
  from public.moderation_actions a
  where a.actor_id = v_admin_id and a.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.report_id is distinct from p_report_id
      or v_existing.action_kind <> v_action_kind
      or v_existing.reason <> v_reason
      or v_existing.private_note is distinct from v_note
    then
      raise exception using errcode = 'P0001', message = 'moderation_idempotency_mismatch';
    end if;
    return query select v_report.id, v_report.status, v_report.outcome_category,
      v_existing.id, false, v_report.target_kind, v_report.target_id,
      case v_report.target_kind
        when 'WRAP' then (select w.status from public.wraps w where w.id = v_report.target_id)
        when 'COMMENT' then (select c.status from public.wrap_comments c where c.id = v_report.target_id)
        when 'USER' then (select p.participation_state from public.profiles p where p.user_id = v_report.target_id)
      end;
    return;
  end if;

  perform private.consume_moderation_slot(v_admin_id);

  if v_action_kind = 'REVIEW' then
    if v_report.status in ('RESOLVED', 'DISMISSED') then
      raise exception using errcode = 'P0001', message = 'moderation_conflict';
    end if;
    v_previous_state := v_report.status;
    v_target_state := case when v_report.status = 'OPEN' then 'REVIEWING' else 'REVIEWING' end;
    if v_report.status = 'OPEN' then
      update public.reports set status = 'REVIEWING', updated_at = clock_timestamp()
      where id = v_report.id;
      v_report.status := 'REVIEWING';
      v_changed := true;
    end if;
  elsif v_action_kind in ('RESOLVE', 'DISMISS') then
    if v_action_kind = 'RESOLVE' and v_outcome <> 'NO_ACTION' then
      raise exception using errcode = 'P0001', message = 'invalid_moderation_outcome';
    end if;
    if v_action_kind = 'DISMISS' and v_outcome not in ('DUPLICATE', 'NO_ACTION') then
      raise exception using errcode = 'P0001', message = 'invalid_moderation_outcome';
    end if;
    if v_report.status in ('RESOLVED', 'DISMISSED') then
      if v_report.status <> (case when v_action_kind = 'RESOLVE' then 'RESOLVED' else 'DISMISSED' end)
        or v_report.outcome_category <> v_outcome then
        raise exception using errcode = 'P0001', message = 'moderation_conflict';
      end if;
      v_previous_state := v_report.status;
      v_target_state := v_report.status;
    else
      v_previous_state := v_report.status;
      v_target_state := case when v_action_kind = 'RESOLVE' then 'RESOLVED' else 'DISMISSED' end;
      update public.reports
      set status = v_target_state, outcome_category = v_outcome,
          admin_note = v_note, resolved_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_report.id;
      v_changed := true;
      v_report.status := v_target_state;
      v_report.outcome_category := v_outcome;
    end if;
  else
    if v_report.target_kind = 'WRAP' then
      select w.* into v_wrap from public.wraps w where w.id = v_report.target_id for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
      end if;
      v_previous_state := v_wrap.status;
      if v_action_kind = 'HIDE' then
        if v_wrap.status = 'REMOVED' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        v_target_state := 'HIDDEN';
        if v_wrap.status = 'PUBLISHED' then
          update public.wraps set status = 'HIDDEN' where id = v_wrap.id;
          v_changed := true;
        elsif v_wrap.status <> 'HIDDEN' then
          raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
        end if;
      elsif v_action_kind = 'REMOVE' then
        if v_wrap.status = 'REMOVED' then
          v_target_state := 'REMOVED';
        elsif v_wrap.status in ('PUBLISHED', 'HIDDEN') then
          v_target_state := 'REMOVED';
          update public.wraps set status = 'REMOVED', deleted_at = clock_timestamp() where id = v_wrap.id;
          v_changed := true;
        else
          raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
        end if;
      end if;
    elsif v_report.target_kind = 'COMMENT' then
      select c.* into v_comment from public.wrap_comments c where c.id = v_report.target_id for update;
      if not found then raise exception using errcode = 'P0001', message = 'admin_target_unavailable'; end if;
      v_previous_state := v_comment.status;
      if v_action_kind = 'HIDE' then
        if v_comment.status = 'REMOVED' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        v_target_state := 'HIDDEN';
        if v_comment.status = 'PUBLISHED' then
          update public.wrap_comments set status = 'HIDDEN' where id = v_comment.id;
          v_changed := true;
        elsif v_comment.status <> 'HIDDEN' then
          raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
        end if;
      elsif v_action_kind = 'REMOVE' then
        v_target_state := 'REMOVED';
        if v_comment.status in ('PUBLISHED', 'HIDDEN') then
          update public.wrap_comments set status = 'REMOVED', removed_at = clock_timestamp() where id = v_comment.id;
          v_changed := true;
        elsif v_comment.status <> 'REMOVED' then
          raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
        end if;
      end if;
    elsif v_report.target_kind = 'USER' then
      select p.* into v_profile from public.profiles p where p.user_id = v_report.target_id for update;
      if not found then raise exception using errcode = 'P0001', message = 'admin_target_unavailable'; end if;
      v_previous_state := v_profile.participation_state;
      if v_action_kind = 'SUSPEND' then
        if v_profile.participation_state = 'DEACTIVATED' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        v_target_state := 'SUSPENDED';
        if v_profile.participation_state = 'ACTIVE' then
          update public.profiles set participation_state = 'SUSPENDED' where user_id = v_profile.user_id;
          v_changed := true;
        end if;
      elsif v_action_kind = 'REINSTATE' then
        if v_profile.participation_state = 'DEACTIVATED' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        if v_profile.participation_state = 'ACTIVE' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        v_target_state := 'ACTIVE';
        if v_profile.participation_state = 'SUSPENDED' then
          update public.profiles set participation_state = 'ACTIVE' where user_id = v_profile.user_id;
          v_changed := true;
        end if;
      end if;
    else
      raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
    end if;

    if v_action_kind <> 'REINSTATE' then
      if v_report.status in ('RESOLVED', 'DISMISSED')
        and v_report.outcome_category <> (case v_action_kind
          when 'HIDE' then 'CONTENT_HIDDEN'
          when 'REMOVE' then 'CONTENT_REMOVED'
          when 'SUSPEND' then 'USER_SUSPENDED'
        end) then
        raise exception using errcode = 'P0001', message = 'moderation_conflict';
      end if;
      v_report.outcome_category := case v_action_kind
        when 'HIDE' then 'CONTENT_HIDDEN'
        when 'REMOVE' then 'CONTENT_REMOVED'
        when 'SUSPEND' then 'USER_SUSPENDED'
      end;
      if v_report.status not in ('RESOLVED', 'DISMISSED') then
        update public.reports
        set status = 'RESOLVED', outcome_category = v_report.outcome_category,
            admin_note = v_note, resolved_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = v_report.id;
        v_report.status := 'RESOLVED';
        v_changed := true;
      end if;
    end if;
  end if;

  select case v_report.target_kind
    when 'WRAP' then (select w.status from public.wraps w where w.id = v_report.target_id)
    when 'COMMENT' then (select c.status from public.wrap_comments c where c.id = v_report.target_id)
    when 'USER' then (select p.participation_state from public.profiles p where p.user_id = v_report.target_id)
  end into v_result_target_state;

  select a.* into v_existing
  from public.moderation_actions a
  where a.report_id = v_report.id
    and a.target_kind = v_report.target_kind
    and a.target_id = v_report.target_id
    and a.action_kind = v_action_kind
  order by a.created_at desc, a.id desc
  limit 1;
  if found and not v_changed then
    return query select v_report.id, v_report.status, v_report.outcome_category,
      v_existing.id, false, v_report.target_kind, v_report.target_id,
      coalesce(v_result_target_state, v_target_state);
    return;
  end if;

  insert into public.moderation_actions (
    actor_id, report_id, target_kind, target_id, action_kind,
    previous_state, new_state, reason, private_note, idempotency_key
  ) values (
    v_admin_id, v_report.id, v_report.target_kind, v_report.target_id,
    v_action_kind, v_previous_state, coalesce(v_target_state, v_report.status),
    v_reason, v_note, p_idempotency_key
  ) returning * into v_action;

  return query select v_report.id, v_report.status, v_report.outcome_category,
    v_action.id, true, v_report.target_kind, v_report.target_id,
    coalesce(v_result_target_state, v_target_state, v_report.status);
end;
$$;

revoke all on function public.moderate_report(uuid, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.moderate_report(uuid, text, text, text, text, uuid)
  to authenticated;

commit;
