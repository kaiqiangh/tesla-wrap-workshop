begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- The unified trending surface: one persisted score, refreshed by the cron.
select has_function(
  'public', 'refresh_discovery_ranking', '{}'::text[],
  'ranking refresh stays a single service-role RPC'
);
select has_function(
  'public', 'search_discovery_wraps_base',
  array['text', 'text', 'text', 'text', 'text', 'integer'],
  'search base keeps its contract signature'
);

-- DB-01/DB-02: the lifetime-formula browse RPC surface is gone.
select is(
  to_regprocedure('public.get_discovery_wraps(text,text,integer)'),
  NULL::regprocedure,
  'dead browse RPC get_discovery_wraps is dropped'
);
select is(
  to_regprocedure('public.get_discovery_wraps_base(text,text,integer)'),
  NULL::regprocedure,
  'dead browse RPC base twin is dropped'
);
select has_column('public', 'wraps', 'trending_score',
  'wraps carry the persisted Trending Score');
select ok(
  has_function_privilege(
    'service_role', 'public.cleanup_discovery_cursor_snapshots()', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.cleanup_discovery_cursor_snapshots()', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.cleanup_discovery_cursor_snapshots()', 'execute'
  ),
  'cursor cleanup is service-role-only'
);

set local role postgres;
insert into public.discovery_cursor_snapshots (
  token, payload, calculated_at, expires_at
) values
  (repeat('a', 36), '{}'::jsonb, clock_timestamp(), clock_timestamp() - interval '1 minute'),
  (repeat('b', 36), '{}'::jsonb, clock_timestamp(), clock_timestamp() + interval '1 day');
set local role service_role;
select lives_ok(
  $$ select public.cleanup_discovery_cursor_snapshots() $$,
  'the scheduled cursor cleanup RPC is available to the service role'
);
set local role postgres;
select ok(
  not exists (
    select 1 from public.discovery_cursor_snapshots where token = repeat('a', 36)
  )
  and exists (
    select 1 from public.discovery_cursor_snapshots where token = repeat('b', 36)
  ),
  'scheduled cursor cleanup removes expired snapshots only'
);
delete from public.discovery_cursor_snapshots where token = repeat('b', 36);
reset role;

