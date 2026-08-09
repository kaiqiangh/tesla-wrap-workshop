create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint tag_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  display_name text not null
    constraint tag_display_name_length check (char_length(display_name) between 1 and 30),
  created_at timestamptz not null default now()
);

create table public.wraps (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (user_id),
  slug text not null unique
    constraint wrap_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title text not null
    constraint wrap_title_format check (
      title = btrim(title) and char_length(title) between 1 and 80
    ),
  description text not null
    constraint wrap_description_length check (char_length(description) between 1 and 2000),
  vehicle_model_id uuid not null references public.vehicle_models (id),
  template_variant_id uuid not null references public.template_variants (id),
  asset_revision_id uuid not null references public.asset_revisions (id),
  license_type text not null
    constraint wrap_license_type check (
      license_type in ('PERSONAL_USE_ALLOWED', 'CREATIVE_COMMONS', 'OTHER')
    ),
  template_asserted boolean not null check (template_asserted),
  distribution_asserted boolean not null check (distribution_asserted),
  status text not null default 'UNPUBLISHED'
    constraint wrap_status check (status in ('UNPUBLISHED', 'PUBLISHED', 'HIDDEN', 'REMOVED')),
  download_count bigint not null default 0 check (download_count >= 0),
  like_count bigint not null default 0 check (like_count >= 0),
  favorite_count bigint not null default 0 check (favorite_count >= 0),
  comment_count bigint not null default 0 check (comment_count >= 0),
  first_published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wraps_asset_revision_unique unique (asset_revision_id),
  constraint wrap_published_has_first_published_at check (
    status <> 'PUBLISHED' or first_published_at is not null
  ),
  constraint wrap_removed_has_deleted_at check (
    status <> 'REMOVED' or deleted_at is not null
  )
);

create table public.wrap_tags (
  wrap_id uuid not null references public.wraps (id) on delete cascade,
  tag_id uuid not null references public.tags (id),
  created_at timestamptz not null default now(),
  primary key (wrap_id, tag_id)
);

create index wraps_public_newest_idx
  on public.wraps (status, first_published_at desc, id desc)
  where status = 'PUBLISHED';
create index wraps_creator_status_idx on public.wraps (creator_id, status, updated_at desc);
create index wrap_tags_tag_idx on public.wrap_tags (tag_id, wrap_id);

alter table public.tags enable row level security;
alter table public.wraps enable row level security;
alter table public.wrap_tags enable row level security;

revoke all on public.tags, public.wraps, public.wrap_tags from anon, authenticated;
grant select, insert on public.tags to service_role;
grant select, insert, update on public.wraps to service_role;
grant select, insert, delete on public.wrap_tags to service_role;

create function private.enforce_wrap_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.slug is distinct from new.slug
    or old.creator_id is distinct from new.creator_id
    or old.first_published_at is distinct from new.first_published_at
    or old.created_at is distinct from new.created_at
  then
    raise exception 'Wrap identity is immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.enforce_wrap_identity() from public;
create trigger enforce_wrap_identity
before update on public.wraps
for each row execute function private.enforce_wrap_identity();

