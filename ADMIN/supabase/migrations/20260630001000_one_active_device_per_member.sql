with duplicate_active_devices as (
  select id
  from (
    select
      id,
      row_number() over (
        partition by member_id
        order by last_seen_at desc, updated_at desc, created_at desc
      ) as row_number
    from licensing.devices
    where status = 'active'
  ) ranked_devices
  where row_number > 1
),
revoked_devices as (
  update licensing.devices devices
  set
    status = 'revoked',
    updated_at = now()
  from duplicate_active_devices duplicates
  where devices.id = duplicates.id
  returning devices.id
)
update licensing.license_sessions sessions
set
  status = 'revoked',
  revoked_at = now(),
  revoked_reason = 'device_limit_cleanup',
  updated_at = now()
from revoked_devices devices
where sessions.device_id = devices.id
  and sessions.status = 'active';

create unique index if not exists devices_one_active_per_member_uidx
  on licensing.devices (member_id)
  where status = 'active';

create index if not exists devices_member_status_last_seen_idx
  on licensing.devices (member_id, status, last_seen_at desc);

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
    updated_at = now()
  where member_id = new.id
    and status = 'active';

  update licensing.license_sessions
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_reason = 'member_inactive',
    updated_at = now()
  where member_id = new.id
    and status = 'active';

  return new;
end;
$$;

drop trigger if exists members_revoke_devices_when_inactive on licensing.members;
create trigger members_revoke_devices_when_inactive
after update of status on licensing.members
for each row
when (old.status is distinct from new.status)
execute function licensing.revoke_member_devices_when_inactive();
