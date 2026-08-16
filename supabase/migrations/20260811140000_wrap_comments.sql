create table public.wrap_comments (
  id uuid primary key default gen_random_uuid(),
  wrap_id uuid not null references public.wraps (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key uuid not null,
  body text not null
    constraint wrap_comment_body_format check (
      body = btrim(body) and char_length(body) between 1 and 1000
    ),
  status text not null default 'PUBLISHED'
    constraint wrap_comment_status check (status in ('PUBLISHED', 'HIDDEN', 'REMOVED')),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  constraint wrap_comments_idempotency_unique unique (author_id, idempotency_key),
  constraint wrap_comments_removed_at check (
    status <> 'REMOVED' or removed_at is not null
  )
);

alter table public.discovery_engagement_events
  add column source_id uuid;
create index discovery_engagement_events_source_idx
  on public.discovery_engagement_events (source_id)
  where source_id is not null;

create index wrap_comments_public_idx
  on public.wrap_comments (wrap_id, created_at desc, id desc)
  where status = 'PUBLISHED';
create index wrap_comments_author_idx
  on public.wrap_comments (author_id, created_at desc);

alter table public.wrap_comments enable row level security;
revoke all on public.wrap_comments from public, anon, authenticated;
grant select on public.wrap_comments to service_role;
grant update (status, removed_at) on public.wrap_comments to service_role;

create function private.guard_comment_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'REMOVED' and new.status is distinct from old.status then
    raise exception using errcode = 'P0001', message = 'comment_removed_terminal';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_comment_status_transition() from public;
create trigger guard_comment_status_transition
before update of status on public.wrap_comments
for each row execute function private.guard_comment_status_transition();

create table private.comment_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  operation_count integer not null default 0 check (operation_count >= 0)
);
revoke all on private.comment_rate_limits from public;

create or replace function private.comment_target_eligible(p_wrap_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.wraps w
    join public.profiles creator
      on creator.user_id = w.creator_id
     and creator.participation_state = 'ACTIVE'
     and creator.onboarding_completed_at is not null
    join public.vehicle_models vm
      on vm.id = w.vehicle_model_id and vm.active
    join public.template_variants tv
      on tv.id = w.template_variant_id
     and tv.vehicle_model_id = w.vehicle_model_id
    join public.asset_revisions ar
      on ar.id = w.asset_revision_id
     and ar.template_verified
     and ar.template_variant_id = w.template_variant_id
     and ar.width_px = tv.width_px
     and ar.height_px = tv.height_px
    join public.wrap_assets preview
      on preview.asset_revision_id = ar.id
     and preview.kind = 'PREVIEW'
     and preview.bucket_id = 'wrap-derived'
     and preview.width_px > 0
     and preview.height_px > 0
    join storage.objects preview_object
      on preview_object.bucket_id = preview.bucket_id
     and preview_object.name = preview.object_key
    where w.id = p_wrap_id
      and w.status = 'PUBLISHED'
      and w.deleted_at is null
  );
$$;

revoke all on function private.comment_target_eligible(uuid) from public;

create or replace function private.consume_comment_slot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 29));
  select window_started_at, operation_count
  into v_started_at, v_count
  from private.comment_rate_limits
  where user_id = p_user_id
  for update;

  if not found or v_started_at <= clock_timestamp() - interval '1 hour' then
    insert into private.comment_rate_limits (user_id, window_started_at, operation_count)
    values (p_user_id, clock_timestamp(), 1)
    on conflict (user_id) do update
      set window_started_at = excluded.window_started_at,
          operation_count = excluded.operation_count;
    return;
  end if;

  if v_count >= 10 then
    raise exception using errcode = 'P0001', message = 'comment_rate_limited';
  end if;

  update private.comment_rate_limits
  set operation_count = operation_count + 1
  where user_id = p_user_id;
end;
$$;

revoke all on function private.consume_comment_slot(uuid) from public;

