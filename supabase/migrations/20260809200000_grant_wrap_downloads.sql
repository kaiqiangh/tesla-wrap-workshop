begin;

create table public.download_events (
  id uuid primary key default gen_random_uuid(),
  wrap_id uuid not null references public.wraps (id),
  principal_kind text not null
    constraint download_event_principal_kind check (principal_kind in ('GUEST', 'USER')),
  principal_hash text not null,
  user_id uuid references auth.users (id),
  counted boolean not null,
  granted_at timestamptz not null default clock_timestamp(),
  constraint download_event_principal_shape check (
    (principal_kind = 'USER' and user_id is not null
      and principal_hash = 'v1:user:' || user_id::text)
    or (principal_kind = 'GUEST' and user_id is null
      and principal_hash ~ '^v1:[0-9a-f]{64}$')
  )
);

create index download_events_gate_idx
  on public.download_events (wrap_id, principal_hash, granted_at desc)
  where counted;
create index download_events_wrap_idx
  on public.download_events (wrap_id, granted_at desc);

alter table public.download_events enable row level security;
revoke all on public.download_events from public, anon, authenticated;
grant select, insert on public.download_events to service_role;

create function public.prepare_original_download(p_slug text, p_user_id uuid)
returns table (
  wrap_id uuid,
  title text,
  template_variant_name text,
  template_variant_key text,
  vehicle_model_name text,
  width_px integer,
  height_px integer,
  verified_at date,
  availability_caveat text,
  bucket_id text,
  object_key text,
  byte_size integer,
  sha256 text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
begin
  select * into v_wrap from public.wraps
  where slug = lower(p_slug) for share;
  if not found or v_wrap.status <> 'PUBLISHED' or v_wrap.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'download_unavailable';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = v_wrap.creator_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'download_creator_unavailable';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.profiles
    where user_id = p_user_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'download_auth';
  end if;

  return query
  select v_wrap.id, v_wrap.title, tv.display_name, tv.catalog_key,
    vm.display_name, ar.width_px, ar.height_px, tv.verified_at,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'::text,
    asset.bucket_id, asset.object_key, asset.byte_size, asset.sha256
  from public.asset_revisions ar
  join public.template_variants tv on tv.id = v_wrap.template_variant_id
  join public.vehicle_models vm on vm.id = tv.vehicle_model_id
  join public.wrap_assets asset
    on asset.asset_revision_id = ar.id and asset.kind = 'ORIGINAL'
    and asset.bucket_id = 'wrap-originals'
  join storage.objects stored
    on stored.bucket_id = asset.bucket_id and stored.name = asset.object_key
  where ar.id = v_wrap.asset_revision_id
    and ar.template_variant_id = v_wrap.template_variant_id
    and ar.width_px = tv.width_px
    and ar.height_px = tv.height_px
    and asset.width_px = tv.width_px
    and asset.height_px = tv.height_px
    and asset.byte_size <= 1000000
    and asset.byte_size = ar.byte_size
    and asset.sha256 = ar.sha256
    and ar.owner_id = v_wrap.creator_id
    and tv.vehicle_model_id = v_wrap.vehicle_model_id
    and ar.template_verified;
  if not found then
    raise exception using errcode = 'P0001', message = 'download_object_missing';
  end if;
end;
$$;

revoke all on function public.prepare_original_download(text, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_original_download(text, uuid) to service_role;

create function public.record_original_download(
  p_wrap_id uuid,
  p_user_id uuid,
  p_guest_principal_hash text
)
returns table (event_id uuid, counted boolean, download_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap public.wraps%rowtype;
  v_principal_hash text;
  v_principal_kind text;
  v_counted boolean;
begin
  if (p_user_id is null) = (p_guest_principal_hash is null) then
    raise exception using errcode = 'P0001', message = 'download_principal_invalid';
  end if;
  if p_user_id is not null then
    v_principal_kind := 'USER';
    v_principal_hash := 'v1:user:' || p_user_id::text;
    if not exists (
      select 1 from public.profiles
      where user_id = p_user_id
        and participation_state = 'ACTIVE'
        and onboarding_completed_at is not null
    ) then
      raise exception using errcode = 'P0001', message = 'download_auth';
    end if;
  else
    if p_guest_principal_hash !~ '^v1:[0-9a-f]{64}$' then
      raise exception using errcode = 'P0001', message = 'download_principal_invalid';
    end if;
    v_principal_kind := 'GUEST';
    v_principal_hash := p_guest_principal_hash;
  end if;

  select * into v_wrap from public.wraps where id = p_wrap_id for update;
  if not found or v_wrap.status <> 'PUBLISHED' or v_wrap.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'download_unavailable';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = v_wrap.creator_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'download_creator_unavailable';
  end if;
  if not exists (
    select 1
    from public.asset_revisions ar
    join public.template_variants tv
      on tv.id = v_wrap.template_variant_id
    join public.wrap_assets asset
      on asset.asset_revision_id = ar.id and asset.kind = 'ORIGINAL'
      and asset.bucket_id = 'wrap-originals'
    join storage.objects stored
      on stored.bucket_id = asset.bucket_id and stored.name = asset.object_key
    where ar.id = v_wrap.asset_revision_id
      and ar.template_variant_id = v_wrap.template_variant_id
      and ar.width_px = tv.width_px
      and ar.height_px = tv.height_px
      and asset.width_px = tv.width_px
      and asset.height_px = tv.height_px
      and asset.byte_size <= 1000000
      and asset.byte_size = ar.byte_size
      and asset.sha256 = ar.sha256
      and ar.owner_id = v_wrap.creator_id
      and tv.vehicle_model_id = v_wrap.vehicle_model_id
      and ar.template_verified
  ) then
    raise exception using errcode = 'P0001', message = 'download_object_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_wrap.id::text || ':' || v_principal_hash, 23)
  );
  select not exists (
    select 1 from public.download_events
    where wrap_id = v_wrap.id
      and principal_hash = v_principal_hash
      and download_events.counted
      and granted_at > clock_timestamp() - interval '10 minutes'
  ) into v_counted;

  insert into public.download_events (
    wrap_id, principal_kind, principal_hash, user_id, counted
  ) values (
    v_wrap.id, v_principal_kind, v_principal_hash, p_user_id, v_counted
  ) returning id into event_id;
  if v_counted then
    update public.wraps
    set download_count = public.wraps.download_count + 1
    where id = v_wrap.id
    returning wraps.download_count into download_count;
  else
    download_count := v_wrap.download_count;
  end if;
  counted := v_counted;
  return next;
end;
$$;

revoke all on function public.record_original_download(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_original_download(uuid, uuid, text) to service_role;

create function public.reconcile_download_counts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap record;
begin
  for v_wrap in select id from public.wraps order by id for update loop
    update public.wraps w
    set download_count = (
      select count(*) from public.download_events event
      where event.wrap_id = v_wrap.id and event.counted
    )
    where w.id = v_wrap.id;
  end loop;
end;
$$;

revoke all on function public.reconcile_download_counts() from public, anon, authenticated;
grant execute on function public.reconcile_download_counts() to service_role;

commit;
