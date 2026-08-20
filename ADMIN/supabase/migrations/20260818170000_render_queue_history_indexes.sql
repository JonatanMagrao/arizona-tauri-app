-- Keep requester/member and worker/device history on indexed keyset scans.

create index if not exists render_jobs_org_requester_member_history_idx
  on licensing.render_jobs (
    organization_id,
    requester_member_id,
    created_at desc,
    id desc
  );

create index if not exists render_jobs_org_target_device_history_idx
  on licensing.render_jobs (
    organization_id,
    target_worker_device_id,
    created_at desc,
    id desc
  );
