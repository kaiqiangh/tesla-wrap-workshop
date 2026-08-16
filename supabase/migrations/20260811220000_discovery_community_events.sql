begin;

alter table public.core_loop_events
  drop constraint if exists core_loop_events_event_kind_check;
alter table public.core_loop_events
  add constraint core_loop_events_event_kind_check check (event_kind in (
    'AUTH_SIGNUP', 'PROFILE_ONBOARDED', 'UPLOAD_STARTED',
    'UPLOAD_VALIDATION_PASSED', 'UPLOAD_VALIDATION_FAILED',
    'WRAP_PUBLISHED', 'WRAP_UNPUBLISHED', 'WRAP_VIEW', 'DOWNLOAD_GRANTED',
    'PAGE_VIEW', 'SEARCH', 'FILTER_APPLIED', 'WRAP_LIKE', 'WRAP_FAVORITE',
    'WRAP_UNLIKE', 'WRAP_UNFAVORITE', 'CREATOR_FOLLOW', 'CREATOR_UNFOLLOW',
    'COMMENT_CREATED', 'COMMENT_DELETED', 'REPORT_CREATED', 'REPORT_OUTCOME',
    'MODERATION_ACTION'
  ));

alter table public.core_loop_events
  drop constraint if exists core_loop_events_target_type_check;
alter table public.core_loop_events
  add constraint core_loop_events_target_type_check check (target_type in (
    'USER', 'PROFILE', 'DISCOVERY', 'PENDING_UPLOAD', 'ASSET_REVISION', 'WRAP',
    'COMMENT', 'REPORT', 'MODERATION'
  ));

create function private.record_social_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_core_loop_event(
    case when tg_table_name = 'wrap_likes'
      then case when tg_op = 'INSERT' then 'WRAP_LIKE' else 'WRAP_UNLIKE' end
      else case when tg_op = 'INSERT' then 'WRAP_FAVORITE' else 'WRAP_UNFAVORITE' end
    end,
    coalesce(new.user_id, old.user_id), null, null, 'WRAP',
    coalesce(new.wrap_id, old.wrap_id), 'SUCCESS',
    case when tg_table_name = 'wrap_likes'
      then case when tg_op = 'INSERT' then 'WRAP_LIKE' else 'WRAP_UNLIKE' end
      else case when tg_op = 'INSERT' then 'WRAP_FAVORITE' else 'WRAP_UNFAVORITE' end
    end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.record_social_event() from public;
drop trigger if exists record_wrap_like_event on public.wrap_likes;
create trigger record_wrap_like_event
after insert or delete on public.wrap_likes
for each row execute function private.record_social_event();
drop trigger if exists record_wrap_favorite_event on public.wrap_favorites;
create trigger record_wrap_favorite_event
after insert or delete on public.wrap_favorites
for each row execute function private.record_social_event();

create function private.record_follow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_core_loop_event(
    case when tg_op = 'INSERT' then 'CREATOR_FOLLOW' else 'CREATOR_UNFOLLOW' end,
    coalesce(new.follower_id, old.follower_id), null, null, 'PROFILE',
    coalesce(new.creator_id, old.creator_id), 'SUCCESS',
    case when tg_op = 'INSERT' then 'CREATOR_FOLLOW' else 'CREATOR_UNFOLLOW' end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.record_follow_event() from public;
drop trigger if exists record_creator_follow_event on public.creator_follows;
create trigger record_creator_follow_event
after insert or delete on public.creator_follows
for each row execute function private.record_follow_event();

create function private.record_comment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_core_loop_event(
      'COMMENT_CREATED', new.author_id, null, null, 'COMMENT', new.id,
      'SUCCESS', 'COMMENT_CREATED'
    );
  elsif tg_op = 'DELETE' or (old.status is distinct from new.status and new.status = 'REMOVED') then
    perform private.record_core_loop_event(
      'COMMENT_DELETED', auth.uid(), null, null,
      'COMMENT', coalesce(new.id, old.id), 'SUCCESS', 'COMMENT_DELETED'
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.record_comment_event() from public;
drop trigger if exists record_comment_event on public.wrap_comments;
create trigger record_comment_event
after insert or update of status or delete on public.wrap_comments
for each row execute function private.record_comment_event();

create function private.record_report_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_core_loop_event(
      'REPORT_CREATED', new.reporter_id, null, null, 'REPORT', new.id,
      'SUCCESS', 'REPORT_CREATED'
    );
  elsif old.status is distinct from new.status and new.status in ('RESOLVED', 'DISMISSED') then
    perform private.record_core_loop_event(
      'REPORT_OUTCOME', auth.uid(), null, null, 'REPORT', new.id,
      'SUCCESS', coalesce(new.outcome_category, 'REPORT_OUTCOME')
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_report_event() from public;
drop trigger if exists record_report_event on public.reports;
create trigger record_report_event
after insert or update of status, outcome_category on public.reports
for each row execute function private.record_report_event();

create function private.record_moderation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_type text := case new.target_kind
    when 'WRAP' then 'WRAP'
    when 'COMMENT' then 'COMMENT'
    when 'USER' then 'PROFILE'
    else 'MODERATION'
  end;
begin
  perform private.record_core_loop_event(
    'MODERATION_ACTION', new.actor_id, null, null, v_target_type,
    new.target_id, 'SUCCESS', 'MODERATION_ACTION'
  );
  return new;
end;
$$;

revoke all on function private.record_moderation_event() from public;
drop trigger if exists record_moderation_event on public.moderation_actions;
create trigger record_moderation_event
after insert on public.moderation_actions
for each row execute function private.record_moderation_event();

commit;
