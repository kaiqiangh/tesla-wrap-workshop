begin;

-- One private policy source for application abuse limits. Bucket keys are
-- pseudonymous v1 values; raw network identifiers never reach this schema.
create table private.launch_rate_policies (
  policy_key text primary key,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  max_count integer not null check (max_count > 0),
  retention_seconds integer not null check (retention_seconds between 1 and 86400)
);

revoke all on private.launch_rate_policies from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on private.launch_rate_policies to service_role;

insert into private.launch_rate_policies (policy_key, window_seconds, max_count, retention_seconds)
values
  ('upload_create_user', 3600, 10, 86400),
  ('upload_finalize_user', 3600, 10, 86400),
  ('publish_user', 3600, 10, 86400),
  ('social_user_minute', 60, 60, 86400),
  ('comment_user_minute', 60, 5, 86400),
  ('comment_user_hour', 3600, 30, 86400),
  ('report_user_hour', 3600, 5, 86400),
  ('report_user_day', 86400, 20, 86400),
  ('download_guest_minute', 60, 30, 86400),
  ('download_guest_hour', 3600, 300, 86400),
  ('download_user_minute', 60, 30, 86400),
  ('download_user_hour', 3600, 120, 86400),
  ('search_principal_minute', 60, 60, 86400),
  ('otp_email_minute', 60, 1, 86400),
  ('otp_email_hour', 3600, 5, 86400),
  ('otp_network_hour', 3600, 20, 86400),
  ('otp_failure_email_hour', 3600, 10, 86400),
  ('otp_failure_network_10m', 600, 10, 86400)
on conflict (policy_key) do update
set window_seconds = excluded.window_seconds,
    max_count = excluded.max_count,
    retention_seconds = excluded.retention_seconds;

create table private.launch_rate_buckets (
  policy_key text not null references private.launch_rate_policies(policy_key),
  principal_key text not null check (
    principal_key ~ '^v1:[0-9a-f]{64}$'
    or principal_key ~ '^v1:[a-z0-9_-]+:[a-z0-9_-]{1,180}$'
    or principal_key ~ '^v2:[a-z0-9_-]+:[0-9a-f]{64}$'
  ),
  window_started_at timestamptz not null default clock_timestamp(),
  operation_count integer not null default 0 check (operation_count >= 0),
  primary key (policy_key, principal_key)
);

revoke all on private.launch_rate_buckets from public, anon, authenticated;
grant select, insert, update, delete on private.launch_rate_buckets to service_role;