create function private.normalize_wrap_tags(p_tags text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tag text;
  v_normalized text[] := '{}'::text[];
begin
  for v_tag in
    select distinct regexp_replace(
      lower(btrim(value)), '[^a-z0-9]+', '-', 'g'
    )
    from unnest(coalesce(p_tags, '{}'::text[])) as values(value)
    where btrim(value) <> ''
    order by 1
  loop
    v_tag := trim(both '-' from v_tag);
    if v_tag = '' or char_length(v_tag) > 30 then
      raise exception using errcode = 'P0001', message = 'invalid_tag';
    end if;
    v_normalized := array_append(v_normalized, v_tag);
  end loop;
  if cardinality(v_normalized) > 10 then
    raise exception using errcode = 'P0001', message = 'too_many_tags';
  end if;
  return v_normalized;
end;
$$;

revoke all on function private.normalize_wrap_tags(text[]) from public;

create function public.publish_wrap(
  p_creator_id uuid,
  p_asset_revision_id uuid,
  p_template_variant_id uuid,
  p_title text,
  p_description text,
  p_license_type text,
  p_tags text[],
  p_template_asserted boolean,
  p_distribution_asserted boolean
)
returns table (
  id uuid,
  slug text,
  status text,
  first_published_at timestamptz,
  asset_revision_id uuid,
  template_variant_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_revision public.asset_revisions%rowtype;
  v_variant public.template_variants%rowtype;
  v_existing public.wraps%rowtype;
  v_existing_tags text[];
  v_wrap public.wraps%rowtype;
  v_tags text[];
  v_base_slug text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_asset_revision_id::text, 2));
  select * into v_profile from public.profiles
  where user_id = p_creator_id for update;
  if not found or v_profile.participation_state <> 'ACTIVE'
    or v_profile.onboarding_completed_at is null
  then
    raise exception using errcode = 'P0001', message = 'wrap_not_allowed';
  end if;

  v_tags := private.normalize_wrap_tags(p_tags);
  select w.* into v_existing from public.wraps w
  where w.asset_revision_id = p_asset_revision_id
    and w.creator_id = p_creator_id;
  if found then
    select coalesce(array_agg(t.slug order by t.slug), '{}'::text[])
    into v_existing_tags
    from public.wrap_tags wt
    join public.tags t on t.id = wt.tag_id
    where wt.wrap_id = v_existing.id;
    if v_existing.template_variant_id <> p_template_variant_id
      or v_existing.title <> p_title
      or v_existing.description <> p_description
      or v_existing.license_type <> p_license_type
      or not v_existing.template_asserted
      or not v_existing.distribution_asserted
      or v_existing_tags <> v_tags
    then
      raise exception using errcode = 'P0001', message = 'wrap_duplicate_mismatch';
    end if;
    if v_existing.status = 'REMOVED' then
      raise exception using errcode = 'P0001', message = 'wrap_removed_duplicate';
    end if;
    if v_existing.status = 'HIDDEN' then
      raise exception using errcode = 'P0001', message = 'wrap_hidden_duplicate';
    end if;
    return query select v_existing.id, v_existing.slug, v_existing.status,
      v_existing.first_published_at, v_existing.asset_revision_id,
      v_existing.template_variant_id, false;
    return;
  end if;

  select ar.* into v_revision from public.asset_revisions ar
  where ar.id = p_asset_revision_id and ar.owner_id = p_creator_id;
  if not found or not v_revision.template_verified then
    raise exception using errcode = 'P0001', message = 'wrap_asset_not_ready';
  end if;
  if v_revision.template_variant_id <> p_template_variant_id then
    raise exception using errcode = 'P0001', message = 'wrap_revision_mismatch';
  end if;

  select tv.* into v_variant from public.template_variants tv
  where tv.id = p_template_variant_id and tv.active;
  if not found or not exists (
    select 1 from public.vehicle_models
    where vehicle_models.id = v_variant.vehicle_model_id and vehicle_models.active
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_template_unavailable';
  end if;
  if not p_template_asserted or not p_distribution_asserted then
    raise exception using errcode = 'P0001', message = 'wrap_assertions_required';
  end if;
  if p_license_type not in ('PERSONAL_USE_ALLOWED', 'CREATIVE_COMMONS', 'OTHER')
    or p_title is null or p_title <> btrim(p_title)
    or char_length(p_title) not between 1 and 80
    or p_description is null or char_length(p_description) not between 1 and 2000
  then
    raise exception using errcode = 'P0001', message = 'wrap_metadata_invalid';
  end if;
  if not (
    (select count(*) from public.wrap_assets wa
      where wa.asset_revision_id = v_revision.id) = 3
    and exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-originals'
        and name = (select wa.object_key from public.wrap_assets wa
          where wa.asset_revision_id = v_revision.id and wa.kind = 'ORIGINAL')
    )
    and exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-derived'
        and name = (select wa.object_key from public.wrap_assets wa
          where wa.asset_revision_id = v_revision.id and wa.kind = 'PREVIEW')
    )
    and exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-derived'
        and name = (select wa.object_key from public.wrap_assets wa
          where wa.asset_revision_id = v_revision.id and wa.kind = 'THUMBNAIL')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_assets_incomplete';
  end if;
  v_base_slug := regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then v_base_slug := 'wrap'; end if;
  v_base_slug := left(v_base_slug, 60) || '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  insert into public.wraps (
    creator_id, slug, title, description, vehicle_model_id,
    template_variant_id, asset_revision_id, license_type,
    template_asserted, distribution_asserted, status, first_published_at
  ) values (
    p_creator_id, v_base_slug, p_title, p_description, v_variant.vehicle_model_id,
    p_template_variant_id, p_asset_revision_id, p_license_type,
    true, true, 'PUBLISHED', clock_timestamp()
  ) returning * into v_wrap;

  insert into public.tags (slug, display_name)
  select value, value from unnest(v_tags) as values(value)
  on conflict on constraint tags_slug_key do nothing;
  insert into public.wrap_tags (wrap_id, tag_id)
  select v_wrap.id, tags.id from public.tags
  where tags.slug = any(v_tags);

  return query select v_wrap.id, v_wrap.slug, v_wrap.status,
    v_wrap.first_published_at, v_wrap.asset_revision_id,
    v_wrap.template_variant_id, true;
