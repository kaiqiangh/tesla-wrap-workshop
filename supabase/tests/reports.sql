begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'reports', 'Reports are migrated');
select has_table('private', 'report_rate_limits', 'Report rate limits are private');
select has_function(
  'public', 'create_report', array['text', 'text', 'text', 'text', 'uuid'],
  'Report creation uses one typed RPC'
);
select has_function(
  'public', 'get_my_report', array['uuid'],
  'Report receipt reads use one typed RPC'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.create_report(text,text,text,text,uuid)', 'execute'
  ),
  'completed Users can submit Reports through the RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.create_report(text,text,text,text,uuid)', 'execute'
  ),
  'Guests cannot bypass the Report mutation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.reports', 'select'),
  'Users cannot read Report rows directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.reports', 'insert'),
  'Users cannot insert Report rows directly'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('87000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'report-reporter@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('87000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'report-creator@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('87000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'report-other@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
  ('87000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'report-incomplete@example.test', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

update public.profiles
set username = case user_id
    when '87000000-0000-0000-0000-000000000001' then 'report-reporter'
    when '87000000-0000-0000-0000-000000000002' then 'report-creator'
    when '87000000-0000-0000-0000-000000000003' then 'report-other'
    else 'report-incomplete'
  end,
  display_name = case
    when user_id = '87000000-0000-0000-0000-000000000004' then null
    else 'Report Fixture'
  end,
  onboarding_completed_at = case
    when user_id = '87000000-0000-0000-0000-000000000004' then null
    else now()
  end
where user_id::text like '87000000-%';

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '88000000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '87000000-0000-0000-0000-000000000002/88000000-0000-0000-0000-000000000001/source.png',
  'report.png', 'image/png', true, 'CREATED'
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '88000000-0000-0000-0000-000000000002',
  '87000000-0000-0000-0000-000000000002',
  (select id from public.template_variants where catalog_key = 'model3'),
  '88000000-0000-0000-0000-000000000001',
  1024, 1024, 100, repeat('a', 64), true
);
update public.pending_uploads
set asset_revision_id = '88000000-0000-0000-0000-000000000002', state = 'READY'
where id = '88000000-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-derived', '87000000-0000-0000-0000-000000000002/88000000-0000-0000-0000-000000000002/preview.png', '87000000-0000-0000-0000-000000000002', '{"size":80}'::jsonb),
  ('wrap-originals', '87000000-0000-0000-0000-000000000002/88000000-0000-0000-0000-000000000002/original.png', '87000000-0000-0000-0000-000000000002', '{"size":100}'::jsonb);
insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
) values
  ('88000000-0000-0000-0000-000000000002', 'PREVIEW', 'wrap-derived',
   '87000000-0000-0000-0000-000000000002/88000000-0000-0000-0000-000000000002/preview.png',
   1024, 1024, 80, repeat('b', 64)),
  ('88000000-0000-0000-0000-000000000002', 'ORIGINAL', 'wrap-originals',
   '87000000-0000-0000-0000-000000000002/88000000-0000-0000-0000-000000000002/original.png',
   1024, 1024, 100, repeat('a', 64));
insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '89000000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000002',
  'report-fixture-wrap', 'Report Fixture Wrap', 'A Report fixture.',
  (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
  (select id from public.template_variants where catalog_key = 'model3'),
  '88000000-0000-0000-0000-000000000002', 'PERSONAL_USE_ALLOWED', true, true,
  'PUBLISHED', now()
);
insert into public.wrap_comments (
  id, wrap_id, author_id, idempotency_key, body, status
) values (
  '8a000000-0000-4000-8000-000000000001',
  '89000000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000002',
  '8a000000-0000-4000-8000-000000000002',
  'Reportable fixture Comment', 'PUBLISHED'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select * from public.reports $$,
  '42501', 'permission denied for table reports',
  'Guests cannot read Report rows directly'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.create_report(
       'WRAP', 'report-fixture-wrap', 'OTHER', '',
       '8b000000-0000-4000-8000-000000000001'
     ) $$,
  'P0001', 'invalid_report_request',
  'Other requires bounded detail'
);
select throws_ok(
  $$ select * from public.create_report(
       'WRAP', 'report-fixture-wrap', 'COPYRIGHT', repeat('x', 1001),
       '8b000000-0000-4000-8000-000000000002'
     ) $$,
  'P0001', 'invalid_report_request',
  'Report detail length is bounded before mutation'
);
select results_eq(
  $$ select target_kind, reason, status, created
     from public.create_report(
       'WRAP', 'report-fixture-wrap', 'COPYRIGHT', null,
       '8b000000-0000-4000-8000-000000000003'
     ) $$,
  $$ values ('WRAP'::text, 'COPYRIGHT'::text, 'OPEN'::text, true) $$,
  'an eligible User can Report a Published Wrap'
);
select set_config(
  'test.report_id',
  (select id::text from public.create_report(
     'WRAP', 'report-fixture-wrap', 'COPYRIGHT', null,
     '8b000000-0000-4000-8000-000000000003'
   )),
  true
);
select results_eq(
  $$ select status, created
     from public.create_report(
       'WRAP', 'report-fixture-wrap', 'COPYRIGHT', null,
       '8b000000-0000-4000-8000-000000000003'
     ) $$,
  $$ values ('OPEN'::text, false) $$,
  'repeating the same idempotency key returns one Report receipt'
);
select results_eq(
  $$ select status, created
     from public.create_report(
       'WRAP', 'report-fixture-wrap', 'COPYRIGHT', null,
       '8b000000-0000-4000-8000-000000000004'
     ) $$,
  $$ values ('OPEN'::text, false) $$,
  'a second active Report for the same target and reason is idempotent'
);
select results_eq(
  $$ select target_kind, reason, detail, created
     from public.create_report(
       'COMMENT', '8a000000-0000-4000-8000-000000000001', 'OTHER',
       'This Comment needs private review.',
       '8b000000-0000-4000-8000-000000000005'
     ) $$,
  $$ values (
    'COMMENT'::text, 'OTHER'::text,
    'This Comment needs private review.'::text, true
  ) $$,
  'an eligible User can Report a public Comment'
);
select results_eq(
  $$ select target_kind, reason, created
     from public.create_report(
       'USER', 'report-creator', 'SPAM', null,
       '8b000000-0000-4000-8000-000000000006'
     ) $$,
  $$ values ('USER'::text, 'SPAM'::text, true) $$,
  'an eligible User can Report another public Profile'
);
set local role service_role;
delete from private.launch_rate_buckets
where principal_key = 'v1:user:87000000-0000-0000-0000-000000000001';
reset role;
select results_eq(
  $$
    select reasons.reason, report.created
    from (values
      ('OFFENSIVE_CONTENT'::text, '8b000000-0000-4000-8000-000000000011'::uuid),
      ('STOLEN_CONTENT'::text, '8b000000-0000-4000-8000-000000000012'::uuid),
      ('WRONG_VEHICLE_OR_TEMPLATE'::text, '8b000000-0000-4000-8000-000000000013'::uuid),
      ('INVALID_DOWNLOAD'::text, '8b000000-0000-4000-8000-000000000014'::uuid)
    ) as reasons(reason, idempotency_key)
    cross join lateral public.create_report(
      'WRAP', 'report-fixture-wrap', reasons.reason, null, reasons.idempotency_key
    ) as report
  $$,
  $$ values
    ('OFFENSIVE_CONTENT'::text, true),
    ('STOLEN_CONTENT'::text, true),
    ('WRONG_VEHICLE_OR_TEMPLATE'::text, true),
    ('INVALID_DOWNLOAD'::text, true)
  $$,
  'all canonical Report reasons are accepted'
);
select throws_ok(
  $$ select * from public.create_report(
       'USER', 'report-reporter', 'SPAM', null,
       '8b000000-0000-4000-8000-000000000007'
     ) $$,
  'P0001', 'report_self_target',
  'a User cannot Report their own Profile'
);
select results_eq(
  $$ select status, reason
     from public.get_my_report(
       current_setting('test.report_id')::uuid
     ) $$,
  $$ values ('OPEN'::text, 'COPYRIGHT'::text) $$,
  'a reporter can read only their own sanitized receipt'
);

reset role;
update public.profiles
set participation_state = 'SUSPENDED'
where user_id = '87000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is_empty(
  $$ select * from public.get_my_report(current_setting('test.report_id')::uuid) $$,
  'a suspended reporter cannot read a Report receipt through the RPC'
);
reset role;
update public.profiles
set participation_state = 'ACTIVE'
where user_id = '87000000-0000-0000-0000-000000000001';

