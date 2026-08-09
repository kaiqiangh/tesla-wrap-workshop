begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wraps', 'Wraps are migrated');
select has_table('public', 'tags', 'Tags are migrated');
select has_table('public', 'wrap_tags', 'Wrap Tags are migrated');
select ok(c.relrowsecurity, 'Wraps enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'wraps';
select ok(c.relrowsecurity, 'Tags enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tags';

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'wrap-one@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('80000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'wrap-two@example.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
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
    perform public.publish_wrap(
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
update storage.objects
set name = left(name, length(name) - length('-missing'))
where bucket_id = 'wrap-derived' and name like '%-missing';

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
