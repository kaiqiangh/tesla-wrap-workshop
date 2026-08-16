begin;

create table public.asset_revision_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_revision_id uuid not null references public.asset_revisions (id),
  owner_id uuid not null references public.profiles (user_id),
  bucket_id text not null check (bucket_id in ('wrap-originals', 'wrap-derived')),
  object_key text not null,
  available_after timestamptz not null,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED')),
  legal_hold boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (bucket_id, object_key)
);

alter table public.asset_revision_cleanup_jobs enable row level security;
revoke all on public.asset_revision_cleanup_jobs from public, anon, authenticated;
grant select, insert, update on public.asset_revision_cleanup_jobs to service_role;

create table public.asset_revision_cleanup_holds (
  asset_revision_id uuid primary key references public.asset_revisions (id),
  held boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.asset_revision_cleanup_holds enable row level security;
revoke all on public.asset_revision_cleanup_holds from public, anon, authenticated;
grant select, insert, update on public.asset_revision_cleanup_holds to service_role;

create or replace function private.enqueue_profile_wrap_cleanup(
  p_profile_id uuid,
  p_available_after timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.profile_wrap_cleanup_jobs (
    profile_id, asset_revision_id, bucket_id, object_key, available_after
  )
  select ar.owner_id, wa.asset_revision_id, wa.bucket_id, wa.object_key,
    greatest(
      p_available_after,
      coalesce(
        (select max(ma.created_at + interval '90 days')
         from public.moderation_actions ma
         where ma.target_kind = 'WRAP'
           and ma.target_id = w.id
           and ma.action_kind = 'REMOVE'),
        p_available_after
      )
    )
  from public.asset_revisions ar
  join public.wrap_assets wa on wa.asset_revision_id = ar.id
  left join public.wraps w on w.asset_revision_id = wa.asset_revision_id
  where ar.owner_id = p_profile_id
  on conflict (object_key) do update
    set profile_id = excluded.profile_id,
        asset_revision_id = excluded.asset_revision_id,
        bucket_id = excluded.bucket_id,
        available_after = greatest(
          profile_wrap_cleanup_jobs.available_after, excluded.available_after
        ),
        state = case when profile_wrap_cleanup_jobs.state = 'COMPLETED'
          then profile_wrap_cleanup_jobs.state else 'PENDING' end,
        attempts = case when profile_wrap_cleanup_jobs.state = 'COMPLETED'
          then profile_wrap_cleanup_jobs.attempts else 0 end,
        claimed_at = null,
        last_error = null,
        completed_at = case when profile_wrap_cleanup_jobs.state = 'COMPLETED'
          then profile_wrap_cleanup_jobs.completed_at else null end;
$$;

revoke all on function private.enqueue_profile_wrap_cleanup(uuid, timestamptz) from public;

create or replace function public.claim_profile_wrap_cleanup_jobs(p_limit integer default 50)
returns table (id uuid, bucket_id text, object_key text, profile_id uuid, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_profile_cleanup_limit';
  end if;
  return query
  with eligible as (
    select j.id
    from public.profile_wrap_cleanup_jobs j
    join public.profiles p on p.user_id = j.profile_id
    where p.participation_state = 'DEACTIVATED'
      and j.available_after <= clock_timestamp()
      and not exists (
        select 1 from public.asset_revision_cleanup_holds h
        where h.asset_revision_id = j.asset_revision_id and h.held
      )
      and (
        j.attempts < 10 and (
          j.state in ('PENDING', 'FAILED')
          or (j.state = 'PROCESSING' and j.claimed_at < clock_timestamp() - interval '10 minutes')
        )
      )
    order by j.available_after, j.id
    limit p_limit
    for update of p, j skip locked
  )
  update public.profile_wrap_cleanup_jobs j
  set state = 'PROCESSING', claimed_at = clock_timestamp(), attempts = j.attempts + 1,
      last_error = null
  from eligible
  where j.id = eligible.id
    and not exists (
      select 1 from public.asset_revision_cleanup_holds h
      where h.asset_revision_id = j.asset_revision_id and h.held
    )
  returning j.id, j.bucket_id, j.object_key, j.profile_id, j.attempts;
end;
$$;

revoke all on function public.claim_profile_wrap_cleanup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_profile_wrap_cleanup_jobs(integer) to service_role;

create or replace function private.queue_pending_staging_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in ('EXPIRED', 'FAILED', 'READY') and old.state is distinct from new.state then
    insert into public.asset_cleanup_jobs (
      pending_upload_id, bucket_id, object_key, reason
    ) values (
      new.id, 'wrap-staging', new.staging_key,
      case when new.state = 'READY' then 'STAGING_AFTER_READY' else 'FAILED_FINALIZATION' end
    ) on conflict (bucket_id, object_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.queue_pending_staging_cleanup() from public;
drop trigger if exists queue_expired_pending_staging on public.pending_uploads;
drop trigger if exists queue_pending_staging_cleanup on public.pending_uploads;
create trigger queue_pending_staging_cleanup
after update of state on public.pending_uploads
for each row execute function private.queue_pending_staging_cleanup();

create table public.asset_orphan_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('wrap-originals', 'wrap-derived')),
  object_key text not null,
  available_after timestamptz not null,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
  , unique (bucket_id, object_key)
);

alter table public.asset_orphan_cleanup_jobs enable row level security;
revoke all on public.asset_orphan_cleanup_jobs from public, anon, authenticated;
grant select, insert, update on public.asset_orphan_cleanup_jobs to service_role;

create table public.asset_revision_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  asset_revision_id uuid not null references public.asset_revisions (id),
  bucket_id text not null check (bucket_id in ('wrap-originals', 'wrap-derived')),
  object_key text not null,
  issue_kind text not null check (issue_kind = 'MISSING_STORAGE_OBJECT'),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (asset_revision_id, bucket_id, object_key, issue_kind)
);

alter table public.asset_revision_reconciliation_issues enable row level security;
revoke all on public.asset_revision_reconciliation_issues from public, anon, authenticated;
grant select, insert, update on public.asset_revision_reconciliation_issues to service_role;

create function private.cancel_orphan_cleanup_on_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  select state into v_state
  from public.asset_orphan_cleanup_jobs
  where bucket_id = new.bucket_id and object_key = new.object_key
  for update;
  if v_state = 'PROCESSING' then
    raise exception using errcode = 'P0001', message = 'asset_orphan_cleanup_claimed';
  end if;
  update public.asset_orphan_cleanup_jobs
  set state = 'COMPLETED', completed_at = clock_timestamp(),
      claimed_at = null, last_error = null
  where bucket_id = new.bucket_id
    and object_key = new.object_key
    and state <> 'COMPLETED';
  return new;
end;
$$;

revoke all on function private.cancel_orphan_cleanup_on_reference() from public;
drop trigger if exists cancel_orphan_cleanup_on_reference on public.wrap_assets;
create trigger cancel_orphan_cleanup_on_reference
after insert on public.wrap_assets
for each row execute function private.cancel_orphan_cleanup_on_reference();

create or replace function private.enqueue_asset_revision_cleanup(
  p_asset_revision_id uuid,
  p_available_after timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.asset_revision_cleanup_jobs (
    asset_revision_id, owner_id, bucket_id, object_key, available_after, legal_hold
  )
  select ar.id, ar.owner_id, wa.bucket_id, wa.object_key, p_available_after
    , coalesce(h.held, false)
  from public.asset_revisions ar
  join public.wrap_assets wa on wa.asset_revision_id = ar.id
  left join public.asset_revision_cleanup_holds h on h.asset_revision_id = ar.id
  where ar.id = p_asset_revision_id
  on conflict (bucket_id, object_key) do update
    set asset_revision_id = excluded.asset_revision_id,
        owner_id = excluded.owner_id,
        available_after = excluded.available_after,
        state = case when asset_revision_cleanup_jobs.state in ('COMPLETED', 'PROCESSING')
          then asset_revision_cleanup_jobs.state else 'PENDING' end,
        attempts = case when asset_revision_cleanup_jobs.state in ('COMPLETED', 'PROCESSING')
          then asset_revision_cleanup_jobs.attempts else 0 end,
        claimed_at = case when asset_revision_cleanup_jobs.state = 'PROCESSING'
          then asset_revision_cleanup_jobs.claimed_at else null end,
        last_error = case when asset_revision_cleanup_jobs.state = 'PROCESSING'
          then asset_revision_cleanup_jobs.last_error else null end,
        completed_at = case when asset_revision_cleanup_jobs.state = 'COMPLETED'
          then asset_revision_cleanup_jobs.completed_at else null end;
$$;

revoke all on function private.enqueue_asset_revision_cleanup(uuid, timestamptz)
  from public;

create function private.schedule_asset_revision_cleanup_on_remove()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'REMOVED' then
    perform private.enqueue_asset_revision_cleanup(
      new.asset_revision_id, clock_timestamp() + interval '30 days'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.schedule_asset_revision_cleanup_on_remove()
  from public;

create function private.guard_asset_revision_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.asset_revisions
  where id = new.asset_revision_id
  for update;
  if exists (
    select 1 from public.asset_revision_cleanup_jobs
    where asset_revision_id = new.asset_revision_id
      and state <> 'COMPLETED'
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_revision_cleanup_pending';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_asset_revision_cleanup() from public;
drop trigger if exists guard_asset_revision_cleanup on public.wraps;
create trigger guard_asset_revision_cleanup
before insert or update of asset_revision_id on public.wraps
for each row execute function private.guard_asset_revision_cleanup();

create function private.extend_moderation_removal_retention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_kind = 'WRAP' and new.action_kind = 'REMOVE' then
    perform 1 from public.asset_revision_cleanup_jobs j
    join public.wraps w on w.asset_revision_id = j.asset_revision_id
    where w.id = new.target_id
    for update;
    perform 1 from public.profile_wrap_cleanup_jobs j
    join public.wraps w on w.asset_revision_id = j.asset_revision_id
    where w.id = new.target_id
    for update;
    if exists (
      select 1 from public.asset_revision_cleanup_jobs j
      join public.wraps w on w.asset_revision_id = j.asset_revision_id
      where w.id = new.target_id and j.state = 'PROCESSING'
      union all
      select 1 from public.profile_wrap_cleanup_jobs j
      join public.wraps w on w.asset_revision_id = j.asset_revision_id
      where w.id = new.target_id and j.state = 'PROCESSING'
    ) then
      raise exception using errcode = 'P0001', message = 'asset_cleanup_in_progress';
    end if;
    update public.asset_revision_cleanup_jobs j
    set available_after = greatest(
      j.available_after, clock_timestamp() + interval '90 days'
    )
    from public.wraps w
    where w.id = new.target_id
      and j.asset_revision_id = w.asset_revision_id
      and j.state <> 'COMPLETED';
    update public.profile_wrap_cleanup_jobs j
    set available_after = greatest(
      j.available_after, clock_timestamp() + interval '90 days'
    )
    from public.wraps w
    where w.id = new.target_id
      and j.asset_revision_id = w.asset_revision_id
      and j.state <> 'COMPLETED';
  end if;
  return new;
end;
$$;

revoke all on function private.extend_moderation_removal_retention() from public;
drop trigger if exists extend_moderation_removal_retention on public.moderation_actions;
create trigger extend_moderation_removal_retention
after insert on public.moderation_actions
for each row execute function private.extend_moderation_removal_retention();

drop trigger if exists schedule_asset_revision_cleanup_on_remove on public.wraps;
create trigger schedule_asset_revision_cleanup_on_remove
after update of status on public.wraps
for each row execute function private.schedule_asset_revision_cleanup_on_remove();

create function public.reconcile_asset_revision_cleanup(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_asset_revision_reconcile_limit';
  end if;
  with candidates as (
    select ar.id as asset_revision_id,
      greatest(
        case when w.status = 'REMOVED' then coalesce(w.deleted_at, ar.created_at)
          else ar.created_at end + interval '30 days',
        coalesce(
          (select max(ma.created_at + interval '90 days')
           from public.moderation_actions ma
           where ma.target_kind = 'WRAP'
             and ma.target_id = w.id
             and ma.action_kind = 'REMOVE'),
          ar.created_at + interval '30 days'
        ),
        clock_timestamp()
      ) as available_after
    from public.asset_revisions ar
    left join public.wraps w on w.asset_revision_id = ar.id
    where (
      w.status = 'REMOVED'
      or (w.id is null and ar.created_at <= clock_timestamp() - interval '30 days')
    )
    order by ar.created_at, ar.id
    limit p_limit
  )
  insert into public.asset_revision_cleanup_jobs (
    asset_revision_id, owner_id, bucket_id, object_key, available_after, legal_hold
  )
  select ar.id, ar.owner_id, wa.bucket_id, wa.object_key, c.available_after,
    coalesce(h.held, false)
  from candidates c
  join public.asset_revisions ar on ar.id = c.asset_revision_id
  join public.wrap_assets wa on wa.asset_revision_id = ar.id
  left join public.asset_revision_cleanup_holds h on h.asset_revision_id = ar.id
  on conflict (bucket_id, object_key) do nothing;
  get diagnostics v_count = row_count;

  insert into public.asset_orphan_cleanup_jobs (
    bucket_id, object_key, available_after
  )
  select so.bucket_id, so.name, clock_timestamp()
  from storage.objects so
  where so.bucket_id in ('wrap-originals', 'wrap-derived')
    and so.created_at <= clock_timestamp() - interval '30 days'
    and not exists (
      select 1 from public.wrap_assets wa
      where wa.bucket_id = so.bucket_id and wa.object_key = so.name
    )
  on conflict (bucket_id, object_key) do nothing;
  insert into public.asset_revision_reconciliation_issues (
    asset_revision_id, bucket_id, object_key, issue_kind
  )
  select wa.asset_revision_id, wa.bucket_id, wa.object_key,
    'MISSING_STORAGE_OBJECT'
  from public.wrap_assets wa
  where not exists (
    select 1 from storage.objects so
    where so.bucket_id = wa.bucket_id and so.name = wa.object_key
  ) and not exists (
    select 1 from public.asset_revision_cleanup_jobs j
    where j.bucket_id = wa.bucket_id and j.object_key = wa.object_key
      and j.state = 'COMPLETED'
  ) and not exists (
    select 1 from public.profile_wrap_cleanup_jobs j
    join public.profiles p on p.user_id = j.profile_id
    where j.bucket_id = wa.bucket_id and j.object_key = wa.object_key
      and j.state = 'COMPLETED'
      and p.participation_state = 'DEACTIVATED'
  )
  on conflict (asset_revision_id, bucket_id, object_key, issue_kind)
  do update set last_seen_at = clock_timestamp(), resolved_at = null;
  update public.asset_revision_reconciliation_issues i
  set resolved_at = clock_timestamp()
  where i.resolved_at is null
    and (
      exists (
      select 1 from storage.objects so
      where so.bucket_id = i.bucket_id and so.name = i.object_key
      ) or exists (
        select 1 from public.asset_revision_cleanup_jobs j
        where j.bucket_id = i.bucket_id and j.object_key = i.object_key
          and j.state = 'COMPLETED'
      ) or exists (
        select 1 from public.profile_wrap_cleanup_jobs j
        join public.profiles p on p.user_id = j.profile_id
        where j.bucket_id = i.bucket_id and j.object_key = i.object_key
          and j.state = 'COMPLETED'
          and p.participation_state = 'DEACTIVATED'
      )
    );
  return v_count;
end;
$$;

revoke all on function public.reconcile_asset_revision_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_asset_revision_cleanup(integer)
  to service_role;

create function public.set_asset_revision_cleanup_hold(
  p_asset_revision_id uuid,
  p_held boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.asset_revision_cleanup_jobs
  where asset_revision_id = p_asset_revision_id
  for update;
  perform 1 from public.profile_wrap_cleanup_jobs
  where asset_revision_id = p_asset_revision_id
  for update;
  if p_held and exists (
    select 1 from public.asset_revision_cleanup_jobs
    where asset_revision_id = p_asset_revision_id and state = 'PROCESSING'
    union all
    select 1 from public.profile_wrap_cleanup_jobs
    where asset_revision_id = p_asset_revision_id and state = 'PROCESSING'
  ) then
    raise exception using errcode = 'P0001', message = 'asset_cleanup_in_progress';
  end if;
  if p_held and exists (
    select 1 from public.asset_revision_cleanup_jobs
    where asset_revision_id = p_asset_revision_id and state = 'COMPLETED'
    union all
    select 1 from public.profile_wrap_cleanup_jobs
    where asset_revision_id = p_asset_revision_id and state = 'COMPLETED'
  ) then
    raise exception using errcode = 'P0001', message = 'asset_cleanup_completed';
  end if;
  insert into public.asset_revision_cleanup_holds(asset_revision_id, held, updated_at)
  values (p_asset_revision_id, p_held, clock_timestamp())
  on conflict (asset_revision_id) do update
    set held = excluded.held, updated_at = excluded.updated_at;
  update public.asset_revision_cleanup_jobs
  set legal_hold = p_held
  where asset_revision_id = p_asset_revision_id and state <> 'COMPLETED';
  return true;
end;
$$;

revoke all on function public.set_asset_revision_cleanup_hold(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_asset_revision_cleanup_hold(uuid, boolean)
  to service_role;

create function public.expire_pending_uploads(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_pending_upload_expiry_limit';
  end if;
  with expired as (
    select id
    from public.pending_uploads
    where state in ('CREATED', 'UPLOADED', 'VALIDATING')
      and expires_at <= clock_timestamp()
    order by expires_at, id
    limit p_limit
    for update skip locked
  )
  update public.pending_uploads pu
  set state = 'EXPIRED', updated_at = clock_timestamp()
  from expired
  where pu.id = expired.id;
  get diagnostics v_count = row_count;
  insert into public.asset_cleanup_jobs (
    pending_upload_id, bucket_id, object_key, reason
  )
  select pu.id, 'wrap-staging', pu.staging_key,
    case when pu.state = 'READY' then 'STAGING_AFTER_READY' else 'FAILED_FINALIZATION' end
  from public.pending_uploads pu
  where pu.state in ('EXPIRED', 'FAILED', 'READY')
  on conflict (bucket_id, object_key) do nothing;
  return v_count;
end;
$$;

revoke all on function public.expire_pending_uploads(integer)
  from public, anon, authenticated;
grant execute on function public.expire_pending_uploads(integer)
  to service_role;

create function public.replace_wrap_asset(
  p_creator_id uuid,
  p_slug text,
  p_asset_revision_id uuid,
  p_template_variant_id uuid
)
returns table (
  id uuid,
  slug text,
  status text,
  first_published_at timestamptz,
  asset_revision_id uuid,
  template_variant_id uuid,
  previous_asset_revision_id uuid,
  cleanup_available_after timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
  v_revision public.asset_revisions%rowtype;
  v_variant public.template_variants%rowtype;
  v_cleanup_after timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p_slug)), 2));
  if not exists (
    select 1 from public.profiles
    where user_id = p_creator_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
    for update
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_not_allowed';
  end if;

  select w.* into v_wrap
  from public.wraps w
  where w.slug = lower(btrim(p_slug)) and w.creator_id = p_creator_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'wrap_not_found';
  end if;
  if v_wrap.status in ('HIDDEN', 'REMOVED') then
    raise exception using errcode = 'P0001', message = 'wrap_unavailable';
  end if;
  if v_wrap.asset_revision_id = p_asset_revision_id then
    return query select v_wrap.id, v_wrap.slug, v_wrap.status,
      v_wrap.first_published_at, v_wrap.asset_revision_id,
      v_wrap.template_variant_id, null::uuid,
      null::timestamptz, false;
    return;
  end if;

  select ar.* into v_revision
  from public.asset_revisions ar
  where ar.id = p_asset_revision_id and ar.owner_id = p_creator_id
  for update;
  if not found or not v_revision.template_verified
    or v_revision.template_variant_id <> p_template_variant_id
    or not exists (
      select 1 from public.pending_uploads pu
      where pu.id = v_revision.source_pending_upload_id
        and pu.owner_id = p_creator_id
        and pu.state = 'READY'
        and pu.asset_revision_id = v_revision.id
    ) then
    raise exception using errcode = 'P0001', message = 'wrap_asset_not_ready';
  end if;
  if exists (
    select 1 from public.wraps w
    where w.asset_revision_id = p_asset_revision_id and w.id <> v_wrap.id
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_revision_in_use';
  end if;
  if exists (
    select 1 from public.asset_revision_cleanup_jobs j
    where j.asset_revision_id = p_asset_revision_id
      and j.state <> 'COMPLETED'
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_revision_cleanup_pending';
  end if;

  select tv.* into v_variant
  from public.template_variants tv
  where tv.id = p_template_variant_id and tv.active;
  if not found or not exists (
    select 1 from public.vehicle_models vm
    where vm.id = v_variant.vehicle_model_id and vm.active
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_template_unavailable';
  end if;
  if v_revision.width_px <> v_variant.width_px
    or v_revision.height_px <> v_variant.height_px then
    raise exception using errcode = 'P0001', message = 'wrap_asset_not_ready';
  end if;
  if (
    select count(*) from public.wrap_assets wa
    where wa.asset_revision_id = v_revision.id
  ) <> 3
    or (
      select count(*)
      from public.wrap_assets wa
      join storage.objects so
        on so.bucket_id = wa.bucket_id and so.name = wa.object_key
      where wa.asset_revision_id = v_revision.id
    ) <> 3 then
    raise exception using errcode = 'P0001', message = 'wrap_assets_incomplete';
  end if;

  v_cleanup_after := clock_timestamp() + interval '30 days';
  perform private.enqueue_asset_revision_cleanup(
    v_wrap.asset_revision_id, v_cleanup_after
  );
  update public.wraps
  set asset_revision_id = v_revision.id,
      template_variant_id = v_variant.id,
      vehicle_model_id = v_variant.vehicle_model_id,
      updated_at = clock_timestamp()
  where public.wraps.id = v_wrap.id;

  return query select v_wrap.id, v_wrap.slug, v_wrap.status,
    v_wrap.first_published_at, v_revision.id, v_variant.id,
    v_wrap.asset_revision_id, v_cleanup_after, true;
end;
$$;

revoke all on function public.replace_wrap_asset(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.replace_wrap_asset(uuid, text, uuid, uuid)
  to service_role;

create function public.claim_asset_revision_cleanup_jobs(p_limit integer default 50)
returns table (
  id uuid,
  asset_revision_id uuid,
  bucket_id text,
  object_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_asset_revision_cleanup_limit';
  end if;
  for v_job in
    select j.id, j.asset_revision_id
    from public.asset_revision_cleanup_jobs j
    where j.available_after <= clock_timestamp()
      and j.attempts < 10
      and not j.legal_hold
      and not exists (
        select 1 from public.asset_revision_cleanup_holds h
        where h.asset_revision_id = j.asset_revision_id and h.held
      )
      and (j.state in ('PENDING', 'FAILED')
        or (j.state = 'PROCESSING'
          and j.claimed_at < clock_timestamp() - interval '10 minutes'))
    order by j.available_after, j.id
    limit p_limit
    for update skip locked
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_job.asset_revision_id::text, 2)
    );
    perform 1 from public.asset_revisions ar
    where ar.id = v_job.asset_revision_id
    for update;
    if exists (
      select 1 from public.wraps w
      where w.asset_revision_id = v_job.asset_revision_id
        and w.status <> 'REMOVED'
    ) then
      continue;
    end if;
    update public.asset_revision_cleanup_jobs j
    set state = 'PROCESSING', attempts = j.attempts + 1,
        claimed_at = clock_timestamp(), last_error = null
    where j.id = v_job.id
      and (j.state in ('PENDING', 'FAILED')
        or (j.state = 'PROCESSING'
          and j.claimed_at < clock_timestamp() - interval '10 minutes'))
      and not j.legal_hold
      and not exists (
        select 1 from public.asset_revision_cleanup_holds h
        where h.asset_revision_id = j.asset_revision_id and h.held
      )
    returning j.id, j.asset_revision_id, j.bucket_id, j.object_key, j.attempts
      into id, asset_revision_id, bucket_id, object_key, attempts;
    if found then return next; end if;
  end loop;
end;
$$;

create function public.complete_asset_revision_cleanup_job(
  p_id uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.asset_revision_cleanup_jobs
  set state = case when p_success then 'COMPLETED' else 'FAILED' end,
      completed_at = case when p_success then clock_timestamp() else null end,
      claimed_at = null,
      last_error = case when p_success then null else left(p_error, 500) end
  where id = p_id and state = 'PROCESSING';
  return found;
end;
$$;

revoke all on function public.claim_asset_revision_cleanup_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.claim_asset_revision_cleanup_jobs(integer)
  to service_role;
revoke all on function public.complete_asset_revision_cleanup_job(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_asset_revision_cleanup_job(uuid, boolean, text)
  to service_role;

create function public.claim_asset_orphan_cleanup_jobs(p_limit integer default 50)
returns table (id uuid, bucket_id text, object_key text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_asset_orphan_cleanup_limit';
  end if;
  return query
  with picked as (
    select j.id
    from public.asset_orphan_cleanup_jobs j
    where j.available_after <= clock_timestamp()
      and j.attempts < 10
      and not exists (
        select 1 from public.wrap_assets wa
        where wa.bucket_id = j.bucket_id and wa.object_key = j.object_key
      )
      and (j.state in ('PENDING', 'FAILED')
        or (j.state = 'PROCESSING'
          and j.claimed_at < clock_timestamp() - interval '10 minutes'))
    order by j.available_after, j.id
    limit p_limit
    for update skip locked
  )
  update public.asset_orphan_cleanup_jobs j
  set state = 'PROCESSING', attempts = j.attempts + 1,
      claimed_at = clock_timestamp(), last_error = null
  from picked
  where j.id = picked.id
  returning j.id, j.bucket_id, j.object_key, j.attempts;
end;
$$;

create function public.complete_asset_orphan_cleanup_job(
  p_id uuid, p_success boolean, p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.asset_orphan_cleanup_jobs
  set state = case when p_success then 'COMPLETED' else 'FAILED' end,
      completed_at = case when p_success then clock_timestamp() else null end,
      claimed_at = null,
      last_error = case when p_success then null else left(p_error, 500) end
  where id = p_id and state = 'PROCESSING';
  return found;
end;
$$;

revoke all on function public.claim_asset_orphan_cleanup_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.claim_asset_orphan_cleanup_jobs(integer)
  to service_role;
revoke all on function public.complete_asset_orphan_cleanup_job(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_asset_orphan_cleanup_job(uuid, boolean, text)
  to service_role;

commit;
