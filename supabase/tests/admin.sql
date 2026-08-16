begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private', 'admin_memberships', 'Administrator membership is private');
select has_table('public', 'moderation_actions', 'Moderation Actions are persisted');
select has_function(
  'public', 'list_admin_reports', array['text'],
  'Admin queue has one typed read RPC'
);
select has_function(
  'public', 'moderate_report', array['uuid', 'text', 'text', 'text', 'text', 'uuid'],
  'Moderation transitions have one typed RPC'
);
select ok(
  has_function_privilege('service_role', 'public.set_admin_membership(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_admin_membership(uuid,boolean)', 'execute'),
  'Only trusted server operations can grant or revoke ADMIN membership'
);
select ok(
  not has_function_privilege('service_role', 'public.moderate_report(uuid,text,text,text,text,uuid)', 'execute'),
  'A client-supplied service key cannot invoke the user-bound moderation RPC'
);
set local role postgres;
select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'select'),
  'Application Users cannot read Moderation Actions directly'
);
select ok(
  not has_table_privilege('service_role', 'public.moderation_actions', 'update'),
  'Even the service role cannot update append-only Moderation Actions'
);
select ok(
  not has_table_privilege('service_role', 'public.moderation_actions', 'delete'),
  'Even the service role cannot delete append-only Moderation Actions'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('92000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'moderator@example.test', now(), '{}', '{}', now(), now()),
  ('92000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'moderation-reporter@example.test', now(), '{}', '{}', now(), now()),
  ('92000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'moderation-target@example.test', now(), '{}', '{}', now(), now());

update public.profiles
set username = case user_id
    when '92000000-0000-0000-0000-000000000001' then 'moderator-user'
    when '92000000-0000-0000-0000-000000000002' then 'moderation-reporter'
    else 'moderation-target'
  end,
  display_name = 'Moderation Fixture',
  onboarding_completed_at = now()
where user_id::text like '92000000-%';
insert into auth.sessions (id, user_id)
values ('92000000-0000-4000-8000-000000000030', '92000000-0000-0000-0000-000000000003');

insert into private.admin_memberships (user_id)
values ('92000000-0000-0000-0000-000000000001');

insert into public.pending_uploads (
  id, owner_id, template_variant_id, staging_key, original_filename,
  declared_mime_type, template_asserted, state
) values (
  '92000000-0000-0000-0000-000000000010',
  '92000000-0000-0000-0000-000000000003',
  (select id from public.template_variants limit 1),
  '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000010/source.png',
  'moderation.png', 'image/png', true, 'CREATED'
);
insert into public.asset_revisions (
  id, owner_id, template_variant_id, source_pending_upload_id,
  width_px, height_px, byte_size, sha256, template_verified
) values (
  '92000000-0000-0000-0000-000000000011',
  '92000000-0000-0000-0000-000000000003',
  (select template_variant_id from public.pending_uploads where id = '92000000-0000-0000-0000-000000000010'),
  '92000000-0000-0000-0000-000000000010', 1024, 1024, 100, repeat('c', 64), true
);
update public.pending_uploads
set asset_revision_id = '92000000-0000-0000-0000-000000000011', state = 'READY'
where id = '92000000-0000-0000-0000-000000000010';
insert into public.wraps (
  id, creator_id, slug, title, description, vehicle_model_id,
  template_variant_id, asset_revision_id, license_type,
  template_asserted, distribution_asserted, status, first_published_at
) values (
  '92000000-0000-0000-0000-000000000012',
  '92000000-0000-0000-0000-000000000003',
  'moderation-fixture-wrap', 'Moderation Fixture Wrap', 'Admin moderation target.',
  (select vehicle_model_id from public.template_variants where id = (select template_variant_id from public.asset_revisions where id = '92000000-0000-0000-0000-000000000011')),
  (select template_variant_id from public.asset_revisions where id = '92000000-0000-0000-0000-000000000011'),
  '92000000-0000-0000-0000-000000000011', 'PERSONAL_USE_ALLOWED', true, true,
  'PUBLISHED', now()
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('wrap-originals', '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/original.png', '92000000-0000-0000-0000-000000000003', '{"size":100}'::jsonb),
  ('wrap-derived', '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/preview.png', '92000000-0000-0000-0000-000000000003', '{"size":80}'::jsonb),
  ('wrap-derived', '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/thumbnail.png', '92000000-0000-0000-0000-000000000003', '{"size":60}'::jsonb);
insert into public.wrap_assets (
  asset_revision_id, kind, bucket_id, object_key,
  width_px, height_px, byte_size, sha256
)
select '92000000-0000-0000-0000-000000000011', kind, bucket_id, object_key,
  tv.width_px, tv.height_px, byte_size, sha256
from (
  values
    ('ORIGINAL'::text, 'wrap-originals'::text, '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/original.png'::text, 100, repeat('a', 64)),
    ('PREVIEW'::text, 'wrap-derived'::text, '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/preview.png'::text, 80, repeat('b', 64)),
    ('THUMBNAIL'::text, 'wrap-derived'::text, '92000000-0000-0000-0000-000000000003/92000000-0000-0000-0000-000000000011/thumbnail.png'::text, 60, repeat('c', 64))
) as assets(kind, bucket_id, object_key, byte_size, sha256)
cross join lateral (
  select tv.width_px, tv.height_px
  from public.template_variants tv
  where tv.id = (select template_variant_id from public.asset_revisions where id = '92000000-0000-0000-0000-000000000011')
) tv;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('profile-source', '92000000-0000-0000-0000-000000000003/avatar-source.png', '92000000-0000-0000-0000-000000000003', '{"size":100}'::jsonb),
  ('profile-derived', '92000000-0000-0000-0000-000000000003/avatar-derived.png', '92000000-0000-0000-0000-000000000003', '{"size":100}'::jsonb);
insert into public.profile_avatar_assets (
  id, profile_id, source_key, derived_key, width_px, height_px, byte_size, sha256
) values (
  '92000000-0000-4000-8000-000000000031',
  '92000000-0000-0000-0000-000000000003',
  '92000000-0000-0000-0000-000000000003/avatar-source.png',
  '92000000-0000-0000-0000-000000000003/avatar-derived.png',
  128, 128, 100, repeat('d', 64)
);
update public.profiles
set avatar_asset_id = '92000000-0000-4000-8000-000000000031',
    avatar_url = '/api/profiles/moderation-target/avatar'
where user_id = '92000000-0000-0000-0000-000000000003';
insert into public.wrap_comments (
  id, wrap_id, author_id, idempotency_key, body, status
) values (
  '92000000-0000-0000-0000-000000000013',
  '92000000-0000-0000-0000-000000000012',
  '92000000-0000-0000-0000-000000000002',
  '92000000-0000-4000-8000-000000000013',
  'Moderation fixture Comment', 'PUBLISHED'
);

insert into public.reports (
  id, reporter_id, target_kind, target_id, target_ref, reason, detail, idempotency_key
) values
  ('92000000-0000-4000-8000-000000000021', '92000000-0000-0000-0000-000000000002',
   'WRAP', '92000000-0000-0000-0000-000000000012', 'moderation-fixture-wrap', 'SPAM', 'Spam target',
   '92000000-0000-4000-8000-000000000021'),
  ('92000000-0000-4000-8000-000000000022', '92000000-0000-0000-0000-000000000002',
   'COMMENT', '92000000-0000-0000-0000-000000000013', '92000000-0000-0000-0000-000000000013', 'OFFENSIVE_CONTENT', null,
   '92000000-0000-4000-8000-000000000022'),
  ('92000000-0000-4000-8000-000000000023', '92000000-0000-0000-0000-000000000002',
   'USER', '92000000-0000-0000-0000-000000000003', 'moderation-target', 'STOLEN_CONTENT', null,
   '92000000-0000-4000-8000-000000000023');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.list_admin_reports() $$,
  'P0001', 'admin_required',
  'Ordinary Users cannot open the private moderation queue'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is((select count(*)::integer from public.list_admin_reports()), 3, 'Current administrators see queue-safe Reports');
select ok(
  not exists (
    select 1 from jsonb_array_elements(
      coalesce((select jsonb_agg(to_jsonb(q)) from public.list_admin_reports() q), '[]'::jsonb)
    ) item
    where item ? 'reporter_id'
  ),
  'Queue projection does not expose reporter identity'
);

select results_eq(
  $$ select report_status, target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'REVIEW', 'SPAM', 'Review this target', '',
       '92000000-0000-4000-8000-000000000101'
     ) $$,
  $$ values ('REVIEWING'::text, 'PUBLISHED'::text) $$,
  'Review moves an OPEN Report to REVIEWING'
);
select results_eq(
  $$ select report_status, outcome_category, target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'HIDE', 'SPAM', 'Hide confirmed', '',
       '92000000-0000-4000-8000-000000000102'
     ) $$,
  $$ values ('RESOLVED'::text, 'CONTENT_HIDDEN'::text, 'HIDDEN'::text) $$,
  'Hide resolves the Report and withdraws the Wrap'
);
set local role postgres;
select is((select status from public.wraps where id = '92000000-0000-0000-0000-000000000012'), 'HIDDEN', 'Wrap state is changed by the explicit action');
select is((select count(*)::integer from public.moderation_actions where report_id = '92000000-0000-4000-8000-000000000021'), 2, 'Audit has one Review and one Hide action');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select action_created from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'HIDE', 'SPAM', 'Hide confirmed', '',
       '92000000-0000-4000-8000-000000000102'
     ) $$,
  $$ values (false) $$,
  'Same moderation retry converges without a second action'
);
select results_eq(
  $$ select report_status, outcome_category, target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000022', 'REMOVE', 'OFFENSIVE_CONTENT', 'Remove confirmed', '',
       '92000000-0000-4000-8000-000000000103'
     ) $$,
  $$ values ('RESOLVED'::text, 'CONTENT_REMOVED'::text, 'REMOVED'::text) $$,
  'Remove resolves the Comment Report'
);
set local role postgres;
select is((select status from public.wrap_comments where id = '92000000-0000-0000-0000-000000000013'), 'REMOVED', 'Comment state is changed by the explicit action');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select report_status, outcome_category, target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000023', 'SUSPEND', 'STOLEN_CONTENT', 'Suspend confirmed', '',
       '92000000-0000-4000-8000-000000000104'
     ) $$,
  $$ values ('RESOLVED'::text, 'USER_SUSPENDED'::text, 'SUSPENDED'::text) $$,
  'Suspend resolves the User Report'
);
set local role postgres;
select is((select participation_state from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), 'SUSPENDED', 'User is suspended without text rewrite');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000023', 'REINSTATE', 'RESTORED', 'Restore confirmed', '',
       '92000000-0000-4000-8000-000000000105'
     ) $$,
  $$ values ('ACTIVE'::text) $$,
  'Reinstate returns an eligible User to Active'
);
select throws_ok(
  $$ select * from public.moderate_report(
       '92000000-0000-4000-8000-000000000023', 'REINSTATE', 'RESTORED', 'Already Active', '',
       '92000000-0000-4000-8000-000000000106'
     ) $$,
  'P0001', 'moderation_conflict',
  'An already Active User cannot be reinstated again with a new action'
);

