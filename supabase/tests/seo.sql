begin;
select plan(4);

select has_function(
  'public',
  'get_public_sitemap_entries',
  'canonical sitemap RPC exists'
);

select is(
  (select count(*) from public.get_public_sitemap_entries()
   where path in ('/', '/explore', '/trending')),
  3::bigint,
  'canonical sitemap always contains the public discovery roots'
);

select is(
  has_function_privilege(
    'anon',
    'public.get_public_sitemap_entries()',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot execute the sitemap RPC'
);

select is(
  has_function_privilege(
    'service_role',
    'public.get_public_sitemap_entries()',
    'EXECUTE'
  ),
  true,
  'the server boundary can execute the sitemap RPC'
);

select * from finish();
rollback;
