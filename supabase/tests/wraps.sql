begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wraps', 'Wraps are migrated');
select has_table('public', 'tags', 'Tags are migrated');
select has_table('public', 'wrap_tags', 'Wrap Tags are migrated');
select has_table(
  'public', 'discovery_engagement_events',
  'Discovery engagement events are migrated'
);
select has_table(
  'public', 'discovery_ranking_state',
  'Discovery ranking state is migrated'
);
select has_table(
  'public', 'asset_revision_cleanup_jobs',
  'Asset Revision cleanup work is durable'
);
select has_table(
  'public', 'asset_revision_cleanup_holds',
  'Asset Revision cleanup holds are durable'
);
select has_table(
  'public', 'asset_orphan_cleanup_jobs',
  'Storage orphan cleanup work is durable'
);
select has_table(
  'public', 'asset_revision_reconciliation_issues',
  'Missing Storage objects have durable reconciliation state'
);
select has_function(
  'public', 'reconcile_asset_revision_cleanup', array['integer'],
  'Asset Revision reconciliation is service-owned'
);
select has_function(
  'public', 'record_discovery_engagement_event',
  array['uuid', 'uuid', 'text', 'timestamp with time zone'],
  'Discovery engagement ingestion is server-only'
);
select ok(c.relrowsecurity, 'Wraps enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'wraps';
select ok(c.relrowsecurity, 'Tags enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tags';
select ok(c.relrowsecurity, 'Discovery engagement events enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'discovery_engagement_events';

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'wrap-one@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('80000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'wrap-two@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());
update public.profiles
set username = case user_id
  when '80000000-0000-0000-0000-000000000001' then 'wrap-one'
  else 'wrap-two'
end,
display_name = case user_id
  when '80000000-0000-0000-0000-000000000001' then 'Wrap One'
  else 'Wrap Two'
end
where user_id in (
  '80000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000002'
);

do $do$
declare
  v_variant record;
  v_upload uuid;
  v_revision uuid;
  v_owner uuid := '80000000-0000-0000-0000-000000000001';
  v_title text;
begin
  for v_variant in
    select id, catalog_key, width_px, height_px
    from public.template_variants order by catalog_key
  loop
    v_upload := gen_random_uuid();
    v_revision := gen_random_uuid();
    v_title := initcap(replace(v_variant.catalog_key, '-', ' ')) || ' Wrap';
    insert into public.pending_uploads (
      id, owner_id, template_variant_id, staging_key, original_filename,
      declared_mime_type, template_asserted, state
    ) values (
      v_upload, v_owner, v_variant.id,
      v_owner::text || '/' || v_upload::text || '/source.png',
      v_variant.catalog_key || '.png', 'image/png', true, 'CREATED'
    );
    insert into public.asset_revisions (
      id, owner_id, template_variant_id, source_pending_upload_id,
      width_px, height_px, byte_size, sha256, template_verified
    ) values (
      v_revision, v_owner, v_variant.id, v_upload,
      v_variant.width_px, v_variant.height_px, 100, repeat('a', 64), true
    );
    update public.pending_uploads
    set asset_revision_id = v_revision, state = 'READY'
    where id = v_upload;
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values
      ('wrap-originals', v_owner::text || '/' || v_revision::text || '/original.png', v_owner::text, '{"size":100}'::jsonb),
      ('wrap-derived', v_owner::text || '/' || v_revision::text || '/preview.png', v_owner::text, '{"size":80}'::jsonb),
      ('wrap-derived', v_owner::text || '/' || v_revision::text || '/thumbnail.png', v_owner::text, '{"size":60}'::jsonb);
    insert into public.wrap_assets (
      asset_revision_id, kind, bucket_id, object_key,
      width_px, height_px, byte_size, sha256
    ) values
      (v_revision, 'ORIGINAL', 'wrap-originals', v_owner::text || '/' || v_revision::text || '/original.png', v_variant.width_px, v_variant.height_px, 100, repeat('a', 64)),
      (v_revision, 'PREVIEW', 'wrap-derived', v_owner::text || '/' || v_revision::text || '/preview.png', v_variant.width_px, v_variant.height_px, 80, repeat('b', 64)),
      (v_revision, 'THUMBNAIL', 'wrap-derived', v_owner::text || '/' || v_revision::text || '/thumbnail.png', 320, 240, 60, repeat('c', 64));
    perform public.publish_wrap_base(
      v_owner, v_revision, v_variant.id, v_title,
      'A bounded public description.', 'PERSONAL_USE_ALLOWED',
      array['Community', 'tesla'], true, true
    );
  end loop;
end
$do$;

select is(
  (select count(*) from public.wraps where status = 'PUBLISHED'),
  12::bigint,
  'every official Template Variant can publish a verified Wrap'
);
select is(
  (select count(distinct asset_revision_id) from public.wraps),
  12::bigint,
  'each publication points to one immutable Asset Revision'
);
select is(
  (select created from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select asset_revision_id from public.wraps where title = 'Model3 Wrap' limit 1),
    (select template_variant_id from public.wraps where title = 'Model3 Wrap' limit 1),
    'Model3 Wrap', 'A bounded public description.', 'PERSONAL_USE_ALLOWED', '{Community,tesla}', true, true
  )),
  false,
  'repeating the same publication is idempotent'
);
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select asset_revision_id from public.wraps where title = 'Model3 Wrap' limit 1),
    (select template_variant_id from public.wraps where title = 'Model3 Wrap' limit 1),
    'Different metadata', 'A bounded public description.', 'PERSONAL_USE_ALLOWED', '{Community,tesla}', true, true
  ) $$,
  'P0001', 'wrap_duplicate_mismatch',
  'a repeated publication with stale metadata is rejected'
);

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '90000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001',
  (select id from public.template_variants where catalog_key = 'model3'),
  '80000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000001/source.png',
  'stale.png', 'image/png', true, 'CREATED'
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '90000000-0000-0000-0000-000000000002',
  '80000000-0000-0000-0000-000000000001',
  (select id from public.template_variants where catalog_key = 'model3'),
  '90000000-0000-0000-0000-000000000001',
  1024, 1024, 100, repeat('a', 64), true
);
update public.pending_uploads
set asset_revision_id = '90000000-0000-0000-0000-000000000002', state = 'READY'
where id = '90000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000002',
    (select id from public.template_variants where catalog_key = 'cybertruck'),
    'Stale Form', 'A stale form', 'OTHER', '{}', true, true
  ) $$,
  'P0001', 'wrap_revision_mismatch',
  'a stale Template Variant cannot publish a different compatibility claim'
);
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000002',
    (select id from public.template_variants where catalog_key = 'model3'),
    'Missing Rights', 'A rights check', 'OTHER', '{}', false, true
  ) $$,
  'P0001', 'wrap_assertions_required',
  'publication requires separate template and distribution assertions'
);
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '80000000-0000-0000-0000-000000000001';
select set_config(
  'test.cyber_slug',
  (select slug from public.wraps where title = 'Cybertruck Wrap' limit 1),
  true
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty(
  $$ select * from public.get_owner_wrap(
    '80000000-0000-0000-0000-000000000001', current_setting('test.cyber_slug')
  ) $$,
  'a suspended Creator cannot read Wrap management data'
);
reset role;
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000002',
    (select id from public.template_variants where catalog_key = 'model3'),
    'Suspended', 'A suspended attempt', 'OTHER', '{}', true, true
  ) $$,
  'P0001', 'wrap_not_allowed',
  'a suspended Creator cannot publish'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '80000000-0000-0000-0000-000000000001';