-- Fixtures: an ACTIVE onboarded Creator with two eligible published Wraps --
-- one freshly downloaded, one without any recent engagement.
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('89000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'discovery-creator@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('89000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'discovery-fan@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

update public.profiles
set username = case user_id
    when '89000000-0000-0000-0000-000000000001' then 'discovery-creator'
    else 'discovery-fan'
  end,
  display_name = 'Discovery Fixture',
  onboarding_completed_at = now()
where user_id::text like '89000000-%';

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values
  ('99000000-0000-0000-0000-000000000001',
   '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000002/source.png',
   'hot.png', 'image/png', true, 'CREATED'),
  ('99000000-0000-0000-0000-000000000003',
   '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000004/source.png',
   'cold.png', 'image/png', true, 'CREATED');

insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values
  ('99000000-0000-0000-0000-000000000002',
   '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '99000000-0000-0000-0000-000000000001',
   1024, 1024, 100, repeat('d', 64), true),
  ('99000000-0000-0000-0000-000000000004',
   '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '99000000-0000-0000-0000-000000000003',
   1024, 1024, 100, repeat('f', 64), true);

update public.pending_uploads pu
set asset_revision_id = map.revision_id::uuid, state = 'READY'
from (values
  ('99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000002'),
  ('99000000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000004')
) as map(pending_id, revision_id)
where pu.id = map.pending_id::uuid;

insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-derived', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000002/preview.png', '89000000-0000-0000-0000-000000000001', '{"size":80}'::jsonb),
  ('wrap-originals', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000002/original.png', '89000000-0000-0000-0000-000000000001', '{"size":100}'::jsonb),
  ('wrap-derived', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000004/preview.png', '89000000-0000-0000-0000-000000000001', '{"size":80}'::jsonb),
  ('wrap-originals', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000004/original.png', '89000000-0000-0000-0000-000000000001', '{"size":100}'::jsonb);

insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
) values
  ('99000000-0000-0000-0000-000000000002', 'PREVIEW', 'wrap-derived',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000002/preview.png',
   1024, 1024, 80, repeat('e', 64)),
  ('99000000-0000-0000-0000-000000000002', 'ORIGINAL', 'wrap-originals',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000002/original.png',
   1024, 1024, 100, repeat('d', 64)),
  ('99000000-0000-0000-0000-000000000004', 'PREVIEW', 'wrap-derived',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000004/preview.png',
   1024, 1024, 80, repeat('7', 64)),
  ('99000000-0000-0000-0000-000000000004', 'ORIGINAL', 'wrap-originals',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000004/original.png',
   1024, 1024, 100, repeat('f', 64));

insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values
  ('9a000000-0000-0000-0000-000000000001',
   '89000000-0000-0000-0000-000000000001',
   'trending-hot-wrap', 'Trending Hot Wrap', 'Has a counted download.',
   (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
   (select id from public.template_variants where catalog_key = 'model3'),
   '99000000-0000-0000-0000-000000000002', 'PERSONAL_USE_ALLOWED', true, true,
   'PUBLISHED', date_trunc('hour', now())),
  ('9a000000-0000-0000-0000-000000000002',
   '89000000-0000-0000-0000-000000000001',
   'trending-cold-wrap', 'Trending Cold Wrap', 'No engagement yet.',
   (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
   (select id from public.template_variants where catalog_key = 'model3'),
   '99000000-0000-0000-0000-000000000004', 'PERSONAL_USE_ALLOWED', true, true,
   'PUBLISHED', date_trunc('hour', now()) - interval '1 hour');

-- A counted Guest download for the hot wrap inside the 7-day window. The
-- principal hash must satisfy the v1:<64-hex> shape constraint.
insert into public.download_events (
  wrap_id, principal_kind, principal_hash, user_id, counted, granted_at
) values (
  '9a000000-0000-0000-0000-000000000001', 'GUEST', 'v1:' || repeat('a', 64),
  null, true, now() - interval '10 minutes'
);

-- A LIKE from an onboarded active fan for the hot wrap.
insert into public.discovery_engagement_events (
  wrap_id, actor_id, kind, active, occurred_at
) values (
  '9a000000-0000-0000-0000-000000000001',
  '89000000-0000-0000-0000-000000000002', 'LIKE', true, now() - interval '5 minutes'
);

-- A middle wrap with one recent Like: sits between hot and cold when ranked.
insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '99000000-0000-0000-0000-000000000005',
  '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000006/source.png',
   'mid.png', 'image/png', true, 'CREATED');
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '99000000-0000-0000-0000-000000000006',
  '89000000-0000-0000-0000-000000000001',
   (select id from public.template_variants where catalog_key = 'model3'),
   '99000000-0000-0000-0000-000000000005',
   1024, 1024, 100, repeat('8', 64), true);
update public.pending_uploads
set asset_revision_id = '99000000-0000-0000-0000-000000000006', state = 'READY'
where id = '99000000-0000-0000-0000-000000000005';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-derived', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000006/preview.png', '89000000-0000-0000-0000-000000000001', '{"size":80}'::jsonb),
  ('wrap-originals', '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000006/original.png', '89000000-0000-0000-0000-000000000001', '{"size":100}'::jsonb);
insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
) values
  ('99000000-0000-0000-0000-000000000006', 'PREVIEW', 'wrap-derived',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000006/preview.png',
   1024, 1024, 80, repeat('9', 64)),
  ('99000000-0000-0000-0000-000000000006', 'ORIGINAL', 'wrap-originals',
   '89000000-0000-0000-0000-000000000001/99000000-0000-0000-0000-000000000006/original.png',
   1024, 1024, 100, repeat('a', 64));
insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '9a000000-0000-0000-0000-000000000003',
  '89000000-0000-0000-0000-000000000001',
  'trending-mid-wrap', 'Trending Mid Wrap', 'One recent Like.',
  (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
  (select id from public.template_variants where catalog_key = 'model3'),
  '99000000-0000-0000-0000-000000000006', 'PERSONAL_USE_ALLOWED', true, true,
  'PUBLISHED', date_trunc('hour', now()));
insert into public.discovery_engagement_events (
  wrap_id, actor_id, kind, active, occurred_at
) values (
  '9a000000-0000-0000-0000-000000000003',
  '89000000-0000-0000-0000-000000000002', 'LIKE', true, now() - interval '4 minutes'
);

insert into public.tags (slug, display_name)
values ('trending', 'Trending');
insert into public.wrap_tags (wrap_id, tag_id)
select '9a000000-0000-0000-0000-000000000001', id
from public.tags
where slug = 'trending';

-- A counted User download exercises the per-user reconciliation scope.
insert into public.download_events (
  wrap_id, principal_kind, principal_hash, user_id, counted, granted_at
) values (
  '9a000000-0000-0000-0000-000000000001', 'USER',
  'v1:user:89000000-0000-0000-0000-000000000002',
  '89000000-0000-0000-0000-000000000002', true, now() - interval '2 minutes'
);

-- The cold wrap's only download left the 7-day window: its score decays to
-- zero even though the event was counted when it happened.
insert into public.download_events (
  wrap_id, principal_kind, principal_hash, user_id, counted, granted_at
) values (
  '9a000000-0000-0000-0000-000000000002', 'GUEST', 'v1:' || repeat('b', 64),
  null, true, now() - interval '8 days'
);

-- Refresh computes the shared formula once.
select ok(
  public.refresh_discovery_ranking() >= clock_timestamp() - interval '1 minute',
  'ranking refresh returns its calculation stamp'
);

select ok(
  (select trending_score > 0::numeric from public.wraps
    where id = '9a000000-0000-0000-0000-000000000001'),
  'recently downloaded Wrap earns a positive Trending Score'
);
select ok(
  (select trending_score > 0::numeric from public.wraps
    where id = '9a000000-0000-0000-0000-000000000003'),
  'recently liked Wrap earns a smaller positive Trending Score'
);
select is(
  (select trending_score from public.wraps
    where id = '9a000000-0000-0000-0000-000000000002'),
  0::numeric,
  'aged-out engagement decays a Wrap Trending Score to zero'
);

-- TRENDING reads the persisted score: hot > mid > cold, cold still listed.
select is(
  (select result->'items'->0->>'id'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  '9a000000-0000-0000-0000-000000000001',
  'TRENDING ranks the hottest Wrap first'
);
select is(
  (select result->'items'->1->>'id'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  '9a000000-0000-0000-0000-000000000003',
  'TRENDING orders by Trending Score descending'
);
select is(
  (select result->'items'->2->>'id'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  '9a000000-0000-0000-0000-000000000002',
  'zero-score Wraps still return behind scored ones'
);

-- Keyset continuation: page one of one carries a cursor into the next rank.
select ok(
  (select result->>'next_cursor' is not null
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 1
   ) result),
  'truncated TRENDING page yields a continuation cursor'
);
select is(
  (
    with page_one as (
      select result->>'next_cursor' as token
      from public.search_discovery_wraps_base(
        null, null, null, 'TRENDING', null, 1
      ) result
    )
    select result->'items'->0->>'id'
    from public.search_discovery_wraps_base(
      null, null, null, 'TRENDING', (select token from page_one), 1
    ) result
  ),
  '9a000000-0000-0000-0000-000000000003',
  'cursor continuation advances to the next-ranked Wrap'
);
select is(
  (select result->>'ranking_status'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  'LIVE',
  'fresh ranking state reports LIVE'
);

-- Stale state flips TRENDING to the documented NEWEST fallback.
update public.discovery_ranking_state
set calculated_at = clock_timestamp() - interval '3 hours'
where id;
select is(
  (select result->>'ranking_status'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  'FALLBACK_NEWEST',
  'stale ranking state falls back to NEWEST'
);
update public.discovery_ranking_state
set calculated_at = clock_timestamp(), status = 'LIVE'
where id;

-- Keep representative query-plan evidence beside the real Discovery fixture.
-- These plans are diagnostics, not pass/fail thresholds: thresholds belong to
-- a production-sized load test, while this fixture proves the measured query
-- shape is non-empty and remains part of the pgTAP gate.
create temp table explain_capture (
  label text not null,
  line_no integer not null,
  line text not null
) on commit drop;

create or replace function pg_temp.capture_explain(
  p_label text,
  p_query text
)
returns void
language plpgsql
as $$
declare
  v_line text;
  v_line_no integer := 0;
begin
  for v_line in execute p_query loop
    v_line_no := v_line_no + 1;
    insert into pg_temp.explain_capture (label, line_no, line)
    values (p_label, v_line_no, v_line);
  end loop;
end;
$$;

select pg_temp.capture_explain(
  'refresh_discovery_ranking',
  $$
    explain (analyze, buffers, format text)
    select public.refresh_discovery_ranking()
  $$
);
select pg_temp.capture_explain(
  'search_discovery_wraps_base',
  $$
    explain (analyze, buffers, format text)
    select public.search_discovery_wraps_base(
      null, null, null, 'TRENDING', null, 24
    )
  $$
);
select pg_temp.capture_explain(
  'discovery_eligible_wraps',
  $$
    explain (analyze, buffers, format text)
    select e.id
    from public.discovery_eligible_wraps e
    order by e.trending_score desc, e.id desc
    limit 24
  $$
);
select pg_temp.capture_explain(
  'reconcile_wrap_counts_for_scope',
  $$
    explain (analyze, buffers, format text)
    select private.reconcile_wrap_counts_for_scope(
      '89000000-0000-0000-0000-000000000001',
      (
        select vehicle_model_id
        from public.template_variants
        where catalog_key = 'model3'
        limit 1
      )
    )
  $$
);
select pg_temp.capture_explain(
  'reconcile_download_counts',
  $$
    explain (analyze, buffers, format text)
    select public.reconcile_download_counts()
  $$
);

-- EXPLAIN on a PL/pgSQL or SQL RPC only reports its outer Result node. Keep
-- read-only copies of the hot-path query shapes beside the RPC plans so the
-- artifact also proves the underlying joins, aggregates, and ranking scan.
-- Reconciliation UPDATE shapes intentionally use EXPLAIN ANALYZE inside this
-- transaction; the final rollback keeps those diagnostics non-persistent.
select pg_temp.capture_explain(
  'refresh_discovery_ranking:score-shape',
  $$
    explain (analyze, buffers, format text)
    with params as (
      select clock_timestamp() as calculated_at
    ), eligible as (
      select e.id, e.first_published_at
      from public.discovery_eligible_wraps e
    ), recent_downloads as (
      select event.wrap_id, count(*)::bigint as counted_downloads
      from public.download_events event
      join public.wraps target on target.id = event.wrap_id
      left join public.profiles downloader on downloader.user_id = event.user_id
      cross join params
      where event.counted
        and event.granted_at >= params.calculated_at - interval '7 days'
        and event.granted_at <= params.calculated_at
        and (
          event.user_id is null
          or (
            downloader.participation_state = 'ACTIVE'
            and downloader.onboarding_completed_at is not null
            and event.user_id <> target.creator_id
          )
        )
      group by event.wrap_id
    ), recent_engagement as (
      select
        event.wrap_id,
        count(distinct event.actor_id) filter (where event.kind = 'LIKE')::bigint
          as unique_likes,
        count(distinct event.actor_id) filter (where event.kind = 'FAVORITE')::bigint
          as unique_favorites,
        count(*) filter (where event.kind = 'COMMENT')::bigint
          as visible_comments
      from public.discovery_engagement_events event
      join public.profiles actor on actor.user_id = event.actor_id
        and actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null
      join public.wraps target on target.id = event.wrap_id
      cross join params
      where event.active
        and event.occurred_at >= params.calculated_at - interval '7 days'
        and event.occurred_at <= params.calculated_at
        and event.actor_id <> target.creator_id
      group by event.wrap_id
    ), scores as (
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
                extract(epoch from (params.calculated_at - e.first_published_at))
                  / 86400,
                0
              ),
              30
            ),
            1.5
          )
        ) as score
      from eligible e
      cross join params
      left join recent_downloads rd on rd.wrap_id = e.id
      left join recent_engagement engagement on engagement.wrap_id = e.id
    )
    select * from scores
  $$
);
select pg_temp.capture_explain(
  'reconcile_wrap_counts_for_scope:recalculated-shape',
  $$
    explain (analyze, buffers, format text)
    with affected as (
      select wrap_id as id
      from public.wrap_likes
      where user_id = '89000000-0000-0000-0000-000000000001'
      union
      select wrap_id as id
      from public.wrap_favorites
      where user_id = '89000000-0000-0000-0000-000000000001'
      union
      select wrap_id as id
      from public.wrap_comments
      where author_id = '89000000-0000-0000-0000-000000000001'
      union
      select wrap_id as id
      from public.download_events
      where user_id = '89000000-0000-0000-0000-000000000001'
      union
      select id
      from public.wraps
      where creator_id = '89000000-0000-0000-0000-000000000001'
         or vehicle_model_id = (
           select vehicle_model_id
           from public.template_variants
           where catalog_key = 'model3'
           limit 1
         )
    ), like_counts as (
      select l.wrap_id, count(*)::bigint as value
      from public.wrap_likes l
      join public.profiles actor on actor.user_id = l.user_id
      where actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null
        and l.wrap_id in (select id from affected)
      group by l.wrap_id
    ), favorite_counts as (
      select f.wrap_id, count(*)::bigint as value
      from public.wrap_favorites f
      join public.profiles actor on actor.user_id = f.user_id
      where actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null
        and f.wrap_id in (select id from affected)
      group by f.wrap_id
    ), comment_counts as (
      select c.wrap_id, count(*)::bigint as value
      from public.wrap_comments c
      join public.profiles author on author.user_id = c.author_id
      where c.status = 'PUBLISHED'
        and author.participation_state = 'ACTIVE'
        and author.onboarding_completed_at is not null
        and c.wrap_id in (select id from affected)
      group by c.wrap_id
    ), download_counts as (
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
    ), recalculated as (
      select
        a.id,
        exists (
          select 1
          from public.discovery_eligible_wraps e
          where e.id = a.id
        ) as eligible,
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
    select * from recalculated
  $$
);
select pg_temp.capture_explain(
  'reconcile_wrap_counts_for_scope:profile-and-model-update-shape',
  $$
    explain (analyze, buffers, format text)
    with scopes(p_user_id, p_model_id) as (
      values
        (
          '89000000-0000-0000-0000-000000000001'::uuid,
          null::uuid
        ),
        (
          null::uuid,
          (
            select vehicle_model_id
            from public.template_variants
            where catalog_key = 'model3'
            limit 1
          )
        )
    ), affected as (
      select l.wrap_id as id
      from scopes s
      join public.wrap_likes l
        on s.p_user_id is not null and l.user_id = s.p_user_id
      union
      select f.wrap_id as id
      from scopes s
      join public.wrap_favorites f
        on s.p_user_id is not null and f.user_id = s.p_user_id
      union
      select c.wrap_id as id
      from scopes s
      join public.wrap_comments c
        on s.p_user_id is not null and c.author_id = s.p_user_id
      union
      select event.wrap_id as id
      from scopes s
      join public.download_events event
        on s.p_user_id is not null and event.user_id = s.p_user_id
      union
      select w.id
      from scopes s
      join public.wraps w
        on (s.p_user_id is not null and w.creator_id = s.p_user_id)
        or (s.p_model_id is not null and w.vehicle_model_id = s.p_model_id)
    ), like_counts as (
      select l.wrap_id, count(*)::bigint as value
      from public.wrap_likes l
      join public.profiles actor on actor.user_id = l.user_id
      where actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null
        and l.wrap_id in (select id from affected)
      group by l.wrap_id
    ), favorite_counts as (
      select f.wrap_id, count(*)::bigint as value
      from public.wrap_favorites f
      join public.profiles actor on actor.user_id = f.user_id
      where actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null
        and f.wrap_id in (select id from affected)
      group by f.wrap_id
    ), comment_counts as (
      select c.wrap_id, count(*)::bigint as value
      from public.wrap_comments c
      join public.profiles author on author.user_id = c.author_id
      where c.status = 'PUBLISHED'
        and author.participation_state = 'ACTIVE'
        and author.onboarding_completed_at is not null
        and c.wrap_id in (select id from affected)
      group by c.wrap_id
    ), download_counts as (
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
    ), recalculated as (
      select
        a.id,
        exists (
          select 1
          from public.discovery_eligible_wraps e
          where e.id = a.id
        ) as eligible,
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
    where w.id = recalculated.id
  $$
);
select pg_temp.capture_explain(
  'reconcile_download_counts:recalculated-shape',
  $$
    explain (analyze, buffers, format text)
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
    ), recalculated as (
      select w.id, coalesce(counts.value, 0)::bigint as download_count
      from public.wraps w
      left join counts on counts.wrap_id = w.id
    )
    select * from recalculated
  $$
);
select pg_temp.capture_explain(
  'reconcile_download_counts_for_user:recalculated-shape',
  $$
    explain (analyze, buffers, format text)
    with affected as (
      select distinct wrap_id as id
      from public.download_events
      where user_id = '89000000-0000-0000-0000-000000000002'
    ), counts as (
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
    ), recalculated as (
      select affected.id, coalesce(counts.value, 0)::bigint as download_count
      from affected
      left join counts on counts.wrap_id = affected.id
    )
    update public.wraps w
    set download_count = recalculated.download_count
    from recalculated
    where w.id = recalculated.id
  $$
);
select pg_temp.capture_explain(
  'search_discovery_wraps_base:candidate-shape',
  $$
    explain (analyze, buffers, format text)
    select
      dsw.id,
      dsw.first_published_at,
      dsw.download_count,
      dsw.trending_score,
      count(t.id) as tag_count
    from public.discovery_eligible_wraps dsw
    left join public.wrap_tags wt on wt.wrap_id = dsw.id
    left join public.tags t on t.id = wt.tag_id
    group by dsw.id, dsw.first_published_at,
      dsw.download_count, dsw.trending_score
    order by dsw.trending_score desc nulls last,
      dsw.first_published_at desc, dsw.id desc
    limit 24
  $$
);
select pg_temp.capture_explain(
  'search_discovery_wraps_base:filtered-candidate-shape',
  $$
    explain (analyze, buffers, format text)
    with params as (
      select
        extensions.unaccent('Trending')::text as query,
        'model-3'::text as model,
        'model3'::text as variant,
        'trending'::text as like_query,
        'trending'::text as fts_query
    ), candidates as (
      select
        dsw.id,
        dsw.first_published_at,
        dsw.download_count,
        dsw.trending_score,
        case when params.fts_query is null then 0::real else
          ts_rank_cd(
            setweight(to_tsvector('simple', extensions.unaccent(dsw.title)), 'A') ||
            setweight(to_tsvector('simple', extensions.unaccent(dsw.description)), 'B') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(dsw.creator_username, ''))), 'A') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(dsw.creator_display_name, ''))), 'B') ||
            setweight(to_tsvector('simple', extensions.unaccent(coalesce(string_agg(t.display_name, ' ' order by t.slug), ''))), 'C'),
            websearch_to_tsquery('simple', params.fts_query)
          )
          + greatest(
            extensions.similarity(extensions.unaccent(dsw.title), params.query),
            extensions.similarity(extensions.unaccent(coalesce(dsw.creator_username, '')), params.query),
            extensions.similarity(extensions.unaccent(coalesce(dsw.creator_display_name, '')), params.query)
          )::real
        end as search_relevance
      from public.discovery_eligible_wraps dsw
      cross join params
      left join public.wrap_tags wt on wt.wrap_id = dsw.id
      left join public.tags t on t.id = wt.tag_id
      where dsw.vehicle_model_slug = params.model
        and dsw.template_variant_key = params.variant
        and (
          (params.fts_query is not null and (
            to_tsvector('simple', extensions.unaccent(dsw.title)) ||
            to_tsvector('simple', extensions.unaccent(dsw.description)) ||
            to_tsvector('simple', extensions.unaccent(coalesce(dsw.creator_username, ''))) ||
            to_tsvector('simple', extensions.unaccent(coalesce(dsw.creator_display_name, '')))
          ) @@ websearch_to_tsquery('simple', params.fts_query))
          or extensions.unaccent(dsw.title) ilike params.like_query || '%' escape E'\\'
          or extensions.unaccent(dsw.description) ilike params.like_query || '%' escape E'\\'
          or extensions.unaccent(coalesce(dsw.creator_username, '')) ilike params.like_query || '%' escape E'\\'
          or extensions.unaccent(coalesce(dsw.creator_display_name, '')) ilike params.like_query || '%' escape E'\\'
          or extensions.similarity(extensions.unaccent(dsw.title), params.query) >= 0.25
          or extensions.similarity(extensions.unaccent(dsw.description), params.query) >= 0.25
          or extensions.similarity(extensions.unaccent(coalesce(dsw.creator_username, '')), params.query) >= 0.25
          or extensions.similarity(extensions.unaccent(coalesce(dsw.creator_display_name, '')), params.query) >= 0.25
          or exists (
            select 1
            from public.wrap_tags query_wt
            join public.tags query_t on query_t.id = query_wt.tag_id
            where query_wt.wrap_id = dsw.id
              and (
                extensions.unaccent(query_t.display_name) ilike params.like_query || '%' escape E'\\'
                or to_tsvector('simple', extensions.unaccent(query_t.display_name))
                     @@ websearch_to_tsquery('simple', params.fts_query)
                or extensions.similarity(extensions.unaccent(query_t.display_name), params.query) >= 0.25
              )
          )
        )
      group by dsw.id, dsw.first_published_at, dsw.download_count,
        dsw.trending_score, dsw.title, dsw.description,
        dsw.creator_username, dsw.creator_display_name, params.query,
        params.fts_query
    )
    select * from candidates
    order by trending_score desc nulls last, first_published_at desc,
      search_relevance desc, id desc
    limit 24
  $$
);
select diag(
  E'\n' || coalesce(
    (
      select string_agg(
        label || E'\n' || line,
        E'\n'
        order by label, line_no
      )
      from pg_temp.explain_capture
    ),
    'No EXPLAIN output captured'
  )
);

select * from finish();
rollback;
