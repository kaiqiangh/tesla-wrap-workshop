begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wrap_likes', 'Like relationships are migrated');
select has_table('public', 'wrap_favorites', 'Favorite relationships are migrated');
select has_function(
  'public', 'toggle_wrap_engagement',
  array['text', 'text', 'boolean'],
  'social mutation uses one typed RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.toggle_wrap_engagement(text,text,boolean)',
    'execute'
  ),
  'authenticated Users can use the social mutation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.toggle_wrap_engagement(text,text,boolean)',
    'execute'
  ),
  'Guests cannot use the social mutation RPC'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'social-actor@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'social-creator@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'social-incomplete@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'social-suspended@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles
set username = case user_id
    when '81000000-0000-0000-0000-000000000001' then 'social-actor'
    when '81000000-0000-0000-0000-000000000002' then 'social-creator'
    when '81000000-0000-0000-0000-000000000003' then 'social-incomplete'
    else 'social-suspended'
  end,
  display_name = case
    when user_id = '81000000-0000-0000-0000-000000000003' then null
    else 'Social Fixture'
  end,
  onboarding_completed_at = case
    when user_id = '81000000-0000-0000-0000-000000000003' then null
    else now()
  end
where user_id::text like '81000000-%';
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '81000000-0000-0000-0000-000000000004';

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '91000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '81000000-0000-0000-0000-000000000002/91000000-0000-0000-0000-000000000001/source.png',
  'social.png', 'image/png', true, 'CREATED'
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '91000000-0000-0000-0000-000000000002',
  '81000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '91000000-0000-0000-0000-000000000001',
  1024, 1024, 100, repeat('d', 64), true
);
update public.pending_uploads
set asset_revision_id = '91000000-0000-0000-0000-000000000002', state = 'READY'
where id = '91000000-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-derived', '81000000-0000-0000-0000-000000000002/91000000-0000-0000-0000-000000000002/preview.png', '81000000-0000-0000-0000-000000000002', '{"size":80}'::jsonb),
  ('wrap-originals', '81000000-0000-0000-0000-000000000002/91000000-0000-0000-0000-000000000002/original.png', '81000000-0000-0000-0000-000000000002', '{"size":100}'::jsonb);
insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
) values
  ('91000000-0000-0000-0000-000000000002', 'PREVIEW', 'wrap-derived',
   '81000000-0000-0000-0000-000000000002/91000000-0000-0000-0000-000000000002/preview.png',
   1024, 1024, 80, repeat('e', 64)),
  ('91000000-0000-0000-0000-000000000002', 'ORIGINAL', 'wrap-originals',
   '81000000-0000-0000-0000-000000000002/91000000-0000-0000-0000-000000000002/original.png',
   1024, 1024, 100, repeat('d', 64));
insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '92000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002',
  'social-fixture-wrap', 'Social Fixture Wrap', 'A social fixture.',
  (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
  (select id from public.template_variants where catalog_key = 'model3'),
  '91000000-0000-0000-0000-000000000002', 'PERSONAL_USE_ALLOWED', true, true,
  'PUBLISHED', now()
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select * from public.wrap_likes $$,
  '42501', 'permission denied for table wrap_likes',
  'Guests cannot read Like identities'
);
select throws_ok(
  $$ select * from public.wrap_favorites $$,
  '42501', 'permission denied for table wrap_favorites',
  'Guests cannot read Favorite identities'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.wrap_likes $$,
  '42501', 'permission denied for table wrap_likes',
  'Users cannot bypass the Like RPC boundary'
);
select throws_ok(
  $$ select * from public.wrap_favorites $$,
  '42501', 'permission denied for table wrap_favorites',
  'Users cannot bypass the Favorite RPC boundary'
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  $$ values ('LIKE'::text, true, 1::bigint, 0::bigint) $$,
  'an eligible User can Like another Creator Wrap'
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  $$ values ('LIKE'::text, true, 1::bigint, 0::bigint) $$,
  'repeating Like is idempotent'
);
reset role;
select is(
  (select count(*) from public.discovery_engagement_events
   where wrap_id = '92000000-0000-0000-0000-000000000001' and kind = 'LIKE' and active),
  1::bigint,
  'repeating Like does not duplicate active engagement events'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'FAVORITE', true) $$,
  $$ values ('FAVORITE'::text, true, 1::bigint, 1::bigint) $$,
  'an eligible User can privately Favorite another Creator Wrap'
);
reset role;
select is(
  (select count(*) from public.wrap_favorites
   where wrap_id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Favorite identity is stored once privately'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', false) $$,
  $$ values ('LIKE'::text, false, 0::bigint, 1::bigint) $$,
  'Unlike removes the public Like count'
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'FAVORITE', false) $$,
  $$ values ('FAVORITE'::text, false, 0::bigint, 0::bigint) $$,
  'Unfavorite removes the eligible Favorite aggregate'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  'P0001', 'social_self_action',
  'a Creator cannot Like their own Wrap'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  'P0001', 'social_actor_unavailable',
  'an incomplete User cannot Like'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'FAVORITE', true) $$,
  'P0001', 'social_actor_unavailable',
  'a suspended User cannot Favorite'
);
reset role;

update public.wraps set status = 'UNPUBLISHED' where id = '92000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  'P0001', 'social_wrap_unavailable',
  'a non-Published Wrap cannot receive a Like'
);
reset role;

select is(
  (select count(*) from public.wrap_likes
   where wrap_id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the mutation tests leave no Like fixture rows'
);

select * from finish();
rollback;
