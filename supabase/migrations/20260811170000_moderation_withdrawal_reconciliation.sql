begin;

alter table public.profiles
  add column if not exists deactivated_at timestamptz,
  add column if not exists recovery_until timestamptz,
  add column if not exists anonymized_at timestamptz;

alter table public.profile_cleanup_jobs
  add column if not exists available_after timestamptz not null default clock_timestamp();

alter table public.asset_cleanup_jobs
  add column if not exists available_after timestamptz not null default clock_timestamp(),
  add column if not exists attempts integer not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_error text;
alter table public.asset_cleanup_jobs
  drop constraint if exists asset_cleanup_jobs_reason_check,
  drop constraint if exists asset_cleanup_jobs_state_check;
alter table public.asset_cleanup_jobs
  add constraint asset_cleanup_jobs_reason_check
    check (reason in ('FAILED_FINALIZATION', 'STAGING_AFTER_READY', 'DEACTIVATED')),
  add constraint asset_cleanup_jobs_state_check
    check (state in ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED'));

create table if not exists public.profile_wrap_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (user_id),
  asset_revision_id uuid not null references public.asset_revisions (id),
  bucket_id text not null check (bucket_id in ('wrap-originals', 'wrap-derived')),
  object_key text not null unique,
  available_after timestamptz not null,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED', 'CANCELED')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

alter table public.profile_wrap_cleanup_jobs enable row level security;
revoke all on public.profile_wrap_cleanup_jobs from public, anon, authenticated;
grant select, insert, update on public.profile_wrap_cleanup_jobs to service_role;

alter table public.moderation_actions drop constraint if exists moderation_action_kind;
alter table public.moderation_actions add constraint moderation_action_kind check (
  action_kind in ('REVIEW', 'RESOLVE', 'DISMISS', 'HIDE', 'REMOVE', 'SUSPEND', 'DEACTIVATE', 'REINSTATE')
);

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
  select ar.owner_id, wa.asset_revision_id, wa.bucket_id, wa.object_key, p_available_after
  from public.asset_revisions ar
  join public.wrap_assets wa on wa.asset_revision_id = ar.id
  where ar.owner_id = p_profile_id
  on conflict (object_key) do update
    set profile_id = excluded.profile_id,
        asset_revision_id = excluded.asset_revision_id,
        bucket_id = excluded.bucket_id,
        available_after = excluded.available_after,
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

create or replace function private.enqueue_profile_staging_cleanup(
  p_profile_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.asset_cleanup_jobs (
    pending_upload_id, bucket_id, object_key, reason, available_after
  )
  select pu.id, 'wrap-staging', pu.staging_key, 'DEACTIVATED', clock_timestamp()
  from public.pending_uploads pu
  where pu.owner_id = p_profile_id
    and pu.state in ('CREATED', 'UPLOADED', 'VALIDATING', 'READY', 'FAILED', 'EXPIRED')
  on conflict (bucket_id, object_key) do update
    set reason = excluded.reason,
        available_after = excluded.available_after,
        state = case when asset_cleanup_jobs.state = 'COMPLETED'
          then asset_cleanup_jobs.state else 'PENDING' end,
        attempts = case when asset_cleanup_jobs.state = 'COMPLETED'
          then asset_cleanup_jobs.attempts else 0 end,
        claimed_at = null,
        last_error = null,
        completed_at = case when asset_cleanup_jobs.state = 'COMPLETED'
          then asset_cleanup_jobs.completed_at else null end;
$$;

revoke all on function private.enqueue_profile_staging_cleanup(uuid) from public;

create or replace function private.guard_pending_upload_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in ('CREATED', 'UPLOADED', 'VALIDATING', 'READY')
    and not exists (
      select 1
      from public.profiles
      where user_id = new.owner_id
        and participation_state = 'ACTIVE'
        and onboarding_completed_at is not null
      for update
    ) then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_pending_upload_owner() from public;
drop trigger if exists guard_pending_upload_owner on public.pending_uploads;
create trigger guard_pending_upload_owner
before insert or update of owner_id, state on public.pending_uploads
for each row execute function private.guard_pending_upload_owner();

create or replace function private.may_upload_staging_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pending_uploads pu
    join public.profiles p on p.user_id = pu.owner_id
    where pu.owner_id = (select auth.uid())
      and pu.staging_key = p_name
      and pu.state = 'CREATED'
      and pu.expires_at > clock_timestamp()
      and p.participation_state = 'ACTIVE'
      and p.onboarding_completed_at is not null
  );
$$;

revoke all on function private.may_upload_staging_object(text) from public;

create or replace function public.claim_asset_cleanup_jobs(p_limit integer default 50)
returns table (
  id uuid,
  pending_upload_id uuid,
  bucket_id text,
  object_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_asset_cleanup_limit';
  end if;
  return query
  with picked as (
    select j.id
    from public.asset_cleanup_jobs j
    where j.available_after <= clock_timestamp()
      and j.attempts < 10
      and (
        j.state in ('PENDING', 'FAILED')
        or (j.state = 'PROCESSING' and j.claimed_at < clock_timestamp() - interval '10 minutes')
      )
    order by j.created_at, j.id
    limit p_limit
    for update skip locked
  )
  update public.asset_cleanup_jobs j
  set state = 'PROCESSING', attempts = j.attempts + 1,
      claimed_at = clock_timestamp(), last_error = null
  from picked
  where j.id = picked.id
  returning j.id, j.pending_upload_id, j.bucket_id, j.object_key, j.attempts;
end;
$$;

revoke all on function public.claim_asset_cleanup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_asset_cleanup_jobs(integer) to service_role;

create or replace function public.complete_asset_cleanup_job(
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
  update public.asset_cleanup_jobs
  set state = case when p_success then 'COMPLETED' else 'FAILED' end,
      completed_at = case when p_success then clock_timestamp() else null end,
      claimed_at = null,
      last_error = case when p_success then null else coalesce(p_error, 'asset_cleanup_failed') end
  where id = p_id and state = 'PROCESSING';
  return found;
end;
$$;

revoke all on function public.complete_asset_cleanup_job(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_asset_cleanup_job(uuid, boolean, text)
  to service_role;

create or replace function private.reconcile_download_counts_for_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.wraps w
  set download_count = (
    select count(*)::bigint
    from public.download_events event
    left join public.profiles actor on actor.user_id = event.user_id
    where event.wrap_id = w.id
      and event.counted
      and (
        event.user_id is null
        or (
          actor.participation_state = 'ACTIVE'
          and actor.onboarding_completed_at is not null
        )
      )
  )
  where exists (
    select 1 from public.download_events event
    where event.wrap_id = w.id and event.user_id = p_user_id
  );
$$;

revoke all on function private.reconcile_download_counts_for_user(uuid) from public;

create or replace function private.reconcile_comments_after_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap_id uuid;
begin
  for v_wrap_id in
    select distinct wrap_id
    from public.wrap_comments
    where author_id = new.user_id
  loop
    perform private.reconcile_wrap_comment_count(v_wrap_id);
  end loop;
  return new;
end;
$$;

revoke all on function private.reconcile_comments_after_profile() from public;
drop trigger if exists reconcile_comments_profile on public.profiles;
create trigger reconcile_comments_profile
after update of participation_state, onboarding_completed_at on public.profiles
for each row
when (old.participation_state is distinct from new.participation_state
  or old.onboarding_completed_at is distinct from new.onboarding_completed_at)
execute function private.reconcile_comments_after_profile();

create or replace function public.reconcile_download_counts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap record;
begin
  for v_wrap in select id from public.wraps order by id for update loop
    update public.wraps w
    set download_count = (
      select count(*)::bigint
      from public.download_events event
      left join public.profiles actor on actor.user_id = event.user_id
      where event.wrap_id = v_wrap.id
        and event.counted
        and (
          event.user_id is null
          or (
            actor.participation_state = 'ACTIVE'
            and actor.onboarding_completed_at is not null
          )
        )
    )
    where w.id = v_wrap.id;
  end loop;
end;
$$;

revoke all on function public.reconcile_download_counts() from public, anon, authenticated;
grant execute on function public.reconcile_download_counts() to service_role;

create or replace function private.deactivate_profile_for_moderation(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_onboarding_completed_at timestamptz;
  v_asset public.profile_avatar_assets%rowtype;
  v_recovery_until timestamptz := clock_timestamp() + interval '30 days';
begin
  select participation_state, onboarding_completed_at
    into v_state, v_onboarding_completed_at
  from public.profiles
  where user_id = p_user_id
  for update;
  if not found or v_state <> 'ACTIVE' or v_onboarding_completed_at is null then
    raise exception using errcode = 'P0001', message = 'admin_target_unavailable';
  end if;
  for v_asset in
    select * from public.profile_avatar_assets
    where profile_id = p_user_id and state = 'ACTIVE'
    for update
  loop
    insert into public.profile_cleanup_jobs (
      profile_id, avatar_asset_id, bucket_id, object_key, available_after
    )
    values
      (p_user_id, v_asset.id, v_asset.source_bucket, v_asset.source_key, v_recovery_until),
      (p_user_id, v_asset.id, v_asset.derived_bucket, v_asset.derived_key, v_recovery_until)
    on conflict (bucket_id, object_key) do nothing;
    update public.profile_avatar_assets
    set state = 'RETIRED', retired_at = clock_timestamp()
    where id = v_asset.id;
  end loop;
  perform private.enqueue_profile_staging_cleanup(p_user_id);
  perform private.enqueue_profile_wrap_cleanup(p_user_id, v_recovery_until);
  delete from auth.sessions where user_id = p_user_id;
  update public.profiles
  set participation_state = 'DEACTIVATED',
      deactivated_at = clock_timestamp(), recovery_until = v_recovery_until,
      anonymized_at = null, avatar_asset_id = null, avatar_url = null
  where user_id = p_user_id;
  perform private.reconcile_download_counts_for_user(p_user_id);
  return true;
end;
$$;

revoke all on function private.deactivate_profile_for_moderation(uuid) from public;

create function private.reinstate_profile_for_moderation(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_recovery_until timestamptz;
  v_anonymized_at timestamptz;
  v_username text;
  v_avatar_id uuid;
begin
  select participation_state, recovery_until, anonymized_at, username
    into v_state, v_recovery_until, v_anonymized_at, v_username
  from public.profiles
  where user_id = p_user_id
  for update;
  if not found or v_state <> 'DEACTIVATED'
    or v_anonymized_at is not null
    or v_recovery_until is null
    or v_recovery_until <= clock_timestamp()
  then
    raise exception using errcode = 'P0001', message = 'moderation_conflict';
  end if;
  if exists (
    select 1 from public.profile_wrap_cleanup_jobs
    where profile_id = p_user_id and state = 'PROCESSING'
  ) then
    raise exception using errcode = 'P0001', message = 'moderation_conflict';
  end if;
  if exists (
    select 1 from public.profile_cleanup_jobs
    where profile_id = p_user_id and state = 'PROCESSING'
  ) then
    raise exception using errcode = 'P0001', message = 'moderation_conflict';
  end if;
  select avatar_asset_id into v_avatar_id
  from public.profile_cleanup_jobs
  where profile_id = p_user_id
    and avatar_asset_id is not null
    and state in ('PENDING', 'FAILED')
  order by created_at desc
  limit 1;
  delete from public.profile_cleanup_jobs
  where profile_id = p_user_id
    and avatar_asset_id is not null
    and avatar_asset_id = v_avatar_id
    and state in ('PENDING', 'FAILED');
  if v_avatar_id is not null then
    update public.profile_avatar_assets
    set state = 'ACTIVE', retired_at = null
    where id = v_avatar_id;
  end if;
  update public.profile_wrap_cleanup_jobs
  set state = 'CANCELED', completed_at = clock_timestamp()
  where profile_id = p_user_id and state in ('PENDING', 'FAILED');
  update public.profiles
  set participation_state = 'ACTIVE', deactivated_at = null, recovery_until = null,
      avatar_asset_id = v_avatar_id,
      avatar_url = case when v_avatar_id is null then null
        else '/api/profiles/' || v_username || '/avatar' end
  where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  perform private.reconcile_download_counts_for_user(p_user_id);
  return true;
end;
$$;

revoke all on function private.reinstate_profile_for_moderation(uuid) from public;

create or replace function public.get_public_profile_details(p_username text)
returns table (
  requested_username text,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  follower_count bigint,
  published_wrap_count bigint,
  ever_published boolean,
  download_count bigint,
  availability text,
  is_alias boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with resolved as (
    select p.*, (a.alias is not null) as alias_hit,
      (p.username = lower(btrim(p_username))) as exact_hit
    from public.profiles p
    left join public.profile_username_aliases a
      on a.profile_id = p.user_id and a.alias = lower(btrim(p_username))
    where p.username = lower(btrim(p_username)) or a.alias is not null
    order by exact_hit desc, p.username
    limit 1
  ), public_profile as (
    select r.*, r.participation_state = 'ACTIVE'
      and r.onboarding_completed_at is not null as is_public
    from resolved r
  ), eligible_wraps as (
    select w.id, w.creator_id
    from public.wraps w
    join public_profile r
      on r.user_id = w.creator_id and r.is_public
    join public.asset_revisions ar on ar.id = w.asset_revision_id
    join public.vehicle_models vm on vm.id = w.vehicle_model_id
    join public.template_variants tv on tv.id = w.template_variant_id
    join public.wrap_assets wa on wa.asset_revision_id = ar.id
      and wa.kind = 'PREVIEW' and wa.bucket_id = 'wrap-derived'
    join storage.objects so on so.bucket_id = wa.bucket_id and so.name = wa.object_key
    where w.status = 'PUBLISHED' and w.deleted_at is null
      and vm.active and ar.template_verified
      and ar.template_variant_id = w.template_variant_id
      and ar.width_px = tv.width_px and ar.height_px = tv.height_px
      and wa.width_px > 0 and wa.height_px > 0
  ), follower_stats as (
    select f.creator_id, count(*)::bigint as follower_count
    from public.creator_follows f
    join public_profile r on r.user_id = f.creator_id and r.is_public
    join public.profiles fp on fp.user_id = f.follower_id
    where fp.participation_state = 'ACTIVE'
      and fp.onboarding_completed_at is not null
    group by f.creator_id
  ), wrap_stats as (
    select creator_id, count(*)::bigint as published_wrap_count
    from eligible_wraps
    group by creator_id
  ), download_stats as (
    select ew.creator_id, count(*)::bigint as download_count
    from eligible_wraps ew
    join public.download_events de on de.wrap_id = ew.id and de.counted
    left join public.profiles actor on actor.user_id = de.user_id
    where de.user_id is null or (
      actor.participation_state = 'ACTIVE'
      and actor.onboarding_completed_at is not null
    )
    group by ew.creator_id
  )
  select lower(btrim(p_username)),
    case when r.is_public then r.username end,
    case when r.is_public then r.display_name end,
    case when r.is_public then r.bio end,
    case when r.is_public and aa.id is not null
      then '/api/profiles/' || r.username || '/avatar' end,
    coalesce(fs.follower_count, 0)::bigint,
    coalesce(ws.published_wrap_count, 0)::bigint,
    case when r.is_public then exists (
      select 1 from public.wraps w
      where w.creator_id = r.user_id and w.first_published_at is not null
    ) else false end,
    coalesce(ds.download_count, 0)::bigint,
    case when r.user_id is null then 'UNAVAILABLE'
      when r.participation_state = 'SUSPENDED' then 'TEMPORARILY_UNAVAILABLE'
      when r.participation_state = 'DEACTIVATED' then 'UNAVAILABLE'
      when r.onboarding_completed_at is null then 'UNAVAILABLE'
      else 'PUBLIC' end,
    case when r.is_public then coalesce(r.alias_hit, false) else false end
  from public_profile r
  left join public.profile_avatar_assets aa
    on aa.id = r.avatar_asset_id and aa.state = 'ACTIVE'
  left join follower_stats fs on fs.creator_id = r.user_id
  left join wrap_stats ws on ws.creator_id = r.user_id
  left join download_stats ds on ds.creator_id = r.user_id;
$$;

revoke all on function public.get_public_profile_details(text) from public;
grant execute on function public.get_public_profile_details(text) to anon, authenticated;

create or replace function public.deactivate_profile()
returns table (deactivated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_state text;
  v_onboarding_completed_at timestamptz;
begin
  select participation_state, onboarding_completed_at
    into v_state, v_onboarding_completed_at
  from public.profiles
  where user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  if v_state = 'DEACTIVATED' then
    return query select false;
    return;
  end if;
  if v_state <> 'ACTIVE' or v_onboarding_completed_at is null then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  perform private.deactivate_profile_for_moderation(v_user_id);
  return query select true;
end;
$$;

revoke all on function public.deactivate_profile() from public, anon;
grant execute on function public.deactivate_profile() to authenticated;

create function public.recover_profile()
returns table (recovered boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_state text;
  v_recovery_until timestamptz;
  v_anonymized_at timestamptz;
  v_username text;
  v_avatar_id uuid;
begin
  select participation_state, recovery_until, anonymized_at, username
    into v_state, v_recovery_until, v_anonymized_at, v_username
  from public.profiles
  where user_id = v_user_id
  for update;
  if not found or v_state <> 'DEACTIVATED' then
    raise exception using errcode = 'P0001', message = 'profile_recovery_unavailable';
  end if;
  if v_anonymized_at is not null
    or v_recovery_until is null
    or v_recovery_until <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'profile_recovery_expired';
  end if;
  if exists (
    select 1 from public.profile_wrap_cleanup_jobs
    where profile_id = v_user_id and state = 'PROCESSING'
  ) then
    raise exception using errcode = 'P0001', message = 'profile_recovery_unavailable';
  end if;
  if exists (
    select 1 from public.profile_cleanup_jobs
    where profile_id = v_user_id and state = 'PROCESSING'
  ) then
    raise exception using errcode = 'P0001', message = 'profile_recovery_unavailable';
  end if;
  select avatar_asset_id into v_avatar_id
  from public.profile_cleanup_jobs
  where profile_id = v_user_id
    and avatar_asset_id is not null
    and state in ('PENDING', 'FAILED')
  order by created_at desc
  limit 1;
  delete from public.profile_cleanup_jobs
  where profile_id = v_user_id
    and avatar_asset_id is not null
    and avatar_asset_id = v_avatar_id
    and state in ('PENDING', 'FAILED');
  if v_avatar_id is not null then
    update public.profile_avatar_assets
    set state = 'ACTIVE', retired_at = null
    where id = v_avatar_id;
  end if;
  update public.profile_wrap_cleanup_jobs
  set state = 'CANCELED', completed_at = clock_timestamp()
  where profile_id = v_user_id and state in ('PENDING', 'FAILED');
  update public.profiles
  set participation_state = 'ACTIVE', deactivated_at = null, recovery_until = null,
      avatar_asset_id = v_avatar_id,
      avatar_url = case when v_avatar_id is null then null
        else '/api/profiles/' || v_username || '/avatar' end
  where user_id = v_user_id;
  delete from auth.sessions
  where user_id = v_user_id
    and (auth.jwt()->>'session_id') is not null
    and id::text <> auth.jwt()->>'session_id';
  perform private.reconcile_download_counts_for_user(v_user_id);
  return query select true;
end;
$$;

revoke all on function public.recover_profile() from public, anon;
grant execute on function public.recover_profile() to authenticated;

create function public.anonymize_expired_profiles(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_profile_anonymization_limit';
  end if;
  for v_profile in
    select user_id
    from public.profiles
    where participation_state = 'DEACTIVATED'
      and anonymized_at is null
      and recovery_until is not null
      and recovery_until <= clock_timestamp()
    order by recovery_until, user_id
    limit p_limit
    for update skip locked
  loop
    update public.profiles
    set username = null, display_name = null, bio = '', onboarding_completed_at = null,
        anonymized_at = clock_timestamp(), updated_at = clock_timestamp()
    where user_id = v_profile.user_id;
    delete from auth.sessions where user_id = v_profile.user_id;
    update auth.identities
    set identity_data = '{}'::jsonb, updated_at = clock_timestamp()
    where user_id = v_profile.user_id;
    update auth.users
    set email = null, phone = null, raw_user_meta_data = '{}'::jsonb,
        raw_app_meta_data = '{}'::jsonb, confirmation_token = null,
        recovery_token = null, email_change = null, phone_change = null,
        email_change_token_new = null, email_change_token_current = null,
        phone_change_token = null, reauthentication_token = null,
        updated_at = clock_timestamp()
    where id = v_profile.user_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.anonymize_expired_profiles(integer) from public, anon, authenticated;
grant execute on function public.anonymize_expired_profiles(integer) to service_role;

create function public.claim_profile_wrap_cleanup_jobs(p_limit integer default 50)
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
  returning j.id, j.bucket_id, j.object_key, j.profile_id, j.attempts;
end;
$$;

create function public.complete_profile_wrap_cleanup_job(
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
  update public.profile_wrap_cleanup_jobs
  set state = case when p_success then 'COMPLETED' else 'FAILED' end,
      completed_at = case when p_success then clock_timestamp() else null end,
      claimed_at = null, last_error = case when p_success then null else left(p_error, 500) end
  where id = p_id and state = 'PROCESSING';
  return found;
end;
$$;

revoke all on function public.claim_profile_wrap_cleanup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_profile_wrap_cleanup_jobs(integer) to service_role;
revoke all on function public.complete_profile_wrap_cleanup_job(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_profile_wrap_cleanup_job(uuid, boolean, text) to service_role;

create or replace function public.claim_profile_cleanup_jobs(p_limit integer default 50)
returns table (
  id uuid,
  profile_id uuid,
  avatar_asset_id uuid,
  bucket_id text,
  object_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select j.id
    from public.profile_cleanup_jobs j
    join public.profiles p on p.user_id = j.profile_id
    where j.available_after <= clock_timestamp()
      and (
        j.state in ('PENDING', 'FAILED')
        or (j.state = 'PROCESSING' and (
          j.claimed_at is null
          or j.claimed_at < clock_timestamp() - interval '10 minutes'
        ))
      )
      and j.attempts < 10
    order by j.created_at, j.id
    for update of p, j skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  update public.profile_cleanup_jobs j
  set state = 'PROCESSING', attempts = j.attempts + 1,
      claimed_at = clock_timestamp(), last_error = null
  from claimed
  where j.id = claimed.id
  returning j.id, j.profile_id, j.avatar_asset_id, j.bucket_id, j.object_key, j.attempts;
end;
$$;

revoke all on function public.claim_profile_cleanup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_profile_cleanup_jobs(integer) to service_role;

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
  if v_action_kind not in ('REVIEW', 'RESOLVE', 'DISMISS', 'HIDE', 'REMOVE', 'SUSPEND', 'DEACTIVATE', 'REINSTATE')
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
      and v_action_kind in ('SUSPEND', 'DEACTIVATE', 'REINSTATE'))
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

  if v_action_kind = 'REINSTATE' and v_report.target_kind = 'USER' then
    select p.participation_state into v_previous_state
    from public.profiles p
    where p.user_id = v_report.target_id
    for update;
    if v_previous_state = 'ACTIVE' then
      raise exception using errcode = 'P0001', message = 'moderation_conflict';
    end if;
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
          perform private.reconcile_download_counts_for_user(v_profile.user_id);
          v_changed := true;
        end if;
      elsif v_action_kind = 'REINSTATE' then
        if v_profile.participation_state = 'ACTIVE' then raise exception using errcode = 'P0001', message = 'moderation_conflict'; end if;
        v_target_state := 'ACTIVE';
        if v_profile.participation_state = 'DEACTIVATED' then
          perform private.reinstate_profile_for_moderation(v_profile.user_id);
          v_changed := true;
        elsif v_profile.participation_state = 'SUSPENDED' then
          update public.profiles set participation_state = 'ACTIVE' where user_id = v_profile.user_id;
          perform private.reconcile_download_counts_for_user(v_profile.user_id);
          v_changed := true;
        end if;
      elsif v_action_kind = 'DEACTIVATE' then
        if v_profile.participation_state <> 'ACTIVE'
          or v_profile.onboarding_completed_at is null then
          raise exception using errcode = 'P0001', message = 'moderation_conflict';
        end if;
        perform private.deactivate_profile_for_moderation(v_profile.user_id);
        v_target_state := 'DEACTIVATED';
        v_changed := true;
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
          when 'DEACTIVATE' then 'USER_DEACTIVATED'
        end) then
        raise exception using errcode = 'P0001', message = 'moderation_conflict';
      end if;
      v_report.outcome_category := case v_action_kind
        when 'HIDE' then 'CONTENT_HIDDEN'
        when 'REMOVE' then 'CONTENT_REMOVED'
        when 'SUSPEND' then 'USER_SUSPENDED'
        when 'DEACTIVATE' then 'USER_DEACTIVATED'
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

create or replace function public.get_public_wrap_base(p_slug text)
returns table (
  id uuid, slug text, title text, description text,
  creator_username text, creator_display_name text,
  vehicle_model_name text, template_variant_name text, template_variant_key text,
  width_px integer, height_px integer, verified_at date, legacy boolean,
  license_type text, tags text[], first_published_at timestamptz,
  download_count bigint, like_count bigint, favorite_count bigint, comment_count bigint,
  preview_width_px integer, preview_height_px integer, preview_available boolean,
  availability_caveat text
)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.slug, w.title, w.description,
    p.username, p.display_name, vm.display_name, tv.display_name,
    tv.catalog_key, ar.width_px, ar.height_px, tv.verified_at,
    not tv.active, w.license_type,
    coalesce(array_agg(t.display_name order by t.slug)
      filter (where t.id is not null), '{}'::text[]),
    w.first_published_at, w.download_count, w.like_count,
    w.favorite_count, w.comment_count, preview.width_px, preview.height_px,
    preview.id is not null and preview_object.id is not null,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id and vm.active
  join public.template_variants tv
    on tv.id = w.template_variant_id
   and tv.vehicle_model_id = w.vehicle_model_id
  join public.asset_revisions ar
    on ar.id = w.asset_revision_id
   and ar.template_verified
   and ar.template_variant_id = w.template_variant_id
   and ar.width_px = tv.width_px
   and ar.height_px = tv.height_px
  left join public.wrap_assets preview
    on preview.asset_revision_id = w.asset_revision_id
   and preview.kind = 'PREVIEW'
   and preview.bucket_id = 'wrap-derived'
   and preview.width_px > 0
   and preview.height_px > 0
  left join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
   and preview_object.name = preview.object_key
  left join public.wrap_tags wt on wt.wrap_id = w.id
  left join public.tags t on t.id = wt.tag_id
  where w.slug = lower(btrim(p_slug))
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
  group by w.id, p.username, p.display_name, vm.display_name,
    tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, tv.active, preview.id, preview.width_px, preview.height_px,
    preview_object.id;
$$;

revoke all on function public.get_public_wrap_base(text) from public, anon, authenticated;

create or replace function public.get_public_wrap_media(p_slug text)
returns table (object_key text, byte_size integer, sha256 text)
language sql stable security definer set search_path = ''
as $$
  select asset.object_key, asset.byte_size, asset.sha256
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id and vm.active
  join public.template_variants tv
    on tv.id = w.template_variant_id
   and tv.vehicle_model_id = w.vehicle_model_id
  join public.asset_revisions ar
    on ar.id = w.asset_revision_id
   and ar.template_verified
   and ar.template_variant_id = w.template_variant_id
   and ar.width_px = tv.width_px
   and ar.height_px = tv.height_px
  join public.wrap_assets asset
    on asset.asset_revision_id = w.asset_revision_id
   and asset.kind = 'PREVIEW'
   and asset.bucket_id = 'wrap-derived'
   and asset.width_px > 0
   and asset.height_px > 0
  join storage.objects stored
    on stored.bucket_id = asset.bucket_id and stored.name = asset.object_key
  where w.slug = lower(btrim(p_slug))
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null;
$$;

revoke all on function public.get_public_wrap_media(text) from public, anon, authenticated;
grant execute on function public.get_public_wrap_media(text) to service_role;


commit;
