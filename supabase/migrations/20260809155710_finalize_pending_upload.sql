insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('wrap-staging', 'wrap-staging', false, 1000000, array['image/png']),
  ('wrap-originals', 'wrap-originals', false, 1000000, array['image/png']),
  ('wrap-derived', 'wrap-derived', false, 1000000, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.pending_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (user_id),
  template_variant_id uuid not null references public.template_variants (id),
  idempotency_key uuid not null unique default gen_random_uuid(),
  staging_key text not null unique,
  original_filename text not null check (
    char_length(original_filename) between 5 and 255
    and lower(right(original_filename, 4)) = '.png'
  ),
  declared_mime_type text not null check (declared_mime_type = 'image/png'),
  template_asserted boolean not null check (template_asserted),
  state text not null default 'CREATED' check (
    state in ('CREATED', 'UPLOADED', 'VALIDATING', 'READY', 'FAILED', 'EXPIRED')
  ),
  failure_code text,
  failure_detail jsonb,
  asset_revision_id uuid unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  finalize_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_upload_failure_consistency check (
    (state = 'FAILED') = (failure_code is not null)
  ),
  constraint pending_upload_ready_consistency check (
    (state = 'READY') = (asset_revision_id is not null)
  )
);

create index pending_uploads_owner_active_idx
  on public.pending_uploads (owner_id, expires_at)
  where state in ('CREATED', 'UPLOADED', 'VALIDATING');
create index pending_uploads_owner_finalize_idx
  on public.pending_uploads (owner_id, finalize_started_at)
  where finalize_started_at is not null;

