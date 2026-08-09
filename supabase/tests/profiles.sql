begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'profiles', 'Profiles are migrated');
select has_table('private', 'blocked_usernames', 'Username restrictions are data-driven');
select ok(c.relrowsecurity, 'Profiles enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'profiles';
select is(
  (select count(*) from private.blocked_usernames),
  17::bigint,
  'the first reserved and brand-confusing Username ruleset is seeded'
);
select is(
  (select count(distinct ruleset_version) from private.blocked_usernames),
  1::bigint,
  'Username restrictions carry a version'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'provision_profile' and not tgisinternal
  ),
  'verified Auth creation provisions a Profile'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'one@example.test', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'two@example.test', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'three@example.test', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

select is(
  (select count(*) from public.profiles where user_id::text like '20000000-%'),
  3::bigint,
  'each verified User has exactly one canonical Profile'
);
select is(
  (
    select count(*) from public.profiles
    where user_id::text like '20000000-%'
      and username is null
      and display_name is null
      and onboarding_completed_at is null
      and participation_state = 'ACTIVE'
  ),
  3::bigint,
  'new Profiles start Active and incomplete without public identity fields'
);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '20000000-0000-0000-0000-000000000004',
  'authenticated', 'authenticated', 'unverified@example.test',
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select is(
  (
    select count(*) from public.profiles
    where user_id = '20000000-0000-0000-0000-000000000004'
  ),
  0::bigint,
  'requesting an OTP does not provision a Profile before verification'
);
update auth.users
set email_confirmed_at = now(), updated_at = now()
where id = '20000000-0000-0000-0000-000000000004';
select is(
  (
    select count(*) from public.profiles
    where user_id = '20000000-0000-0000-0000-000000000004'
  ),
  1::bigint,
  'the first verified sign-in provisions exactly one Profile'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$ select username from public.profiles $$,
  '42501',
  'permission denied for table profiles',
  'an authenticated User cannot bypass the Profile RPC boundaries'
);
select results_eq(
  $$ select may_onboard, may_participate from public.current_profile_access() $$,
  $$ values (true, false) $$,
  'fresh Profile access permits onboarding but blocks participation'
);

select * from public.complete_profile('Road_One', '  Road One  ');

select results_eq(
  $$
    select username, display_name
    from public.get_public_profile('road_one')
  $$,
  $$ values ('road_one', 'Road One') $$,
  'onboarding canonicalizes Username and trims display name'
);
select results_eq(
  $$ select username, may_onboard, may_participate from public.current_profile_access() $$,
  $$ values ('road_one', true, true) $$,
  'a completed Active User may participate'
);

select is_empty(
  $$ select * from public.complete_profile('changed', 'Changed too soon') $$,
  'onboarding cannot be reused as the later Profile-edit flow'
);
select is(
  (
    select display_name from public.get_public_profile('road_one')
  ),
  'Road One',
  'a second onboarding attempt leaves the Profile unchanged'
);

select is_empty(
  $$ select * from public.complete_profile('stolen', 'Stolen') $$,
  'a completed User cannot onboard another Profile'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    select * from public.complete_profile('TESLA', 'Brand')
  $$,
  'P0001',
  'username_unavailable',
  'brand-confusing Usernames are unavailable case-insensitively'
);
select throws_ok(
  $$
    select * from public.complete_profile('-bad', 'Bad')
  $$,
  '23514',
  'new row for relation "profiles" violates check constraint "profile_username_format"',
  'Username syntax rejects a non-alphanumeric first character'
);
select throws_ok(
  $$
    select * from public.complete_profile('okay-name', '   ')
  $$,
  '23514',
  'new row for relation "profiles" violates check constraint "profile_display_name_format"',
  'display name must contain one to sixty trimmed characters'
);
select throws_ok(
  $$
    select * from public.complete_profile('ROAD_ONE', 'Collision')
  $$,
  '23505',
  'duplicate key value violates unique constraint "profiles_username_key"',
  'case variants cannot race into duplicate Usernames'
);

select * from public.complete_profile('road-two', 'Road Two');
reset role;
update public.profiles
set bio = 'Second builder.'
where user_id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (
    select
      (select count(*) from public.get_public_profile('road_one'))
      + (select count(*) from public.get_public_profile('road-two'))
  ),
  2::bigint,
  'authenticated public reads include completed Active Profiles'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (
    select
      (select count(*) from public.get_public_profile('road_one'))
      + (select count(*) from public.get_public_profile('road-two'))
  ),
  2::bigint,
  'a Guest sees completed Active Profiles and not incomplete Profiles'
);
select results_eq(
  $$
    select username, display_name, bio
    from public.get_public_profile('road-two')
  $$,
  $$ values ('road-two', 'Road Two', 'Second builder.') $$,
  'the public Profile allowlist exposes intended identity fields'
);
select is(
  pg_get_function_result('public.get_public_profile(text)'::regprocedure),
  'TABLE(username text, display_name text, bio text, avatar_url text)',
  'the public Profile response is an exact four-field allowlist'
);
select is(
  (
    select count(*)
    from information_schema.column_privileges
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name = 'profiles'
  ),
  0::bigint,
  'Data API roles receive no direct Profile column grants'
);
select throws_ok(
  $$ select user_id from public.profiles limit 1 $$,
  '42501',
  'permission denied for table profiles',
  'a Guest cannot read canonical Auth IDs'
);
select throws_ok(
  $$ select created_at from public.profiles limit 1 $$,
  '42501',
  'permission denied for table profiles',
  'a Guest cannot read internal Profile timestamps'
);
select throws_ok(
  $$ select participation_state from public.profiles limit 1 $$,
  '42501',
  'permission denied for table profiles',
  'a Guest cannot read Profile moderation state'
);
select throws_ok(
  $$ select username from public.profiles limit 1 $$,
  '42501',
  'permission denied for table profiles',
  'a Guest cannot enumerate public Profiles outside the lookup RPC'
);
select throws_ok(
  $$ select * from public.current_profile_access() $$,
  '42501',
  'permission denied for function current_profile_access',
  'a Guest cannot call the authenticated Profile-access boundary'
);
select throws_ok(
  $$ select * from public.complete_profile('guest', 'Guest') $$,
  '42501',
  'permission denied for function complete_profile',
  'a Guest cannot complete a Profile'
);
select throws_ok(
  $$
    insert into public.profiles (user_id)
    values ('20000000-0000-0000-0000-000000000099')
  $$,
  '42501',
  'permission denied for table profiles',
  'a Guest cannot create a Profile'
);