select set_config(
  'test.model3_slug',
  (select slug from public.wraps where title = 'Model3 Wrap' limit 1),
  true
);
select set_config(
  'test.model3_preview_key',
  (select wa.object_key
   from public.wrap_assets wa
   join public.wraps w on w.asset_revision_id = wa.asset_revision_id
   where w.slug = current_setting('test.model3_slug') and wa.kind = 'PREVIEW'),
  true
);
set local role service_role;
select is(
  (select count(*) from public.get_public_wrap_media(current_setting('test.model3_slug'))),
  1::bigint,
  'eligible public Wrap media exposes one preview'
);
select is(
  (select sha256 from public.get_public_wrap_media(current_setting('test.model3_slug'))),
  repeat('b', 64),
  'public Wrap media exposes the immutable preview digest'
);
update storage.objects
set name = name || '-public-media-missing'
where bucket_id = 'wrap-derived'
  and name = current_setting('test.model3_preview_key');
select is_empty(
  $$ select * from public.get_public_wrap_media(current_setting('test.model3_slug')) $$,
  'a missing public preview object is excluded from the media projection'
);
update storage.objects
set name = current_setting('test.model3_preview_key')
where bucket_id = 'wrap-derived'
  and name = current_setting('test.model3_preview_key') || '-public-media-missing';
update public.wraps
set status = 'UNPUBLISHED'
where slug = current_setting('test.model3_slug');
select is_empty(
  $$ select * from public.get_public_wrap_media(current_setting('test.model3_slug')) $$,
  'an unpublished Wrap is excluded from the media projection'
);
update public.wraps
set status = 'PUBLISHED'
where slug = current_setting('test.model3_slug');
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.get_public_wrap_media(current_setting('test.model3_slug')) $$,
  '42501', 'permission denied for function get_public_wrap_media',
  'anonymous callers cannot execute the service-owned public Wrap media RPC'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select * from public.wraps $$,
  '42501', 'permission denied for table wraps',
  'Guests cannot bypass the public Wrap RPC projection'
);
select throws_ok(
  $$ select * from public.tags $$,
  '42501', 'permission denied for table tags',
  'Guests cannot bypass the public Tag projection'
);
select throws_ok(
  $$ select object_key from public.wrap_assets $$,
  '42501', 'permission denied for table wrap_assets',
  'Guests cannot read private Wrap Asset keys'
);
select throws_ok(
  $$ select * from public.discovery_engagement_events $$,
  '42501', 'permission denied for table discovery_engagement_events',
  'Guests cannot read private engagement identities'
);
select isnt_empty(
  $$ select * from public.get_public_wrap(current_setting('test.model3_slug')) $$,
  'Guests can read a published allowlisted Wrap detail'
);
select matches(
  (select availability_caveat from public.get_public_wrap(current_setting('test.model3_slug'))),
  '^Vehicle, configuration, account, software, and region',
  'public detail carries the conservative Tesla availability caveat'
);
reset role;
update storage.objects
set name = name || '-missing'
where bucket_id = 'wrap-derived'
  and name = (
    select wa.object_key
    from public.wrap_assets wa
    join public.wraps w on w.asset_revision_id = wa.asset_revision_id
    where w.slug = current_setting('test.model3_slug') and wa.kind = 'PREVIEW'
  );
