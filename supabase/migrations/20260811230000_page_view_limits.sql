begin;

insert into private.launch_rate_policies (
  policy_key, window_seconds, max_count, retention_seconds
)
values
  ('page_view_session_minute', 60, 30, 86400),
  ('page_view_network_minute', 60, 120, 86400)
on conflict (policy_key) do update
set window_seconds = excluded.window_seconds,
    max_count = excluded.max_count,
    retention_seconds = excluded.retention_seconds;

create function public.consume_page_view_limit(
  p_session_principal text,
  p_network_principal text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_launch_limit(
    'page_view_session_minute', p_session_principal, 'page_view_rate_limited'
  );
  perform private.consume_launch_limit(
    'page_view_network_minute', p_network_principal, 'page_view_rate_limited'
  );
end;
$$;

revoke all on function public.consume_page_view_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_page_view_limit(text, text)
  to service_role;

commit;
