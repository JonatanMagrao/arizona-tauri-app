-- Licensing foundation for Arizona App.
-- Security posture:
-- - Keep licensing data outside the public API schema.
-- - Edge Functions perform all privileged actions.
-- - RLS is enabled as defense-in-depth; direct client access is denied by default.
-- - Seat limits are enforced in the database, not only in application code.

create schema if not exists licensing;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

do $$
begin
  create type licensing.organization_status as enum ('active', 'paused', 'blocked', 'deleted');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.master_status as enum ('active', 'disabled');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.member_role as enum ('admin', 'user');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.member_status as enum ('invited', 'active', 'disabled', 'revoked');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.device_status as enum ('active', 'disabled', 'revoked');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.license_session_status as enum ('active', 'expired', 'revoked');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type licensing.clock_status as enum ('ok', 'suspicious', 'blocked');
exception
  when duplicate_object then null;
end
$$;

create or replace function licensing.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists licensing.master_accounts (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  status licensing.master_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists licensing.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  seats_allowed integer not null check (seats_allowed >= 0),
  status licensing.organization_status not null default 'active',
  created_by_master_id uuid references licensing.master_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists licensing.members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  email extensions.citext not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  role licensing.member_role not null default 'user',
  status licensing.member_status not null default 'invited',
  added_by_master_id uuid references licensing.master_accounts(id) on delete set null,
  added_by_member_id uuid references licensing.members(id) on delete set null,
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create unique index if not exists members_org_auth_user_id_uidx
  on licensing.members (organization_id, auth_user_id)
  where auth_user_id is not null;

create index if not exists members_org_status_idx
  on licensing.members (organization_id, status);

create index if not exists members_email_idx
  on licensing.members (email);

create table if not exists licensing.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  member_id uuid not null references licensing.members(id) on delete cascade,
  install_id text not null,
  device_fingerprint_hash text,
  device_label text,
  app_version text,
  status licensing.device_status not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, install_id)
);

create index if not exists devices_org_status_idx
  on licensing.devices (organization_id, status);

create index if not exists devices_install_id_idx
  on licensing.devices (install_id);

create table if not exists licensing.license_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  member_id uuid not null references licensing.members(id) on delete cascade,
  device_id uuid not null references licensing.devices(id) on delete cascade,
  token_id uuid not null unique default gen_random_uuid(),
  token_key_id text not null default 'v1',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  server_time_at_issue timestamptz not null default now(),
  status licensing.license_session_status not null default 'active',
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > issued_at)
);

create index if not exists license_sessions_member_status_idx
  on licensing.license_sessions (member_id, status, expires_at desc);

create index if not exists license_sessions_device_status_idx
  on licensing.license_sessions (device_id, status, expires_at desc);

create table if not exists licensing.clock_audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references licensing.organizations(id) on delete set null,
  member_id uuid references licensing.members(id) on delete set null,
  device_id uuid references licensing.devices(id) on delete set null,
  license_session_id uuid references licensing.license_sessions(id) on delete set null,
  client_local_time timestamptz,
  last_server_time_seen timestamptz,
  last_local_time_seen timestamptz,
  server_time timestamptz not null default now(),
  clock_skew_seconds integer,
  status licensing.clock_status not null default 'ok',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists clock_audits_device_created_idx
  on licensing.clock_audits (device_id, created_at desc);

create table if not exists licensing.app_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references licensing.organizations(id) on delete set null,
  member_id uuid references licensing.members(id) on delete set null,
  device_id uuid references licensing.devices(id) on delete set null,
  license_session_id uuid references licensing.license_sessions(id) on delete set null,
  event_name text not null,
  app_version text,
  success boolean,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(event_name) between 2 and 96),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists app_events_org_created_idx
  on licensing.app_events (organization_id, created_at desc);

create index if not exists app_events_name_created_idx
  on licensing.app_events (event_name, created_at desc);