set local role anon;
select is(
  (select preview_available from public.get_public_wrap(current_setting('test.model3_slug'))),
  false,
  'public preview availability follows the actual Storage object'
);
reset role;
set local role service_role;
select public.reconcile_asset_revision_cleanup(100);
select ok(
  (select count(*) from public.asset_revision_reconciliation_issues i
   join public.wraps w on w.asset_revision_id = i.asset_revision_id
   where w.slug = current_setting('test.model3_slug')
     and i.resolved_at is null) > 0,
  'reconciliation records a missing required Storage object'
);
reset role;
update storage.objects
set name = left(name, length(name) - length('-missing'))
where bucket_id = 'wrap-derived' and name like '%-missing';
set local role service_role;
select public.reconcile_asset_revision_cleanup(100);
select is(
  (select count(*) from public.asset_revision_reconciliation_issues i
   join public.wraps w on w.asset_revision_id = i.asset_revision_id
   where w.slug = current_setting('test.model3_slug')
     and i.resolved_at is null),
  0::bigint,
  'a second reconciliation clears a repaired missing-object issue'
);
reset role;

select has_function(
  'public', 'get_discovery_wraps', array['text', 'text', 'integer'],
  'the database-owned Discovery Set RPC is migrated'
);
set local role anon;
select is(
  (select count(*) from public.get_discovery_wraps('NEWEST', null, 24)),
  12::bigint,
  'the Discovery Set returns every eligible official-variant Wrap'
);
select is(
  (select vehicle_model_slug from public.get_discovery_wraps('MODEL', 'cybertruck', 24) limit 1),
  'cybertruck',
  'Vehicle Model discovery is scoped by the database model slug'
);
select is_empty(
  $$ select * from public.get_discovery_wraps('MODEL', 'not-a-model', 24) $$,
  'an unknown Vehicle Model has no Discovery Set rows'
);
select is_empty(
  $$ select * from public.get_public_vehicle_model('not-a-model') $$,
  'an unknown Vehicle Model is distinguishable from an empty active model'
);
select isnt_empty(
  $$ select * from public.get_public_vehicle_model('cybertruck') $$,
  'active Vehicle Model metadata is public through an allowlisted RPC'
);
reset role;
insert into public.tags (slug, display_name)
values ('night-drive', 'Night Drive'), ('cafe', 'Café')
on conflict (slug) do update set display_name = excluded.display_name;
insert into public.wrap_tags (wrap_id, tag_id)
select w.id, t.id
from public.wraps w
join public.tags t on t.slug in ('night-drive', 'cafe')
where w.title = 'Cybertruck Wrap'
on conflict do nothing;
set local role service_role;
select public.record_discovery_engagement_event(
  w.id, '80000000-0000-0000-0000-000000000002', event.kind
)
from public.wraps w
cross join (values ('LIKE'), ('LIKE'), ('FAVORITE'), ('COMMENT')) event(kind)
where w.title = 'Cybertruck Wrap';
insert into public.discovery_engagement_events (wrap_id, actor_id, kind)
select w.id, '80000000-0000-0000-0000-000000000001', 'LIKE'
from public.wraps w
where w.title = 'Cybertruck Wrap';
select throws_ok(
  $$ select public.record_discovery_engagement_event(
    (select id from public.wraps where title = 'Cybertruck Wrap'),
    '80000000-0000-0000-0000-000000000002', 'LIKE',
    current_timestamp + interval '1 hour'
  ) $$,
  '22023', 'invalid_discovery_engagement_time',
  'engagement events cannot be future-dated'
);
select public.refresh_discovery_ranking();
reset role;
do $boundary$
declare
  v_variant record;
  v_upload uuid;
  v_revision uuid;
  v_wrap uuid;
  v_key text;
  v_index integer;
