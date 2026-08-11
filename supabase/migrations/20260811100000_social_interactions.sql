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

create function private.resolve_social_wrap(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.wraps w
  join public.profiles creator on creator.user_id = w.creator_id
  join public.vehicle_models vm
    on vm.id = w.vehicle_model_id and vm.active
  join public.template_variants tv
    on tv.id = w.template_variant_id
   and tv.vehicle_model_id = w.vehicle_model_id
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  join public.wrap_assets preview
    on preview.asset_revision_id = w.asset_revision_id
   and preview.kind = 'PREVIEW'
   and preview.bucket_id = 'wrap-derived'
  where w.slug = lower(btrim(p_slug))
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and creator.participation_state = 'ACTIVE'
    and creator.onboarding_completed_at is not null
    and ar.template_verified
    and ar.template_variant_id = w.template_variant_id
    and ar.width_px = tv.width_px
    and ar.height_px = tv.height_px
    and preview.width_px > 0
    and preview.height_px > 0
    and exists (
      select 1
      from storage.objects preview_object
      where preview_object.bucket_id = preview.bucket_id
        and preview_object.name = preview.object_key
    )
  limit 1;
$$;

revoke all on function private.resolve_social_wrap(text) from public;

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
  where w.id = p_wrap_id
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and creator.participation_state = 'ACTIVE'
    and creator.onboarding_completed_at is not null
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
  if p_kind is null or p_kind not in ('LIKE', 'FAVORITE') then
    raise exception using errcode = '22023', message = 'invalid_social_kind';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'invalid_social_state';
  end if;

  v_wrap_id := private.resolve_social_wrap(p_slug);
  if v_wrap_id is null then
    raise exception using errcode = 'P0001', message = 'social_wrap_unavailable';
  end if;
  perform 1
  from public.wraps w
  where w.id = v_wrap_id
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

create function public.get_wrap_engagement_state(p_slug text)
returns table (
  liked boolean,
  favorited boolean,
  like_count bigint,
  favorite_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select private.resolve_social_wrap(p_slug) as wrap_id
  ), actor as (
    select auth.uid() as user_id
  )
  select
    exists (
      select 1
      from public.wrap_likes l
      where l.wrap_id = target.wrap_id
        and l.user_id = actor.user_id
    ),
    exists (
      select 1
      from public.wrap_favorites f
      where f.wrap_id = target.wrap_id
        and f.user_id = actor.user_id
    ),
    (
      select count(*)
      from public.wrap_likes l
      join public.profiles p on p.user_id = l.user_id
      where l.wrap_id = target.wrap_id
        and p.participation_state = 'ACTIVE'
        and p.onboarding_completed_at is not null
    ),
    (
      select count(*)
      from public.wrap_favorites f
      join public.profiles p on p.user_id = f.user_id
      where f.wrap_id = target.wrap_id
        and p.participation_state = 'ACTIVE'
        and p.onboarding_completed_at is not null
    )
  from target cross join actor
  where target.wrap_id is not null;
$$;

revoke all on function public.get_wrap_engagement_state(text) from public;
grant execute on function public.get_wrap_engagement_state(text) to anon, authenticated;

create function private.reconcile_wrap_social_counts(p_wrap_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wraps
  set like_count = (
        select count(*)
        from public.wrap_likes l
        join public.profiles p on p.user_id = l.user_id
        where l.wrap_id = p_wrap_id
          and p.participation_state = 'ACTIVE'
          and p.onboarding_completed_at is not null
      ),
      favorite_count = (
        select count(*)
        from public.wrap_favorites f
        join public.profiles p on p.user_id = f.user_id
        where f.wrap_id = p_wrap_id
          and p.participation_state = 'ACTIVE'
          and p.onboarding_completed_at is not null
      )
  where id = p_wrap_id;
end;
$$;

revoke all on function private.reconcile_wrap_social_counts(uuid) from public;

create function private.reconcile_social_counts_after_profile()
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
  loop
    perform private.reconcile_wrap_social_counts(v_wrap_id);
  end loop;
  return new;
end;
$$;

revoke all on function private.reconcile_social_counts_after_profile() from public;
create trigger reconcile_social_counts_profile
after update of participation_state, onboarding_completed_at on public.profiles
for each row
when (
  old.participation_state is distinct from new.participation_state
  or old.onboarding_completed_at is distinct from new.onboarding_completed_at
)
execute function private.reconcile_social_counts_after_profile();

create function private.reconcile_social_counts_after_wrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_wrap_social_counts(new.id);
  return new;
end;
$$;

revoke all on function private.reconcile_social_counts_after_wrap() from public;
create trigger reconcile_social_counts_wrap
after update of status, deleted_at on public.wraps
for each row
when (
  old.status is distinct from new.status
  or old.deleted_at is distinct from new.deleted_at
)
execute function private.reconcile_social_counts_after_wrap();
