begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private', 'launch_rate_policies', 'launch limits have one private policy source');
select has_table('private', 'launch_rate_buckets', 'launch limit buckets are private');
select is(
  (select count(*) from private.launch_rate_policies),
  16::bigint,
  'all launch policies are seeded'
);
select is(
  (select array_agg(policy_key order by policy_key)
   from private.launch_rate_policies),
  array[
    'comment_user_hour',
    'comment_user_minute',
    'download_guest_hour',
    'download_guest_minute',
    'download_user_hour',
    'download_user_minute',
    'follow_user_minute',
    'page_view_network_minute',
    'page_view_session_minute',
    'publish_user',
    'report_user_day',
    'report_user_hour',
    'search_principal_minute',
    'social_user_minute',
    'upload_create_user',
    'upload_finalize_user'
  ]::text[],
  'the expected launch policy keys are configured'
);
select ok(
  to_regprocedure('public.consume_otp_limit(text,text)') is null
    and to_regprocedure('public.consume_otp_failure_limit(text,text)') is null,
  'Email Sign-in OTP limiters are retired'
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
select ok(
  has_function_privilege(
    'service_role', 'public.cleanup_launch_rate_buckets()', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.cleanup_launch_rate_buckets()', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.cleanup_launch_rate_buckets()', 'execute'
  ),
  'launch bucket cleanup is service-role-only'
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
update private.launch_rate_buckets
set window_started_at = clock_timestamp() - interval '2 days'
where policy_key = 'search_principal_minute'
  and principal_key = 'v1:user:99000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.cleanup_launch_rate_buckets() $$,
  'the scheduled cleanup RPC is available to the service role'
);
select ok(
  not exists (
    select 1 from private.launch_rate_buckets
    where policy_key = 'search_principal_minute'
      and principal_key = 'v1:user:99000000-0000-0000-0000-000000000001'
  ),
  'scheduled launch cleanup removes expired buckets'
);
reset role;

set local role postgres;
create temporary table limit_boundary_results (
  policy_key text,
  nth_ok boolean,
  nth_count_ok boolean,
  n_plus_one_ok boolean,
  n_plus_one_count_ok boolean,
  n_plus_one_window_ok boolean,
  recovery_ok boolean,
  recovery_count_ok boolean
);
do $$
declare
  policy record;
  principal text;
  nth_count integer;
  nth_window timestamptz;
  denied_count integer;
  denied_window timestamptz;
  recovery_count integer;
  nth_ok boolean;
  n_plus_one_ok boolean;
  recovery_ok boolean;
begin
  for policy in
    select policy_key, window_seconds, max_count
    from private.launch_rate_policies
    order by policy_key
  loop
    principal := 'v1:test:' || replace(policy.policy_key, '_', '-');
    delete from private.launch_rate_buckets
    where policy_key = policy.policy_key and principal_key = principal;
    insert into private.launch_rate_buckets (
      policy_key, principal_key, window_started_at, operation_count
    ) values (
      policy.policy_key, principal, clock_timestamp(), policy.max_count - 1
    );

    nth_ok := false;
    begin
      perform private.consume_launch_limit(policy.policy_key, principal);
      nth_ok := true;
    exception when others then
      nth_ok := false;
    end;

    select operation_count into nth_count
    from private.launch_rate_buckets
    where policy_key = policy.policy_key and principal_key = principal;
    select window_started_at into nth_window
    from private.launch_rate_buckets
    where policy_key = policy.policy_key and principal_key = principal;
    n_plus_one_ok := false;

    begin
      perform private.consume_launch_limit(policy.policy_key, principal);
    exception when others then
      n_plus_one_ok := sqlstate = 'P0001' and sqlerrm = 'launch_rate_limited';
    end;
    select operation_count, window_started_at
      into denied_count, denied_window
    from private.launch_rate_buckets
    where policy_key = policy.policy_key and principal_key = principal;

    update private.launch_rate_buckets
    set window_started_at = clock_timestamp()
      - make_interval(secs => policy.window_seconds + 1)
    where policy_key = policy.policy_key and principal_key = principal;
    recovery_ok := false;
    begin
      perform private.consume_launch_limit(policy.policy_key, principal);
      recovery_ok := true;
    exception when others then
      recovery_ok := false;
    end;
    select operation_count into recovery_count
    from private.launch_rate_buckets
    where policy_key = policy.policy_key and principal_key = principal;
    insert into limit_boundary_results values (
      policy.policy_key,
      nth_ok,
      nth_count = policy.max_count,
      n_plus_one_ok,
      denied_count = policy.max_count,
      denied_window = nth_window,
      recovery_ok,
      recovery_count = 1
    );
  end loop;
end;
$$;
select ok(
  nth_ok and nth_count_ok and n_plus_one_ok and n_plus_one_count_ok
    and n_plus_one_window_ok and recovery_ok and recovery_count_ok,
  policy_key || ' passes N/N+1 and fake-clock recovery'
)
from limit_boundary_results
order by policy_key;
reset role;

select * from finish();
rollback;