create or replace function private.reconcile_wrap_comment_count(p_wrap_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wraps
  set comment_count = case when private.comment_target_eligible(p_wrap_id) then (
        select count(*)
        from public.wrap_comments c
        join public.profiles author on author.user_id = c.author_id
        where c.wrap_id = p_wrap_id
          and c.status = 'PUBLISHED'
          and author.participation_state = 'ACTIVE'
          and author.onboarding_completed_at is not null
      ) else 0 end
  where id = p_wrap_id;
end;
$$;

revoke all on function private.reconcile_wrap_comment_count(uuid) from public;

create or replace function private.sync_comment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.discovery_engagement_events
  set active = (new.status = 'PUBLISHED')
  where source_id = new.id
    and active is distinct from (new.status = 'PUBLISHED');
  perform private.reconcile_wrap_comment_count(new.wrap_id);
  return new;
end;
$$;

revoke all on function private.sync_comment_event() from public;
create trigger sync_comment_event
after insert or update of status on public.wrap_comments
for each row execute function private.sync_comment_event();

create function private.reconcile_comment_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_wrap_comment_count(old.wrap_id);
  return old;
end;
$$;

revoke all on function private.reconcile_comment_after_delete() from public;
create trigger reconcile_comment_delete
after delete on public.wrap_comments
for each row execute function private.reconcile_comment_after_delete();

create or replace function private.reconcile_comments_after_wrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_wrap_comment_count(new.id);
  return new;
end;
$$;

revoke all on function private.reconcile_comments_after_wrap() from public;
create trigger reconcile_comments_wrap
after update of status, deleted_at, asset_revision_id, template_variant_id, vehicle_model_id
on public.wraps
for each row execute function private.reconcile_comments_after_wrap();

create function private.reconcile_comments_after_model()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap_id uuid;
begin
  for v_wrap_id in
    select id from public.wraps where vehicle_model_id = new.id
  loop
    perform private.reconcile_wrap_comment_count(v_wrap_id);
  end loop;
  return new;
end;
$$;

revoke all on function private.reconcile_comments_after_model() from public;
create trigger reconcile_comments_model
after update of active on public.vehicle_models
for each row
when (old.active is distinct from new.active)
execute function private.reconcile_comments_after_model();

create function public.add_wrap_comment(
  p_slug text,
  p_body text,
  p_idempotency_key uuid
)
returns table (
  id uuid,
  slug text,
  body text,
  author_username text,
  author_display_name text,
  created_at timestamptz,
  comment_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_creator_id uuid;
  v_wrap_id uuid;
  v_comment_id uuid;
  v_existing public.wrap_comments;
begin
  if v_actor_id is null then
    raise exception using errcode = 'P0001', message = 'comment_auth_required';
  end if;
  if p_idempotency_key is null or p_body is null or btrim(p_body) = ''
    or char_length(btrim(p_body)) > 1000
    or p_body <> btrim(p_body)
  then
    raise exception using errcode = '22023', message = 'invalid_comment_request';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_actor_id::text || ':' || p_idempotency_key::text,
      37
    )
  );

  select w.creator_id into v_creator_id
  from public.wraps w
  where w.slug = lower(btrim(p_slug));
  perform 1
  from public.profiles
  where user_id in (v_actor_id, v_creator_id)
  order by user_id
  for update;
  if not exists (
    select 1 from public.profiles
    where user_id = v_actor_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'comment_actor_unavailable';
  end if;

  select * into v_existing
  from public.wrap_comments
  where author_id = v_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.body <> p_body or v_existing.wrap_id is distinct from (
      select w.id from public.wraps w where w.slug = lower(btrim(p_slug))
    ) then
      raise exception using errcode = 'P0001', message = 'comment_idempotency_mismatch';
    end if;
    if v_existing.status <> 'PUBLISHED' then
      raise exception using errcode = 'P0001', message = 'comment_wrap_unavailable';
    end if;
    select w.id into v_wrap_id
    from public.wraps w
    join public.profiles creator
      on creator.user_id = w.creator_id
     and creator.participation_state = 'ACTIVE'
     and creator.onboarding_completed_at is not null
    join public.vehicle_models vm
      on vm.id = w.vehicle_model_id and vm.active
    join public.template_variants tv
      on tv.id = w.template_variant_id
     and tv.vehicle_model_id = w.vehicle_model_id
    join public.asset_revisions ar
      on ar.id = w.asset_revision_id
     and ar.template_verified
     and ar.template_variant_id = w.template_variant_id
     and ar.width_px = tv.width_px
     and ar.height_px = tv.height_px
    join public.wrap_assets preview
      on preview.asset_revision_id = ar.id
     and preview.kind = 'PREVIEW'
     and preview.bucket_id = 'wrap-derived'
     and preview.width_px > 0
     and preview.height_px > 0
    join storage.objects preview_object
      on preview_object.bucket_id = preview.bucket_id
     and preview_object.name = preview.object_key
    where w.id = v_existing.wrap_id
      and w.slug = lower(btrim(p_slug))
      and w.status = 'PUBLISHED'
      and w.deleted_at is null
    for update of w, creator, vm, tv, ar, preview, preview_object;
    if v_wrap_id is null then
      raise exception using errcode = 'P0001', message = 'comment_wrap_unavailable';
    end if;
    perform private.reconcile_wrap_comment_count(v_existing.wrap_id);
    return query
    select c.id, w.slug, c.body, author.username, author.display_name,
      c.created_at, w.comment_count
    from public.wrap_comments c
    join public.wraps w on w.id = c.wrap_id
    join public.profiles author on author.user_id = c.author_id
    where c.id = v_existing.id;
    return;
  end if;

  select w.id into v_wrap_id
  from public.wraps w
  join public.profiles creator
    on creator.user_id = w.creator_id
   and creator.participation_state = 'ACTIVE'
   and creator.onboarding_completed_at is not null
  join public.vehicle_models vm
    on vm.id = w.vehicle_model_id and vm.active
  join public.template_variants tv
    on tv.id = w.template_variant_id
   and tv.vehicle_model_id = w.vehicle_model_id
  join public.asset_revisions ar
    on ar.id = w.asset_revision_id
   and ar.template_verified
   and ar.template_variant_id = w.template_variant_id
   and ar.width_px = tv.width_px
   and ar.height_px = tv.height_px
  join public.wrap_assets preview
    on preview.asset_revision_id = ar.id
   and preview.kind = 'PREVIEW'
   and preview.bucket_id = 'wrap-derived'
   and preview.width_px > 0
   and preview.height_px > 0
  join storage.objects preview_object
    on preview_object.bucket_id = preview.bucket_id
   and preview_object.name = preview.object_key
  where w.slug = lower(btrim(p_slug))
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
  for update of w, creator, vm, tv, ar, preview, preview_object;
  if v_wrap_id is null then
    raise exception using errcode = 'P0001', message = 'comment_wrap_unavailable';
  end if;

  perform private.consume_comment_slot(v_actor_id);
  insert into public.wrap_comments (wrap_id, author_id, idempotency_key, body)
  values (v_wrap_id, v_actor_id, p_idempotency_key, p_body)
  returning wrap_comments.id into v_comment_id;
  select c.* into v_existing
  from public.wrap_comments c
  where c.id = v_comment_id;

  insert into public.discovery_engagement_events (
    wrap_id, actor_id, kind, active, source_id
  ) values (
    v_wrap_id, v_actor_id, 'COMMENT', true, v_comment_id
  );
  perform private.reconcile_wrap_comment_count(v_wrap_id);

  return query
  select c.id, w.slug, c.body, author.username, author.display_name,
    c.created_at, w.comment_count
  from public.wrap_comments c
  join public.wraps w on w.id = c.wrap_id
  join public.profiles author on author.user_id = c.author_id
  where c.id = v_comment_id;
end;
$$;

revoke all on function public.add_wrap_comment(text, text, uuid) from public, anon;
grant execute on function public.add_wrap_comment(text, text, uuid) to authenticated;

create function public.remove_wrap_comment(p_comment_id uuid)
returns table (id uuid, removed boolean, comment_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_comment public.wrap_comments;
  v_creator_id uuid;
begin
  if v_actor_id is null then
    raise exception using errcode = 'P0001', message = 'comment_auth_required';
  end if;
  select creator_id into v_creator_id
  from public.wraps w
  where w.id = (
    select c.wrap_id from public.wrap_comments c where c.id = p_comment_id
  );
  perform 1
  from public.profiles
  where user_id in (v_actor_id, v_creator_id)
  order by user_id
  for update;
  if not exists (
    select 1 from public.profiles
    where user_id = v_actor_id
      and participation_state = 'ACTIVE'
      and onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'comment_actor_unavailable';
  end if;
  select c.* into v_comment
  from public.wrap_comments c
  where c.id = p_comment_id
  for update;
  if not found or v_comment.status = 'HIDDEN' then
    raise exception using errcode = 'P0001', message = 'comment_unavailable';
  end if;
  if v_comment.author_id <> v_actor_id then
    raise exception using errcode = 'P0001', message = 'comment_not_owner';
  end if;
  if v_comment.status = 'REMOVED' then
    perform private.reconcile_wrap_comment_count(v_comment.wrap_id);
    return query select v_comment.id, true,
      (select w.comment_count from public.wraps w where w.id = v_comment.wrap_id);
    return;
  end if;
  perform 1 from public.wraps w where w.id = v_comment.wrap_id for update;
  if not private.comment_target_eligible(v_comment.wrap_id) then
    raise exception using errcode = 'P0001', message = 'comment_wrap_unavailable';
  end if;
  update public.wrap_comments
  set status = 'REMOVED', removed_at = clock_timestamp()
  where wrap_comments.id = v_comment.id;
  perform private.reconcile_wrap_comment_count(v_comment.wrap_id);
  return query select v_comment.id, true,
    (select w.comment_count from public.wraps w where w.id = v_comment.wrap_id);
end;
$$;

revoke all on function public.remove_wrap_comment(uuid) from public, anon;
grant execute on function public.remove_wrap_comment(uuid) to authenticated;

create function public.get_public_wrap_comments(
  p_slug text,
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  id uuid,
  body text,
  author_username text,
  author_display_name text,
  created_at timestamptz,
  owned_by_viewer boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.body, author.username, author.display_name, c.created_at,
    c.author_id = (select auth.uid())
  from public.wrap_comments c
  join public.wraps w on w.id = c.wrap_id
  join public.profiles author
    on author.user_id = c.author_id
   and author.participation_state = 'ACTIVE'
   and author.onboarding_completed_at is not null
  where w.slug = lower(btrim(p_slug))
    and c.status = 'PUBLISHED'
    and private.comment_target_eligible(w.id)
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_public_wrap_comments(text, integer, integer)
  from public;
grant execute on function public.get_public_wrap_comments(text, integer, integer)
  to anon, authenticated;

-- Keep the cached public count aligned when an eligible Profile changes state.
create or replace function private.reconcile_social_counts_after_profile_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrap_id uuid;
begin
  for v_wrap_id in
    select wrap_id from public.wrap_likes where user_id = new.user_id
    union
    select wrap_id from public.wrap_favorites where user_id = new.user_id
    union
    select wrap_id from public.wrap_comments where author_id = new.user_id
    union
    select id from public.wraps where creator_id = new.user_id
  loop
    perform private.reconcile_wrap_social_counts(v_wrap_id);
    perform private.reconcile_wrap_comment_count(v_wrap_id);
  end loop;
  return new;
end;
$$;

commit;