end;
$$;

revoke all on function public.publish_wrap(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) from public, anon, authenticated;
grant execute on function public.publish_wrap(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) to service_role;

create function public.edit_wrap(
  p_creator_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_license_type text,
  p_tags text[]
)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
  v_tags text[];
begin
  select w.* into v_wrap from public.wraps w
  where w.slug = lower(p_slug) and w.creator_id = p_creator_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'wrap_not_found';
  end if;
  if v_wrap.status in ('HIDDEN', 'REMOVED') then
    raise exception using errcode = 'P0001', message = 'wrap_unavailable';
  end if;
  if p_license_type not in ('PERSONAL_USE_ALLOWED', 'CREATIVE_COMMONS', 'OTHER')
    or p_title is null or p_title <> btrim(p_title)
    or char_length(p_title) not between 1 and 80
    or p_description is null or char_length(p_description) not between 1 and 2000
  then
    raise exception using errcode = 'P0001', message = 'wrap_metadata_invalid';
  end if;
  v_tags := private.normalize_wrap_tags(p_tags);
  update public.wraps
  set title = p_title, description = p_description,
      license_type = p_license_type
  where wraps.id = v_wrap.id;
  delete from public.wrap_tags where wrap_id = v_wrap.id;
  insert into public.tags (slug, display_name)
  select value, value from unnest(v_tags) as values(value)
  on conflict on constraint tags_slug_key do nothing;
  insert into public.wrap_tags (wrap_id, tag_id)
  select v_wrap.id, tags.id from public.tags
  where tags.slug = any(v_tags);
  return query select v_wrap.id, v_wrap.slug,
    (select wraps.status from public.wraps where wraps.id = v_wrap.id),
    v_wrap.first_published_at;
end;
$$;

