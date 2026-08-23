begin;

create index if not exists launch_rate_buckets_retention_idx
  on private.launch_rate_buckets (policy_key, window_started_at);

create or replace function private.consume_launch_limit(
  p_policy_key text,
  p_principal_key text,
  p_error_code text default 'launch_rate_limited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.launch_rate_policies%rowtype;
  v_started_at timestamptz;
  v_count integer;
begin
  if p_principal_key is null
    or (
      p_principal_key !~ '^v1:[0-9a-f]{64}$'
      and p_principal_key !~ '^v1:[a-z0-9_-]+:[a-z0-9_-]{1,180}$'
      and p_principal_key !~ '^v2:[a-z0-9_-]+:[0-9a-f]{64}$'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_launch_principal';
  end if;

  select * into v_policy
  from private.launch_rate_policies
  where policy_key = p_policy_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'launch_policy_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_policy_key || ':' || p_principal_key, 101)
  );

  select window_started_at, operation_count
  into v_started_at, v_count
  from private.launch_rate_buckets
  where policy_key = p_policy_key and principal_key = p_principal_key
  for update;

  if not found or v_started_at <= clock_timestamp()
      - make_interval(secs => v_policy.window_seconds)
  then
    insert into private.launch_rate_buckets (
      policy_key, principal_key, window_started_at, operation_count
    ) values (p_policy_key, p_principal_key, clock_timestamp(), 1)
    on conflict (policy_key, principal_key) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;

  if v_count >= v_policy.max_count then
    raise exception using errcode = 'P0001', message = coalesce(
      nullif(p_error_code, ''), 'launch_rate_limited'
    );
  end if;

  update private.launch_rate_buckets
  set operation_count = operation_count + 1
  where policy_key = p_policy_key and principal_key = p_principal_key;
end;
$$;

revoke all on function private.consume_launch_limit(text, text, text) from public;

create or replace function public.cleanup_launch_rate_buckets()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from private.launch_rate_buckets bucket
    using private.launch_rate_policies policy
    where bucket.policy_key = policy.policy_key
      and bucket.window_started_at < clock_timestamp()
        - make_interval(secs => policy.retention_seconds)
    returning 1
  )
  select count(*)::bigint from deleted;
$$;

revoke all on function public.cleanup_launch_rate_buckets() from public, anon, authenticated;
grant execute on function public.cleanup_launch_rate_buckets() to service_role;

create or replace function public.cleanup_discovery_cursor_snapshots()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.discovery_cursor_snapshots
    where expires_at <= clock_timestamp()
    returning 1
  )
  select count(*)::bigint from deleted;
$$;

revoke all on function public.cleanup_discovery_cursor_snapshots()
  from public, anon, authenticated;
grant execute on function public.cleanup_discovery_cursor_snapshots() to service_role;

