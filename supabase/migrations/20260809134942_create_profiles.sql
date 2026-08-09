create table private.blocked_usernames (
  username text primary key
    constraint blocked_username_canonical check (username = lower(username))
    constraint blocked_username_format check (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  category text not null
    constraint blocked_username_category
      check (category in ('RESERVED', 'BRAND_CONFUSING', 'MODERATION_BLOCKED')),
  ruleset_version smallint not null
    constraint blocked_username_ruleset_version check (ruleset_version > 0),
  created_at timestamptz not null default now()
);

revoke all on table private.blocked_usernames from public;

insert into private.blocked_usernames (username, category, ruleset_version)
values
  ('admin', 'RESERVED', 1),
  ('api', 'RESERVED', 1),
  ('auth', 'RESERVED', 1),
  ('explore', 'RESERVED', 1),
  ('help', 'RESERVED', 1),
  ('model', 'RESERVED', 1),
  ('moderation', 'RESERVED', 1),
  ('moderator', 'RESERVED', 1),
  ('root', 'RESERVED', 1),
  ('settings', 'RESERVED', 1),
  ('support', 'RESERVED', 1),
  ('trending', 'RESERVED', 1),
  ('upload', 'RESERVED', 1),
  ('wrap', 'RESERVED', 1),
  ('tesla', 'BRAND_CONFUSING', 1),
  ('teslamotors', 'BRAND_CONFUSING', 1),
  ('wrapforge', 'BRAND_CONFUSING', 1);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text unique
    constraint profile_username_canonical
      check (username is null or username = lower(username))
    constraint profile_username_format
      check (username is null or username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  display_name text
    constraint profile_display_name_format check (
      display_name is null or (
        display_name = btrim(display_name)
        and char_length(display_name) between 1 and 60
      )
    ),
  bio text not null default ''
    constraint profile_bio_length check (char_length(bio) <= 500),
  avatar_url text,
  onboarding_completed_at timestamptz,
  participation_state text not null default 'ACTIVE'
    constraint profile_participation_state
      check (participation_state in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  username_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_onboarding_consistency check (
    (onboarding_completed_at is not null) =
    (username is not null and display_name is not null)
  )
);

create function private.prepare_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));

    if exists (
      select 1
      from private.blocked_usernames
      where blocked_usernames.username = new.username
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

create trigger prepare_profile
before insert or update on public.profiles
for each row execute function private.prepare_profile();

create function private.provision_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.provision_profile() from public;

create trigger provision_profile
after insert or update of email_confirmed_at on auth.users
for each row execute function private.provision_profile();

insert into public.profiles (user_id)
select id from auth.users
where email_confirmed_at is not null
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to service_role;
grant update (participation_state) on public.profiles to service_role;

create function public.complete_profile(p_username text, p_display_name text)
returns table (username text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.profiles
  set username = p_username, display_name = p_display_name
  where profiles.user_id = (select auth.uid())
    and profiles.participation_state = 'ACTIVE'
    and profiles.onboarding_completed_at is null
  returning profiles.username;
end;
$$;

revoke all on function public.complete_profile(text, text) from public, anon;
grant execute on function public.complete_profile(text, text) to authenticated;

create function public.get_public_profile(p_username text)
returns table (username text, display_name text, bio text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select profiles.username, profiles.display_name, profiles.bio, profiles.avatar_url
  from public.profiles
  where profiles.username = lower(p_username)
    and profiles.onboarding_completed_at is not null
    and profiles.participation_state = 'ACTIVE';
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

create function public.current_profile_access()
returns table (
  username text,
  may_onboard boolean,
  may_participate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profiles.username,
    profiles.participation_state = 'ACTIVE',
    profiles.participation_state = 'ACTIVE'
      and profiles.onboarding_completed_at is not null
  from public.profiles
  where profiles.user_id = (select auth.uid());
$$;

revoke all on function public.current_profile_access() from public, anon;
grant execute on function public.current_profile_access() to authenticated;