revoke all on function public.edit_wrap(uuid, text, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.edit_wrap(uuid, text, text, text, text, text[])
  to service_role;

create function public.unpublish_wrap(p_creator_id uuid, p_slug text)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
begin
  select w.* into v_wrap from public.wraps w
  where w.slug = lower(p_slug) and w.creator_id = p_creator_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'wrap_not_found';
  end if;
  if v_wrap.status = 'REMOVED' or v_wrap.status = 'HIDDEN' then
    raise exception using errcode = 'P0001', message = 'wrap_unavailable';
  end if;
  if v_wrap.status = 'PUBLISHED' then
    update public.wraps set status = 'UNPUBLISHED' where wraps.id = v_wrap.id;
  end if;
  return query select v_wrap.id, v_wrap.slug,
    (select wraps.status from public.wraps where wraps.id = v_wrap.id),
    v_wrap.first_published_at;
end;
$$;

revoke all on function public.unpublish_wrap(uuid, text) from public, anon, authenticated;
grant execute on function public.unpublish_wrap(uuid, text) to service_role;

create function public.republish_wrap(p_creator_id uuid, p_slug text)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
begin
  select w.* into v_wrap from public.wraps w
  where w.slug = lower(p_slug) and w.creator_id = p_creator_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'wrap_not_found';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = p_creator_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_not_allowed';
  end if;
  if v_wrap.status = 'REMOVED' or v_wrap.status = 'HIDDEN' then
    raise exception using errcode = 'P0001', message = 'wrap_unavailable';
  end if;
  if not exists (
    select 1 from public.asset_revisions ar
      where ar.id = v_wrap.asset_revision_id
      and ar.owner_id = p_creator_id
      and ar.template_verified
      and (select count(*) from public.wrap_assets wa
        where wa.asset_revision_id = ar.id) = 3
      and (select count(*) from public.wrap_assets wa
        join storage.objects so
          on so.bucket_id = wa.bucket_id and so.name = wa.object_key
        where wa.asset_revision_id = ar.id) = 3
  ) then
    raise exception using errcode = 'P0001', message = 'wrap_asset_not_ready';
  end if;
  if v_wrap.status = 'UNPUBLISHED' then
    update public.wraps set status = 'PUBLISHED', deleted_at = null
    where wraps.id = v_wrap.id;
  end if;
  return query select v_wrap.id, v_wrap.slug,
    (select wraps.status from public.wraps where wraps.id = v_wrap.id),
    v_wrap.first_published_at;
end;
$$;

revoke all on function public.republish_wrap(uuid, text) from public, anon, authenticated;
grant execute on function public.republish_wrap(uuid, text) to service_role;

create function public.remove_wrap(p_creator_id uuid, p_slug text)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
begin
  select w.* into v_wrap from public.wraps w
  where w.slug = lower(p_slug) and w.creator_id = p_creator_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'wrap_not_found';
  end if;
  if v_wrap.status = 'HIDDEN' then
    raise exception using errcode = 'P0001', message = 'wrap_unavailable';
  end if;
  if v_wrap.status <> 'REMOVED' then
    update public.wraps set status = 'REMOVED', deleted_at = clock_timestamp()
    where wraps.id = v_wrap.id;
  end if;
  return query select v_wrap.id, v_wrap.slug,
    (select wraps.status from public.wraps where wraps.id = v_wrap.id),
    v_wrap.first_published_at;
end;
$$;

revoke all on function public.remove_wrap(uuid, text) from public, anon, authenticated;
grant execute on function public.remove_wrap(uuid, text) to service_role;

create function public.get_public_wrap(p_slug text)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  creator_username text,
  creator_display_name text,
  vehicle_model_name text,
  template_variant_name text,
  template_variant_key text,
  width_px integer,
  height_px integer,
  verified_at date,
  legacy boolean,
  license_type text,
  tags text[],
  first_published_at timestamptz,
  download_count bigint,
  like_count bigint,
  favorite_count bigint,
  comment_count bigint,
  preview_width_px integer,
  preview_height_px integer,
  preview_available boolean,
  availability_caveat text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.slug, w.title, w.description,
    p.username, p.display_name, vm.display_name, tv.display_name,
    tv.catalog_key, ar.width_px, ar.height_px, tv.verified_at,
    not tv.active, w.license_type,
    coalesce(array_agg(t.display_name order by t.slug)
      filter (where t.id is not null), '{}'::text[]),
    w.first_published_at, w.download_count, w.like_count,
    w.favorite_count, w.comment_count, preview.width_px, preview.height_px,
    preview.id is not null and preview_object.id is not null,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id
  join public.template_variants tv on tv.id = w.template_variant_id
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  left join public.wrap_tags wt on wt.wrap_id = w.id
  left join public.tags t on t.id = wt.tag_id
  left join public.wrap_assets preview
    on preview.asset_revision_id = w.asset_revision_id
    and preview.kind = 'PREVIEW'
  left join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
    and preview_object.name = preview.object_key
  where w.slug = lower(p_slug)
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
    and ar.template_verified
  group by w.id, p.username, p.display_name, vm.display_name,
    tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, tv.active, preview.id, preview.width_px, preview.height_px,
    preview_object.id;
$$;

revoke all on function public.get_public_wrap(text) from public;
grant execute on function public.get_public_wrap(text) to anon, authenticated;

create function public.get_public_creator_wraps(p_username text)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  creator_username text,
  creator_display_name text,
  vehicle_model_name text,
  template_variant_name text,
  template_variant_key text,
  width_px integer,
  height_px integer,
  verified_at date,
  legacy boolean,
  license_type text,
  tags text[],
  first_published_at timestamptz,
  download_count bigint,
  like_count bigint,
  favorite_count bigint,
  comment_count bigint,
  preview_width_px integer,
  preview_height_px integer,
  preview_available boolean,
  availability_caveat text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.slug, w.title, w.description,
    p.username, p.display_name, vm.display_name, tv.display_name,
    tv.catalog_key, ar.width_px, ar.height_px, tv.verified_at,
    not tv.active, w.license_type,
    coalesce(array_agg(t.display_name order by t.slug)
      filter (where t.id is not null), '{}'::text[]),
    w.first_published_at, w.download_count, w.like_count,
    w.favorite_count, w.comment_count, preview.width_px, preview.height_px,
    preview.id is not null and preview_object.id is not null,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id
  join public.template_variants tv on tv.id = w.template_variant_id
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  left join public.wrap_tags wt on wt.wrap_id = w.id
  left join public.tags t on t.id = wt.tag_id
  left join public.wrap_assets preview
    on preview.asset_revision_id = w.asset_revision_id
    and preview.kind = 'PREVIEW'
  left join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
    and preview_object.name = preview.object_key
  where p.username = lower(p_username)
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
    and ar.template_verified
  group by w.id, p.username, p.display_name, vm.display_name,
    tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, tv.active, preview.id, preview.width_px, preview.height_px,
    preview_object.id
  order by w.first_published_at desc, w.id desc;
$$;

revoke all on function public.get_public_creator_wraps(text) from public;
grant execute on function public.get_public_creator_wraps(text) to anon, authenticated;

create function public.get_owner_wrap(p_creator_id uuid, p_slug text)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  status text,
  creator_username text,
  template_variant_name text,
  template_variant_key text,
  width_px integer,
  height_px integer,
  verified_at date,
  license_type text,
  template_asserted boolean,
  distribution_asserted boolean,
  tags text[],
  first_published_at timestamptz,
  asset_revision_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.slug, w.title, w.description, w.status,
    p.username, tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, w.license_type, w.template_asserted,
    w.distribution_asserted,
    coalesce(array_agg(t.display_name order by t.slug)
      filter (where t.id is not null), '{}'::text[]),
    w.first_published_at, w.asset_revision_id
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.template_variants tv on tv.id = w.template_variant_id
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  left join public.wrap_tags wt on wt.wrap_id = w.id
  left join public.tags t on t.id = wt.tag_id
  where w.slug = lower(p_slug)
    and w.creator_id = p_creator_id
    and p_creator_id = (select auth.uid())
    and exists (
      select 1 from public.profiles profile
      where profile.user_id = w.creator_id
        and profile.participation_state = 'ACTIVE'
        and profile.onboarding_completed_at is not null
    )
    and w.status not in ('HIDDEN', 'REMOVED')
  group by w.id, p.username, tv.display_name, tv.catalog_key,
    ar.width_px, ar.height_px, tv.verified_at;
$$;

revoke all on function public.get_owner_wrap(uuid, text) from public, anon;
grant execute on function public.get_owner_wrap(uuid, text) to authenticated, service_role;

create function public.get_public_wrap_media(p_slug text)
returns table (object_key text, byte_size integer, sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select asset.object_key, asset.byte_size, asset.sha256
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.wrap_assets asset
    on asset.asset_revision_id = w.asset_revision_id
    and asset.kind = 'PREVIEW'
  join public.asset_revisions ar on ar.id = w.asset_revision_id
  join storage.objects stored
    on stored.bucket_id = asset.bucket_id and stored.name = asset.object_key
  where w.slug = lower(p_slug)
    and w.status = 'PUBLISHED'
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
    and ar.template_verified;
$$;

revoke all on function public.get_public_wrap_media(text) from public, anon, authenticated;
grant execute on function public.get_public_wrap_media(text) to service_role;