reset role;
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '20000000-0000-0000-0000-000000000002';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (
    select
      (select count(*) from public.get_public_profile('road_one'))
      + (select count(*) from public.get_public_profile('road-two'))
  ),
  1::bigint,
  'a suspended Profile is immediately withdrawn from public reads'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select results_eq(
  $$ select may_onboard, may_participate from public.current_profile_access() $$,
  $$ values (false, false) $$,
  'fresh database state denies a suspended User'
);
select throws_ok(
  $$
    update public.profiles
    set participation_state = 'ACTIVE'
    where user_id = '20000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  'permission denied for table profiles',
  'a User cannot change their own moderation state'
);

reset role;
update public.profiles
set participation_state = 'DEACTIVATED'
where user_id = '20000000-0000-0000-0000-000000000002';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty(
  $$ select * from public.get_public_profile('road-two') $$,
  'a deactivated Profile remains withdrawn from public reads'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select results_eq(
  $$ select may_onboard, may_participate from public.current_profile_access() $$,
  $$ values (false, false) $$,
  'fresh database state denies a deactivated User'
);
select is_empty(
  $$ select * from public.complete_profile('reactivated', 'Reactivated') $$,
  'a deactivated User cannot complete onboarding'
);

reset role;
select is(
  (
    select count(*)
    from information_schema.column_privileges
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name = 'profiles'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'Data API roles have no direct Profile data or structural privileges'
);

set local role service_role;
select lives_ok(
  $$
    update public.profiles
    set participation_state = 'SUSPENDED'
    where user_id = '20000000-0000-0000-0000-000000000003'
  $$,
  'the server-only service role can apply fresh participation state'
);
reset role;

select * from finish();
rollback;
