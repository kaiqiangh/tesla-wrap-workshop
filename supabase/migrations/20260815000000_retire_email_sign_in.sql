begin;

-- Email Sign-in is retired. Keep this as an additive migration so already
-- applied launch-limit migrations remain immutable.
revoke all on function public.consume_otp_limit(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_otp_failure_limit(text, text)
  from public, anon, authenticated, service_role;

drop function if exists public.consume_otp_limit(text, text);
drop function if exists public.consume_otp_failure_limit(text, text);

delete from private.launch_rate_buckets
where policy_key in (
  'otp_email_minute',
  'otp_email_hour',
  'otp_network_hour',
  'otp_failure_email_hour',
  'otp_failure_network_10m'
);

delete from private.launch_rate_policies
where policy_key in (
  'otp_email_minute',
  'otp_email_hour',
  'otp_network_hour',
  'otp_failure_email_hour',
  'otp_failure_network_10m'
);

commit;
