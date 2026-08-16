create table private.social_toggle_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  operation_count integer not null default 0
    check (operation_count >= 0)
);

revoke all on table private.social_toggle_rate_limits from public;

create function private.consume_social_toggle_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_started_at timestamptz;
  v_operation_count integer;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'social_auth_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 23));
  select window_started_at, operation_count
  into v_window_started_at, v_operation_count
  from private.social_toggle_rate_limits
  where user_id = p_user_id
  for update;

  if not found or v_window_started_at <= clock_timestamp() - interval '1 hour' then
    insert into private.social_toggle_rate_limits (
      user_id, window_started_at, operation_count
    ) values (p_user_id, clock_timestamp(), 1)
    on conflict (user_id) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;

  if v_operation_count >= 10 then
    raise exception using errcode = 'P0001', message = 'social_rate_limited';
  end if;

  update private.social_toggle_rate_limits
  set operation_count = operation_count + 1
  where user_id = p_user_id;
end;
$$;

revoke all on function private.consume_social_toggle_slot(uuid) from public;

alter function public.toggle_wrap_engagement(text, text, boolean)
  set schema private;
alter function private.toggle_wrap_engagement(text, text, boolean)
  rename to toggle_wrap_engagement_base;
revoke all on function private.toggle_wrap_engagement_base(text, text, boolean)
  from public, anon, authenticated;

create function public.toggle_wrap_engagement(
  p_slug text,
  p_kind text,
  p_enabled boolean
)
returns table (
  kind text,
  enabled boolean,
  like_count bigint,
  favorite_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_wrap_id uuid;
begin
  v_wrap_id := private.resolve_social_wrap(p_slug);
  if v_wrap_id is null then
    raise exception using errcode = 'P0001', message = 'social_wrap_unavailable';
  end if;
  perform private.assert_social_target(v_wrap_id, v_actor_id);
  perform private.consume_social_toggle_slot(v_actor_id);
  return query
  select result.kind, result.enabled, result.like_count, result.favorite_count
  from private.toggle_wrap_engagement_base(p_slug, p_kind, p_enabled) result;
end;
$$;

revoke all on function public.toggle_wrap_engagement(text, text, boolean)
  from public, anon;
grant execute on function public.toggle_wrap_engagement(text, text, boolean)
  to authenticated;

create or replace function private.reconcile_wrap_social_counts(p_wrap_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_eligible boolean;
begin
  select exists (
    select 1
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
  ) into v_target_eligible;

  update public.wraps
  set like_count = case when v_target_eligible then (
        select count(*)
        from public.wrap_likes l
        join public.profiles p on p.user_id = l.user_id
        where l.wrap_id = p_wrap_id
          and p.participation_state = 'ACTIVE'
          and p.onboarding_completed_at is not null
      ) else 0 end,
      favorite_count = case when v_target_eligible then (
        select count(*)
        from public.wrap_favorites f
        join public.profiles p on p.user_id = f.user_id
        where f.wrap_id = p_wrap_id
          and p.participation_state = 'ACTIVE'
          and p.onboarding_completed_at is not null
      ) else 0 end
  where id = p_wrap_id;
end;
$$;

revoke all on function private.reconcile_wrap_social_counts(uuid) from public;

create function private.reconcile_social_counts_after_profile_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap_id uuid;
begin
  for v_wrap_id in
    select wrap_id from public.wrap_likes where user_id = new.user_id
    union
    select wrap_id from public.wrap_favorites where user_id = new.user_id
    union
    select id from public.wraps where creator_id = new.user_id
  loop
    perform private.reconcile_wrap_social_counts(v_wrap_id);
  end loop;
  return new;
end;
$$;

revoke all on function private.reconcile_social_counts_after_profile_v2() from public;
drop trigger reconcile_social_counts_profile on public.profiles;
create trigger reconcile_social_counts_profile
after update of participation_state, onboarding_completed_at on public.profiles
for each row
when (
  old.participation_state is distinct from new.participation_state
  or old.onboarding_completed_at is distinct from new.onboarding_completed_at
)
execute function private.reconcile_social_counts_after_profile_v2();
