begin;

create extension if not exists pgtap with schema extensions;

select plan(26);
select has_table('public', 'vehicle_models', 'vehicle models are migrated');
select has_table('public', 'template_variants', 'template variants are migrated');
select ok(c.relrowsecurity, 'vehicle models enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'vehicle_models';
select ok(c.relrowsecurity, 'template variants enforce RLS')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'template_variants';

insert into public.vehicle_models (id, slug, display_name, sort_order, active)
values ('00000000-0000-0000-0000-000000000099', 'hidden', 'Hidden', 99, false);
insert into public.template_variants (
  id, vehicle_model_id, catalog_key, display_name, width_px, height_px,
  source_commit, source_url, source_note, verified_at, active
) values (
  '10000000-0000-0000-0000-000000000099',
  '00000000-0000-0000-0000-000000000001',
  'hidden', 'Hidden', 1024, 1024,
  '86c7d31454caf0f20af6f6af105f577643f13bce',
  'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/hidden',
  'Test row', '2026-08-09', false
);

set local role anon;

select is((select count(*) from public.vehicle_models), 5::bigint, 'guest sees five active models');
select is((select count(*) from public.template_variants), 12::bigint, 'guest sees twelve active variants');
select is(
  (select array_agg(catalog_key order by catalog_key) from public.template_variants),
  array[
    'cybertruck', 'model3', 'model3-2024-base', 'model3-2024-performance',
    'models-2021', 'models-2025-plaid', 'modelx-2021', 'modely',
    'modely-2025-base', 'modely-2025-performance', 'modely-2025-premium', 'modely-l'
  ]::text[],
  'guest receives the exact pinned catalog keys'
);
select is(
  (select count(*) from public.template_variants where source_commit = '86c7d31454caf0f20af6f6af105f577643f13bce'),
  12::bigint,
  'all variants pin the verified Tesla commit'
);
select results_eq(
  $$ select width_px, height_px from public.template_variants where catalog_key = 'cybertruck' $$,
  $$ values (1024::smallint, 768::smallint) $$,
  'Cybertruck preserves its rectangular official template'
);
select is(
  (select count(*) from public.template_variants where catalog_key <> 'cybertruck' and width_px = 1024 and height_px = 1024),
  11::bigint,
  'the other official templates preserve square dimensions'
);
select results_eq(
  $$
    select
      vehicle_models.display_name,
      template_variants.catalog_key,
      template_variants.display_name,
      template_variants.width_px,
      template_variants.height_px,
      template_variants.source_url,
      template_variants.verified_at,
      template_variants.active
    from public.template_variants
    join public.vehicle_models on vehicle_models.id = template_variants.vehicle_model_id
    order by template_variants.catalog_key
  $$,
  $$ values
    ('Cybertruck', 'cybertruck', 'Cybertruck', 1024::smallint, 768::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/cybertruck', '2026-08-09'::date, true),
    ('Model 3', 'model3', 'Model 3', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3', '2026-08-09'::date, true),
    ('Model 3', 'model3-2024-base', 'Model 3 (2024+) Standard & Premium', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3-2024-base', '2026-08-09'::date, true),
    ('Model 3', 'model3-2024-performance', 'Model 3 (2024+) Performance', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3-2024-performance', '2026-08-09'::date, true),
    ('Model S', 'models-2021', 'Model S (2021+)', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/models-2021', '2026-08-09'::date, true),
    ('Model S', 'models-2025-plaid', 'Model S (2025+) Plaid', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/models-2025-plaid', '2026-08-09'::date, true),
    ('Model X', 'modelx-2021', 'Model X (2021+)', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modelx-2021', '2026-08-09'::date, true),
    ('Model Y', 'modely', 'Model Y', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely', '2026-08-09'::date, true),
    ('Model Y', 'modely-2025-base', 'Model Y (2025+) Standard', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-base', '2026-08-09'::date, true),
    ('Model Y', 'modely-2025-performance', 'Model Y (2025+) Performance', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-performance', '2026-08-09'::date, true),
    ('Model Y', 'modely-2025-premium', 'Model Y (2025+) Premium', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-premium', '2026-08-09'::date, true),
    ('Model Y', 'modely-l', 'Model Y L', 1024::smallint, 1024::smallint, 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-l', '2026-08-09'::date, true)
  $$,
  'the guest catalog preserves every required reference field'
);
select is((select count(*) from public.vehicle_models where slug = 'hidden'), 0::bigint, 'inactive model is hidden');
select is((select count(*) from public.template_variants where catalog_key = 'hidden'), 0::bigint, 'inactive variant is hidden');
select throws_ok(
  $$ insert into public.vehicle_models (id, slug, display_name, sort_order) values ('00000000-0000-0000-0000-000000000098', 'blocked', 'Blocked', 98) $$,
  '42501',
  'permission denied for table vehicle_models',
  'guest cannot mutate the catalog'
);
select throws_ok(
  $$ insert into public.template_variants (id, vehicle_model_id, catalog_key, display_name, width_px, height_px, source_commit, source_url, source_note, verified_at) values ('10000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000001', 'blocked', 'Blocked', 1024, 1024, '86c7d31454caf0f20af6f6af105f577643f13bce', 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/blocked', 'Blocked', '2026-08-09') $$,
  '42501',
  'permission denied for table template_variants',
  'guest cannot add a template variant'
);
select throws_ok(
  $$ select source_note from public.template_variants limit 1 $$,
  '42501',
  'permission denied for table template_variants',
  'guest cannot read internal source notes'
);
select is(
  (select count(*) from information_schema.column_privileges where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name in ('vehicle_models', 'template_variants') and privilege_type <> 'SELECT'),
  0::bigint,
  'Data API roles have no non-select column grants'
);

reset role;

set local role authenticated;
select is((select count(*) from public.vehicle_models), 5::bigint, 'authenticated user sees five active models');
select is((select count(*) from public.template_variants), 12::bigint, 'authenticated user sees twelve active variants');
select is((select count(*) from public.vehicle_models where slug = 'hidden'), 0::bigint, 'authenticated user cannot see inactive models');
select is((select count(*) from public.template_variants where catalog_key = 'hidden'), 0::bigint, 'authenticated user cannot see inactive variants');
select throws_ok(
  $$ insert into public.vehicle_models (id, slug, display_name, sort_order) values ('00000000-0000-0000-0000-000000000097', 'blocked-auth', 'Blocked Auth', 97) $$,
  '42501',
  'permission denied for table vehicle_models',
  'authenticated user cannot add a vehicle model'
);
select throws_ok(
  $$ insert into public.template_variants (id, vehicle_model_id, catalog_key, display_name, width_px, height_px, source_commit, source_url, source_note, verified_at) values ('10000000-0000-0000-0000-000000000097', '00000000-0000-0000-0000-000000000001', 'blocked-auth', 'Blocked Auth', 1024, 1024, '86c7d31454caf0f20af6f6af105f577643f13bce', 'https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/blocked-auth', 'Blocked', '2026-08-09') $$,
  '42501',
  'permission denied for table template_variants',
  'authenticated user cannot add a template variant'
);
select throws_ok(
  $$ select source_note from public.template_variants limit 1 $$,
  '42501',
  'permission denied for table template_variants',
  'authenticated user cannot read internal source notes'
);

reset role;
select throws_ok(
  $$ update public.template_variants set display_name = 'Rewritten' where catalog_key = 'cybertruck' $$,
  'P0001',
  'Template Variants are immutable; insert a new revision or mark Active false',
  'a privileged path cannot rewrite compatibility evidence'
);
select lives_ok(
  $$ update public.template_variants set active = false where catalog_key = 'cybertruck' $$,
  'a privileged path may retire a Template Variant'
);

select * from finish();
rollback;
