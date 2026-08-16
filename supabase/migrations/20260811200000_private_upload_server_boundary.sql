create function public.start_pending_upload_for_owner(
  p_owner uuid,
  p_template_variant_id uuid,
  p_original_filename text,
  p_declared_mime_type text,
  p_template_asserted boolean
)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_max integer;
  v_window_seconds integer;
begin
  if p_owner is null or not exists (
    select 1 from public.profiles
    where user_id = p_owner
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  if not exists (
    select 1 from public.template_variants
    where template_variants.id = p_template_variant_id and template_variants.active
  ) then
    raise exception using errcode = 'P0001', message = 'template_unavailable';
  end if;
  if p_original_filename is null
    or char_length(p_original_filename) not between 5 and 255
    or lower(right(p_original_filename, 4)) <> '.png'
    or p_declared_mime_type <> 'image/png'
    or p_template_asserted is not true
  then
    raise exception using errcode = '22023', message = 'invalid_upload_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 0));
  select max_count, window_seconds into v_max, v_window_seconds
  from private.launch_rate_policies
  where policy_key = 'upload_create_user';
  if v_max is null or v_window_seconds is null then
    raise exception using errcode = 'P0001', message = 'launch_policy_missing';
  end if;
  if (
    select count(*) from public.pending_uploads
    where owner_id = p_owner
      and created_at >= clock_timestamp() - make_interval(secs => v_window_seconds)
  ) >= v_max then
    raise exception using errcode = 'P0001', message = 'upload_rate_limited';
  end if;

  update public.pending_uploads
  set state = 'EXPIRED', updated_at = clock_timestamp()
  where owner_id = p_owner
    and state in ('CREATED', 'UPLOADED', 'VALIDATING')
    and pending_uploads.expires_at <= clock_timestamp();
  if (
    select count(*) from public.pending_uploads
    where owner_id = p_owner
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
    v_id, p_owner, p_template_variant_id,
    p_owner::text || '/' || v_id::text || '/source.png',
    p_original_filename, p_declared_mime_type, p_template_asserted
  )
  returning pending_uploads.id, pending_uploads.expires_at;
end;
$$;

create function public.get_pending_upload_for_owner(p_owner uuid, p_id uuid)
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
  where pending_uploads.id = p_id and pending_uploads.owner_id = p_owner;
$$;

revoke all on function public.start_pending_upload_for_owner(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_pending_upload_for_owner(
  uuid, uuid, text, text, boolean
) to service_role;
revoke all on function public.get_pending_upload_for_owner(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pending_upload_for_owner(uuid, uuid)
  to service_role;

drop function public.start_pending_upload(uuid, text, text, boolean);
create function public.start_pending_upload(
  p_template_variant_id uuid,
  p_original_filename text,
  p_declared_mime_type text,
  p_template_asserted boolean
)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise exception using errcode = 'P0001', message = 'upload_not_allowed';
  end if;
  return query
  select * from public.start_pending_upload_for_owner(
    v_owner, p_template_variant_id, p_original_filename,
    p_declared_mime_type, p_template_asserted
  );
end;
$$;
revoke all on function public.start_pending_upload(uuid, text, text, boolean)
  from public, anon;
grant execute on function public.start_pending_upload(uuid, text, text, boolean)
  to authenticated;
revoke all on function public.get_pending_upload(uuid)
  from public, anon, authenticated;

create or replace function private.queue_expired_pending_staging()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'EXPIRED' and old.state is distinct from new.state then
    insert into public.asset_cleanup_jobs (
      pending_upload_id, bucket_id, object_key, reason
    ) values (
      new.id, 'wrap-staging', new.staging_key, 'FAILED_FINALIZATION'
    ) on conflict (bucket_id, object_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_expired_pending_staging() from public;
drop trigger if exists queue_expired_pending_staging on public.pending_uploads;
create trigger queue_expired_pending_staging
after update of state on public.pending_uploads
for each row execute function private.queue_expired_pending_staging();

drop policy if exists "owners insert issued staging objects" on storage.objects;
drop policy if exists "owners read issued staging objects" on storage.objects;
revoke all on table storage.objects from anon, authenticated;
