-- Finalize wait/lifecycle hardening (#61):
-- 1. Document the VALIDATING staleness-reclaim window (2 minutes) as the
--    deliberate upper bound on a single finalization's sharp + Storage work.
-- 2. Queue staging cleanup when expiry transitions a Pending Upload out of
--    CREATED/UPLOADED/VALIDATING, so an expired transfer cannot orphan its
--    staged object.

-- 1) Widen the cleanup reason vocabulary for the new expiry path.
alter table public.asset_cleanup_jobs
  drop constraint asset_cleanup_jobs_reason_check;
alter table public.asset_cleanup_jobs
  add constraint asset_cleanup_jobs_reason_check
  check (reason in ('FAILED_FINALIZATION', 'STAGING_AFTER_READY', 'EXPIRED_PENDING_UPLOAD'));

-- 2) Re-apply the claim function with the documented window and the expiry
--    cleanup insert. Logic is otherwise identical to
--    20260809155710_finalize_pending_upload.sql:238-307.
create or replace function public.claim_pending_upload(p_id uuid, p_owner uuid)
returns table (claimed boolean, state text, asset_revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.pending_uploads%rowtype;
begin
  -- A VALIDATING row whose updated_at goes stale by CLAIM_STALENESS_INTERVAL
  -- (2 minutes -- the worst-case duration of one finalization's sharp decode/
  -- resize plus two Storage uploads, with headroom) may be re-claimed by the
  -- next request. Do not lower it without revisiting finalize timeouts.
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
    -- Expiry must not orphan the staged object (#61/WU-02).
    if coalesce(v_upload.staging_key, '') <> '' then
      insert into public.asset_cleanup_jobs (
        pending_upload_id, bucket_id, object_key, reason
      ) values (
        p_id, 'wrap-staging', v_upload.staging_key, 'EXPIRED_PENDING_UPLOAD'
      )
      on conflict (bucket_id, object_key) do nothing;
    end if;
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
grant execute on function public.claim_pending_upload(uuid, uuid)
  to service_role;
