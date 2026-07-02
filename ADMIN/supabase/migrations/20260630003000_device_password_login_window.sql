alter table licensing.devices
  add column if not exists last_password_login_at timestamptz;

update licensing.devices
set last_password_login_at = coalesce(last_password_login_at, last_seen_at, now())
where status = 'active'
  and last_password_login_at is null;

create index if not exists devices_password_login_idx
  on licensing.devices (member_id, status, last_password_login_at desc);
