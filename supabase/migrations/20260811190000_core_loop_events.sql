begin;

create table public.core_loop_events (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null check (event_kind in (
    'AUTH_SIGNUP',
    'PROFILE_ONBOARDED',
    'UPLOAD_STARTED',
    'UPLOAD_VALIDATION_PASSED',
    'UPLOAD_VALIDATION_FAILED',
    'WRAP_PUBLISHED',
    'WRAP_UNPUBLISHED',
    'WRAP_VIEW',
    'DOWNLOAD_GRANTED'
  )),
  actor_id uuid references auth.users (id) on delete set null,
  principal_kind text check (principal_kind is null or principal_kind in ('GUEST', 'USER')),
  principal_hash text,
  target_type text not null check (target_type in (
    'USER',
    'PROFILE',
    'PENDING_UPLOAD',
    'ASSET_REVISION',
    'WRAP'
  )),
  target_id uuid not null,
  outcome text not null check (outcome in ('SUCCESS', 'DUPLICATE', 'FAILURE')),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  counted boolean,
  correlation_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '90 days'),
  constraint core_loop_event_principal_shape check (
    (principal_kind is null and principal_hash is null)
    or (principal_kind = 'USER' and principal_hash is null and actor_id is not null)
    or (principal_kind = 'GUEST' and principal_hash ~ '^v1:[0-9a-f]{64}$')
  ),
  constraint core_loop_event_count_shape check (
    event_kind <> 'DOWNLOAD_GRANTED' or counted is not null
  )
);

create index core_loop_events_kind_idx
  on public.core_loop_events (event_kind, occurred_at desc);
create index core_loop_events_target_idx
  on public.core_loop_events (target_type, target_id, occurred_at desc);
create index core_loop_events_expiry_idx
  on public.core_loop_events (expires_at);

alter table public.core_loop_events enable row level security;
revoke all on public.core_loop_events from public, anon, authenticated;
grant select on public.core_loop_events to service_role;

create function private.normalized_core_loop_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9_-]', '_', 'g'), 64), ''),
    'UNKNOWN'
  );
$$;

revoke all on function private.normalized_core_loop_code(text) from public;