create function private.consume_launch_limit(
  p_policy_key text,
  p_principal_key text,
  p_error_code text default 'launch_rate_limited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.launch_rate_policies%rowtype;
  v_started_at timestamptz;
  v_count integer;
begin
  if p_principal_key is null
    or (
      p_principal_key !~ '^v1:[0-9a-f]{64}$'
      and p_principal_key !~ '^v1:[a-z0-9_-]+:[a-z0-9_-]{1,180}$'
      and p_principal_key !~ '^v2:[a-z0-9_-]+:[0-9a-f]{64}$'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_launch_principal';
  end if;

  select * into v_policy
  from private.launch_rate_policies
  where policy_key = p_policy_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'launch_policy_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_policy_key || ':' || p_principal_key, 101)
  );
  delete from private.launch_rate_buckets
  where policy_key = p_policy_key
    and window_started_at < clock_timestamp()
      - make_interval(secs => v_policy.retention_seconds);

  select window_started_at, operation_count
  into v_started_at, v_count
  from private.launch_rate_buckets
  where policy_key = p_policy_key and principal_key = p_principal_key
  for update;

  if not found or v_started_at <= clock_timestamp()
      - make_interval(secs => v_policy.window_seconds)
  then
    insert into private.launch_rate_buckets (
      policy_key, principal_key, window_started_at, operation_count
    ) values (p_policy_key, p_principal_key, clock_timestamp(), 1)
    on conflict (policy_key, principal_key) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;

  if v_count >= v_policy.max_count then
    raise exception using errcode = 'P0001', message = coalesce(
      nullif(p_error_code, ''), 'launch_rate_limited'
    );
  end if;

  update private.launch_rate_buckets
  set operation_count = operation_count + 1
  where policy_key = p_policy_key and principal_key = p_principal_key;
end;
$$;
revoke all on function private.consume_launch_limit(text, text, text) from public;

create function private.consume_auth_launch_limit(
  p_policy_key text,
  p_error_code text default 'launch_rate_limited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_principal text := case
    when v_user_id is null then 'v1:guest:global'
    else 'v1:user:' || v_user_id::text
  end;
begin
  perform private.consume_launch_limit(p_policy_key, v_principal, p_error_code);
end;
$$;
revoke all on function private.consume_auth_launch_limit(text, text) from public;

create function public.consume_otp_limit(
  p_email_principal text,
  p_network_principal text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_launch_limit(
    'otp_email_minute', p_email_principal, 'otp_email_minute_rate_limited'
  );
  perform private.consume_launch_limit(
    'otp_email_hour', p_email_principal, 'otp_email_hour_rate_limited'
  );
  perform private.consume_launch_limit(
    'otp_network_hour', p_network_principal, 'otp_network_rate_limited'
  );
end;
$$;
revoke all on function public.consume_otp_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_otp_limit(text, text) to service_role;

create function public.consume_otp_failure_limit(
  p_email_principal text,
  p_network_principal text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_launch_limit(
    'otp_failure_email_hour', p_email_principal, 'otp_failure_email_rate_limited'
  );
  perform private.consume_launch_limit(
    'otp_failure_network_10m', p_network_principal, 'otp_failure_network_rate_limited'
  );
end;
$$;
revoke all on function public.consume_otp_failure_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_otp_failure_limit(text, text)
  to service_role;

create function public.consume_user_launch_limit(
  p_policy_key text,
  p_user_id uuid,
  p_error_code text default 'launch_rate_limited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_launch_principal';
  end if;
  perform private.consume_launch_limit(
    p_policy_key, 'v1:user:' || p_user_id::text, p_error_code
  );
end;
$$;
revoke all on function public.consume_user_launch_limit(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_user_launch_limit(text, uuid, text)
  to service_role;

create or replace function private.consume_social_toggle_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'social_auth_required';
  end if;
  perform private.consume_launch_limit(
    'social_user_minute', 'v1:user:' || p_user_id::text, 'social_rate_limited'
  );
end;
$$;
revoke all on function private.consume_social_toggle_slot(uuid) from public;

create or replace function private.consume_comment_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_launch_limit(
    'comment_user_minute', 'v1:user:' || p_user_id::text, 'comment_minute_rate_limited'
  );
  perform private.consume_launch_limit(
    'comment_user_hour', 'v1:user:' || p_user_id::text, 'comment_hour_rate_limited'
  );
end;
$$;
revoke all on function private.consume_comment_slot(uuid) from public;

create or replace function private.consume_report_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_launch_limit(
    'report_user_hour', 'v1:user:' || p_user_id::text, 'report_hour_rate_limited'
  );
  perform private.consume_launch_limit(
    'report_user_day', 'v1:user:' || p_user_id::text, 'report_day_rate_limited'
  );
end;
$$;
revoke all on function private.consume_report_slot(uuid) from public;

create function private.enforce_pending_upload_launch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window_seconds integer;
  v_count integer;
begin
  if current_setting('request.jwt.claims', true) is null
    or current_setting('request.jwt.claims', true) = ''
  then
    return new;
  end if;
  select max_count, window_seconds into v_max, v_window_seconds
  from private.launch_rate_policies
  where policy_key = case when tg_op = 'INSERT'
    then 'upload_create_user' else 'upload_finalize_user' end;
  if v_max is null or v_window_seconds is null then
    raise exception using errcode = 'P0001', message = 'launch_policy_missing';
  end if;
  if tg_op = 'UPDATE'
    and old.state is distinct from new.state
    and new.state = 'VALIDATING'
  then
    select count(*) into v_count
    from public.pending_uploads
    where owner_id = new.owner_id
      and id <> new.id
      and finalize_started_at >= clock_timestamp() - make_interval(secs => v_window_seconds);
  else
    return new;
  end if;
  if v_count >= v_max then
    raise exception using errcode = 'P0001', message = 'upload_rate_limited';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_pending_upload_launch_limit() from public;
create trigger enforce_pending_upload_launch_limit
before insert or update of state on public.pending_uploads
for each row execute function private.enforce_pending_upload_launch_limit();

create or replace function public.start_pending_upload(
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
  v_max integer;
  v_window_seconds integer;
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

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));

  select max_count, window_seconds into v_max, v_window_seconds
  from private.launch_rate_policies
  where policy_key = 'upload_create_user';
  if v_max is null or v_window_seconds is null then
    raise exception using errcode = 'P0001', message = 'launch_policy_missing';
  end if;
  if (
    select count(*) from public.pending_uploads
    where owner_id = v_owner
      and created_at >= clock_timestamp() - make_interval(secs => v_window_seconds)
  ) >= v_max then
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

create or replace function public.claim_pending_upload(p_id uuid, p_owner uuid)
returns table (claimed boolean, state text, asset_revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.pending_uploads%rowtype;
  v_max integer;
  v_window_seconds integer;
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
    update public.pending_uploads set updated_at = clock_timestamp()
    where id = p_id;
    return query select true, 'VALIDATING'::text, null::uuid;
    return;
  end if;
  if v_upload.finalize_started_at is null then
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 1));
    select max_count, window_seconds into v_max, v_window_seconds
    from private.launch_rate_policies
    where policy_key = 'upload_finalize_user';
    if v_max is null or v_window_seconds is null then
      raise exception using errcode = 'P0001', message = 'launch_policy_missing';
    end if;
    if (
      select count(*) from public.pending_uploads
      where owner_id = p_owner
        and finalize_started_at >= clock_timestamp()
          - make_interval(secs => v_window_seconds)
    ) >= v_max then
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

alter function public.publish_wrap(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) rename to publish_wrap_base;
revoke all on function public.publish_wrap_base(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) from public, anon, authenticated, service_role;
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
  v_row record;
begin
  select * into v_row from public.publish_wrap_base(
    p_creator_id, p_asset_revision_id, p_template_variant_id, p_title,
    p_description, p_license_type, p_tags, p_template_asserted,
    p_distribution_asserted
  );
  if v_row.created then
    perform private.consume_launch_limit(
      'publish_user', 'v1:user:' || p_creator_id::text, 'publish_rate_limited'
    );
  end if;
  return query select v_row.id, v_row.slug, v_row.status,
    v_row.first_published_at, v_row.asset_revision_id,
    v_row.template_variant_id, v_row.created;
end;
$$;
revoke all on function public.publish_wrap(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) from public, anon, authenticated;
grant execute on function public.publish_wrap(
  uuid, uuid, uuid, text, text, text, text[], boolean, boolean
) to service_role;

alter function public.unpublish_wrap(uuid, text) rename to unpublish_wrap_base;
revoke all on function public.unpublish_wrap_base(uuid, text)
  from public, anon, authenticated, service_role;
create function public.unpublish_wrap(p_creator_id uuid, p_slug text)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_row record;
begin
  select w.status into v_before from public.wraps w
  where w.creator_id = p_creator_id and w.slug = lower(p_slug) for update;
  select * into v_row from public.unpublish_wrap_base(p_creator_id, p_slug);
  if v_before = 'PUBLISHED' and v_row.status = 'UNPUBLISHED' then
    perform private.consume_launch_limit(
      'publish_user', 'v1:user:' || p_creator_id::text, 'publish_rate_limited'
    );
  end if;
  return query select v_row.id, v_row.slug, v_row.status, v_row.first_published_at;
end;
$$;
revoke all on function public.unpublish_wrap(uuid, text)
  from public, anon, authenticated;
grant execute on function public.unpublish_wrap(uuid, text) to service_role;

alter function public.republish_wrap(uuid, text) rename to republish_wrap_base;
revoke all on function public.republish_wrap_base(uuid, text)
  from public, anon, authenticated, service_role;
create function public.republish_wrap(p_creator_id uuid, p_slug text)
returns table (id uuid, slug text, status text, first_published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_row record;
begin
  select w.status into v_before from public.wraps w
  where w.creator_id = p_creator_id and w.slug = lower(p_slug) for update;
  select * into v_row from public.republish_wrap_base(p_creator_id, p_slug);
  if v_before = 'UNPUBLISHED' and v_row.status = 'PUBLISHED' then
    perform private.consume_launch_limit(
      'publish_user', 'v1:user:' || p_creator_id::text, 'publish_rate_limited'
    );
  end if;
  return query select v_row.id, v_row.slug, v_row.status, v_row.first_published_at;
end;
$$;
revoke all on function public.republish_wrap(uuid, text)
  from public, anon, authenticated;
grant execute on function public.republish_wrap(uuid, text) to service_role;

create function private.enforce_publish_launch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('request.jwt.claims', true) is null
    or current_setting('request.jwt.claims', true) = ''
  then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.status = 'PUBLISHED')
    or (tg_op = 'UPDATE' and old.status is distinct from new.status
      and (new.status = 'PUBLISHED'
        or (old.status = 'PUBLISHED' and new.status = 'UNPUBLISHED')))
  then
    perform private.consume_launch_limit(
      'publish_user', 'v1:user:' || new.creator_id::text, 'publish_rate_limited'
    );
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_publish_launch_limit() from public;
create trigger enforce_publish_launch_limit
before insert or update of status on public.wraps
for each row execute function private.enforce_publish_launch_limit();

drop trigger enforce_publish_launch_limit on public.wraps;

create function private.enforce_download_launch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.principal_kind = 'GUEST' then
    perform private.consume_launch_limit(
      'download_guest_minute', new.principal_hash, 'download_minute_rate_limited'
    );
    perform private.consume_launch_limit(
      'download_guest_hour', new.principal_hash, 'download_hour_rate_limited'
    );
  else
    perform private.consume_launch_limit(
      'download_user_minute', new.principal_hash, 'download_minute_rate_limited'
    );
    perform private.consume_launch_limit(
      'download_user_hour', new.principal_hash, 'download_hour_rate_limited'
    );
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_download_launch_limit() from public;
create trigger enforce_download_launch_limit
before insert on public.download_events
for each row execute function private.enforce_download_launch_limit();

-- The public search wrapper is the single application-facing read boundary.
create or replace function public.search_discovery_wraps(
  p_q text default null,
  p_model_slug text default null,
  p_variant_key text default null,
  p_sort text default 'NEWEST',
  p_cursor text default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb;
begin
  v_result := public.search_discovery_wraps_base(
    p_q, p_model_slug, p_variant_key, p_sort, p_cursor, p_limit
  );
  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'liked', exists (
          select 1 from public.wrap_likes l
          where l.wrap_id = nullif(item->>'id', '')::uuid
            and l.user_id = (select auth.uid())
        ),
        'favorited', exists (
          select 1 from public.wrap_favorites f
          where f.wrap_id = nullif(item->>'id', '')::uuid
            and f.user_id = (select auth.uid())
        )
      ) order by ordinality
    ), '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as page(item, ordinality);
  return v_result || jsonb_build_object('items', v_items);
end;
$$;
revoke all on function public.search_discovery_wraps(text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_discovery_wraps(text, text, text, text, text, integer)
  to service_role;

create function public.search_discovery_wraps_for_principal(
  p_q text default null,
  p_model_slug text default null,
  p_variant_key text default null,
  p_sort text default 'NEWEST',
  p_cursor text default null,
  p_limit integer default 24,
  p_principal_key text default null,
  p_viewer_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb;
begin
  perform private.consume_launch_limit(
    'search_principal_minute', p_principal_key, 'search_rate_limited'
  );
  v_result := public.search_discovery_wraps_base(
    p_q, p_model_slug, p_variant_key, p_sort, p_cursor, p_limit
  );
  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'liked', exists (
          select 1 from public.wrap_likes l
          where l.wrap_id = nullif(item->>'id', '')::uuid
            and l.user_id = coalesce(p_viewer_id, (select auth.uid()))
        ),
        'favorited', exists (
          select 1 from public.wrap_favorites f
          where f.wrap_id = nullif(item->>'id', '')::uuid
            and f.user_id = coalesce(p_viewer_id, (select auth.uid()))
        )
      ) order by ordinality
    ), '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as page(item, ordinality);
  return v_result || jsonb_build_object('items', v_items);
end;
$$;
revoke all on function public.search_discovery_wraps_for_principal(
  text, text, text, text, text, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.search_discovery_wraps_for_principal(
  text, text, text, text, text, integer, text, uuid
) to service_role;

commit;
