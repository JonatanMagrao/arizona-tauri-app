-- Passwordless activation, MFA-backed daily authorization and bounded operational data.
-- No activation code, TOTP secret, access token or refresh token is stored in licensing tables.

alter table licensing.organizations
  add column if not exists receipt_ttl_seconds integer not null default 900
    check (receipt_ttl_seconds between 300 and 3600);

alter table licensing.devices
  add column if not exists last_mfa_login_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;

alter table licensing.members
  add column if not exists device_recovery_mfa_not_before timestamptz,
  add column if not exists device_recovery_expires_at timestamptz;

alter table licensing.license_sessions
  add column if not exists auth_day text,
  add column if not exists last_validated_at timestamptz not null default now();

-- Bind only master identities that were explicitly pre-created in both Auth
-- and licensing. Runtime email-based binding is intentionally forbidden.
update licensing.master_accounts master
set
  auth_user_id = auth_user.id,
  updated_at = now()
from auth.users auth_user
where master.auth_user_id is null
  and auth_user.email_confirmed_at is not null
  and lower(master.email::text) = lower(auth_user.email::text)
  and not exists (
    select 1
    from licensing.master_accounts other
    where other.auth_user_id = auth_user.id
      and other.id <> master.id
  );

create table if not exists licensing.activation_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  member_id uuid not null references licensing.members(id) on delete cascade,
  purpose text not null check (purpose in ('activation', 'recovery')),
  code_hash text not null unique check (length(code_hash) = 64),
  created_by_master_id uuid references licensing.master_accounts(id) on delete set null,
  created_by_member_id uuid references licensing.members(id) on delete set null,
  expires_at timestamptz not null,
  max_attempts smallint not null default 6 check (max_attempts between 1 and 20),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists activation_codes_member_created_idx
  on licensing.activation_codes (member_id, created_at desc);

create index if not exists activation_codes_open_expiry_idx
  on licensing.activation_codes (expires_at)
  where used_at is null and revoked_at is null;

create table if not exists licensing.rate_limit_events (
  id bigint generated always as identity primary key,
  action text not null check (length(action) between 2 and 64),
  subject_hash text not null check (length(subject_hash) = 64),
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on licensing.rate_limit_events (action, subject_hash, created_at desc);

create or replace function licensing.consume_rate_limit(
  target_action text,
  target_subject_hash text,
  maximum_events integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  recent_count integer;
begin
  if length(target_action) not between 2 and 64
    or length(target_subject_hash) <> 64
    or maximum_events not between 1 and 1000
    or window_seconds not between 1 and 86400
  then
    raise exception 'invalid_rate_limit_arguments';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_action || ':' || target_subject_hash, 0));

  select count(*)::integer
    into recent_count
  from licensing.rate_limit_events
  where action = target_action
    and subject_hash = target_subject_hash
    and created_at >= now() - make_interval(secs => window_seconds);

  if recent_count >= maximum_events then
    return false;
  end if;

  insert into licensing.rate_limit_events (action, subject_hash)
  values (target_action, target_subject_hash);
  return true;
end;
$$;

create or replace function licensing.consume_activation_code(
  target_code_hash text,
  target_email text
)
returns table (
  result text,
  code_id uuid,
  member_id uuid,
  organization_id uuid,
  purpose text,
  created_by_master_id uuid
)
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  selected_code licensing.activation_codes%rowtype;
  member_email text;
begin
  select *
    into selected_code
  from licensing.activation_codes
  where code_hash = target_code_hash
  for update;

  if not found then
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  select lower(m.email::text)
    into member_email
  from licensing.members m
  where m.id = selected_code.member_id;

  if selected_code.used_at is not null then
    return query
      select 'used'::text, null::uuid, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  if selected_code.revoked_at is not null
    or selected_code.expires_at <= now()
    or selected_code.attempt_count >= selected_code.max_attempts
  then
    update licensing.activation_codes
    set revoked_at = coalesce(revoked_at, now())
    where id = selected_code.id;
    return query
      select 'expired'::text, null::uuid, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  if member_email is null or member_email <> lower(trim(target_email)) then
    update licensing.activation_codes
    set
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      revoked_at = case
        when attempt_count + 1 >= max_attempts then now()
        else revoked_at
      end
    where id = selected_code.id;
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  update licensing.activation_codes
  set
    used_at = now(),
    last_attempt_at = now()
  where id = selected_code.id;

  return query
    select
      'consumed'::text,
      selected_code.id,
      selected_code.member_id,
      selected_code.organization_id,
      selected_code.purpose,
      selected_code.created_by_master_id;
