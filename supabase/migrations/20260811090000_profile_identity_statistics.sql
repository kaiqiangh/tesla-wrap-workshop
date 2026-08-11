begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-source', 'profile-source', false, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('profile-derived', 'profile-derived', false, 1048576, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.profile_username_aliases (
  alias text primary key
    constraint profile_alias_canonical check (alias = lower(alias))
    constraint profile_alias_format check (alias ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  profile_id uuid not null,
  created_at timestamptz not null default now()
);

create index profile_alias_profile_idx on public.profile_username_aliases (profile_id);

create table public.profile_avatar_assets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (user_id) on delete cascade,
  source_bucket text not null default 'profile-source' check (source_bucket = 'profile-source'),
  source_key text not null unique,
  derived_bucket text not null default 'profile-derived' check (derived_bucket = 'profile-derived'),
  derived_key text not null unique,
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  byte_size integer not null check (byte_size between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'RETIRED')),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create unique index profile_avatar_one_active_idx
  on public.profile_avatar_assets (profile_id)
  where state = 'ACTIVE';

alter table public.profiles
  add column if not exists avatar_asset_id uuid references public.profile_avatar_assets (id);

create table public.creator_follows (
  follower_id uuid not null references public.profiles (user_id) on delete cascade,
  creator_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id),
  constraint creator_follow_not_self check (follower_id <> creator_id)
);

create index creator_follows_creator_idx on public.creator_follows (creator_id, follower_id);

