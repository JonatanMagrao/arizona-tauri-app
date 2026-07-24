alter table licensing.organizations
  add column if not exists device_switch_cooldown_days integer not null default 0
    check (device_switch_cooldown_days between 0 and 365);

update licensing.organizations
set device_switch_cooldown_days = least(
  365,
  greatest(0, ceil(device_switch_cooldown_minutes / 1440.0)::integer)
)
where device_switch_cooldown_days = 0
  and device_switch_cooldown_minutes > 0;

comment on column licensing.organizations.device_switch_cooldown_days is
  'Full days after a normal device release before another device can be activated.';

comment on column licensing.organizations.device_switch_cooldown_minutes is
  'Deprecated compatibility mirror of device_switch_cooldown_days.';