set local role postgres;
insert into public.reports (
  id, reporter_id, target_kind, target_id, target_ref, reason, idempotency_key
) values (
  '92000000-0000-4000-8000-000000000024',
  '92000000-0000-0000-0000-000000000002', 'USER',
  '92000000-0000-0000-0000-000000000003', 'moderation-target', 'OTHER',
  '92000000-0000-4000-8000-000000000024'
);
set local role authenticated;
select results_eq(
  $$ select report_status, outcome_category, target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000024', 'DEACTIVATE', 'OTHER', 'Deactivate confirmed', '',
       '92000000-0000-4000-8000-000000000110'
     ) $$,
  $$ values ('RESOLVED'::text, 'USER_DEACTIVATED'::text, 'DEACTIVATED'::text) $$,
  'Deactivate resolves the User Report and withdraws the Profile'
);
set local role postgres;
select is((select participation_state from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), 'DEACTIVATED', 'Administrator deactivation preserves the Profile row but withdraws participation');
select is((select count(*)::integer from auth.sessions where user_id = '92000000-0000-0000-0000-000000000003'), 0, 'Deactivation revokes the target User sessions');
select ok((select recovery_until > clock_timestamp() from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), 'Deactivation opens a 30-day recovery window');
select ok((select deactivated_at is not null from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), 'Deactivation records a lifecycle timestamp');
select is((select count(*)::integer from public.profile_wrap_cleanup_jobs where profile_id = '92000000-0000-0000-0000-000000000003'), 3, 'Deactivation queues immutable Wrap objects for delayed cleanup');
select is((select count(*)::integer from public.asset_cleanup_jobs where pending_upload_id = '92000000-0000-0000-0000-000000000010'), 1, 'Deactivation queues READY staging bytes for cleanup');
set local role anon;
select results_eq(
  $$ select username, ever_published, availability from public.get_public_profile_details('moderation-target') $$,
  $$ values (null::text, false, 'UNAVAILABLE'::text) $$,
  'Deactivated Profiles redact identity and history from public reads'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.moderate_report(
       '92000000-0000-4000-8000-000000000023', 'HIDE', 'SPAM', 'Invalid User action', '',
       '92000000-0000-4000-8000-000000000106'
     ) $$,
  'P0001', 'invalid_moderation_target_action',
  'A User Report cannot take a Wrap or Comment action'
);
select throws_ok(
  $$ select * from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'SUSPEND', 'SPAM', 'Invalid Wrap action', '',
       '92000000-0000-4000-8000-000000000107'
     ) $$,
  'P0001', 'invalid_moderation_target_action',
  'A Wrap Report cannot take a User action'
);
select throws_ok(
  $$ select * from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'DISMISS', 'NO_VIOLATION', 'Conflicting final action', 'NO_ACTION',
       '92000000-0000-4000-8000-000000000108'
     ) $$,
  'P0001', 'moderation_conflict',
  'A resolved Report cannot switch to a different final action'
);
select results_eq(
  $$ select target_state
     from public.moderate_report(
       '92000000-0000-4000-8000-000000000024', 'REINSTATE', 'RESTORED', 'Restore before expiry', '',
       '92000000-0000-4000-8000-000000000109'
     ) $$,
  $$ values ('ACTIVE'::text) $$,
  'A deactivated User can be reinstated during the recovery window'
);
set local role postgres;
select is((select participation_state from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), 'ACTIVE', 'Recovery restores active participation');
select is((select count(*)::integer from public.profile_wrap_cleanup_jobs where profile_id = '92000000-0000-0000-0000-000000000003' and state = 'CANCELED'), 3, 'Recovery cancels delayed Wrap cleanup before expiry');
select is((select avatar_asset_id from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), '92000000-0000-4000-8000-000000000031'::uuid, 'Recovery restores the retained avatar asset');
select is((select state from public.profile_avatar_assets where id = '92000000-0000-4000-8000-000000000031'), 'ACTIVE', 'Recovery restores avatar media eligibility');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
do $$
declare
  i integer;