create table public.profile_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (user_id) on delete cascade,
  avatar_asset_id uuid references public.profile_avatar_assets (id),
  bucket_id text not null check (bucket_id in ('profile-source', 'profile-derived')),
  object_key text not null,
  state text not null default 'PENDING' check (state in ('PENDING', 'DONE', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (bucket_id, object_key)
);

alter table public.profile_cleanup_jobs
  drop constraint profile_cleanup_jobs_state_check;
alter table public.profile_cleanup_jobs
  add constraint profile_cleanup_jobs_state_check
  check (state in ('PENDING', 'PROCESSING', 'DONE', 'FAILED'));

alter table public.profile_username_aliases enable row level security;
alter table public.profile_avatar_assets enable row level security;
alter table public.creator_follows enable row level security;
alter table public.profile_cleanup_jobs enable row level security;

revoke all on public.profile_username_aliases, public.profile_avatar_assets,
  public.creator_follows, public.profile_cleanup_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.profile_username_aliases,
  public.profile_avatar_assets, public.creator_follows, public.profile_cleanup_jobs
  to service_role;

create or replace function public.claim_profile_cleanup_jobs(p_limit integer default 50)
returns table (
  id uuid,
  profile_id uuid,
  avatar_asset_id uuid,
  bucket_id text,
  object_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select j.id
    from public.profile_cleanup_jobs j
    where (
      j.state in ('PENDING', 'FAILED')
      or (j.state = 'PROCESSING' and (
        j.claimed_at is null
        or j.claimed_at < clock_timestamp() - interval '10 minutes'
      ))
    )
    and j.attempts < 10
    order by j.created_at, j.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  update public.profile_cleanup_jobs j
  set state = 'PROCESSING', attempts = j.attempts + 1,
      claimed_at = clock_timestamp(), last_error = null
  from claimed
  where j.id = claimed.id
  returning j.id, j.profile_id, j.avatar_asset_id, j.bucket_id, j.object_key, j.attempts;
end;
$$;

create or replace function public.complete_profile_cleanup_job(
  p_id uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profile_cleanup_jobs
  set state = case when p_success then 'DONE' else 'FAILED' end,
      claimed_at = null,
      last_error = case when p_success then null else left(coalesce(p_error, 'cleanup_failed'), 500) end,
      completed_at = case when p_success then clock_timestamp() else null end
  where id = p_id and state = 'PROCESSING';
  return found;
end;
$$;

revoke all on function public.claim_profile_cleanup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_profile_cleanup_jobs(integer) to service_role;
revoke all on function public.complete_profile_cleanup_job(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_profile_cleanup_job(uuid, boolean, text)
  to service_role;

create or replace function public.update_profile(
  p_username text,
  p_display_name text,
  p_bio text
)
returns table (username text, display_name text, bio text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_bio text := btrim(coalesce(p_bio, ''));
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'profile_auth_required';
  end if;

  select * into v_profile
  from public.profiles
  where user_id = v_user_id
  for update;

  if not found or v_profile.participation_state <> 'ACTIVE'
    or v_profile.onboarding_completed_at is null then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  if v_username = '' or v_username <> v_profile.username then
    if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$' then
      raise exception using errcode = 'P0001', message = 'username_invalid';
    end if;
    if exists (select 1 from private.blocked_usernames b where b.username = v_username)
      or exists (select 1 from public.profile_username_aliases a where a.alias = v_username)
      or exists (select 1 from public.profiles p where p.username = v_username and p.user_id <> v_user_id) then
      raise exception using errcode = 'P0001', message = 'username_unavailable';
    end if;
    if v_profile.username_changed_at is not null
      and v_profile.username_changed_at > clock_timestamp() - interval '30 days' then
      raise exception using errcode = 'P0001', message = 'username_cooldown';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_profile.username, 22));
    insert into public.profile_username_aliases (alias, profile_id)
    values (v_profile.username, v_user_id)
    on conflict (alias) do nothing;
    v_profile.username_changed_at := clock_timestamp();
  else
    v_username := v_profile.username;
  end if;

  if char_length(v_display_name) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'display_name_invalid';
  end if;
  if char_length(v_bio) > 500 then
    raise exception using errcode = 'P0001', message = 'bio_invalid';
  end if;

  return query
  update public.profiles p
  set username = v_username,
      display_name = v_display_name,
      bio = v_bio,
      username_changed_at = v_profile.username_changed_at
  where p.user_id = v_user_id
  returning p.username, p.display_name, p.bio;
end;
$$;

revoke all on function public.update_profile(text, text, text) from public, anon;
grant execute on function public.update_profile(text, text, text) to authenticated;

create or replace function public.replace_profile_avatar(
  p_profile_id uuid,
  p_source_key text,
  p_derived_key text,
  p_width_px integer,
  p_height_px integer,
  p_byte_size integer,
  p_sha256 text
)
returns table (avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_profile_id;
  v_username text;
  v_old public.profile_avatar_assets%rowtype;
  v_new_id uuid;
begin
  select username into v_username
  from public.profiles
  where user_id = v_user_id
    and participation_state = 'ACTIVE'
    and onboarding_completed_at is not null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  if p_source_key !~ ('^' || v_user_id::text || '/')
    or p_derived_key !~ ('^' || v_user_id::text || '/') then
    raise exception using errcode = 'P0001', message = 'avatar_key_invalid';
  end if;

  select * into v_old from public.profile_avatar_assets
  where profile_id = v_user_id and state = 'ACTIVE' for update;

  insert into public.profile_avatar_assets (
    profile_id, source_key, derived_key, width_px, height_px, byte_size, sha256
  ) values (
    v_user_id, p_source_key, p_derived_key, p_width_px, p_height_px, p_byte_size, lower(p_sha256)
  ) returning id into v_new_id;

  update public.profile_avatar_assets
  set state = 'RETIRED', retired_at = clock_timestamp()
  where profile_id = v_user_id and state = 'ACTIVE' and id <> v_new_id;

  update public.profiles
  set avatar_asset_id = v_new_id,
      avatar_url = '/api/profiles/' || v_username || '/avatar'
  where user_id = v_user_id;

  if found and v_old.id is not null then
    insert into public.profile_cleanup_jobs (profile_id, avatar_asset_id, bucket_id, object_key)
    values
      (v_user_id, v_old.id, v_old.source_bucket, v_old.source_key),
      (v_user_id, v_old.id, v_old.derived_bucket, v_old.derived_key)
    on conflict (bucket_id, object_key) do nothing;
  end if;
  return query select '/api/profiles/' || v_username || '/avatar';
end;
$$;

revoke all on function public.replace_profile_avatar(uuid, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.replace_profile_avatar(uuid, text, text, integer, integer, integer, text)
  to service_role;

create or replace function public.deactivate_profile()
returns table (deactivated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile_state text;
  v_onboarding_completed_at timestamptz;
  v_asset public.profile_avatar_assets%rowtype;
begin
  select participation_state, onboarding_completed_at
    into v_profile_state, v_onboarding_completed_at
  from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  if (v_profile_state is distinct from 'ACTIVE'
      or v_onboarding_completed_at is null)
    and v_profile_state <> 'DEACTIVATED' then
    raise exception using errcode = 'P0001', message = 'profile_unavailable';
  end if;
  if v_profile_state = 'DEACTIVATED' then
    return query select false;
    return;
  end if;
  for v_asset in select * from public.profile_avatar_assets where profile_id = v_user_id and state = 'ACTIVE' loop
    insert into public.profile_cleanup_jobs (profile_id, avatar_asset_id, bucket_id, object_key)
    values
      (v_user_id, v_asset.id, v_asset.source_bucket, v_asset.source_key),
      (v_user_id, v_asset.id, v_asset.derived_bucket, v_asset.derived_key)
    on conflict (bucket_id, object_key) do nothing;
    update public.profile_avatar_assets
    set state = 'RETIRED', retired_at = clock_timestamp()
    where id = v_asset.id;
  end loop;
  update public.profiles
  set participation_state = 'DEACTIVATED', avatar_asset_id = null, avatar_url = null
  where user_id = v_user_id;
  return query select true;
end;
$$;

revoke all on function public.deactivate_profile() from public, anon;
grant execute on function public.deactivate_profile() to authenticated;

create or replace function public.get_public_profile_details(p_username text)
returns table (
  requested_username text,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  follower_count bigint,
  published_wrap_count bigint,
  ever_published boolean,
  download_count bigint,
  availability text,
  is_alias boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with resolved as (
    select p.*, (a.alias is not null) as alias_hit,
      (p.username = lower(btrim(p_username))) as exact_hit
    from public.profiles p
    left join public.profile_username_aliases a
      on a.profile_id = p.user_id and a.alias = lower(btrim(p_username))
    where p.username = lower(btrim(p_username)) or a.alias is not null
    order by exact_hit desc, p.username
    limit 1
  )
  select lower(btrim(p_username)),
    r.username,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null then r.display_name end,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null then r.bio end,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null and aa.id is not null
      then '/api/profiles/' || r.username || '/avatar' end,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null
      then coalesce((select count(*) from public.creator_follows f
      join public.profiles fp on fp.user_id = f.follower_id
      where f.creator_id = r.user_id and fp.participation_state = 'ACTIVE'
        and fp.onboarding_completed_at is not null), 0)::bigint
      else 0::bigint end,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null
      then coalesce((select count(*) from public.wraps w
      join public.asset_revisions ar on ar.id = w.asset_revision_id
      join public.vehicle_models vm on vm.id = w.vehicle_model_id
      join public.template_variants tv on tv.id = w.template_variant_id
      join public.wrap_assets wa on wa.asset_revision_id = ar.id
        and wa.kind = 'PREVIEW' and wa.bucket_id = 'wrap-derived'
      join storage.objects so on so.bucket_id = wa.bucket_id and so.name = wa.object_key
      where w.creator_id = r.user_id and w.status = 'PUBLISHED' and w.deleted_at is null
        and vm.active
        and ar.template_verified
        and ar.template_variant_id = w.template_variant_id
        and ar.width_px = tv.width_px and ar.height_px = tv.height_px
        and wa.width_px > 0 and wa.height_px > 0), 0)::bigint
      else 0::bigint end,
    case when r.user_id is not null then exists (
      select 1 from public.wraps w
      where w.creator_id = r.user_id and w.first_published_at is not null
    ) else false end,
    case when r.participation_state = 'ACTIVE' and r.onboarding_completed_at is not null
      then coalesce((select count(*) from public.download_events de
      join public.wraps w on w.id = de.wrap_id
      join public.asset_revisions ar on ar.id = w.asset_revision_id
      join public.vehicle_models vm on vm.id = w.vehicle_model_id
      join public.template_variants tv on tv.id = w.template_variant_id
      join public.wrap_assets wa on wa.asset_revision_id = ar.id
        and wa.kind = 'PREVIEW' and wa.bucket_id = 'wrap-derived'
      join storage.objects so on so.bucket_id = wa.bucket_id and so.name = wa.object_key
      left join public.profiles actor on actor.user_id = de.user_id
      where de.counted and (de.user_id is null or (
          actor.participation_state = 'ACTIVE'
          and actor.onboarding_completed_at is not null))
        and w.creator_id = r.user_id and w.status = 'PUBLISHED' and w.deleted_at is null
        and vm.active
        and ar.template_verified
        and ar.template_variant_id = w.template_variant_id
        and ar.width_px = tv.width_px and ar.height_px = tv.height_px
        and wa.width_px > 0 and wa.height_px > 0), 0)::bigint
      else 0::bigint end,
    case when r.user_id is null then 'UNAVAILABLE'
      when r.participation_state = 'SUSPENDED' then 'TEMPORARILY_UNAVAILABLE'
      when r.participation_state = 'DEACTIVATED' then 'UNAVAILABLE'
      when r.onboarding_completed_at is null then 'UNAVAILABLE'
      else 'PUBLIC' end,
    coalesce(r.alias_hit, false)
  from resolved r
  left join public.profile_avatar_assets aa
    on aa.id = r.avatar_asset_id and aa.state = 'ACTIVE';
$$;

revoke all on function public.get_public_profile_details(text) from public;
grant execute on function public.get_public_profile_details(text) to anon, authenticated;

create or replace function public.get_public_profile(p_username text)
returns table (username text, display_name text, bio text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.username, d.display_name, d.bio, d.avatar_url
  from public.get_public_profile_details(p_username) d
  where d.availability = 'PUBLIC';
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

drop function if exists public.get_public_creator_wraps(text);

create or replace function public.get_public_creator_wraps(
  p_username text,
  p_offset integer default 0
)
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
-- ponytail: offset pagination keeps the profile surface small; use discovery keysets if creator catalogs need deeper scale.
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
    w.first_published_at,
    coalesce((select count(*) from public.download_events de
      left join public.profiles actor on actor.user_id = de.user_id
      where de.wrap_id = w.id and de.counted and (de.user_id is null or (
        actor.participation_state = 'ACTIVE'
        and actor.onboarding_completed_at is not null))), 0)::bigint,
    w.like_count,
    w.favorite_count, w.comment_count, preview.width_px, preview.height_px,
    true,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'
  from public.wraps w
  join public.profiles p on p.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id
  join public.template_variants tv on tv.id = w.template_variant_id
  join public.asset_revisions ar on ar.id = w.asset_revision_id
    and ar.template_variant_id = w.template_variant_id
    and ar.width_px = tv.width_px
    and ar.height_px = tv.height_px
  join public.wrap_assets preview
    on preview.asset_revision_id = w.asset_revision_id
    and preview.kind = 'PREVIEW'
    and preview.bucket_id = 'wrap-derived'
    and preview.width_px > 0
    and preview.height_px > 0
  join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
    and preview_object.name = preview.object_key
  left join public.wrap_tags wt on wt.wrap_id = w.id
  left join public.tags t on t.id = wt.tag_id
  where p.username = lower(btrim(p_username))
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and p.participation_state = 'ACTIVE'
    and p.onboarding_completed_at is not null
    and vm.active
    and ar.template_verified
  group by w.id, p.username, p.display_name, vm.display_name,
    tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, tv.active, preview.width_px, preview.height_px
  order by w.first_published_at desc, w.id desc
  limit 24 offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_public_creator_wraps(text, integer) from public;
grant execute on function public.get_public_creator_wraps(text, integer) to anon, authenticated;

create or replace function private.prepare_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));
    perform pg_advisory_xact_lock(hashtextextended(new.username, 22));

    if exists (
      select 1 from private.blocked_usernames
      where blocked_usernames.username = new.username
    ) or exists (
      select 1 from public.profile_username_aliases
      where alias = new.username and profile_id <> new.user_id
    ) then
      raise exception using errcode = 'P0001', message = 'username_unavailable';
    end if;
  end if;

  if new.display_name is not null then
    new.display_name := btrim(new.display_name);
  end if;

  if new.username is not null
    and new.display_name is not null
    and new.onboarding_completed_at is null
  then
    new.onboarding_completed_at := clock_timestamp();
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.prepare_profile() from public;

commit;
