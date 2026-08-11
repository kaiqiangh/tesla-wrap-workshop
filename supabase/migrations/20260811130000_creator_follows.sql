begin;

create or replace function public.toggle_creator_follow(
  p_username text,
  p_enabled boolean
)
returns table (following boolean, follower_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_target_id uuid;
  v_actor_state text;
  v_target_state text;
  v_actor_onboarded timestamptz;
  v_target_onboarded timestamptz;
begin
  if v_actor_id is null then
    raise exception using errcode = 'P0001', message = 'follow_auth_required';
  end if;
  if p_enabled is null then
    raise exception using errcode = 'P0001', message = 'follow_invalid_state';
  end if;

  select p.user_id
  into v_target_id
  from public.profiles p
  left join public.profile_username_aliases a
    on a.profile_id = p.user_id
   and a.alias = lower(btrim(p_username))
  where p.username = lower(btrim(p_username)) or a.alias is not null
  order by (p.username = lower(btrim(p_username))) desc, p.username
  limit 1;

  if v_target_id is null then
    raise exception using errcode = 'P0001', message = 'follow_creator_unavailable';
  end if;
  if v_actor_id = v_target_id then
    raise exception using errcode = 'P0001', message = 'follow_self';
  end if;

  perform 1
  from public.profiles p
  where p.user_id in (v_actor_id, v_target_id)
  order by p.user_id
  for update;

  select p.participation_state, p.onboarding_completed_at
  into v_actor_state, v_actor_onboarded
  from public.profiles p
  where p.user_id = v_actor_id;
  if v_actor_state is distinct from 'ACTIVE' or v_actor_onboarded is null then
    raise exception using errcode = 'P0001', message = 'follow_actor_unavailable';
  end if;

  select p.participation_state, p.onboarding_completed_at
  into v_target_state, v_target_onboarded
  from public.profiles p
  where p.user_id = v_target_id;
  if v_target_state is distinct from 'ACTIVE'
     or v_target_onboarded is null
     or not exists (
       select 1
       from public.wraps w
       where w.creator_id = v_target_id
         and w.first_published_at is not null
     ) then
    raise exception using errcode = 'P0001', message = 'follow_creator_unavailable';
  end if;

  if p_enabled then
    insert into public.creator_follows (follower_id, creator_id)
    values (v_actor_id, v_target_id)
    on conflict (follower_id, creator_id) do nothing;
  else
    delete from public.creator_follows
    where follower_id = v_actor_id and creator_id = v_target_id;
  end if;

  return query
  select p_enabled,
    (
      select count(*)::bigint
      from public.creator_follows f
      join public.profiles follower on follower.user_id = f.follower_id
      where f.creator_id = v_target_id
        and follower.participation_state = 'ACTIVE'
        and follower.onboarding_completed_at is not null
    );
end;
$$;

revoke all on function public.toggle_creator_follow(text, boolean) from public, anon;
grant execute on function public.toggle_creator_follow(text, boolean) to authenticated;

create or replace function public.get_creator_follow_state(p_username text)
returns table (following boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.creator_follows f
    join public.profiles actor on actor.user_id = f.follower_id
      and actor.participation_state = 'ACTIVE'
      and actor.onboarding_completed_at is not null
    join public.profiles target on target.user_id = f.creator_id
      and target.participation_state = 'ACTIVE'
      and target.onboarding_completed_at is not null
    left join public.profile_username_aliases a
      on a.profile_id = target.user_id
     and a.alias = lower(btrim(p_username))
    where f.follower_id = (select auth.uid())
      and (target.username = lower(btrim(p_username)) or a.alias is not null)
      and exists (
        select 1 from public.wraps w
        where w.creator_id = target.user_id and w.first_published_at is not null
      )
  );
$$;

revoke all on function public.get_creator_follow_state(text) from public, anon;
grant execute on function public.get_creator_follow_state(text) to authenticated;

commit;