create table public.asset_revisions (
  id uuid primary key,
  owner_id uuid not null references public.profiles (user_id),
  template_variant_id uuid not null references public.template_variants (id),
  source_pending_upload_id uuid not null unique references public.pending_uploads (id),
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  byte_size integer not null check (byte_size between 1 and 1000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  template_verified boolean not null check (template_verified),
  ready_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.pending_uploads
  add constraint pending_upload_asset_revision_fkey
  foreign key (asset_revision_id) references public.asset_revisions (id);

create table public.wrap_assets (
  id uuid primary key default gen_random_uuid(),
  asset_revision_id uuid not null references public.asset_revisions (id),
  kind text not null check (kind in ('ORIGINAL', 'PREVIEW', 'THUMBNAIL')),
  bucket_id text not null check (bucket_id in ('wrap-originals', 'wrap-derived')),
  object_key text not null unique,
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  byte_size integer not null check (byte_size between 1 and 1000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (asset_revision_id, kind),
  constraint wrap_asset_bucket_kind check (
    (kind = 'ORIGINAL' and bucket_id = 'wrap-originals')
    or (kind in ('PREVIEW', 'THUMBNAIL') and bucket_id = 'wrap-derived')
  )
);

create table public.asset_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  pending_upload_id uuid not null references public.pending_uploads (id),
  bucket_id text not null check (
    bucket_id in ('wrap-staging', 'wrap-originals', 'wrap-derived')
  ),
  object_key text not null,
  reason text not null check (
    reason in ('FAILED_FINALIZATION', 'STAGING_AFTER_READY')
  ),
  state text not null default 'PENDING' check (state in ('PENDING', 'COMPLETED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (bucket_id, object_key)
);

alter table public.pending_uploads enable row level security;
alter table public.asset_revisions enable row level security;
alter table public.wrap_assets enable row level security;
alter table public.asset_cleanup_jobs enable row level security;

revoke all on public.pending_uploads, public.asset_revisions, public.wrap_assets
  from anon, authenticated;
revoke all on public.asset_cleanup_jobs from anon, authenticated;
grant select, insert, update on public.pending_uploads to service_role;
grant select, insert on public.asset_revisions, public.wrap_assets to service_role;
grant select, insert, update on public.asset_cleanup_jobs to service_role;

create function public.start_pending_upload(
  p_template_variant_id uuid,
  p_original_filename text,
  p_declared_mime_type text,
  p_template_asserted boolean
)
returns table (
  id uuid,
  staging_key text,
  idempotency_key uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
begin
  if v_owner is null or not exists (
    select 1 from public.profiles
    where user_id = v_owner
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  if not exists (
    select 1 from public.template_variants
    where template_variants.id = p_template_variant_id and active
  ) then
    raise exception using errcode = 'P0001', message = 'template_unavailable';
  end if;
  if (
    select count(*) from public.pending_uploads
    where owner_id = v_owner
      and created_at >= clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'upload_rate_limited';
  end if;
  if p_original_filename is null
    or char_length(p_original_filename) not between 5 and 255
    or lower(right(p_original_filename, 4)) <> '.png'
    or p_declared_mime_type <> 'image/png'
    or p_template_asserted is not true
  then
    raise exception using errcode = '22023', message = 'invalid_upload_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  update public.pending_uploads
  set state = 'EXPIRED', updated_at = clock_timestamp()
  where owner_id = v_owner
    and state in ('CREATED', 'UPLOADED', 'VALIDATING')
    and pending_uploads.expires_at <= clock_timestamp();

  if (
    select count(*) from public.pending_uploads
    where owner_id = v_owner
      and state in ('CREATED', 'UPLOADED', 'VALIDATING')
      and pending_uploads.expires_at > clock_timestamp()
  ) >= 2 then
    raise exception using errcode = 'P0001', message = 'too_many_active_uploads';
  end if;

  return query
  insert into public.pending_uploads (
    id, owner_id, template_variant_id, staging_key, original_filename,
    declared_mime_type, template_asserted
  ) values (
    v_id, v_owner, p_template_variant_id,
    v_owner::text || '/' || v_id::text || '/source.png',
    p_original_filename, p_declared_mime_type, p_template_asserted
  )
  returning pending_uploads.id, pending_uploads.staging_key,
    pending_uploads.idempotency_key, pending_uploads.expires_at;
end;
$$;

revoke all on function public.start_pending_upload(uuid, text, text, boolean)
  from public, anon;
grant execute on function public.start_pending_upload(uuid, text, text, boolean)
  to authenticated;

create function public.get_pending_upload(p_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  template_variant_id uuid,
  staging_key text,
  original_filename text,
  declared_mime_type text,
  template_asserted boolean,
  state text,
  failure_code text,
  failure_detail jsonb,
  expires_at timestamptz,
  asset_revision_id uuid,
  width_px integer,
  height_px integer,
  max_file_bytes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select pending_uploads.id, pending_uploads.owner_id,
    pending_uploads.template_variant_id, pending_uploads.staging_key,
    pending_uploads.original_filename, pending_uploads.declared_mime_type,
    pending_uploads.template_asserted, pending_uploads.state,
    pending_uploads.failure_code, pending_uploads.failure_detail,
    pending_uploads.expires_at, pending_uploads.asset_revision_id,
    template_variants.width_px::integer, template_variants.height_px::integer,
    template_variants.max_file_bytes
  from public.pending_uploads
  join public.template_variants
    on template_variants.id = pending_uploads.template_variant_id
  where pending_uploads.id = p_id
    and pending_uploads.owner_id = (select auth.uid());
$$;

revoke all on function public.get_pending_upload(uuid) from public, anon;
grant execute on function public.get_pending_upload(uuid) to authenticated;

create function public.claim_pending_upload(p_id uuid, p_owner uuid)
returns table (claimed boolean, state text, asset_revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.pending_uploads%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_upload from public.pending_uploads
  where id = p_id and owner_id = p_owner for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'upload_not_found';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = p_owner
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  if v_upload.expires_at <= clock_timestamp()
    and v_upload.state in ('CREATED', 'UPLOADED', 'VALIDATING')
  then
    update public.pending_uploads set state = 'EXPIRED', updated_at = clock_timestamp()
    where id = p_id;
    return query select false, 'EXPIRED'::text, null::uuid;
    return;
  end if;
  if v_upload.state = 'VALIDATING'
    and v_upload.updated_at > clock_timestamp() - interval '2 minutes'
  then
    return query select false, v_upload.state, v_upload.asset_revision_id;
    return;
  end if;
  if v_upload.state in ('READY', 'FAILED', 'EXPIRED') then
    return query select false, v_upload.state, v_upload.asset_revision_id;
    return;
  end if;
  if v_upload.state = 'VALIDATING' then
    update public.pending_uploads
    set updated_at = clock_timestamp()
    where id = p_id;
    return query select true, 'VALIDATING'::text, null::uuid;
    return;
  end if;
  if v_upload.finalize_started_at is null then
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 1));
    if (
      select count(*) from public.pending_uploads
      where owner_id = p_owner
        and finalize_started_at >= clock_timestamp() - interval '1 hour'
    ) >= 10 then
      raise exception using errcode = 'P0001', message = 'upload_rate_limited';
    end if;
    update public.pending_uploads
    set finalize_started_at = clock_timestamp()
    where id = p_id;
  end if;
  if v_upload.state = 'CREATED' then
    update public.pending_uploads set state = 'UPLOADED', updated_at = clock_timestamp()
    where id = p_id;
  end if;
  update public.pending_uploads set state = 'VALIDATING', updated_at = clock_timestamp()
  where id = p_id;
  return query select true, 'VALIDATING'::text, null::uuid;
end;
$$;

revoke all on function public.claim_pending_upload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_pending_upload(uuid, uuid) to service_role;

create function public.complete_pending_upload(
  p_id uuid,
  p_revision_id uuid,
  p_width integer,
  p_height integer,
  p_original_bytes integer,
  p_original_sha256 text,
  p_preview_width integer,
  p_preview_height integer,
  p_preview_bytes integer,
  p_preview_sha256 text,
  p_thumbnail_width integer,
  p_thumbnail_height integer,
  p_thumbnail_bytes integer,
  p_thumbnail_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.pending_uploads%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_upload from public.pending_uploads where id = p_id for update;
  if not found or v_upload.state <> 'VALIDATING' then
    raise exception using errcode = 'P0001', message = 'upload_not_validating';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = v_upload.owner_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  if not exists (
    select 1 from public.template_variants
      where id = v_upload.template_variant_id
      and width_px = p_width and height_px = p_height
      and p_original_bytes between 1 and max_file_bytes
  ) then
    raise exception using errcode = 'P0001', message = 'asset_measurements_invalid';
  end if;
  if p_preview_bytes not between 1 and 1000000
    or p_thumbnail_bytes not between 1 and 1000000
  then
    raise exception using errcode = 'P0001', message = 'asset_measurements_invalid';
  end if;
  if not (
    exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-originals'
        and name = v_upload.owner_id::text || '/' || p_revision_id::text || '/original.png'
    )
    and exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-derived'
        and name = v_upload.owner_id::text || '/' || p_revision_id::text || '/preview.png'
    )
    and exists (
      select 1 from storage.objects
      where bucket_id = 'wrap-derived'
        and name = v_upload.owner_id::text || '/' || p_revision_id::text || '/thumbnail.png'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'assets_incomplete';
  end if;

  insert into public.asset_revisions (
    id, owner_id, template_variant_id, source_pending_upload_id,
    width_px, height_px, byte_size, sha256, template_verified
  ) values (
    p_revision_id, v_upload.owner_id, v_upload.template_variant_id, p_id,
    p_width, p_height, p_original_bytes, p_original_sha256, true
  );
  insert into public.wrap_assets (
    asset_revision_id, kind, bucket_id, object_key, width_px, height_px,
    byte_size, sha256
  ) values
    (p_revision_id, 'ORIGINAL', 'wrap-originals',
      v_upload.owner_id::text || '/' || p_revision_id::text || '/original.png',
      p_width, p_height, p_original_bytes, p_original_sha256),
    (p_revision_id, 'PREVIEW', 'wrap-derived',
      v_upload.owner_id::text || '/' || p_revision_id::text || '/preview.png',
      p_preview_width, p_preview_height, p_preview_bytes, p_preview_sha256),
    (p_revision_id, 'THUMBNAIL', 'wrap-derived',
      v_upload.owner_id::text || '/' || p_revision_id::text || '/thumbnail.png',
      p_thumbnail_width, p_thumbnail_height, p_thumbnail_bytes, p_thumbnail_sha256);
  update public.pending_uploads
  set state = 'READY', asset_revision_id = p_revision_id, updated_at = clock_timestamp()
  where id = p_id;
  return p_revision_id;
end;
$$;

revoke all on function public.complete_pending_upload(
  uuid, uuid, integer, integer, integer, text,
  integer, integer, integer, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.complete_pending_upload(
  uuid, uuid, integer, integer, integer, text,
  integer, integer, integer, text, integer, integer, integer, text
) to service_role;

create function public.fail_pending_upload(p_id uuid, p_code text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code !~ '^WF-UPLOAD-[A-Z-]+$' then
    raise exception using errcode = '22023', message = 'invalid_failure_code';
  end if;
  update public.pending_uploads
  set state = 'FAILED', failure_code = p_code, failure_detail = p_detail,
    updated_at = clock_timestamp()
  where id = p_id and state in ('CREATED', 'UPLOADED', 'VALIDATING');
end;
$$;

revoke all on function public.fail_pending_upload(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_pending_upload(uuid, text, jsonb)
  to service_role;

create function private.may_upload_staging_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pending_uploads
    where owner_id = (select auth.uid())
      and staging_key = p_name
      and state = 'CREATED'
      and expires_at > clock_timestamp()
  );
$$;

revoke all on function private.may_upload_staging_object(text) from public;
grant execute on function private.may_upload_staging_object(text) to authenticated;

create function private.reject_asset_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Asset Revisions and Wrap Assets are immutable';
end;
$$;

revoke all on function private.reject_asset_mutation() from public;

create trigger reject_asset_revision_mutation
before update or delete on public.asset_revisions
for each row execute function private.reject_asset_mutation();

create trigger reject_wrap_asset_mutation
before update or delete on public.wrap_assets
for each row execute function private.reject_asset_mutation();

create policy "owners insert issued staging objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wrap-staging'
  and private.may_upload_staging_object(name)
  and owner_id = (select auth.uid()::text)
);

create policy "owners read issued staging objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'wrap-staging'
  and private.may_upload_staging_object(name)
  and owner_id = (select auth.uid()::text)
);