begin
  select tv.id, tv.catalog_key, tv.width_px, tv.height_px, tv.vehicle_model_id
  into v_variant
  from public.template_variants tv
  where tv.catalog_key = 'model3';
  for v_index in 1..13 loop
    v_upload := gen_random_uuid();
    v_revision := gen_random_uuid();
    v_wrap := gen_random_uuid();
    v_key := 'boundary/' || v_revision::text;
    insert into public.pending_uploads (
      id, owner_id, template_variant_id, staging_key, original_filename,
      declared_mime_type, template_asserted, state
    ) values (
      v_upload, '80000000-0000-0000-0000-000000000001', v_variant.id,
      v_key || '/source.png', 'boundary.png', 'image/png', true, 'CREATED'
    );
    insert into public.asset_revisions (
      id, owner_id, template_variant_id, source_pending_upload_id,
      width_px, height_px, byte_size, sha256, template_verified
    ) values (
      v_revision, '80000000-0000-0000-0000-000000000001', v_variant.id,
      v_upload, v_variant.width_px, v_variant.height_px, 100,
      repeat('d', 64), true
    );
    update public.pending_uploads
    set asset_revision_id = v_revision, state = 'READY'
    where id = v_upload;
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values
      ('wrap-originals', v_key || '/original.png', '80000000-0000-0000-0000-000000000001', '{"size":100}'::jsonb),
      ('wrap-derived', v_key || '/preview.png', '80000000-0000-0000-0000-000000000001', '{"size":80}'::jsonb),
      ('wrap-derived', v_key || '/thumbnail.png', '80000000-0000-0000-0000-000000000001', '{"size":60}'::jsonb);
    insert into public.wrap_assets (
      asset_revision_id, kind, bucket_id, object_key,
      width_px, height_px, byte_size, sha256
    ) values
      (v_revision, 'ORIGINAL', 'wrap-originals', v_key || '/original.png', v_variant.width_px, v_variant.height_px, 100, repeat('d', 64)),
      (v_revision, 'PREVIEW', 'wrap-derived', v_key || '/preview.png', v_variant.width_px, v_variant.height_px, 80, repeat('e', 64)),
      (v_revision, 'THUMBNAIL', 'wrap-derived', v_key || '/thumbnail.png', 320, 240, 60, repeat('f', 64));
    insert into public.wraps (
      id, creator_id, slug, title, description, vehicle_model_id,
      template_variant_id, asset_revision_id, license_type,
      template_asserted, distribution_asserted, status, first_published_at
    ) values (
      v_wrap, '80000000-0000-0000-0000-000000000001',
      'boundary-wrap-' || lpad(v_index::text, 2, '0'),
      'Boundary Wrap ' || v_index, 'A bounded public description.',
      v_variant.vehicle_model_id, v_variant.id, v_revision,
      'PERSONAL_USE_ALLOWED', true, true, 'PUBLISHED',
      '2026-08-01 00:00:00+00'::timestamptz
    );
  end loop;
end
$boundary$;
set local role service_role;
select is(
  jsonb_array_length((select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 24)->'items')),
  24,
  'keyset pagination returns a full 24-card page'
);
select set_config(
  'test.boundary_last',
  (select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 24)->'items'->23->>'id'),
  true
);
select set_config(
  'test.boundary_cursor',
  (select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 24)->>'next_cursor'),
  true
);
select is(
  jsonb_array_length((select public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.boundary_cursor'), 24
  )->'items')),
  1,
  'the 25th card is reachable on the next keyset page'
);
select isnt(
  (select public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.boundary_cursor'), 24
  )->'items'->0->>'id'),
  current_setting('test.boundary_last'),
  'equal sort tuples do not repeat across keyset pages'
);
select is(
  (select public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.boundary_cursor'), 24
  )->>'next_cursor'),
  null,
  'the boundary page has no further cursor'
);
reset role;
delete from public.wraps where slug like 'boundary-wrap-%';
set local role service_role;
select has_function(
  'public', 'search_discovery_wraps',
  array['text', 'text', 'text', 'text', 'text', 'integer'],
  'the bounded search and pagination RPC is migrated'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 24)->'items')),
  12,
  'search returns every eligible Wrap on the first page'
);
select ok(
  not (
    (select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->'items'->0)
      ?| array[
        'counted_downloads_7d', 'unique_likes_7d',
        'unique_favorites_7d', 'visible_comments_7d',
        'search_relevance', 'trending_score'
      ]
  ),
  'public search items omit internal ranking metrics'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('cybertruck', null, null, 'NEWEST', null, 24)->'items')),
  1,
  'search matches a Wrap title without exposing private fields'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('bounded', null, null, 'NEWEST', null, 24)->'items')),
  12,
  'search matches descriptions'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('wrap-one', null, null, 'NEWEST', null, 24)->'items')),
  12,
  'search matches creator usernames'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('Wrap One', null, null, 'NEWEST', null, 24)->'items')),
  12,
  'search matches creator display names'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('night drive', null, null, 'NEWEST', null, 24)->'items')),
  1,
  'search matches a multi-token tag through full text'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('cafe', null, null, 'NEWEST', null, 24)->'items')),
  1,
  'search folds accents'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('%', null, null, 'NEWEST', null, 24)->'items')),
  0,
  'wildcard characters cannot widen search'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps('_', null, null, 'NEWEST', null, 24)->'items')),
  0,
  'underscore cannot widen search'
);
select is(
  (select (public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->'items'->0->>'id')),
  (select (public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->'items'->0->>'id')),
  'Newest search ordering is deterministic'
);
select set_config(
  'test.discovery_cursor',
  (select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->>'next_cursor'),
  true
);
select matches(
  current_setting('test.discovery_cursor'),
  '^[0-9a-f]{36}$',
  'next cursors are opaque random tokens'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.discovery_cursor'), 1
  )->'items')),
  1,
  'an opaque cursor returns the next page'
);
select isnt(
  (select (public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->'items'->0->>'id')),
  (select (public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.discovery_cursor'), 1
  )->'items'->0->>'id')),
  'keyset pagination does not repeat the previous page'
);
select throws_ok(
  $$ select public.search_discovery_wraps(
    null, null, null, 'NEWEST', current_setting('test.discovery_cursor'), 2
  ) $$,
  '22023', 'invalid_discovery_cursor',
  'changing the page size invalidates a cursor'
);
select throws_ok(
  $$ select public.search_discovery_wraps(null, null, null, 'NEWEST', '000000000000000000000000000000000000', 1) $$,
  '22023', 'invalid_discovery_cursor',
  'a forged cursor is rejected'
);
select throws_ok(
  $$ select public.search_discovery_wraps(null, null, null, 'NEWEST', ' ', 1) $$,
  '22023', 'invalid_discovery_cursor',
  'a blank cursor is rejected'
);
select is(
  jsonb_array_length((select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 25)->'items')),
  12,
  'the page limit is capped at 24'
);
select is(
  (select public.search_discovery_wraps(null, null, null, 'TRENDING', null, 1)->>'ranking_status'),
  'LIVE',
  'Trending exposes a live calculation status'
);
select is(
  (select public.search_discovery_wraps(null, null, null, 'TRENDING', null, 1)->'items'->0->>'title'),
  'Cybertruck Wrap',
  'Trending uses only distinct eligible seven-day engagement'
);
reset role;
update public.discovery_ranking_state
set calculated_at = current_timestamp - interval '3 hours', status = 'LIVE'
where id;
set local role service_role;
select is(
  (select public.search_discovery_wraps(null, null, null, 'TRENDING', null, 1)->>'ranking_status'),
  'FALLBACK_NEWEST',
  'stale Trending falls back honestly to Newest'
);
select is(
  (select public.search_discovery_wraps(null, null, null, 'TRENDING', null, 1)->'items'->0->>'id'),
  (select public.search_discovery_wraps(null, null, null, 'NEWEST', null, 1)->'items'->0->>'id'),
  'stale Trending ordering matches Newest'
);
reset role;
select public.refresh_discovery_ranking();
select throws_ok(
  $$ select public.search_discovery_wraps(repeat('x', 101), null, null, 'NEWEST', null, 24) $$,
  '22023', 'invalid_discovery_query',
  'oversized search queries are rejected'
);
select throws_ok(
  $$ select public.search_discovery_wraps(null, 'cybertruck', 'model3', 'NEWEST', null, 24) $$,
  '22023', 'invalid_discovery_variant',
  'a variant from another model cannot widen the result set'
);
reset role;
delete from public.wrap_tags wt
using public.tags t
where wt.tag_id = t.id
  and t.slug in ('night-drive', 'cafe')
  and wt.wrap_id = (select id from public.wraps where title = 'Cybertruck Wrap');
