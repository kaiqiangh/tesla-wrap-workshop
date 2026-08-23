-- CI surfaced that refresh_discovery_ranking() ended its data-modifying
-- CTE chain with a bare SELECT, which plpgsql rejects ("query has no
-- destination for result data") -- the cron could never refresh scores.
-- Recreate the function identically but consume the CTEs with perform.
create or replace function public.refresh_discovery_ranking()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calculated_at timestamptz;
begin
  v_calculated_at := clock_timestamp();

  with eligible as (
    select e.id, e.first_published_at
    from public.discovery_eligible_wraps e
  ),
  recent_downloads as (
    select event.wrap_id, count(*)::bigint as counted_downloads
    from public.download_events event
    join public.wraps target on target.id = event.wrap_id
    left join public.profiles downloader on downloader.user_id = event.user_id
    where event.counted
      and event.granted_at >= v_calculated_at - interval '7 days'
      and event.granted_at <= v_calculated_at
      and (
        event.user_id is null
        or (
          downloader.participation_state = 'ACTIVE'
          and downloader.onboarding_completed_at is not null
          and event.user_id <> target.creator_id
        )
      )
    group by event.wrap_id
  ),
  recent_engagement as (
    select
      event.wrap_id,
      count(distinct event.actor_id) filter (where event.kind = 'LIKE')::bigint
        as unique_likes,
      count(distinct event.actor_id) filter (where event.kind = 'FAVORITE')::bigint
        as unique_favorites,
      count(*) filter (where event.kind = 'COMMENT')::bigint as visible_comments
    from public.discovery_engagement_events event
    join public.profiles actor on actor.user_id = event.actor_id
      and actor.participation_state = 'ACTIVE'
      and actor.onboarding_completed_at is not null
    join public.wraps target on target.id = event.wrap_id
    where event.active
      and event.occurred_at >= v_calculated_at - interval '7 days'
      and event.occurred_at <= v_calculated_at
      and event.actor_id <> target.creator_id
    group by event.wrap_id
  ),
  scores as (
    select
      e.id,
      (
        (coalesce(rd.counted_downloads, 0) * 3
          + coalesce(engagement.unique_likes, 0) * 2
          + coalesce(engagement.unique_favorites, 0) * 2
          + coalesce(engagement.visible_comments, 0))::numeric
        / power(
          2 + least(
            greatest(
              extract(epoch from (v_calculated_at - e.first_published_at)) / 86400,
              0
            ),
            30
          ),
          1.5
        )
      ) as score
    from eligible e
    left join recent_downloads rd on rd.wrap_id = e.id
    left join recent_engagement engagement on engagement.wrap_id = e.id
  ),
  apply_scores as (
    update public.wraps w
    set trending_score = scores.score
    from scores
    where w.id = scores.id
      and w.trending_score is distinct from scores.score
    returning 1
  ),
  reset_ineligible as (
    update public.wraps w
    set trending_score = 0
    where w.trending_score <> 0
      and not exists (select 1 from eligible e where e.id = w.id)
    returning 1
  )
  perform count(*)
  from (
    select 1 from apply_scores
    union all
    select 1 from reset_ineligible
  ) applied;

  update public.discovery_ranking_state
  set calculated_at = v_calculated_at, status = 'LIVE'
  where id;

  return v_calculated_at;
end;
$$;

revoke all on function public.refresh_discovery_ranking()
  from public, anon, authenticated;
grant execute on function public.refresh_discovery_ranking() to service_role;
