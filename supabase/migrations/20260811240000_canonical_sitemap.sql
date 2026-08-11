create or replace function public.get_public_sitemap_entries()
returns table (path text, last_modified timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with static_paths(path) as (
    values ('/'::text), ('/explore'::text), ('/trending'::text)
  )
  select static_paths.path, null::timestamptz
  from static_paths
  union all
  select '/models/' || vm.slug, null::timestamptz
  from public.vehicle_models vm
  where vm.active
  union all
  select '/u/' || p.username, max(coalesce(w.updated_at, p.updated_at))
  from public.profiles p
  left join public.wraps w
    on w.creator_id = p.user_id
   and w.status = 'PUBLISHED'
   and w.deleted_at is null
  where p.username is not null
    and p.onboarding_completed_at is not null
    and p.participation_state = 'ACTIVE'
  group by p.username
  union all
  select '/wrap/' || w.slug, w.updated_at
  from public.wraps w
  join public.profiles p
    on p.user_id = w.creator_id
   and p.onboarding_completed_at is not null
   and p.participation_state = 'ACTIVE'
  join public.vehicle_models vm
    on vm.id = w.vehicle_model_id
   and vm.active
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
  join storage.objects stored
    on stored.bucket_id = preview.bucket_id
   and stored.name = preview.object_key
  where w.status = 'PUBLISHED'
    and w.deleted_at is null;
$$;

revoke all on function public.get_public_sitemap_entries()
  from public, anon, authenticated;
grant execute on function public.get_public_sitemap_entries() to service_role;