update public.wraps
set download_count = 100
where title = 'Cybertruck Wrap';
set local role service_role;
select is(
  (select (public.search_discovery_wraps(null, null, null, 'MOST_DOWNLOADED', null, 1)->'items'->0->>'title')),
  'Cybertruck Wrap',
  'Most Downloaded is a deterministic primary sort'
);
reset role;
update public.wraps
set download_count = 0
where title = 'Cybertruck Wrap';

update public.template_variants
set active = false
where catalog_key = 'cybertruck';
set local role anon;
select is(
  (select legacy from public.get_discovery_wraps('MODEL', 'cybertruck', 24) limit 1),
  true,
  'Legacy Template Variant Wraps remain discoverable with a warning flag'
);
reset role;

update storage.objects
set name = name || '-discovery-missing'
where bucket_id = 'wrap-derived'
  and name = (
    select wa.object_key
    from public.wrap_assets wa
    join public.wraps w on w.asset_revision_id = wa.asset_revision_id
    where w.title = 'Cybertruck Wrap' and wa.kind = 'PREVIEW'
  );
set local role anon;
select is_empty(
  $$ select * from public.get_discovery_wraps('MODEL', 'cybertruck', 24) $$,
  'a missing Derived PREVIEW object removes the Wrap from discovery'
);
reset role;
update storage.objects
set name = left(name, length(name) - length('-discovery-missing'))
where bucket_id = 'wrap-derived' and name like '%-discovery-missing';

update storage.objects
set name = name || '-original-missing'
where bucket_id = 'wrap-originals'
  and name = (
    select wa.object_key
    from public.wrap_assets wa
    join public.wraps w on w.asset_revision_id = wa.asset_revision_id
    where w.title = 'Cybertruck Wrap' and wa.kind = 'ORIGINAL'
  );
set local role anon;
select is(
  (select count(*) from public.get_discovery_wraps('MODEL', 'cybertruck', 24)),
  1::bigint,
  'a missing private Original does not hide an otherwise eligible browse card'
);
reset role;
update storage.objects
set name = left(name, length(name) - length('-original-missing'))
where bucket_id = 'wrap-originals' and name like '%-original-missing';

update public.profiles
set participation_state = 'SUSPENDED'
where username = 'wrap-one';
set local role anon;
select is(
  (select count(*) from public.get_discovery_wraps('NEWEST', null, 24)),
  0::bigint,
  'a suspended Creator is removed from every Discovery Set surface'
);
reset role;
update public.profiles
set participation_state = 'ACTIVE'
where username = 'wrap-one';

update public.wraps
set status = 'UNPUBLISHED'
where title = 'Cybertruck Wrap';
set local role anon;
select is(
  (select count(*) from public.get_discovery_wraps('NEWEST', null, 24)),
  11::bigint,
  'an unpublished Wrap is removed from the Discovery Set'
);
reset role;
update public.wraps
set status = 'PUBLISHED'
where title = 'Cybertruck Wrap';

