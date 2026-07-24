alter table licensing.organizations
  add column if not exists device_switch_interval_days integer not null default 0
    check (device_switch_interval_days between 0 and 365);

update licensing.organizations
set device_switch_interval_days = least(
  365,
  greatest(
    0,
    coalesce(
      device_switch_cooldown_days,
      ceil(device_switch_cooldown_minutes / 1440.0)::integer,
      0
    )
  )
)
where device_switch_interval_days = 0;

alter table licensing.organizations
  alter column device_switch_interval_days set default 7;

alter table licensing.devices
  add column if not exists activated_at timestamptz;

update licensing.devices
set activated_at = coalesce(first_seen_at, created_at, now())
where activated_at is null;

alter table licensing.devices
  alter column activated_at set default now(),
  alter column activated_at set not null;

comment on column licensing.organizations.device_switch_interval_days is
  'Minimum full 24-hour days that an active device must remain registered before it can be released; zero allows immediate release.';

comment on column licensing.organizations.device_switch_cooldown_days is
  'Deprecated legacy field. Use device_switch_interval_days.';

comment on column licensing.organizations.device_switch_cooldown_minutes is
  'Deprecated legacy field. Use device_switch_interval_days.';

comment on column licensing.devices.activated_at is
  'Timestamp of the most recent transition that activated this installation for the member.';
