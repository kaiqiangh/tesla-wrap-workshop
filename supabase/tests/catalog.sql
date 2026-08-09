begin;

create extension if not exists pgtap with schema extensions;

select plan(15);
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
select is((select count(*) from public.vehicle_models where slug = 'hidden'), 0::bigint, 'inactive model is hidden');
select is((select count(*) from public.template_variants where catalog_key = 'hidden'), 0::bigint, 'inactive variant is hidden');
select throws_ok(
  $$ insert into public.vehicle_models (id, slug, display_name, sort_order) values ('00000000-0000-0000-0000-000000000098', 'blocked', 'Blocked', 98) $$,
  '42501',
  'permission denied for table vehicle_models',
  'guest cannot mutate the catalog'
);
select throws_ok(
  $$ select source_note from public.template_variants limit 1 $$,
  '42501',
  'permission denied for table template_variants',
  'guest cannot read internal source notes'
);
select is(
  (select count(*) from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name in ('vehicle_models', 'template_variants') and privilege_type <> 'SELECT'),
  0::bigint,
  'guest has no non-select column grants'
);

reset role;
select * from finish();
rollback;