update public.wraps
set download_count = 100, like_count = 0, favorite_count = 0, comment_count = 0
where title = 'Cybertruck Wrap';
set local role anon;
select is(
  (select title from public.get_discovery_wraps('TRENDING', null, 1)),
  'Cybertruck Wrap',
  'Trending applies the resolved score before deterministic tie breakers'
);
reset role;
update public.wraps
set download_count = 0
where title = 'Cybertruck Wrap';

select throws_ok(
  $$ update public.wraps set slug = 'changed-slug' $$,
  'P0001', 'Wrap identity is immutable',
  'Wrap Slugs cannot be changed'
);

select lives_ok($$
  select * from public.edit_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Model3 Wrap' limit 1),
    'Updated Model 3', 'Updated description', 'CREATIVE_COMMONS', array['updated tag']
  )
$$, 'a Creator can edit bounded metadata without replacing the Asset Revision');
select is(
  (select count(*) from public.wraps where title = 'Updated Model 3'),
  1::bigint,
  'metadata edit is persisted'
);
select is(
  (select first_published_at from public.wraps where title = 'Updated Model 3'),
  (select min(first_published_at) from public.wraps where title = 'Updated Model 3'),
  'first publication time remains immutable after edit'
);

select set_config(
  'test.old_model3_revision',
  (select asset_revision_id::text from public.wraps where title = 'Updated Model 3'),
  true
);
do $replace_fixture$
declare
  v_variant record;
  v_upload uuid := '91000000-0000-0000-0000-000000000001';
  v_revision uuid := '91000000-0000-0000-0000-000000000002';
  v_owner uuid := '80000000-0000-0000-0000-000000000001';
  v_key text := '80000000-0000-0000-0000-000000000001/91000000-0000-0000-0000-000000000002';
begin
  select id, width_px, height_px into v_variant
  from public.template_variants where catalog_key = 'model3';
  insert into public.pending_uploads (
    id, owner_id, template_variant_id, staging_key, original_filename,
    declared_mime_type, template_asserted, state
  ) values (
    v_upload, v_owner, v_variant.id, v_key || '/source.png',
    'replacement.png', 'image/png', true, 'CREATED'
  );
  insert into public.asset_revisions (
    id, owner_id, template_variant_id, source_pending_upload_id,
    width_px, height_px, byte_size, sha256, template_verified
  ) values (
    v_revision, v_owner, v_variant.id, v_upload, v_variant.width_px,
    v_variant.height_px, 100, repeat('9', 64), true
  );
  update public.pending_uploads
  set asset_revision_id = v_revision, state = 'READY'
  where id = v_upload;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values
    ('wrap-originals', v_key || '/original.png', v_owner::text, '{"size":100}'::jsonb),
    ('wrap-derived', v_key || '/preview.png', v_owner::text, '{"size":80}'::jsonb),
    ('wrap-derived', v_key || '/thumbnail.png', v_owner::text, '{"size":60}'::jsonb);
  insert into public.wrap_assets (
    asset_revision_id, kind, bucket_id, object_key,
    width_px, height_px, byte_size, sha256
  ) values
    (v_revision, 'ORIGINAL', 'wrap-originals', v_key || '/original.png', v_variant.width_px, v_variant.height_px, 100, repeat('9', 64)),
    (v_revision, 'PREVIEW', 'wrap-derived', v_key || '/preview.png', v_variant.width_px, v_variant.height_px, 80, repeat('8', 64)),
    (v_revision, 'THUMBNAIL', 'wrap-derived', v_key || '/thumbnail.png', 320, 240, 60, repeat('7', 64));
end
$replace_fixture$;
select set_config(
  'test.model3_variant',
  (select id::text from public.template_variants where catalog_key = 'model3'),
  true
);
set local role service_role;
select is(
  (select created from public.replace_wrap_asset(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Updated Model 3' limit 1),
    '91000000-0000-0000-0000-000000000002',
    current_setting('test.model3_variant')::uuid
  )),
  true,
  'replacement atomically switches the active Asset Revision'
);
select is(
  (select asset_revision_id from public.wraps where title = 'Updated Model 3'),
  '91000000-0000-0000-0000-000000000002'::uuid,
  'replacement points the Wrap at the new immutable revision'
);
select is(
  (select count(*) from public.asset_revision_cleanup_jobs
   where asset_revision_id = current_setting('test.old_model3_revision')::uuid),
  3::bigint,
  'replacement queues all old immutable objects for delayed cleanup'
);
select ok(
  public.set_asset_revision_cleanup_hold(
    current_setting('test.old_model3_revision')::uuid, true
  ),
  'a cleanup hold is durable even after the revision job is created'
);
select is(
  (select count(*) from public.asset_revision_cleanup_jobs
   where asset_revision_id = current_setting('test.old_model3_revision')::uuid
     and legal_hold),
  3::bigint,
  'a cleanup hold applies to every immutable object'
);
update public.asset_revision_cleanup_jobs
set available_after = clock_timestamp()
where asset_revision_id = current_setting('test.old_model3_revision')::uuid;
select is(
  (select count(*) from public.claim_asset_revision_cleanup_jobs(10)),
  0::bigint,
  'a held revision cannot be claimed by the cleanup worker'
);
select ok(
  public.set_asset_revision_cleanup_hold(
    current_setting('test.old_model3_revision')::uuid, false
  ),
  'a cleanup hold can be released'
);
select is(
  (select created from public.replace_wrap_asset(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Updated Model 3' limit 1),
    '91000000-0000-0000-0000-000000000002',
    current_setting('test.model3_variant')::uuid
  )),
  false,
  'repeating the same replacement is idempotent'
);
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    current_setting('test.old_model3_revision')::uuid,
    current_setting('test.model3_variant')::uuid,
    'Old Revision Attempt', 'A bounded public description.',
    'PERSONAL_USE_ALLOWED', '{Community}', true, true
  ) $$,
  'P0001', 'wrap_revision_cleanup_pending',
  'a revision awaiting cleanup cannot be republished'
);
reset role;