reset role;

set local role service_role;
insert into private.launch_rate_buckets (
  policy_key, principal_key, window_started_at, operation_count
) values
  ('report_user_hour', 'v1:user:87000000-0000-0000-0000-000000000001', clock_timestamp(), 4),
  ('report_user_day', 'v1:user:87000000-0000-0000-0000-000000000001', clock_timestamp(), 4)
on conflict (policy_key, principal_key) do update
set window_started_at = excluded.window_started_at,
    operation_count = excluded.operation_count;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select reason, created from public.create_report(
       'USER', 'report-creator', 'INVALID_DOWNLOAD', null,
       '8b000000-0000-4000-8000-000000000008'
     ) $$,
  $$ values ('INVALID_DOWNLOAD'::text, true) $$,
  'the tenth Report mutation is accepted at the rolling limit boundary'
);
reset role;

set local role service_role;
update private.launch_rate_buckets
set operation_count = 5
where principal_key = 'v1:user:87000000-0000-0000-0000-000000000001'
  and policy_key in ('report_user_hour', 'report_user_day');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.create_report(
       'USER', 'report-creator', 'OFFENSIVE_CONTENT', null,
       '8b000000-0000-4000-8000-000000000009'
     ) $$,
  'P0001', 'report_hour_rate_limited',
  'the rolling Report limit denies the eleventh mutation'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.create_report(
       'WRAP', 'report-fixture-wrap', 'SPAM', null,
       '8b000000-0000-4000-8000-000000000010'
     ) $$,
  'P0001', 'report_actor_unavailable',
  'an incomplete User cannot Report'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is_empty(
  $$ select * from public.get_my_report(
       current_setting('test.report_id')::uuid
  ) $$,
  'another User cannot read the reporter receipt'
);
reset role;

update public.wraps
set status = 'UNPUBLISHED', first_published_at = first_published_at
where id = '89000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.create_report(
       'WRAP', 'report-fixture-wrap', 'INVALID_DOWNLOAD', null,
       '8b000000-0000-4000-8000-000000000010'
     ) $$,
  'P0001', 'report_target_unavailable',
  'a non-Published Wrap cannot be Reported through the public boundary'
);
reset role;

select is(
  (select count(*) from public.reports),
  8::bigint,
  'duplicate and rejected Report attempts leave no extra rows'
);
select is_empty(
  $$ select admin_note from public.reports where admin_note is not null $$,
  'the initial Report projection contains no administrator notes'
);

select * from finish();
rollback;
