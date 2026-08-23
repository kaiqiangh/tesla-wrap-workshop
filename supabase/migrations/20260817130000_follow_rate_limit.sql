-- Follow rate limiting (#PR-03): follows previously had no per-user bound,
-- letting one session churn creator_follows rows across every Creator.
-- Mirrors the engagement limiter (social_user_minute) via launch limits.
begin;

insert into private.launch_rate_policies (policy_key, window_seconds, max_count, retention_seconds)
values ('follow_user_minute', 60, 30, 86400)
on conflict (policy_key) do update
set window_seconds = excluded.window_seconds,
    max_count = excluded.max_count,
    retention_seconds = excluded.retention_seconds;

create or replace function private.consume_follow_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'follow_auth_required';
  end if;
  perform private.consume_launch_limit(
    'follow_user_minute', 'v1:user:' || p_user_id::text, 'follow_rate_limited'
  );
end;
$$;
revoke all on function private.consume_follow_slot(uuid) from public;

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
  perform private.consume_follow_slot(v_actor_id);
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

commit;