select lives_ok($$
  select * from public.unpublish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Updated Model 3' limit 1)
  )
$$, 'a Creator can unpublish a Wrap');
set local role anon;
select is_empty(
  $$ select * from public.get_public_wrap(current_setting('test.model3_slug')) $$,
  'an unpublished Wrap is absent from public detail'
);
reset role;
select lives_ok($$
  select * from public.republish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Updated Model 3' limit 1)
  )
$$, 'a Creator can republish a still-complete Wrap');
select lives_ok($$
  select * from public.remove_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select slug from public.wraps where title = 'Updated Model 3' limit 1)
  )
$$, 'a Creator can remove a Wrap');
select is(
  (select status from public.wraps where title = 'Updated Model 3'),
  'REMOVED',
  'removal is terminal'
);
select is(
  (select count(*) from public.asset_revision_cleanup_jobs
   where asset_revision_id = (
     select asset_revision_id from public.wraps where title = 'Updated Model 3'
   )),
  3::bigint,
  'creator removal queues the active revision for delayed cleanup'
);
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select asset_revision_id from public.wraps where title = 'Updated Model 3'),
    (select template_variant_id from public.wraps where title = 'Updated Model 3'),
    'Updated Model 3', 'Updated description', 'CREATIVE_COMMONS', array['updated-tag'], true, true
  ) $$,
  'P0001', 'wrap_removed_duplicate',
  'a Removed Wrap cannot be republished through duplicate submission'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty(
  $$ select * from public.get_owner_wrap(
    '80000000-0000-0000-0000-000000000001', current_setting('test.model3_slug')
  ) $$,
  'a Removed Wrap is unavailable through owner management'
);
reset role;

update public.wraps
set status = 'HIDDEN', deleted_at = null
where slug = current_setting('test.cyber_slug');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty(
  $$ select * from public.get_owner_wrap(
    '80000000-0000-0000-0000-000000000001', current_setting('test.cyber_slug')
  ) $$,
  'a Hidden Wrap is unavailable through owner management'
);
reset role;
select throws_ok(
  $$ select * from public.remove_wrap(
    '80000000-0000-0000-0000-000000000001', current_setting('test.cyber_slug')
  ) $$,
  'P0001', 'wrap_unavailable',
  'a Creator cannot remove a moderation-hidden Wrap'
);
select throws_ok(
  $$ select * from public.publish_wrap(
    '80000000-0000-0000-0000-000000000001',
    (select asset_revision_id from public.wraps where slug = current_setting('test.cyber_slug')),
    (select template_variant_id from public.wraps where slug = current_setting('test.cyber_slug')),
    'Cybertruck Wrap', 'A bounded public description.', 'PERSONAL_USE_ALLOWED', '{Community,tesla}', true, true
  ) $$,
  'P0001', 'wrap_hidden_duplicate',
  'a Hidden Wrap cannot be republished through duplicate submission'
);
update public.wraps
set status = 'PUBLISHED'
where slug = current_setting('test.cyber_slug');

