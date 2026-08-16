create function public.get_public_vehicle_model(p_slug text)
returns table (slug text, display_name text, sort_order smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select vm.slug, vm.display_name, vm.sort_order
  from public.vehicle_models vm
  where vm.slug = lower(btrim(p_slug))
    and vm.active;
$$;

revoke all on function public.get_public_vehicle_model(text)
  from public, anon, authenticated;
grant execute on function public.get_public_vehicle_model(text)
  to anon, authenticated;

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
  availability_caveat text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if p_kind not in ('TRENDING', 'NEWEST', 'MODEL') then
    raise exception using errcode = '22023', message = 'invalid_discovery_kind';
  end if;
  if p_kind = 'MODEL' and (p_model_slug is null or btrim(p_model_slug) = '') then
    raise exception using errcode = '22023', message = 'invalid_discovery_model';
  end if;

  return query
  with eligible as (
    select
      w.id,
      w.slug,
      w.title,
      w.description,
      p.username as creator_username,
      p.display_name as creator_display_name,
      vm.slug as vehicle_model_slug,
      vm.display_name as vehicle_model_name,
      tv.display_name as template_variant_name,
      tv.catalog_key as template_variant_key,
      ar.width_px,
      ar.height_px,
      tv.verified_at,
      not tv.active as legacy,
      w.license_type,
      coalesce(
        array_agg(t.display_name order by t.slug)
          filter (where t.id is not null),
        '{}'::text[]
      ) as tags,
      w.first_published_at,
      w.download_count,
      w.like_count,
      w.favorite_count,
      w.comment_count,
      preview.width_px as preview_width_px,
      preview.height_px as preview_height_px,
      true as preview_available,
      'Vehicle, configuration, account, software, and region can affect Paint Shop availability.'::text
        as availability_caveat,
      (
        (w.download_count * 3 + w.like_count * 2
          + w.favorite_count * 2 + w.comment_count)::numeric
        / power(
          2 + least(
            greatest(extract(epoch from (now() - w.first_published_at)) / 86400, 0),
            30
          ),
          1.5
        )
      ) as trending_score
    from public.wraps w
    join public.profiles p on p.user_id = w.creator_id
    join public.vehicle_models vm on vm.id = w.vehicle_model_id
    join public.template_variants tv on tv.id = w.template_variant_id
    join public.asset_revisions ar on ar.id = w.asset_revision_id
    join public.wrap_assets preview
      on preview.asset_revision_id = w.asset_revision_id
      and preview.kind = 'PREVIEW'
      and preview.bucket_id = 'wrap-derived'
    left join public.wrap_tags wt on wt.wrap_id = w.id
    left join public.tags t on t.id = wt.tag_id
    where w.status = 'PUBLISHED'
      and w.deleted_at is null
      and p.participation_state = 'ACTIVE'
      and p.onboarding_completed_at is not null
      and ar.template_verified
      and ar.template_variant_id = w.template_variant_id
      and ar.width_px = tv.width_px
      and ar.height_px = tv.height_px
      and preview.width_px > 0
      and preview.height_px > 0
      and exists (
        select 1
        from storage.objects preview_object
        where preview_object.bucket_id = preview.bucket_id
          and preview_object.name = preview.object_key
      )
      and (
        p_kind <> 'MODEL'
        or vm.slug = lower(btrim(p_model_slug))
      )
    group by w.id, p.username, p.display_name, vm.slug, vm.display_name,
      tv.display_name, tv.catalog_key, ar.width_px, ar.height_px,
      tv.verified_at, tv.active, preview.width_px, preview.height_px
  )
  select eligible.id, eligible.slug, eligible.title, eligible.description,
    eligible.creator_username, eligible.creator_display_name,
    eligible.vehicle_model_slug, eligible.vehicle_model_name,
    eligible.template_variant_name, eligible.template_variant_key,
    eligible.width_px, eligible.height_px, eligible.verified_at,
    eligible.legacy, eligible.license_type, eligible.tags,
    eligible.first_published_at, eligible.download_count,
    eligible.like_count, eligible.favorite_count, eligible.comment_count,
    eligible.preview_width_px, eligible.preview_height_px,
    eligible.preview_available, eligible.availability_caveat
  from eligible
  order by
    case when p_kind = 'TRENDING' then eligible.trending_score end desc nulls last,
    case when p_kind <> 'TRENDING' then eligible.first_published_at end desc nulls last,
    eligible.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_discovery_wraps(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_discovery_wraps(text, text, integer)
  to anon, authenticated;
