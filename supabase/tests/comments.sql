begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wrap_comments', 'Comment source rows are migrated');
select has_table('private', 'comment_rate_limits', 'Comment rate limits are private');
select has_function(
  'public', 'add_wrap_comment', array['text', 'text', 'uuid'],
  'Comment creation uses one typed RPC'
);
select has_function(
  'public', 'remove_wrap_comment', array['uuid'],
  'Comment removal uses one typed RPC'
);
select has_function(
  'public', 'get_public_wrap_comments', array['text', 'integer', 'integer'],
  'Public Comment reads use one typed RPC'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.add_wrap_comment(text,text,uuid)', 'execute'
  ),
  'authenticated Users can add Comments'
);
select ok(
  not has_function_privilege(
    'anon', 'public.add_wrap_comment(text,text,uuid)', 'execute'
  ),
  'Guests cannot bypass the Comment mutation RPC'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.wrap_comments', 'select'
  ),
  'Users cannot read Comment rows directly'
);
select ok(
  not has_table_privilege(
    'service_role', 'public.wrap_comments', 'delete'
  ),
  'Comments cannot be hard-deleted through the service table grant'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('83000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'comment-author@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('83000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'comment-other@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('83000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'comment-incomplete@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

update public.profiles
set username = case user_id
    when '83000000-0000-0000-0000-000000000001' then 'comment-author'
    when '83000000-0000-0000-0000-000000000002' then 'comment-other'
    else 'comment-incomplete'
  end,
  display_name = case
    when user_id = '83000000-0000-0000-0000-000000000003' then null
    else 'Comment Fixture'
  end,
  onboarding_completed_at = case
    when user_id = '83000000-0000-0000-0000-000000000003' then null
    else now()
  end
where user_id::text like '83000000-%';

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '84000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '83000000-0000-0000-0000-000000000002/84000000-0000-0000-0000-000000000001/source.png',
  'comment.png', 'image/png', true, 'CREATED'
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '84000000-0000-0000-0000-000000000002',
  '83000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '84000000-0000-0000-0000-000000000001',
  1024, 1024, 100, repeat('a', 64), true
);
update public.pending_uploads
set asset_revision_id = '84000000-0000-0000-0000-000000000002', state = 'READY'
where id = '84000000-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-derived', '83000000-0000-0000-0000-000000000002/84000000-0000-0000-0000-000000000002/preview.png', '83000000-0000-0000-0000-000000000002', '{"size":80}'::jsonb),
  ('wrap-originals', '83000000-0000-0000-0000-000000000002/84000000-0000-0000-0000-000000000002/original.png', '83000000-0000-0000-0000-000000000002', '{"size":100}'::jsonb);
insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
) values
  ('84000000-0000-0000-0000-000000000002', 'PREVIEW', 'wrap-derived',
   '83000000-0000-0000-0000-000000000002/84000000-0000-0000-0000-000000000002/preview.png',
   1024, 1024, 80, repeat('b', 64)),
  ('84000000-0000-0000-0000-000000000002', 'ORIGINAL', 'wrap-originals',
   '83000000-0000-0000-0000-000000000002/84000000-0000-0000-0000-000000000002/original.png',
   1024, 1024, 100, repeat('a', 64));
insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '85000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002',
  'comment-fixture-wrap', 'Comment Fixture Wrap', 'A comment fixture.',
  (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
  (select id from public.template_variants where catalog_key = 'model3'),
  '84000000-0000-0000-0000-000000000002', 'PERSONAL_USE_ALLOWED', true, true,
  'PUBLISHED', now()
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select * from public.wrap_comments $$,
  '42501', 'permission denied for table wrap_comments',
  'Guests cannot read Comment source rows'
);
select is(
  (select count(*) from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50)),
  0::bigint,
  'an empty Published Wrap has no public Comments'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.add_wrap_comment(
       'comment-fixture-wrap', '', gen_random_uuid()
     ) $$,
  '22023', 'invalid_comment_request',
  'empty Comments are rejected'
);
select results_eq(
  $$ select body, author_username, comment_count
     from public.add_wrap_comment(
       'comment-fixture-wrap', '<script>alert(1)</script>',
       '86000000-0000-0000-0000-000000000001'
     ) $$,
  $$ values (
    '<script>alert(1)</script>'::text,
    'comment-author'::text,
    1::bigint
  ) $$,
  'an eligible User can add hostile text as a plain Comment'
);
select results_eq(
  $$ select body, comment_count
     from public.add_wrap_comment(
       'comment-fixture-wrap', '<script>alert(1)</script>',
       '86000000-0000-0000-0000-000000000001'
     ) $$,
  $$ values ('<script>alert(1)</script>'::text, 1::bigint) $$,
  'repeating the same idempotency key returns one authoritative Comment'
);
reset role;
select is(
  (select count(*) from public.wrap_comments),
  1::bigint,
  'duplicate Comment submission does not create a second row'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select body, owned_by_viewer
     from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50) $$,
  $$ values ('<script>alert(1)</script>'::text, true) $$,
  'public Comment reads expose text and only the viewer ownership boolean'
);
reset role;
select is(
  (select count(*) from public.discovery_engagement_events
   where wrap_id = '85000000-0000-0000-0000-000000000001'
     and kind = 'COMMENT' and active),
  1::bigint,
  'a Comment creates one active Trending event'
);
reset role;
update public.wrap_comments
set status = 'HIDDEN'
where id = (select id from public.wrap_comments limit 1);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*) from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50)),
  0::bigint,
  'Hidden Comments disappear from public reads'
);
reset role;
select is(
  (select comment_count from public.wraps
   where id = '85000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Hidden Comments are removed from the cached public count'
);
update public.wrap_comments
set status = 'PUBLISHED'
where id = (select id from public.wrap_comments limit 1);
update public.wraps
set status = 'UNPUBLISHED'
where id = '85000000-0000-0000-0000-000000000001';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*) from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50)),
  0::bigint,
  'Comments disappear while the target Wrap is unpublished'
);
reset role;
update public.wraps
set status = 'PUBLISHED'
where id = '85000000-0000-0000-0000-000000000001';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*) from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50)),
  1::bigint,
  'eligible Comments reappear after the target is republished'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select comment_count
     from public.add_wrap_comment(
       'comment-fixture-wrap', 'second comment',
       '86000000-0000-0000-0000-000000000002'
     ) $$,
  $$ values (2::bigint) $$,
  'a second Comment receives its own authoritative count'
);
reset role;
select is(
  (select count(*) from public.discovery_engagement_events
   where wrap_id = '85000000-0000-0000-0000-000000000001'
   and kind = 'COMMENT' and active),
  2::bigint,
  'each Comment has an independent active Trending event'
);

