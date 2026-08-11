begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private', 'launch_rate_policies', 'launch limits have one private policy source');
select has_table('private', 'launch_rate_buckets', 'launch limit buckets are private');
select is(
  (select count(*) from private.launch_rate_policies),
  18::bigint,
  'all launch policies are seeded'
);
select ok(
  not has_function_privilege(
    'anon', 'public.consume_otp_limit(text,text)', 'execute'
  ),
  'Guests cannot call the server-only OTP limiter'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.search_discovery_wraps(text,text,text,text,text,integer)',
    'execute'
  ),
  'Guests cannot bypass the server-bound Search limiter'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.search_discovery_wraps_for_principal(text,text,text,text,text,integer,text,uuid)',
    'execute'
  ),
  'the server can call the principal-bound Search wrapper'
);

set local role service_role;
select public.consume_user_launch_limit(
  'search_principal_minute',
  '99000000-0000-0000-0000-000000000001'
);
insert into private.launch_rate_buckets (
  policy_key, principal_key, window_started_at, operation_count
) values (
  'search_principal_minute',
  'v1:user:99000000-0000-0000-0000-000000000001',
  clock_timestamp(), 59
)
on conflict (policy_key, principal_key) do update
set window_started_at = excluded.window_started_at,
    operation_count = excluded.operation_count;
select lives_ok(
  $$ select public.consume_user_launch_limit(
       'search_principal_minute',
       '99000000-0000-0000-0000-000000000001'
     ) $$,
  'the Nth operation succeeds at the configured boundary'
);
select is(
  (select operation_count from private.launch_rate_buckets
   where policy_key = 'search_principal_minute'
     and principal_key = 'v1:user:99000000-0000-0000-0000-000000000001'),
  60,
  'the boundary operation is recorded exactly once'
);
select throws_ok(
  $$ select public.consume_user_launch_limit(
       'search_principal_minute',
       '99000000-0000-0000-0000-000000000001'
     ) $$,
  'P0001', 'launch_rate_limited',
  'the N+1 operation is denied with a stable code'
);
update private.launch_rate_buckets
set window_started_at = clock_timestamp() - interval '61 seconds'
where policy_key = 'search_principal_minute'
  and principal_key = 'v1:user:99000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.consume_user_launch_limit(
       'search_principal_minute',
       '99000000-0000-0000-0000-000000000001'
     ) $$,
  'an expired window recovers without manual deletion'
);
reset role;

select * from finish();
rollback;
