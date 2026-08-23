begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wrap_likes', 'Like relationships are migrated');
select has_table('public', 'wrap_favorites', 'Favorite relationships are migrated');
select has_table(
  'private', 'social_toggle_rate_limits',
  'social toggle rate limits are private'
);
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
   'social-actor@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'social-creator@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'social-incomplete@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'social-suspended@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

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
insert into public.profile_username_aliases (alias, profile_id)
values ('social-old', '81000000-0000-0000-0000-000000000002');

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

select has_function(
  'public', 'toggle_creator_follow', array['text', 'boolean'],
  'Creator Follow mutation uses one typed RPC'
);
select has_function(
  'public', 'get_creator_follow_state', array['text'],
  'Creator Follow viewer state uses a private typed RPC'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.toggle_creator_follow(text,boolean)', 'execute'
  ),
  'authenticated Users can use the Creator Follow mutation RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.toggle_creator_follow(text,boolean)', 'execute'
  ),
  'Guests cannot use the Creator Follow mutation RPC'
);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select * from public.creator_follows $$,
  '42501', 'permission denied for table creator_follows',
  'Guests cannot read Follow identities'
);
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.creator_follows $$,
  '42501', 'permission denied for table creator_follows',
  'Users cannot bypass the Creator Follow RPC boundary'
);
select results_eq(
  $$ select following, follower_count
     from public.toggle_creator_follow('social-old', true) $$,
  $$ values (true, 1::bigint) $$,
  'an eligible User can Follow a Creator through a permanent Username Alias'
);
select results_eq(
  $$ select following, follower_count
     from public.toggle_creator_follow('social-creator', true) $$,
  $$ values (true, 1::bigint) $$,
  'repeating Follow is idempotent'
);
select results_eq(
  $$ select following from public.get_creator_follow_state('social-creator') $$,
  $$ values (true) $$,
  'an eligible User can read only their own Follow state'
);
select throws_ok(
  $$ select * from public.toggle_creator_follow('social-actor', true) $$,
  'P0001', 'follow_self',
  'a User cannot Follow their own Profile'
);
select throws_ok(
  $$ select * from public.toggle_creator_follow('social-incomplete', true) $$,
  'P0001', 'follow_creator_unavailable',
  'a non-Creator target cannot receive a Follow'
);
reset role;
insert into private.launch_rate_buckets (
  policy_key, principal_key, window_started_at, operation_count
) values (
  'follow_user_minute',
  'v1:user:81000000-0000-0000-0000-000000000001',
  clock_timestamp(), 30
)
on conflict (policy_key, principal_key) do update
set window_started_at = excluded.window_started_at,
    operation_count = excluded.operation_count;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_creator_follow('social-old', false) $$,
  'P0001', 'follow_rate_limited',
  'a Follow past the per-minute allowance is rate limited'
);
reset role;
delete from private.launch_rate_buckets
where policy_key = 'follow_user_minute'
  and principal_key = 'v1:user:81000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select following from public.get_creator_follow_state('social-creator') $$,
  $$ values (true) $$,
  'the rate-limited attempt did not change the relationship'
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$ select follower_count from public.get_public_profile_details('social-creator') $$,
  $$ values (1::bigint) $$,
  'public Profiles expose only the eligible Followers count'
);
reset role;
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '81000000-0000-0000-0000-000000000001';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$ select follower_count from public.get_public_profile_details('social-creator') $$,
  $$ values (0::bigint) $$,
  'a suspended follower is excluded from the public count'
);
reset role;
update public.profiles
set participation_state = 'DEACTIVATED'
where user_id = '81000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_creator_follow('social-creator', false) $$,
  'P0001', 'follow_actor_unavailable',
  'an ineligible actor cannot mutate an existing Follow'
);
reset role;
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000001';
update public.profiles
set participation_state = 'DEACTIVATED'
where user_id = '81000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_creator_follow('social-creator', false) $$,
  'P0001', 'follow_creator_unavailable',
  'a deactivated Creator cannot receive a Follow mutation'
);
reset role;
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000002';
update public.wraps
set status = 'UNPUBLISHED'
where id = '92000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select following, follower_count
     from public.toggle_creator_follow('social-creator', true) $$,
  $$ values (true, 1::bigint) $$,
  'Follow persists while a Creator has no currently Published Wraps'
);
select results_eq(
  $$ select following, follower_count
     from public.toggle_creator_follow('social-creator', false) $$,
  $$ values (false, 0::bigint) $$,
  'unfollowing returns the authoritative state and count'
);
reset role;
update public.wraps
set status = 'PUBLISHED'
where id = '92000000-0000-0000-0000-000000000001';

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
  $$ select liked, favorited
     from public.get_public_wrap('social-fixture-wrap') $$,
  $$ values (true, true) $$,
  'the public Wrap projection exposes only this session state'
);
select results_eq(
  $$ select liked, favorited
     from public.get_discovery_wraps('NEWEST', null, 24)
     where slug = 'social-fixture-wrap' $$,
  $$ values (true, true) $$,
  'the Discovery projection shares the Favorite viewer state'
);
reset role;
set local role service_role;
select is(
  (public.search_discovery_wraps_for_principal(
    null, null, null, 'NEWEST', null, 24,
    'v1:user:81000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001'
  ) -> 'items' -> 0 ->> 'liked')::boolean,
  true,
  'the paginated Discovery projection shares the Like viewer state'
);
reset role;
set local role authenticated;
select results_eq(
  $$ select slug, liked, favorited
     from public.get_my_favorites(0, 25) $$,
  $$ values ('social-fixture-wrap'::text, true, true) $$,
  'an owner can read only the compatible private Favorite cards'
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$ select liked, favorited
     from public.get_public_wrap('social-fixture-wrap') $$,
  $$ values (false, false) $$,
  'Guests receive neutral viewer state without Favorite identity'
);
select throws_ok(
  $$ select * from public.get_my_favorites(0, 25) $$,
  '42501', 'permission denied for function get_my_favorites',
  'Guests cannot call the private Favorites projection'
);
reset role;
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
select throws_ok(
  $$ select * from public.toggle_wrap_engagement(
       'social-fixture-wrap', null::text, true
     ) $$,
  '22023', 'invalid_social_kind',
  'the RPC rejects a null social kind'
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  $$ values ('LIKE'::text, true, 1::bigint, 0::bigint) $$,
  'a Like can be restored before an actor state transition'
);
reset role;
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '81000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'suspending an actor immediately removes cached Like influence'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'restoring an actor restores independently eligible Like influence'
);
update public.profiles
set participation_state = 'DEACTIVATED'
where user_id = '81000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'deactivating an actor removes cached Like influence'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'reactivating an actor restores independently eligible Like influence'
);
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '81000000-0000-0000-0000-000000000002';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'suspending a Creator removes incoming Like influence'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000002';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'restoring a Creator restores independently eligible incoming Like influence'
);
update public.profiles
set participation_state = 'DEACTIVATED'
where user_id = '81000000-0000-0000-0000-000000000002';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'deactivating a Creator removes incoming Like influence'
);
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '81000000-0000-0000-0000-000000000002';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'reactivating a Creator restores incoming Like influence'
);
update public.wraps
set status = 'UNPUBLISHED'
where id = '92000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'unpublishing a Wrap removes cached Like influence'
);
select is(
  (select count(*) from public.wrap_likes
   where wrap_id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'unpublishing preserves the durable Like relationship'
);
update public.wraps
set status = 'PUBLISHED', deleted_at = null
where id = '92000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'republishing restores eligible incoming Like influence'
);
update public.wraps
set status = 'HIDDEN'
where id = '92000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'hiding a Wrap removes cached Like influence'
);
update public.wraps
set status = 'PUBLISHED'
where id = '92000000-0000-0000-0000-000000000001';
update public.wraps
set status = 'REMOVED', deleted_at = clock_timestamp()
where id = '92000000-0000-0000-0000-000000000001';
select is(
  (select like_count from public.wraps where id = '92000000-0000-0000-0000-000000000001'),
  0::bigint,
  'removing a Wrap removes cached Like influence'
);
update public.wraps
set status = 'PUBLISHED', deleted_at = null
where id = '92000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', false) $$,
  $$ values ('LIKE'::text, false, 0::bigint, 0::bigint) $$,
  'the state-transition fixture can be cleared idempotently'
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

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  $$ values ('LIKE'::text, true, 1::bigint, 0::bigint) $$,
  'the rate-limit fixture starts from an existing Like'
);
reset role;
insert into private.launch_rate_buckets (
  policy_key, principal_key, window_started_at, operation_count
) values (
  'social_user_minute',
  'v1:user:81000000-0000-0000-0000-000000000001',
  clock_timestamp(), 60
)
on conflict (policy_key, principal_key) do update
set window_started_at = excluded.window_started_at,
    operation_count = excluded.operation_count;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', true) $$,
  'P0001', 'social_rate_limited',
  'the eleventh social operation is rate limited'
);
select throws_ok(
  $$ select * from public.toggle_wrap_engagement('social-fixture-wrap', 'FAVORITE', false) $$,
  'P0001', 'social_rate_limited',
  'a rate-limited no-op disable is still rejected'
);
reset role;
select is(
  (select count(*) from public.wrap_likes
   where wrap_id = '92000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a rate-limited operation does not change the relationship'
);
select is(
  (select count(*) from public.discovery_engagement_events
   where wrap_id = '92000000-0000-0000-0000-000000000001'
     and kind = 'LIKE' and active),
  1::bigint,
  'a rate-limited operation does not add an engagement event'
);
delete from private.launch_rate_buckets
where policy_key = 'social_user_minute'
  and principal_key = 'v1:user:81000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select kind, enabled, like_count, favorite_count
     from public.toggle_wrap_engagement('social-fixture-wrap', 'LIKE', false) $$,
  $$ values ('LIKE'::text, false, 0::bigint, 0::bigint) $$,
  'the rate-limit fixture can be cleared after the limit window'
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
select results_eq(
  $$ select count(*)::bigint
     from public.get_my_favorites(0, 25) $$,
  $$ values (0::bigint) $$,
  'an unavailable saved Wrap is omitted from private cards'
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