create or replace function private.reconcile_wrap_counts_after_profile(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with affected as (
    select wrap_id as id from public.wrap_likes where user_id = p_user_id
    union
    select wrap_id as id from public.wrap_favorites where user_id = p_user_id
    union
    select wrap_id as id from public.wrap_comments where author_id = p_user_id
    union
    select wrap_id as id from public.download_events where user_id = p_user_id
    union
    select id from public.wraps where creator_id = p_user_id
  ),
  like_counts as (
    select l.wrap_id, count(*)::bigint as value
    from public.wrap_likes l
    join public.profiles actor on actor.user_id = l.user_id
    where actor.participation_state = 'ACTIVE'
      and actor.onboarding_completed_at is not null
      and l.wrap_id in (select id from affected)
    group by l.wrap_id
  ),
  favorite_counts as (
    select f.wrap_id, count(*)::bigint as value
    from public.wrap_favorites f
    join public.profiles actor on actor.user_id = f.user_id
    where actor.participation_state = 'ACTIVE'
      and actor.onboarding_completed_at is not null
      and f.wrap_id in (select id from affected)
    group by f.wrap_id
  ),
  comment_counts as (
    select c.wrap_id, count(*)::bigint as value
    from public.wrap_comments c
    join public.profiles author on author.user_id = c.author_id
    where c.status = 'PUBLISHED'
      and author.participation_state = 'ACTIVE'
      and author.onboarding_completed_at is not null
      and c.wrap_id in (select id from affected)
    group by c.wrap_id
  ),
  download_counts as (
    select event.wrap_id, count(*)::bigint as value
    from public.download_events event
    left join public.profiles actor on actor.user_id = event.user_id
    where event.counted
      and event.wrap_id in (select id from affected)
      and (
        event.user_id is null
        or (
          actor.participation_state = 'ACTIVE'
          and actor.onboarding_completed_at is not null
        )
      )
    group by event.wrap_id
  ),
  recalculated as (
    select
      a.id,
      exists (select 1 from public.discovery_eligible_wraps e where e.id = a.id)
        as eligible,
      coalesce(like_counts.value, 0)::bigint as like_count,
      coalesce(favorite_counts.value, 0)::bigint as favorite_count,
      coalesce(comment_counts.value, 0)::bigint as comment_count,
      coalesce(download_counts.value, 0)::bigint as download_count
    from affected a
    left join like_counts on like_counts.wrap_id = a.id
    left join favorite_counts on favorite_counts.wrap_id = a.id
    left join comment_counts on comment_counts.wrap_id = a.id
    left join download_counts on download_counts.wrap_id = a.id
  )
  update public.wraps w
  set like_count = case when recalculated.eligible then recalculated.like_count else 0 end,
      favorite_count = case when recalculated.eligible then recalculated.favorite_count else 0 end,
      comment_count = case when recalculated.eligible then recalculated.comment_count else 0 end,
      download_count = recalculated.download_count
  from recalculated
  where w.id = recalculated.id;
$$;

revoke all on function private.reconcile_wrap_counts_after_profile(uuid) from public;

create or replace function private.reconcile_social_counts_after_profile_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_wrap_counts_after_profile(new.user_id);
  return new;
end;
$$;

drop trigger if exists reconcile_comments_profile on public.profiles;
drop function if exists private.reconcile_comments_after_profile();

create or replace function private.reconcile_comments_after_model()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with affected as (
    select w.id,
      exists (select 1 from public.discovery_eligible_wraps e where e.id = w.id)
        as eligible
    from public.wraps w
    where w.vehicle_model_id = new.id
  ),
  comment_counts as (
    select c.wrap_id, count(*)::bigint as value
    from public.wrap_comments c
    join public.profiles author on author.user_id = c.author_id
    where c.status = 'PUBLISHED'
      and author.participation_state = 'ACTIVE'
      and author.onboarding_completed_at is not null
      and c.wrap_id in (select id from affected)
    group by c.wrap_id
  )
  update public.wraps w
  set comment_count = case
    when affected.eligible then coalesce(comment_counts.value, 0)::bigint
    else 0::bigint
  end
  from affected
  left join comment_counts on comment_counts.wrap_id = affected.id
  where w.id = affected.id;
  return new;
end;
$$;

revoke all on function private.reconcile_comments_after_model() from public;

create or replace function private.reconcile_download_counts_for_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with affected as (
    select distinct wrap_id as id
    from public.download_events
    where user_id = p_user_id
  ),
  counts as (
    select event.wrap_id, count(*)::bigint as value
    from public.download_events event
    left join public.profiles actor on actor.user_id = event.user_id
    where event.counted
      and event.wrap_id in (select id from affected)
      and (
        event.user_id is null
        or (
          actor.participation_state = 'ACTIVE'
          and actor.onboarding_completed_at is not null
        )
      )
    group by event.wrap_id
  )
  update public.wraps w
  set download_count = coalesce(counts.value, 0)::bigint
  from affected
  left join counts on counts.wrap_id = affected.id
  where w.id = affected.id;
$$;

revoke all on function private.reconcile_download_counts_for_user(uuid) from public;

create or replace function public.reconcile_download_counts()
returns void
language sql
security definer
set search_path = ''
as $$
  with counts as (
    select event.wrap_id, count(*)::bigint as value
    from public.download_events event
    left join public.profiles actor on actor.user_id = event.user_id
    where event.counted
      and (
        event.user_id is null
        or (
          actor.participation_state = 'ACTIVE'
          and actor.onboarding_completed_at is not null
        )
      )
    group by event.wrap_id
  ),
  recalculated as (
    select w.id, coalesce(counts.value, 0)::bigint as download_count
    from public.wraps w
    left join counts on counts.wrap_id = w.id
  )
  update public.wraps w
  set download_count = recalculated.download_count
  from recalculated
  where w.id = recalculated.id;
$$;

revoke all on function public.reconcile_download_counts() from public, anon, authenticated;
grant execute on function public.reconcile_download_counts() to service_role;

create or replace function private.assert_social_target(p_wrap_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  if p_actor_id is null then
    raise exception using errcode = 'P0001', message = 'social_auth_required';
  end if;

  select w.creator_id
  into v_creator_id
  from public.wraps w
  where w.id = p_wrap_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'social_wrap_unavailable';
  end if;
  if v_creator_id = p_actor_id then
    raise exception using errcode = 'P0001', message = 'social_self_action';
  end if;

  perform 1
  from public.profiles p
  where p.user_id in (p_actor_id, v_creator_id)
  order by p.user_id
  for update;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_id
      and p.participation_state = 'ACTIVE'
      and p.onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'social_actor_unavailable';
  end if;

  select w.creator_id
  into v_creator_id
  from public.wraps w
  join public.profiles creator
    on creator.user_id = w.creator_id
   and creator.participation_state = 'ACTIVE'
   and creator.onboarding_completed_at is not null
  join public.vehicle_models vm
    on vm.id = w.vehicle_model_id and vm.active
  join public.template_variants tv
    on tv.id = w.template_variant_id
   and tv.vehicle_model_id = w.vehicle_model_id
  join public.asset_revisions ar
    on ar.id = w.asset_revision_id
   and ar.template_verified
   and ar.template_variant_id = w.template_variant_id
   and ar.width_px = tv.width_px
   and ar.height_px = tv.height_px
  join public.wrap_assets preview
    on preview.asset_revision_id = ar.id
   and preview.kind = 'PREVIEW'
   and preview.bucket_id = 'wrap-derived'
   and preview.width_px > 0
   and preview.height_px > 0
  join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
   and preview_object.name = preview.object_key
  where w.id = p_wrap_id
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
  for update of w;

  if not found then
    raise exception using errcode = 'P0001', message = 'social_wrap_unavailable';
  end if;
  if v_creator_id = p_actor_id then
    raise exception using errcode = 'P0001', message = 'social_self_action';
  end if;
  return v_creator_id;
end;
$$;

revoke all on function private.assert_social_target(uuid, uuid) from public;

-- Keep cursor expiry off the anonymous search read path while replacing the
-- already-installed base function without duplicating its large query body.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.search_discovery_wraps_base(text, text, text, text, text, integer)'::regprocedure
  ) into v_definition;
  if position(
    'delete from public.discovery_cursor_snapshots' in lower(v_definition)
  ) = 0 then
    raise exception 'search_discovery_wraps_base cleanup statement not found';
  end if;
  v_updated := regexp_replace(
    v_definition,
    'delete from public[.]discovery_cursor_snapshots[[:space:]]+where expires_at <= current_timestamp;',
    '',
    1,
    1,
    'i'
  );
  if v_updated = v_definition then
    raise exception 'search_discovery_wraps_base cleanup statement was not replaced';
  end if;
  execute v_updated;
end;
$$;

commit;
