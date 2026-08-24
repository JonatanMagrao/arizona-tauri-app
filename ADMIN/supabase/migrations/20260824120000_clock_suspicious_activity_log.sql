-- Surface clock-based access denials in the master activity history without
-- mixing their storage or retention with the administrative audit table.

create or replace view licensing.activity_log
with (security_invoker = true)
as
select
  audit.id,
  audit.organization_id,
  audit.actor_master_id,
  audit.actor_member_id,
  audit.action,
  audit.target_table,
  audit.target_id,
  audit.metadata,
  audit.created_at
from licensing.audit_log as audit

union all

select
  clock.id,
  clock.organization_id,
  null::uuid as actor_master_id,
  clock.member_id as actor_member_id,
  'access.clock_suspicious'::text as action,
  'devices'::text as target_table,
  clock.device_id as target_id,
  jsonb_strip_nulls(jsonb_build_object(
    'reason', 'clock_suspicious',
    'clockSkewSeconds', clock.clock_skew_seconds
  )) as metadata,
  clock.created_at
from licensing.clock_audits as clock
where clock.status = 'suspicious'::licensing.clock_status;

comment on view licensing.activity_log is
  'Read-only union of administrative audits and suspicious device-clock access denials.';

revoke all on table licensing.activity_log from public, anon, authenticated, service_role;
grant select on table licensing.activity_log to service_role;

notify pgrst, 'reload schema';
