create table public.wrap_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  wrap_id uuid not null references public.wraps (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, wrap_id)
);

create table public.wrap_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  wrap_id uuid not null references public.wraps (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, wrap_id)
);

create index wrap_likes_wrap_idx on public.wrap_likes (wrap_id, created_at desc);
create index wrap_favorites_wrap_idx on public.wrap_favorites (wrap_id, created_at desc);

alter table public.wrap_likes enable row level security;
alter table public.wrap_favorites enable row level security;
revoke all on public.wrap_likes, public.wrap_favorites from public, anon, authenticated;
grant select, insert, delete on public.wrap_likes, public.wrap_favorites to service_role;

create function private.assert_social_target(p_wrap_id uuid, p_actor_id uuid)
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
  join public.profiles creator on creator.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id and vm.active
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  where w.id = p_wrap_id
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and creator.participation_state = 'ACTIVE'
    and creator.onboarding_completed_at is not null
    and ar.template_verified
    and ar.width_px > 0
    and ar.height_px > 0
    and exists (
      select 1
      from public.wrap_assets wa
      join storage.objects so
        on so.bucket_id = wa.bucket_id
       and so.name = wa.object_key
      where wa.asset_revision_id = w.asset_revision_id
        and wa.kind = 'PREVIEW'
        and wa.bucket_id = 'wrap-derived'
    )
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
  v_creator_id uuid;
  v_affected integer := 0;
  v_enabled boolean;
  v_like_count bigint;
  v_favorite_count bigint;
begin
  if p_kind not in ('LIKE', 'FAVORITE') then
    raise exception using errcode = '22023', message = 'invalid_social_kind';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'invalid_social_state';
  end if;

  select w.id
  into v_wrap_id
  from public.wraps w
  where w.slug = lower(btrim(p_slug))
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_wrap_unavailable';
  end if;

  v_creator_id := private.assert_social_target(v_wrap_id, v_actor_id);

  if p_kind = 'LIKE' then
    if p_enabled then
      insert into public.wrap_likes (user_id, wrap_id)
      values (v_actor_id, v_wrap_id)
      on conflict do nothing;
      get diagnostics v_affected = row_count;
      if v_affected > 0 then
        insert into public.discovery_engagement_events (
          wrap_id, actor_id, kind, active
        ) values (v_wrap_id, v_actor_id, 'LIKE', true);
      end if;
    else
      delete from public.wrap_likes
      where user_id = v_actor_id and wrap_id = v_wrap_id;
      get diagnostics v_affected = row_count;
      if v_affected > 0 then
        update public.discovery_engagement_events
        set active = false
        where id = (
          select event.id
          from public.discovery_engagement_events event
          where event.wrap_id = v_wrap_id
            and event.actor_id = v_actor_id
            and event.kind = 'LIKE'
            and event.active
          order by event.occurred_at desc, event.id desc
          limit 1
        );
      end if;
    end if;
    select exists (
      select 1 from public.wrap_likes
      where user_id = v_actor_id and wrap_id = v_wrap_id
    ) into v_enabled;
  else
    if p_enabled then
      insert into public.wrap_favorites (user_id, wrap_id)
      values (v_actor_id, v_wrap_id)
      on conflict do nothing;
      get diagnostics v_affected = row_count;
      if v_affected > 0 then
        insert into public.discovery_engagement_events (
          wrap_id, actor_id, kind, active
        ) values (v_wrap_id, v_actor_id, 'FAVORITE', true);
      end if;
    else
      delete from public.wrap_favorites
      where user_id = v_actor_id and wrap_id = v_wrap_id;
      get diagnostics v_affected = row_count;
      if v_affected > 0 then
        update public.discovery_engagement_events
        set active = false
        where id = (
          select event.id
          from public.discovery_engagement_events event
          where event.wrap_id = v_wrap_id
            and event.actor_id = v_actor_id
            and event.kind = 'FAVORITE'
            and event.active
          order by event.occurred_at desc, event.id desc
          limit 1
        );
      end if;
    end if;
    select exists (
      select 1 from public.wrap_favorites
      where user_id = v_actor_id and wrap_id = v_wrap_id
    ) into v_enabled;
  end if;

  select count(*)
  into v_like_count
  from public.wrap_likes l
  join public.profiles actor on actor.user_id = l.user_id
  where l.wrap_id = v_wrap_id
    and actor.participation_state = 'ACTIVE'
    and actor.onboarding_completed_at is not null;

  select count(*)
  into v_favorite_count
  from public.wrap_favorites f
  join public.profiles actor on actor.user_id = f.user_id
  where f.wrap_id = v_wrap_id
    and actor.participation_state = 'ACTIVE'
    and actor.onboarding_completed_at is not null;

  update public.wraps
  set like_count = v_like_count,
      favorite_count = v_favorite_count
  where id = v_wrap_id;

  return query select p_kind, v_enabled, v_like_count, v_favorite_count;
end;
$$;

revoke all on function public.toggle_wrap_engagement(text, text, boolean)
  from public, anon;
grant execute on function public.toggle_wrap_engagement(text, text, boolean)
  to authenticated;