create function private.record_core_loop_event(
  p_event_kind text,
  p_actor_id uuid,
  p_principal_kind text,
  p_principal_hash text,
  p_target_type text,
  p_target_id uuid,
  p_outcome text,
  p_code text,
  p_counted boolean default null,
  p_correlation_id uuid default null,
  p_occurred_at timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.core_loop_events (
    event_kind, actor_id, principal_kind, principal_hash,
    target_type, target_id, outcome, code, counted,
    correlation_id, occurred_at, expires_at
  ) values (
    p_event_kind, p_actor_id, p_principal_kind, p_principal_hash,
    p_target_type, p_target_id, p_outcome,
    private.normalized_core_loop_code(p_code), p_counted,
    p_correlation_id, coalesce(p_occurred_at, clock_timestamp()),
    coalesce(p_occurred_at, clock_timestamp()) + interval '90 days'
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.record_core_loop_event(
  text, uuid, text, text, text, uuid, text, text, boolean, uuid, timestamptz
) from public;

create function public.record_core_loop_event(
  p_event_kind text,
  p_actor_id uuid,
  p_principal_kind text,
  p_principal_hash text,
  p_target_type text,
  p_target_id uuid,
  p_outcome text,
  p_code text,
  p_counted boolean,
  p_correlation_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.record_core_loop_event(
    p_event_kind, p_actor_id, p_principal_kind, p_principal_hash,
    p_target_type, p_target_id, p_outcome, p_code, p_counted,
    p_correlation_id, clock_timestamp()
  );
$$;

revoke all on function public.record_core_loop_event(
  text, uuid, text, text, text, uuid, text, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.record_core_loop_event(
  text, uuid, text, text, text, uuid, text, text, boolean, uuid
) to service_role;

create function public.cleanup_core_loop_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.core_loop_events
  where expires_at <= clock_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_core_loop_events() from public, anon, authenticated;
grant execute on function public.cleanup_core_loop_events() to service_role;

create function private.record_auth_signup_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_core_loop_event(
    'AUTH_SIGNUP', new.id, null, null, 'USER', new.id,
    'SUCCESS', 'AUTH_SIGNUP'
  );
  return new;
end;
$$;

revoke all on function private.record_auth_signup_event() from public;
drop trigger if exists record_auth_signup_event on auth.users;
create trigger record_auth_signup_event
after insert on auth.users
for each row execute function private.record_auth_signup_event();

create function private.record_profile_onboarding_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.onboarding_completed_at is null
    and new.onboarding_completed_at is not null
  then
    perform private.record_core_loop_event(
      'PROFILE_ONBOARDED', new.user_id, null, null, 'PROFILE', new.user_id,
      'SUCCESS', 'PROFILE_ONBOARDED'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_profile_onboarding_event() from public;
drop trigger if exists record_profile_onboarding_event on public.profiles;
create trigger record_profile_onboarding_event
after update on public.profiles
for each row execute function private.record_profile_onboarding_event();

create function private.record_pending_upload_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_core_loop_event(
      'UPLOAD_STARTED', new.owner_id, null, null, 'PENDING_UPLOAD', new.id,
      'SUCCESS', 'UPLOAD_STARTED'
    );
  elsif old.state is distinct from new.state and new.state = 'READY' then
    perform private.record_core_loop_event(
      'UPLOAD_VALIDATION_PASSED', new.owner_id, null, null, 'PENDING_UPLOAD', new.id,
      'SUCCESS', 'UPLOAD_VALIDATION_PASSED'
    );
  elsif old.state is distinct from new.state and new.state = 'FAILED' then
    perform private.record_core_loop_event(
      'UPLOAD_VALIDATION_FAILED', new.owner_id, null, null, 'PENDING_UPLOAD', new.id,
      'FAILURE', coalesce(new.failure_code, 'UPLOAD_VALIDATION_FAILED')
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_pending_upload_event() from public;
drop trigger if exists record_pending_upload_event on public.pending_uploads;
create trigger record_pending_upload_event
after insert or update of state, failure_code on public.pending_uploads
for each row execute function private.record_pending_upload_event();

create function private.record_wrap_publication_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'PUBLISHED'
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    perform private.record_core_loop_event(
      'WRAP_PUBLISHED', new.creator_id, null, null, 'WRAP', new.id,
      'SUCCESS', 'WRAP_PUBLISHED'
    );
  elsif tg_op = 'UPDATE'
    and old.status = 'PUBLISHED'
    and new.status = 'UNPUBLISHED'
  then
    perform private.record_core_loop_event(
      'WRAP_UNPUBLISHED', new.creator_id, null, null, 'WRAP', new.id,
      'SUCCESS', 'WRAP_UNPUBLISHED'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_wrap_publication_event() from public;
drop trigger if exists record_wrap_publication_event on public.wraps;
create trigger record_wrap_publication_event
after insert or update of status on public.wraps
for each row execute function private.record_wrap_publication_event();

create function private.record_download_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_core_loop_event(
    'DOWNLOAD_GRANTED', new.user_id,
    new.principal_kind,
    case when new.principal_kind = 'GUEST' then new.principal_hash end,
    'WRAP', new.wrap_id,
    case when new.counted then 'SUCCESS' else 'DUPLICATE' end,
    case when new.counted then 'DOWNLOAD_COUNTED' else 'DOWNLOAD_DUPLICATE' end,
    new.counted
  );
  return new;
end;
$$;

revoke all on function private.record_download_event() from public;
drop trigger if exists record_download_event on public.download_events;
create trigger record_download_event
after insert on public.download_events
for each row execute function private.record_download_event();

commit;
