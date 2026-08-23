begin;

-- ---------------------------------------------------------------------------
-- Unify Trending Score (review findings DB-01 / DB-02, issue #57)
--
-- 1. Drop the dead browse RPC surface: the application exclusively reads the
--    search functions (src/lib/discovery.ts delegates getDiscoveryWraps to
--    searchDiscoveryWraps), so the lifetime-formula get_discovery_wraps and
--    its _base twin were never user-visible.
-- 2. Persist the one live 7-day eligible-engagement formula onto wraps so the
--    hourly ranking cron computes it once instead of every TRENDING request
--    recomputing engagement laterals inline.
-- ---------------------------------------------------------------------------

drop function public.get_discovery_wraps(text, text, integer);
drop function public.get_discovery_wraps_base(text, text, integer);

alter table public.wraps add column trending_score numeric not null default 0;

create index wraps_trending_score_idx
  on public.wraps (trending_score desc, id desc)
  where status = 'PUBLISHED' and deleted_at is null;

-- The cron now owns score computation. The expression is byte-for-byte the
-- one that lived inside search's candidates CTE (weights 3/2/2/1 over the
-- 7-day eligible-engagement aggregates, age clamped to 30 days), so ranking
-- semantics are unchanged; only their evaluation point moves from read time
-- to refresh time. discovery_ranking_state.calculated_at remains the single
-- freshness authority consumed by the <=2h FALLBACK_NEWEST gate.
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
    select w.id, w.first_published_at
    from public.wraps w
    join public.profiles p on p.user_id = w.creator_id
    join public.vehicle_models vm on vm.id = w.vehicle_model_id and vm.active
    join public.template_variants tv on tv.id = w.template_variant_id
    join public.asset_revisions ar on ar.id = w.asset_revision_id
    join public.wrap_assets preview
      on preview.asset_revision_id = w.asset_revision_id
      and preview.kind = 'PREVIEW'
      and preview.bucket_id = 'wrap-derived'
    where w.status = 'PUBLISHED'
      and w.deleted_at is null
      and p.participation_state = 'ACTIVE'
      and p.onboarding_completed_at is not null
      and ar.template_verified
      and ar.template_variant_id = w.template_variant_id
      and ar.width_px = tv.width_px
      and ar.height_px = tv.height_px
      and preview.width_px > 0
      and preview.height_px > 0
      and exists (
        select 1 from storage.objects preview_object
        where preview_object.bucket_id = preview.bucket_id
          and preview_object.name = preview.object_key
      )
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
          + coalesce(re_.unique_likes, 0) * 2
          + coalesce(re_.unique_favorites, 0) * 2
          + coalesce(re_.visible_comments, 0))::numeric
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
    left join recent_engagement re_ on re_.wrap_id = e.id
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
  select
    (select count(*) from apply_scores)
    + (select count(*) from reset_ineligible);

  update public.discovery_ranking_state
  set calculated_at = v_calculated_at, status = 'LIVE'
  where id;

  return v_calculated_at;
end;
$$;

revoke all on function public.refresh_discovery_ranking()
  from public, anon, authenticated;
grant execute on function public.refresh_discovery_ranking() to service_role;

-- The search base now reads persisted scores: identical signature, contract,
-- cursor mechanics, and fallback gate; the per-request engagement laterals
-- and inline formula are gone. Cursor snapshots keep storing trending_score,
-- so keyset continuation is unchanged (scores move at most once per refresh
-- window, within the snapshot TTL by design).
create or replace function public.search_discovery_wraps_base(
  p_q text default null,
  p_model_slug text default null,
  p_variant_key text default null,
  p_sort text default 'NEWEST',
  p_cursor text default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(extensions.unaccent(coalesce(p_q, ''))), '');
  v_model text := nullif(lower(btrim(coalesce(p_model_slug, ''))), '');
  v_variant text := nullif(lower(btrim(coalesce(p_variant_key, ''))), '');
  v_like_query text;
  v_fts_query text;
  v_sort text := upper(coalesce(nullif(btrim(p_sort), ''), 'NEWEST'));
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_cursor jsonb;
  v_calculated_at timestamptz;
  v_effective_sort text;
  v_ranking_status text := 'LIVE';
  v_items jsonb;
  v_has_next boolean;
  v_next_cursor text;
  v_last_trending_score numeric;
  v_last_download_count bigint;
  v_last_first_published_at timestamptz;
  v_last_relevance real;
  v_last_id uuid;
  v_result jsonb;