end;
$$;

create or replace function licensing.revoke_previous_activation_codes()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
begin
  update licensing.activation_codes
  set revoked_at = now()
  where member_id = new.member_id
    and id <> new.id
    and used_at is null
    and revoked_at is null;
  return new;
end;
$$;

drop trigger if exists activation_codes_revoke_previous on licensing.activation_codes;
create trigger activation_codes_revoke_previous
after insert on licensing.activation_codes
for each row execute function licensing.revoke_previous_activation_codes();

create or replace function licensing.revoke_member_devices_when_inactive()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
begin
  if new.status in ('invited', 'active') then
    return new;
  end if;

  update licensing.devices
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = 'member_inactive',
    updated_at = now()
  where member_id = new.id
    and status = 'active';

  update licensing.license_sessions
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = 'member_inactive',
    updated_at = now()
  where member_id = new.id
    and status = 'active';

  return new;
end;
$$;

create or replace function licensing.revoke_organization_access_when_inactive()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
begin
  if new.status = 'active' then
    return new;
  end if;

  update licensing.devices
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = 'organization_inactive',
    updated_at = now()
  where organization_id = new.id
    and status = 'active';

  update licensing.license_sessions
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = 'organization_inactive',
    updated_at = now()
  where organization_id = new.id
    and status = 'active';

  return new;
end;
$$;

drop trigger if exists organizations_revoke_access_when_inactive on licensing.organizations;
create trigger organizations_revoke_access_when_inactive
after update of status on licensing.organizations
for each row
when (old.status is distinct from new.status)
execute function licensing.revoke_organization_access_when_inactive();

create or replace function licensing.purge_operational_data(
  session_retention_days integer default 14,
  clock_retention_days integer default 30,
  event_retention_days integer default 90,
  rate_limit_retention_days integer default 2,
  activation_retention_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  deleted_sessions integer := 0;
  deleted_clock_audits integer := 0;
  deleted_events integer := 0;
  deleted_rate_limits integer := 0;
  deleted_activation_codes integer := 0;
begin
  if session_retention_days < 1
    or clock_retention_days < 1
    or event_retention_days < 1
    or rate_limit_retention_days < 1
    or activation_retention_days < 1
  then
    raise exception 'invalid_retention';
  end if;

  delete from licensing.clock_audits
  where created_at < now() - make_interval(days => clock_retention_days);
  get diagnostics deleted_clock_audits = row_count;

  delete from licensing.app_events
  where created_at < now() - make_interval(days => event_retention_days);
  get diagnostics deleted_events = row_count;

  delete from licensing.license_sessions
  where status <> 'active'
    and updated_at < now() - make_interval(days => session_retention_days);
  get diagnostics deleted_sessions = row_count;

  delete from licensing.rate_limit_events
  where created_at < now() - make_interval(days => rate_limit_retention_days);
  get diagnostics deleted_rate_limits = row_count;

  delete from licensing.activation_codes
  where coalesce(used_at, revoked_at, expires_at) < now() - make_interval(days => activation_retention_days);
  get diagnostics deleted_activation_codes = row_count;

  return jsonb_build_object(
    'licenseSessions', deleted_sessions,
    'clockAudits', deleted_clock_audits,
    'appEvents', deleted_events,
    'rateLimitEvents', deleted_rate_limits,
    'activationCodes', deleted_activation_codes
  );
end;
$$;

alter table licensing.activation_codes enable row level security;
alter table licensing.activation_codes force row level security;
alter table licensing.rate_limit_events enable row level security;
alter table licensing.rate_limit_events force row level security;

revoke all on licensing.activation_codes from public, anon, authenticated;
revoke all on licensing.rate_limit_events from public, anon, authenticated;
revoke all on function licensing.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function licensing.consume_activation_code(text, text)
  from public, anon, authenticated;
revoke all on function licensing.purge_operational_data(integer, integer, integer, integer, integer)
  from public, anon, authenticated;

grant all privileges on licensing.activation_codes to service_role;
grant all privileges on licensing.rate_limit_events to service_role;
grant usage, select on all sequences in schema licensing to service_role;
grant execute on function licensing.consume_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function licensing.consume_activation_code(text, text)
  to service_role;
grant execute on function licensing.purge_operational_data(integer, integer, integer, integer, integer)
  to service_role;
