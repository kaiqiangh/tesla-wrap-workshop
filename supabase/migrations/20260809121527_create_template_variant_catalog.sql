create table public.vehicle_models (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  display_name text not null unique,
  sort_order smallint not null unique check (sort_order > 0),
  active boolean not null default true
);

create table public.template_variants (
  id uuid primary key,
  vehicle_model_id uuid not null references public.vehicle_models (id),
  catalog_key text not null check (catalog_key ~ '^[a-z0-9-]+$'),
  display_name text not null,
  width_px smallint not null check (width_px between 512 and 1024),
  height_px smallint not null check (height_px between 512 and 1024),
  max_file_bytes integer not null default 1000000 check (max_file_bytes > 0),
  allowed_mime_types text[] not null default array['image/png']::text[],
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  source_url text not null check (source_url like 'https://github.com/teslamotors/custom-wraps/%'),
  source_note text not null,
  verified_at date not null,
  active boolean not null default true,
  unique (catalog_key, source_commit)
);

create unique index one_active_template_variant_per_catalog_key
  on public.template_variants (catalog_key)
  where active;

create schema private;
revoke all on schema private from public;

create function private.enforce_template_variant_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.active
    and not new.active
    and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  raise exception 'Template Variants are immutable; insert a new revision or mark Active false';
end;
$$;

revoke all on function private.enforce_template_variant_immutability() from public;

create trigger enforce_template_variant_immutability
before update or delete on public.template_variants
for each row execute function private.enforce_template_variant_immutability();

alter table public.vehicle_models enable row level security;
alter table public.template_variants enable row level security;

revoke all on public.vehicle_models from anon, authenticated;
revoke all on public.template_variants from anon, authenticated;

grant select (id, slug, display_name, sort_order, active)
  on public.vehicle_models to anon, authenticated;
grant select (
  id, vehicle_model_id, catalog_key, display_name, width_px, height_px,
  max_file_bytes, allowed_mime_types, source_commit, source_url, verified_at, active
) on public.template_variants to anon, authenticated;

create policy "active vehicle models are public"
  on public.vehicle_models for select
  to anon, authenticated
  using (active);

create policy "active template variants are public"
  on public.template_variants for select
  to anon, authenticated
  using (
    active and exists (
      select 1 from public.vehicle_models
      where vehicle_models.id = template_variants.vehicle_model_id
        and vehicle_models.active
    )
  );