update public.vehicle_models
set active = false
where id = (
  select vehicle_model_id from public.wraps
  where id = '85000000-0000-0000-0000-000000000001'
);
select is(
  (select comment_count from public.wraps
   where id = '85000000-0000-0000-0000-000000000001'),
  0::bigint,
  'retiring a vehicle model removes its cached public comment count'
);
update public.vehicle_models
set active = true
where id = (
  select vehicle_model_id from public.wraps
  where id = '85000000-0000-0000-0000-000000000001'
);
select is(
  (select comment_count from public.wraps
   where id = '85000000-0000-0000-0000-000000000001'),
  2::bigint,
  'reactivating a vehicle model restores its cached public comment count'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.remove_wrap_comment(
       (select id from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50) limit 1)
     ) $$,
  'P0001', 'comment_not_owner',
  'another User cannot delete a Comment they do not own'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select removed, comment_count
     from public.remove_wrap_comment(
       (select id from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50) limit 1)
     ) $$,
  $$ values (true, 1::bigint) $$,
  'a User can soft-delete their own Comment'
);
select results_eq(
  $$ select count(*) from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50) $$,
  $$ values (1::bigint) $$,
  'soft-deleted Comments disappear from public reads'
);
reset role;
select set_config(
  'test.removed_comment_id',
  (select id::text from public.wrap_comments
   where idempotency_key = '86000000-0000-0000-0000-000000000002'),
  true
);
select is(
  (select count(*) from public.discovery_engagement_events
   where wrap_id = '85000000-0000-0000-0000-000000000001'
     and kind = 'COMMENT' and active),
  1::bigint,
  'soft-deleted Comments deactivate only their own Trending event'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select removed, comment_count
     from public.remove_wrap_comment(
       (select id from public.get_public_wrap_comments('comment-fixture-wrap', 0, 50) limit 1)
     ) $$,
  $$ values (true, 0::bigint) $$,
  'the remaining Comment can also be soft-deleted'
);
select results_eq(
  $$ select removed, comment_count
     from public.remove_wrap_comment(
       current_setting('test.removed_comment_id')::uuid
     ) $$,
  $$ values (true, 0::bigint) $$,
  'repeating deletion of an already removed Comment is idempotent'
);
select throws_ok(
  $$ select * from public.add_wrap_comment(
       'comment-fixture-wrap', '<script>alert(1)</script>',
       '86000000-0000-0000-0000-000000000001'
     ) $$,
  'P0001', 'comment_wrap_unavailable',
  'a replayed key cannot expose a removed Comment'
);
reset role;
select throws_ok(
  $$ update public.wrap_comments
     set status = 'PUBLISHED', removed_at = null
     where id = current_setting('test.removed_comment_id')::uuid $$,
  'P0001', 'comment_removed_terminal',
  'Removed Comments cannot be reactivated by a direct moderation update'
);
reset role;

update public.wraps set status = 'UNPUBLISHED'
where id = '85000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.add_wrap_comment(
       'comment-fixture-wrap', 'not allowed', gen_random_uuid()
     ) $$,
  'P0001', 'comment_actor_unavailable',
  'an incomplete User cannot add a Comment'
);
reset role;

select * from finish();
rollback;