create table if not exists licensing.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references licensing.organizations(id) on delete set null,
  actor_master_id uuid references licensing.master_accounts(id) on delete set null,
  actor_member_id uuid references licensing.members(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(action) between 2 and 128),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists audit_log_org_created_idx
  on licensing.audit_log (organization_id, created_at desc);

create index if not exists audit_log_action_created_idx
  on licensing.audit_log (action, created_at desc);

create or replace function licensing.consumed_seats(target_organization_id uuid)
returns integer
language sql
stable
set search_path = licensing, public
as $$
  select count(*)::integer
  from licensing.members m
  where m.organization_id = target_organization_id
    and m.role in ('admin', 'user')
    and m.status in ('invited', 'active');
$$;

create or replace function licensing.enforce_member_seat_limit()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
declare
  org_status licensing.organization_status;
  allowed integer;
  consumed integer;
begin
  if new.status not in ('invited', 'active') or new.role not in ('admin', 'user') then
    return new;
  end if;

  select o.status, o.seats_allowed
    into org_status, allowed
  from licensing.organizations o
  where o.id = new.organization_id
  for update;

  if not found then
    raise exception 'organization_not_found';
  end if;

  if org_status <> 'active' then
    raise exception 'organization_not_active';
  end if;

  select count(*)::integer
    into consumed
  from licensing.members m
  where m.organization_id = new.organization_id
    and m.role in ('admin', 'user')
    and m.status in ('invited', 'active')
    and m.id <> new.id;

  if consumed + 1 > allowed then
    raise exception 'seat_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists master_accounts_set_updated_at on licensing.master_accounts;
create trigger master_accounts_set_updated_at
before update on licensing.master_accounts
for each row execute function licensing.set_updated_at();

drop trigger if exists organizations_set_updated_at on licensing.organizations;
create trigger organizations_set_updated_at
before update on licensing.organizations
for each row execute function licensing.set_updated_at();

drop trigger if exists members_set_updated_at on licensing.members;
create trigger members_set_updated_at
before update on licensing.members
for each row execute function licensing.set_updated_at();

drop trigger if exists devices_set_updated_at on licensing.devices;
create trigger devices_set_updated_at
before update on licensing.devices
for each row execute function licensing.set_updated_at();

drop trigger if exists license_sessions_set_updated_at on licensing.license_sessions;
create trigger license_sessions_set_updated_at
before update on licensing.license_sessions
for each row execute function licensing.set_updated_at();

drop trigger if exists members_enforce_seat_limit on licensing.members;
create trigger members_enforce_seat_limit
before insert or update of organization_id, role, status on licensing.members
for each row execute function licensing.enforce_member_seat_limit();

alter table licensing.master_accounts enable row level security;
alter table licensing.organizations enable row level security;
alter table licensing.members enable row level security;
alter table licensing.devices enable row level security;
alter table licensing.license_sessions enable row level security;
alter table licensing.clock_audits enable row level security;
alter table licensing.app_events enable row level security;
alter table licensing.audit_log enable row level security;

alter table licensing.master_accounts force row level security;
alter table licensing.organizations force row level security;
alter table licensing.members force row level security;
alter table licensing.devices force row level security;
alter table licensing.license_sessions force row level security;
alter table licensing.clock_audits force row level security;
alter table licensing.app_events force row level security;
alter table licensing.audit_log force row level security;

revoke all on schema licensing from public, anon, authenticated;
revoke all on all tables in schema licensing from public, anon, authenticated;
revoke all on all routines in schema licensing from public, anon, authenticated;
revoke all on all sequences in schema licensing from public, anon, authenticated;

grant usage on schema licensing to service_role;
grant all privileges on all tables in schema licensing to service_role;
grant all privileges on all routines in schema licensing to service_role;
grant all privileges on all sequences in schema licensing to service_role;

alter default privileges in schema licensing
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema licensing
  revoke all on routines from public, anon, authenticated;
alter default privileges in schema licensing
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema licensing
  grant all on tables to service_role;
alter default privileges in schema licensing
  grant all on routines to service_role;
alter default privileges in schema licensing
  grant all on sequences to service_role;
