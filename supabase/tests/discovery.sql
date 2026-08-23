begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- The unified trending surface: one persisted score, refreshed by the cron.
select has_function(
  'public', 'refresh_discovery_ranking', array[''],
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
set asset_revision_id = ar.id, state = 'READY'
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
   1024, 1024, 80, repeat('g', 64)),
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
select is(
  (select trending_score from public.wraps
    where id = '9a000000-0000-0000-0000-000000000002'),
  0::numeric,
  'engagement-less Wrap keeps a zero Trending Score but stays listed'
);

-- TRENDING reads the persisted score: hot wrap leads, status LIVE.
select is(
  (select result->'items'->0->>'id'
   from public.search_discovery_wraps_base(
     null, null, null, 'TRENDING', null, 24
   ) result),
  '9a000000-0000-0000-0000-000000000001',
  'TRENDING orders by the persisted Trending Score'
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

rollback;