begin
  if v_sort not in ('TRENDING', 'NEWEST', 'MOST_DOWNLOADED') then
    raise exception using errcode = '22023', message = 'invalid_discovery_sort';
  end if;
  if p_cursor is not null then
    begin
      if btrim(p_cursor) = '' then
        raise exception using errcode = '22023', message = 'invalid_discovery_cursor';
      end if;
      if p_cursor !~ '^[0-9a-f]{36}$' then
        raise exception using errcode = '22023', message = 'invalid_discovery_cursor';
      end if;
      select snapshot.payload, snapshot.calculated_at
      into v_cursor, v_calculated_at
      from public.discovery_cursor_snapshots snapshot
      where snapshot.token = p_cursor
        and snapshot.expires_at > current_timestamp;
      if v_cursor is null then
        raise exception using errcode = '22023', message = 'invalid_discovery_cursor';
      end if;
      if v_cursor->>'q' is distinct from v_query
        or v_cursor->>'model' is distinct from v_model
        or v_cursor->>'variant' is distinct from v_variant
        or v_cursor->>'sort' is distinct from v_sort
        or (v_cursor->>'limit')::integer is distinct from v_limit
      then
          raise exception using errcode = '22023', message = 'invalid_discovery_cursor';
      end if;
      v_effective_sort := coalesce(v_cursor->>'effective_sort', v_sort);
      v_ranking_status := coalesce(v_cursor->>'ranking_status', 'LIVE');
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_discovery_cursor';
    end;
  else
    v_cursor := null;
    select state.calculated_at, state.status
    into v_calculated_at, v_ranking_status
    from public.discovery_ranking_state state
    where state.id;
    v_calculated_at := coalesce(v_calculated_at, current_timestamp);
    if v_sort = 'TRENDING'
      and (v_ranking_status <> 'LIVE'
        or v_calculated_at < current_timestamp - interval '2 hours')
    then
      v_effective_sort := 'NEWEST';
      v_ranking_status := 'FALLBACK_NEWEST';
    else
      v_effective_sort := v_sort;
      v_ranking_status := 'LIVE';
    end if;
  end if;

  delete from public.discovery_cursor_snapshots
  where expires_at <= current_timestamp;

  with candidates as (
      select
        w.id,
        w.slug,
        w.title,
        w.description,
        p.username as creator_username,
        p.display_name as creator_display_name,
        vm.slug as vehicle_model_slug,
        vm.display_name as vehicle_model_name,
        tv.display_name as template_variant_name,
        tv.catalog_key as template_variant_key,
        ar.width_px,
        ar.height_px,
        tv.verified_at,
        not tv.active as legacy,
        w.license_type,
        coalesce(
          array_agg(t.display_name order by t.slug)
            filter (where t.id is not null),
          '{}'::text[]
        ) as tags,
        w.first_published_at,
        w.download_count,
        w.like_count,
        w.favorite_count,
        w.comment_count,
        w.trending_score as trending_score,
        preview.width_px as preview_width_px,
        preview.height_px as preview_height_px,
        true as preview_available,
        'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'::text
          as availability_caveat,
        case when v_fts_query is null then 0::real else
          ts_rank_cd(
            setweight(to_tsvector('simple', extensions.unaccent(w.title)), 'A') ||
            setweight(to_tsvector('simple', extensions.unaccent(w.description)), 'B') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(string_agg(t.display_name, ' ' order by t.slug), ''))), 'C') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.username, ''))), 'A') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.display_name, ''))), 'B'),
            websearch_to_tsquery('simple', v_fts_query)
          )
          + greatest(
            extensions.similarity(extensions.unaccent(w.title), v_query),
            extensions.similarity(extensions.unaccent(coalesce(p.username, '')), v_query),
            extensions.similarity(extensions.unaccent(coalesce(p.display_name, '')), v_query)
          )::real
        end as search_relevance
      from public.wraps w
      join public.profiles p on p.user_id = w.creator_id
      join public.vehicle_models vm on vm.id = w.vehicle_model_id
      join public.template_variants tv on tv.id = w.template_variant_id
      join public.asset_revisions ar on ar.id = w.asset_revision_id
      join public.wrap_assets preview
        on preview.asset_revision_id = w.asset_revision_id
        and preview.kind = 'PREVIEW'
        and preview.bucket_id = 'wrap-derived'
      left join public.wrap_tags wt on wt.wrap_id = w.id
      left join public.tags t on t.id = wt.tag_id
      where w.status = 'PUBLISHED'
        and w.deleted_at is null
        and p.participation_state = 'ACTIVE'
        and p.onboarding_completed_at is not null
        and vm.active
        and ar.template_verified
        and ar.template_variant_id = w.template_variant_id
        and ar.width_px = tv.width_px
        and ar.height_px = tv.height_px
        and preview.width_px > 0
        and preview.height_px > 0
        and exists (
          select 1 from storage.objects preview_object
          where preview_object.bucket_id = preview.bucket_id
            and preview_object.name = preview.object_key
        )
        and (v_model is null or vm.slug = v_model)
        and (v_variant is null or tv.catalog_key = v_variant)
        and (
          v_query is null
          or (v_fts_query is not null and (
            to_tsvector('simple', extensions.unaccent(w.title)) ||
            to_tsvector('simple', extensions.unaccent(w.description)) ||
            to_tsvector('simple', extensions.unaccent(coalesce(p.username, ''))) ||
            to_tsvector('simple', extensions.unaccent(coalesce(p.display_name, '')))
          ) @@ websearch_to_tsquery('simple', v_fts_query))
          or extensions.unaccent(w.title) ilike v_like_query || '%' escape E'\'
          or extensions.unaccent(w.description) ilike v_like_query || '%' escape E'\'
          or extensions.unaccent(coalesce(p.username, '')) ilike v_like_query || '%' escape E'\'
          or extensions.unaccent(coalesce(p.display_name, '')) ilike v_like_query || '%' escape E'\'
          or extensions.similarity(extensions.unaccent(w.title), v_query) >= 0.25
          or extensions.similarity(extensions.unaccent(w.description), v_query) >= 0.25
          or extensions.similarity(extensions.unaccent(coalesce(p.username, '')), v_query) >= 0.25
          or extensions.similarity(extensions.unaccent(coalesce(p.display_name, '')), v_query) >= 0.25
          or exists (
            select 1
            from public.wrap_tags query_wt
            join public.tags query_t on query_t.id = query_wt.tag_id
            where query_wt.wrap_id = w.id
              and (
                extensions.unaccent(query_t.display_name) ilike v_like_query || '%' escape E'\'
                or (v_fts_query is not null and
                  to_tsvector('simple', extensions.unaccent(query_t.display_name))
                    @@ websearch_to_tsquery('simple', v_fts_query))
                or extensions.similarity(extensions.unaccent(query_t.display_name), v_query) >= 0.25
              )
          )
        )
      group by w.id, p.username, p.display_name, vm.slug, vm.display_name,
        tv.display_name, tv.catalog_key, tv.verified_at, tv.active,
        ar.width_px, ar.height_px, preview.width_px, preview.height_px
    ),
    ordered as (
      select candidates.*,
        row_number() over (
          order by
            case when v_effective_sort = 'TRENDING' then trending_score end desc nulls last,
            case when v_effective_sort = 'MOST_DOWNLOADED' then download_count end desc nulls last,
            case when v_effective_sort = 'NEWEST' then first_published_at end desc nulls last,
            first_published_at desc,
            search_relevance desc,
            id desc
        ) as row_number
      from candidates
      where v_cursor is null
        or (
          v_effective_sort = 'TRENDING'
          and (
            trending_score < (v_cursor->>'trending_score')::numeric
            or (trending_score = (v_cursor->>'trending_score')::numeric
              and first_published_at < (v_cursor->>'first_published_at')::timestamptz)
            or (trending_score = (v_cursor->>'trending_score')::numeric
              and first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance < (v_cursor->>'relevance')::real)
            or (trending_score = (v_cursor->>'trending_score')::numeric
              and first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance = (v_cursor->>'relevance')::real
              and id < (v_cursor->>'id')::uuid)
          )
          or v_effective_sort = 'MOST_DOWNLOADED' and (
            download_count < (v_cursor->>'download_count')::bigint
            or (download_count = (v_cursor->>'download_count')::bigint
              and first_published_at < (v_cursor->>'first_published_at')::timestamptz)
            or (download_count = (v_cursor->>'download_count')::bigint
              and first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance < (v_cursor->>'relevance')::real)
            or (download_count = (v_cursor->>'download_count')::bigint
              and first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance = (v_cursor->>'relevance')::real
              and id < (v_cursor->>'id')::uuid)
          )
          or v_effective_sort = 'NEWEST' and (
            first_published_at < (v_cursor->>'first_published_at')::timestamptz
            or (first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance < (v_cursor->>'relevance')::real)
            or (first_published_at = (v_cursor->>'first_published_at')::timestamptz
              and search_relevance = (v_cursor->>'relevance')::real
              and id < (v_cursor->>'id')::uuid)
          )
        )
    ),
    page as (
      select * from ordered where row_number <= v_limit
    ),
    last_page as (
      select * from ordered where row_number = v_limit
    ),
    page_json as (
      select coalesce(
        jsonb_agg(
          to_jsonb(page)
            - 'row_number'
            - 'search_relevance'
            - 'trending_score'
          order by row_number
        ),
        '[]'::jsonb
      ) as items
      from page
    ),
    next_page as (
      select exists(select 1 from ordered where row_number = v_limit + 1) as has_next
    )
    select
      page_json.items,
      next_page.has_next,
      last_page.trending_score,
      last_page.download_count,
      last_page.first_published_at,
      last_page.search_relevance,
      last_page.id
    into
      v_items,
      v_has_next,
      v_last_trending_score,
      v_last_download_count,
      v_last_first_published_at,
      v_last_relevance,
      v_last_id
    from page_json, next_page
    left join last_page on true;

  if v_has_next then
    v_next_cursor := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.discovery_cursor_snapshots (
      token, payload, calculated_at, expires_at
    ) values (
      v_next_cursor,
      jsonb_build_object(
        'q', v_query,
        'model', v_model,
        'variant', v_variant,
        'sort', v_sort,
        'limit', v_limit,
        'effective_sort', v_effective_sort,
        'ranking_status', v_ranking_status,
        'calculated_at', v_calculated_at,
        'trending_score', v_last_trending_score,
        'download_count', v_last_download_count,
        'first_published_at', v_last_first_published_at,
        'relevance', v_last_relevance,
        'id', v_last_id
      ),
      v_calculated_at,
      current_timestamp + interval '2 hours'
    );
  end if;

  v_result := jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor,
    'calculated_at', v_calculated_at,
    'ranking_status', v_ranking_status
  );
  return v_result;
end;
$$;

revoke all on function public.search_discovery_wraps_base(text, text, text, text, text, integer)
  from public, anon, authenticated, service_role;

commit;