-- Keep the existing allowlisted projections as the source of card fields, then
-- add only the current viewer's relationship booleans at the public boundary.
alter function public.get_discovery_wraps(text, text, integer)
  rename to get_discovery_wraps_base;

create function public.get_discovery_wraps(
  p_kind text,
  p_model_slug text default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  creator_username text,
  creator_display_name text,
  vehicle_model_slug text,
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
  availability_caveat text,
  liked boolean,
  favorited boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select base.*,
    exists (
      select 1 from public.wrap_likes l
      where l.wrap_id = base.id and l.user_id = (select auth.uid())
    ),
    exists (
      select 1 from public.wrap_favorites f
      where f.wrap_id = base.id and f.user_id = (select auth.uid())
    )
  from public.get_discovery_wraps_base(p_kind, p_model_slug, p_limit) base;
$$;

revoke all on function public.get_discovery_wraps_base(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_discovery_wraps(text, text, integer)
  to anon, authenticated;

alter function public.search_discovery_wraps(text, text, text, text, text, integer)
  rename to search_discovery_wraps_base;

create function public.search_discovery_wraps(
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
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as page(item, ordinality);

  return v_result || jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.search_discovery_wraps_base(
  text, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.search_discovery_wraps(
  text, text, text, text, text, integer
) to anon, authenticated;

alter function public.get_public_wrap(text) rename to get_public_wrap_base;

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
  availability_caveat text,
  liked boolean,
  favorited boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select base.*,
    exists (
      select 1 from public.wrap_likes l
      where l.wrap_id = base.id and l.user_id = (select auth.uid())
    ),
    exists (
      select 1 from public.wrap_favorites f
      where f.wrap_id = base.id and f.user_id = (select auth.uid())
    )
  from public.get_public_wrap_base(p_slug) base;
$$;

revoke all on function public.get_public_wrap_base(text)
  from public, anon, authenticated;
grant execute on function public.get_public_wrap(text) to anon, authenticated;

create function public.get_my_favorites(
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  creator_username text,
  creator_display_name text,
  vehicle_model_slug text,
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
  availability_caveat text,
  liked boolean,
  favorited boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 25);
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles owner
    where owner.user_id = v_user_id
      and owner.participation_state = 'ACTIVE'
      and owner.onboarding_completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'favorites_not_allowed';
  end if;

  return query
  select w.id, w.slug, w.title, w.description,
    creator.username, creator.display_name, vm.slug, vm.display_name,
    tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
    tv.verified_at, not tv.active, w.license_type,
    coalesce(array_agg(t.display_name order by t.slug)
      filter (where t.id is not null), '{}'::text[]),
    w.first_published_at,
    coalesce((select count(*) from public.download_events de
      left join public.profiles downloader on downloader.user_id = de.user_id
      where de.wrap_id = w.id and de.counted and (de.user_id is null or (
        downloader.participation_state = 'ACTIVE'
        and downloader.onboarding_completed_at is not null))), 0)::bigint,
    w.like_count, w.favorite_count, w.comment_count,
    preview.width_px, preview.height_px, true,
    'Vehicle, configuration, account, software, and region can affect Paint Shop availability.',
    exists (select 1 from public.wrap_likes l
      where l.wrap_id = w.id and l.user_id = v_user_id), true
  from public.wrap_favorites favorite
  join public.wraps w on w.id = favorite.wrap_id
  join public.profiles creator on creator.user_id = w.creator_id
  join public.vehicle_models vm on vm.id = w.vehicle_model_id and vm.active
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
  where favorite.user_id = v_user_id
    and w.status = 'PUBLISHED'
    and w.deleted_at is null
    and creator.participation_state = 'ACTIVE'
    and creator.onboarding_completed_at is not null
  group by w.id, creator.username, creator.display_name, vm.slug,
    vm.display_name, tv.display_name, tv.catalog_key, ar.width_px,
    ar.height_px, tv.verified_at, tv.active, preview.width_px,
    preview.height_px, favorite.created_at
  order by favorite.created_at desc, w.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.get_my_favorites(integer, integer)
  from public, anon;
grant execute on function public.get_my_favorites(integer, integer)
  to authenticated;

commit;
