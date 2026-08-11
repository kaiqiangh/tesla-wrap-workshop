begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'core_loop_events', 'Core-loop events are migrated');
select ok(c.relrowsecurity, 'Core-loop events enforce RLS')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'core_loop_events';
select ok(
  not has_table_privilege('anon', 'public.core_loop_events', 'select'),
  'anonymous callers cannot select core-loop events'
);
select ok(
  has_table_privilege('service_role', 'public.core_loop_events', 'select'),
  'service-role cleanup can select core-loop events'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'core_loop_events'
      and column_name in (
        'email', 'ip_address', 'raw_ip', 'user_agent', 'query_referrer',
        'authorization', 'cookie', 'token', 'signed_url', 'storage_key',
        'free_text', 'upload_bytes'
      )
  ),
  0::bigint,
  'event rows expose no forbidden request or content fields'
);
set local role anon;
select throws_ok(
  $$ select public.record_core_loop_event(
    'WRAP_VIEW', null, null, null, 'WRAP',
    '90000000-0000-4000-8000-000000000001', 'SUCCESS', 'WRAP_VIEW', null, null
  ) $$,
  '42501',
  'permission denied for function record_core_loop_event',
  'anonymous callers cannot inject durable core-loop events'
);

reset role;
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'event-user@example.test', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select is(
  (select count(*) from public.core_loop_events
   where event_kind = 'AUTH_SIGNUP'
     and target_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Auth signup is recorded without copying the email'
);
select ok(
  (select expires_at - occurred_at = interval '90 days'
   from public.core_loop_events
   where event_kind = 'AUTH_SIGNUP'
     and target_id = '90000000-0000-4000-8000-000000000001'),
  'events carry the explicit 90-day retention boundary'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select * from public.complete_profile('event-user', 'Event User');
reset role;
select is(
  (select count(*) from public.core_loop_events
   where event_kind = 'PROFILE_ONBOARDED'
     and actor_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Profile onboarding is recorded at the Profile transaction boundary'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select * from public.start_pending_upload(
  (select id from public.template_variants where catalog_key = 'model3'),
  'event.png', 'image/png', true
);
reset role;
select is(
  (select count(*) from public.core_loop_events
   where event_kind = 'UPLOAD_STARTED'
     and target_type = 'PENDING_UPLOAD'),
  1::bigint,
  'Pending Upload creation records upload_started atomically'
);
savepoint core_loop_event_atomicity;
insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted
) values (
  '90000000-0000-4000-8000-000000000006',
  '90000000-0000-4000-8000-000000000001',
  (select id from public.template_variants where catalog_key = 'model3'),
  '90000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000006/source.png',
  'rolled-back.png', 'image/png', true
);
rollback to savepoint core_loop_event_atomicity;
select is(
  (select count(*) from public.core_loop_events
   where target_id = '90000000-0000-4000-8000-000000000006'),
  0::bigint,
  'rolling back a business mutation also rolls back its event'
);

update public.pending_uploads
set state = 'FAILED', failure_code = 'WF-UPLOAD-DECODE',
  failure_detail = '{"measured":"bounded","rule":"png","nextAction":"retry"}'::jsonb
where owner_id = '90000000-0000-4000-8000-000000000001'
  and original_filename = 'event.png';
select is(
  (select count(*) from public.core_loop_events
   where event_kind = 'UPLOAD_VALIDATION_FAILED'
     and code = 'WF-UPLOAD-DECODE'),
  1::bigint,
  'failed validation records only a stable failure code'
);

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted
) values (
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000001',
  (select id from public.template_variants where catalog_key = 'model3'),
  '90000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000002/source.png',
  'event-ready.png', 'image/png', true
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '90000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000001',
  (select id from public.template_variants where catalog_key = 'model3'),
  '90000000-0000-4000-8000-000000000002',
  1024, 1024, 100, repeat('a', 64), true
);
update public.pending_uploads
set state = 'READY', asset_revision_id = '90000000-0000-4000-8000-000000000003'
where id = '90000000-0000-4000-8000-000000000002';
select is(
  (select count(*) from public.core_loop_events
   where event_kind = 'UPLOAD_VALIDATION_PASSED'
     and target_id = '90000000-0000-4000-8000-000000000002'),
  1::bigint,
  'successful validation records at the READY transition'
);

insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000001', 'event-wrap', 'Event Wrap',
  'A bounded event fixture.',
  (select vehicle_model_id from public.template_variants where catalog_key = 'model3'),
  (select id from public.template_variants where catalog_key = 'model3'),
  '90000000-0000-4000-8000-000000000003', 'PERSONAL_USE_ALLOWED',
  true, true, 'PUBLISHED', now()
);
update public.wraps set status = 'UNPUBLISHED'
where id = '90000000-0000-4000-8000-000000000004';
select is(
  (select count(*) from public.core_loop_events
   where target_id = '90000000-0000-4000-8000-000000000004'
     and event_kind in ('WRAP_PUBLISHED', 'WRAP_UNPUBLISHED')),
  2::bigint,
  'publication transitions record publish and unpublish atomically'
);

insert into public.wrap_likes (user_id, wrap_id)
values ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004');
insert into public.wrap_favorites (user_id, wrap_id)
values ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004');
select is(
  (select count(*) from public.core_loop_events
   where target_id = '90000000-0000-4000-8000-000000000004'
     and event_kind in ('WRAP_LIKE', 'WRAP_FAVORITE')),
  2::bigint,
  'eligible Like and Favorite mutations record durable events'
);

insert into public.wrap_comments (id, wrap_id, author_id, idempotency_key, body)
values (
  '90000000-0000-4000-8000-000000000007',
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000008',
  'Bounded event comment.'
);
delete from public.wrap_comments
where id = '90000000-0000-4000-8000-000000000007';
select is(
  (select count(*) from public.core_loop_events
   where target_id = '90000000-0000-4000-8000-000000000007'
     and event_kind in ('COMMENT_CREATED', 'COMMENT_DELETED')),
  2::bigint,
  'Comment creation and deletion record durable events'
);

insert into public.download_events (
  wrap_id, principal_kind, principal_hash, counted
) values (
  '90000000-0000-4000-8000-000000000004', 'GUEST',
  'v1:' || repeat('b', 64), true
);
select results_eq(
  $$ select outcome, counted, principal_kind from public.core_loop_events
     where event_kind = 'DOWNLOAD_GRANTED'
       and target_id = '90000000-0000-4000-8000-000000000004' $$,
  $$ values ('SUCCESS'::text, true, 'GUEST'::text) $$,
  'every Download grant records Counted Download truth and only a pseudonymous Guest principal'
);

select public.record_core_loop_event(
  'WRAP_VIEW', null, null, null, 'WRAP',
  '90000000-0000-4000-8000-000000000004', 'SUCCESS', 'WRAP_VIEW', null,
  '90000000-0000-4000-8000-000000000005'
);
select is(
  (select correlation_id from public.core_loop_events
   where correlation_id = '90000000-0000-4000-8000-000000000005'),
  '90000000-0000-4000-8000-000000000005'::uuid,
  'server event adapter preserves the non-secret correlation ID'
);

update public.core_loop_events
set expires_at = clock_timestamp() - interval '1 second'
where correlation_id = '90000000-0000-4000-8000-000000000005';
select is(public.cleanup_core_loop_events(), 1, 'event retention cleanup is explicit and callable');
select is_empty(
  $$ select id from public.core_loop_events
     where correlation_id = '90000000-0000-4000-8000-000000000005' $$,
  'expired core-loop events are removed by the cleanup boundary'
);

select * from finish();
rollback;
