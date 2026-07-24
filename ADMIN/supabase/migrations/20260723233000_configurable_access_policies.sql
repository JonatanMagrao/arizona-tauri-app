-- Per-organization access policy. Defaults preserve the behavior that was
-- previously hard-coded in the Edge Functions.

alter table licensing.organizations
  add column if not exists activation_code_ttl_minutes integer not null default 15
    check (activation_code_ttl_minutes between 5 and 60),
  add column if not exists activation_attempt_limit integer not null default 8
    check (activation_attempt_limit between 1 and 100),
  add column if not exists activation_attempt_window_minutes integer not null default 60
    check (activation_attempt_window_minutes between 1 and 1440),
  add column if not exists activation_generation_limit integer not null default 3
    check (activation_generation_limit between 1 and 50),
  add column if not exists activation_generation_window_minutes integer not null default 60
    check (activation_generation_window_minutes between 1 and 1440),
  add column if not exists device_release_limit integer not null default 10
    check (device_release_limit between 1 and 100),
  add column if not exists device_release_window_minutes integer not null default 60
    check (device_release_window_minutes between 1 and 1440),
  add column if not exists device_switch_cooldown_minutes integer not null default 0
    check (device_switch_cooldown_minutes between 0 and 10080),
  add column if not exists device_recovery_window_minutes integer not null default 15
    check (device_recovery_window_minutes between 5 and 60);

create or replace function licensing.consume_rate_limit_v2(
  target_action text,
  target_subject_hash text,
  maximum_events integer,
  window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  recent_count integer;
  oldest_event_at timestamptz;
  remaining_seconds integer;
begin
  if length(target_action) not between 2 and 64
    or length(target_subject_hash) <> 64
    or maximum_events not between 1 and 1000
    or window_seconds not between 1 and 2592000
  then
    raise exception 'invalid_rate_limit_arguments';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_action || ':' || target_subject_hash, 0));

  select count(*)::integer, min(created_at)
    into recent_count, oldest_event_at
  from licensing.rate_limit_events
  where action = target_action
    and subject_hash = target_subject_hash
    and created_at >= now() - make_interval(secs => window_seconds);

  if recent_count >= maximum_events then
    remaining_seconds := greatest(
      1,
      ceil(extract(epoch from (
        oldest_event_at + make_interval(secs => window_seconds) - now()
      )))::integer
    );
    return query select false, remaining_seconds;
    return;
  end if;

  insert into licensing.rate_limit_events (action, subject_hash)
  values (target_action, target_subject_hash);

  return query select true, 0;
end;
$$;

revoke all on function licensing.consume_rate_limit_v2(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function licensing.consume_rate_limit_v2(text, text, integer, integer)
  to service_role;