begin
  for i in 1..3 loop
    perform public.moderate_report(
      '92000000-0000-4000-8000-000000000021', 'HIDE', 'SPAM', '', '',
      ('92000000-0000-4000-8000-' || lpad((200 + i)::text, 12, '0'))::uuid
    );
  end loop;
end;
$$;
select throws_ok(
  $$ select * from public.moderate_report(
       '92000000-0000-4000-8000-000000000021', 'HIDE', 'SPAM', '', '',
       '92000000-0000-4000-8000-000000000206'
     ) $$,
  'P0001', 'moderation_rate_limited',
  'The eleventh moderation action in one rolling hour is denied'
);

set local role postgres;
select public.set_admin_membership('92000000-0000-0000-0000-000000000001', false);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select * from public.list_admin_reports() $$,
  'P0001', 'admin_required',
  'A revoked administrator cannot reopen the moderation queue'
);
set local role postgres;
select public.set_admin_membership('92000000-0000-0000-0000-000000000001', true);

update public.profiles
set participation_state = 'DEACTIVATED', deactivated_at = clock_timestamp() - interval '31 days',
    recovery_until = clock_timestamp() - interval '1 day', anonymized_at = null
where user_id = '92000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.anonymize_expired_profiles(50), 1, 'Expired deactivation is anonymized by the service worker');
select is((select username from public.profiles where user_id = '92000000-0000-0000-0000-000000000003'), null::text, 'Expired Profiles release public identity fields');
set local role postgres;
select is((select email::text from auth.users where id = '92000000-0000-0000-0000-000000000003'), null::text, 'Expired Profiles release Auth email data');

select ok(
  not exists (select 1 from public.moderation_actions where action_kind = 'DISMISS' and report_id = '92000000-0000-4000-8000-000000000021'),
  'No unrelated moderation action is created'
);
select * from finish();
rollback;