select has_table('public', 'download_events', 'Download Events are migrated');
set local role service_role;
update public.wraps
set status = 'UNPUBLISHED'
where slug = current_setting('test.cyber_slug');
select throws_ok(
  $$ select * from public.prepare_original_download(current_setting('test.cyber_slug'), null) $$,
  'P0001', 'download_unavailable',
  'an Unpublished Wrap cannot grant a private download'
);
update public.wraps
set status = 'HIDDEN'
where slug = current_setting('test.cyber_slug');
select throws_ok(
  $$ select * from public.prepare_original_download(current_setting('test.cyber_slug'), null) $$,
  'P0001', 'download_unavailable',
  'a Hidden Wrap cannot grant a private download'
);
update public.wraps
set status = 'PUBLISHED'
where slug = current_setting('test.cyber_slug');
select throws_ok(
  $$ select * from public.prepare_original_download(current_setting('test.model3_slug'), null) $$,
  'P0001', 'download_unavailable',
  'a Removed Wrap cannot grant a private download'
);
select lives_ok($$
  select * from public.prepare_original_download(current_setting('test.cyber_slug'), null)
$$, 'a Guest can prepare a private Original Wrap Asset delivery');
select is(
  (select counted from public.record_original_download(
    (select id from public.wraps where slug = current_setting('test.cyber_slug')),
    null, 'v1:' || repeat('a', 64)
  )),
  true,
  'the first Guest grant is counted'
);
select is(
  (select counted from public.record_original_download(
    (select id from public.wraps where slug = current_setting('test.cyber_slug')),
    null, 'v1:' || repeat('a', 64)
  )),
  false,
  'a repeated Guest grant inside ten minutes is not counted'
);
select is(
  (select count(*) from public.download_events
   where wrap_id = (select id from public.wraps where slug = current_setting('test.cyber_slug'))),
  2::bigint,
  'every successful Guest grant creates a Download Event'
);
select is(
  (select download_count from public.wraps where slug = current_setting('test.cyber_slug')),
  1::bigint,
  'the rolling gate increments the Wrap counter once'
);
select is(
  (select counted from public.record_original_download(
    (select id from public.wraps where slug = current_setting('test.cyber_slug')),
    '80000000-0000-0000-0000-000000000001', null
  )),
  true,
  'an authenticated Active User is counted by canonical Auth identity'
);
select is(
  (select principal_hash from public.download_events
   where user_id = '80000000-0000-0000-0000-000000000001'
   order by granted_at desc limit 1),
  'v1:user:80000000-0000-0000-0000-000000000001',
  'authenticated events store a versioned canonical User principal'
);
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '80000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.record_original_download(
    (select id from public.wraps where slug = current_setting('test.cyber_slug')),
    '80000000-0000-0000-0000-000000000002', null
  ) $$,
  'P0001', 'download_auth',
  'a suspended authenticated User cannot grant a private download'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '80000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.record_original_download(
    (select id from public.wraps where slug = current_setting('test.cyber_slug')),
    null, 'not-a-versioned-principal'
  ) $$,
  'P0001', 'download_principal_invalid',
  'invalid Guest principal material is rejected'
);
do $do$
declare
  v_index integer;
  v_wrap uuid := (select id from public.wraps where slug = current_setting('test.cyber_slug'));
begin
  for v_index in 1..20 loop
    perform * from public.record_original_download(
      v_wrap, null, 'v1:' || repeat('b', 64)
    );
  end loop;
end
$do$;
select is(
  (select count(*) from public.download_events
   where wrap_id = (select id from public.wraps where slug = current_setting('test.cyber_slug'))
     and principal_hash = 'v1:' || repeat('b', 64)),
  20::bigint,
  'twenty repeated grants still create twenty events'
);
select is(
  (select count(*) from public.download_events
   where wrap_id = (select id from public.wraps where slug = current_setting('test.cyber_slug'))
     and principal_hash = 'v1:' || repeat('b', 64) and counted),
  1::bigint,
  'twenty repeated grants produce exactly one counted event'
);
update public.wraps
set download_count = 999
where slug = current_setting('test.cyber_slug');
select lives_ok($$ select public.reconcile_download_counts() $$,
  'download count reconciliation is available to the service role');
select is(
  (select download_count from public.wraps where slug = current_setting('test.cyber_slug')),
  (select count(*) from public.download_events
   where wrap_id = (select id from public.wraps where slug = current_setting('test.cyber_slug'))
     and counted),
  'reconciliation derives the counter only from counted events'
);
update storage.objects
set name = name || '-download-missing'
where bucket_id = 'wrap-originals'
  and name = (
    select wa.object_key from public.wrap_assets wa
    join public.wraps w on w.asset_revision_id = wa.asset_revision_id
    where w.slug = current_setting('test.cyber_slug') and wa.kind = 'ORIGINAL'
  );
select throws_ok(
  $$ select * from public.prepare_original_download(current_setting('test.cyber_slug'), null) $$,
  'P0001', 'download_object_missing',
  'a missing private object is denied before an event is written'
);
update storage.objects
set name = left(name, length(name) - length('-download-missing'))
where bucket_id = 'wrap-originals' and name like '%-download-missing';
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = (select creator_id from public.wraps where slug = current_setting('test.cyber_slug'));
select throws_ok(
  $$ select * from public.prepare_original_download(current_setting('test.cyber_slug'), null) $$,
  'P0001', 'download_creator_unavailable',
  'a suspended Creator cannot grant private Original downloads'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = (select creator_id from public.wraps where slug = current_setting('test.cyber_slug'));
reset role;
set local role anon;
select is_empty(
  $$ select * from storage.objects where bucket_id = 'wrap-originals' $$,
  'Guests cannot read private Original objects directly'
);
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is_empty(
  $$ select * from storage.objects where bucket_id = 'wrap-originals' $$,
  'another authenticated User cannot read private Original objects directly'
);
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (
    'wrap-originals',
    '80000000-0000-0000-0000-000000000002/arbitrary/original.png',
    '80000000-0000-0000-0000-000000000002', '{}'
  )
$$, '42501', 'new row violates row-level security policy for table "objects"',
  'another authenticated User cannot insert a private Original object');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is_empty(
  $$ select * from public.get_owner_wrap(
    '80000000-0000-0000-0000-000000000001',
    current_setting('test.model3_slug')
  ) $$,
  'another authenticated User cannot read owner management data'
);
select throws_ok(
  $$ select * from public.edit_wrap(
    '80000000-0000-0000-0000-000000000001',
    current_setting('test.model3_slug'),
    'Stolen', '', 'OTHER', '{}'
  ) $$,
  '42501', 'permission denied for function edit_wrap',
  'management RPCs are service-only'
);
reset role;

select * from finish();
rollback;
