-- Make worker availability decisions against the row that was actually
-- locked. clock_timestamp() is intentional here: now() is fixed at the
-- transaction start and could consider an expired heartbeat fresh after a
-- transaction spent time waiting for the worker lock.

create or replace function licensing.render_create_job(
  p_organization_id uuid,
  p_requester_member_id uuid,
  p_requester_device_id uuid,
  p_target_worker_device_id uuid,
  p_idempotency_key text,
  p_jobao_cod text,
  p_jobinho_cod text,
  p_project_name text,
  p_project_relative_path text,
  p_project_size_bytes bigint,
  p_project_sha256 text,
  p_recipe text,
  p_outputs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = licensing, public, extensions
as $$
declare
  existing_job licensing.render_jobs%rowtype;
  target_worker licensing.render_workers%rowtype;
  created_job_id uuid;
  conflicting_job_id uuid;
  destination_path text;
begin
  if not licensing.render_device_context_is_active(
    p_organization_id, p_requester_member_id, p_requester_device_id
  ) then
    raise exception 'render_requester_device_not_active';
  end if;
  if p_recipe <> 'arizona-render-v1'
    or p_project_sha256 !~ '^[0-9a-f]{64}$'
    or not licensing.render_relative_path_is_valid(p_project_relative_path, '.aep')
    or not licensing.render_outputs_are_valid(p_outputs)
  then
    raise exception 'render_invalid_manifest';
  end if;

  -- A missing job row cannot be protected with SELECT ... FOR UPDATE.
  -- Serialize the idempotency namespace before looking it up so concurrent
  -- retries cannot race into the unique constraint.
  perform pg_advisory_xact_lock(hashtextextended(
    p_requester_device_id::text || ':' || p_idempotency_key,
    0
  ));

  select * into existing_job
  from licensing.render_jobs
  where requester_device_id = p_requester_device_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_job.organization_id <> p_organization_id
      or existing_job.requester_member_id <> p_requester_member_id
      or (
        existing_job.target_worker_device_id <> p_target_worker_device_id
        and not (
          p_target_worker_device_id = any(existing_job.previous_target_worker_device_ids)
        )
      )
      or existing_job.jobao_cod <> p_jobao_cod
      or existing_job.jobinho_cod <> p_jobinho_cod
      or existing_job.project_name <> p_project_name
      or existing_job.project_relative_path <> p_project_relative_path
      or existing_job.project_size_bytes <> p_project_size_bytes
      or existing_job.project_sha256 <> p_project_sha256
      or existing_job.recipe <> p_recipe
      or existing_job.outputs <> p_outputs
    then
      raise exception 'render_idempotency_conflict';
    end if;
    return existing_job.id;
  end if;

  -- Serialize assignment with availability changes on this worker. A worker
  -- in another organization is intentionally indistinguishable from a
  -- missing worker.
  select worker.* into target_worker
  from licensing.render_workers worker
  where worker.device_id = p_target_worker_device_id
    and worker.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'render_target_worker_not_found';
  end if;
  if not exists (
    select 1
    from licensing.devices device
    join licensing.members member on member.id = device.member_id
    join licensing.organizations organization on organization.id = device.organization_id
    where device.id = target_worker.device_id
      and device.organization_id = target_worker.organization_id
      and device.member_id = target_worker.member_id
      and member.organization_id = target_worker.organization_id
      and device.status = 'active'
      and member.status = 'active'
      and organization.status = 'active'
  )
    or not target_worker.enabled
    or target_worker.reported_availability <> 'available'
    or target_worker.status_code is not null
    or target_worker.protocol_version <> 1
    or target_worker.render_recipe <> 'arizona-render-v1'
    or target_worker.heartbeat_at < clock_timestamp() - interval '45 seconds'
  then
    raise exception 'render_worker_not_available';
  end if;

  -- Output paths are a cross-worker fencing namespace. Lock every normalized
  -- path in deterministic order before checking the authoritative job state.
  for destination_path in
    select distinct lower(requested_output.value ->> 'destinationRelativePath')
    from jsonb_array_elements(p_outputs) as requested_output(value)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'render-output:' || p_organization_id::text || ':' || destination_path,
      0
    ));
  end loop;

  select job.id into conflicting_job_id
  from licensing.render_jobs job
  where job.organization_id = p_organization_id
    and job.status not in ('completed', 'failed', 'cancelled')
    and exists (
      select 1
      from jsonb_array_elements(job.outputs) as stored_output(value)
      join jsonb_array_elements(p_outputs) as requested_output(value)
        on lower(stored_output.value ->> 'destinationRelativePath')
          = lower(requested_output.value ->> 'destinationRelativePath')
    )
  order by job.created_at, job.id
  limit 1
  for update;
  if found then
    raise exception 'render_output_destination_in_use';
  end if;

  -- Advisory output locks may have taken time to acquire. The worker row is
  -- still locked, but freshness is time-dependent and must be checked again
  -- against the wall clock immediately before accepting the job.
  if target_worker.heartbeat_at < clock_timestamp() - interval '45 seconds' then
    raise exception 'render_worker_not_available';
  end if;

  insert into licensing.render_jobs (
    organization_id, requester_member_id, requester_device_id,
    target_worker_device_id, idempotency_key, jobao_cod, jobinho_cod,
    project_name, project_relative_path, project_size_bytes, project_sha256,
    recipe, outputs, status, stage
  ) values (
    p_organization_id, p_requester_member_id, p_requester_device_id,
    p_target_worker_device_id, p_idempotency_key, p_jobao_cod, p_jobinho_cod,
    p_project_name, p_project_relative_path, p_project_size_bytes, p_project_sha256,
    p_recipe, p_outputs, 'waiting_for_sync', 'waiting_for_sync'
  ) returning id into created_job_id;

  return created_job_id;
end;
$$;

create or replace function licensing.render_claim_job(
  p_organization_id uuid,
  p_member_id uuid,
  p_device_id uuid,
  p_worker_session_id uuid,
  p_job_id uuid,
  p_observed_project_sha256 text,
  p_observed_project_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public, extensions
as $$
declare
  worker licensing.render_workers%rowtype;
  active_job licensing.render_jobs%rowtype;
  next_job licensing.render_jobs%rowtype;
  next_lease_id uuid;
  next_generation bigint;
  next_expiry timestamptz;
begin
  -- Lock and validate the worker before refreshing or locking queue rows. This
  -- matches render_touch_worker and prevents availability/claim lock inversion.
  select * into worker
  from licensing.render_workers
  where device_id = p_device_id
  for update;
  if not found
    or worker.organization_id <> p_organization_id
    or worker.member_id <> p_member_id
    or worker.worker_session_id <> p_worker_session_id
    or not exists (
      select 1
      from licensing.devices device
      join licensing.members member on member.id = device.member_id
      join licensing.organizations organization on organization.id = device.organization_id
      where device.id = worker.device_id
        and device.organization_id = worker.organization_id
        and device.member_id = worker.member_id
        and member.organization_id = worker.organization_id
        and device.status = 'active'
        and member.status = 'active'
        and organization.status = 'active'
    )
    or not worker.enabled
    or worker.reported_availability <> 'available'
    or worker.status_code is not null
    or worker.protocol_version <> 1
    or worker.render_recipe <> 'arizona-render-v1'
    or worker.heartbeat_at < clock_timestamp() - interval '45 seconds'
  then
    raise exception 'render_worker_not_available';
  end if;

  perform licensing.render_refresh_queue_states(p_organization_id);

  -- The validated worker row remains locked. Renew after any wait incurred by
  -- queue refresh so the claim starts from an actual wall-clock heartbeat.
  update licensing.render_workers
  set heartbeat_at = clock_timestamp()
  where device_id = p_device_id;

  select * into active_job
  from licensing.render_jobs
  where target_worker_device_id = p_device_id
    and status in ('claimed', 'rendering', 'publishing')
  for update;
  if found then
    if active_job.claimed_worker_session_id = p_worker_session_id
      and (p_job_id is null or active_job.id = p_job_id)
      and active_job.project_sha256 = p_observed_project_sha256
      and (p_observed_project_size_bytes is null
        or active_job.project_size_bytes = p_observed_project_size_bytes)
      and active_job.lease_expires_at > clock_timestamp()
    then
      return jsonb_build_object(
        'jobId', active_job.id,
        'leaseId', active_job.lease_id,
        'leaseGeneration', active_job.lease_generation,
        'leaseExpiresAt', active_job.lease_expires_at,
        'reused', true
      );
    end if;
    raise exception 'render_worker_already_busy';
  end if;

  select * into next_job
  from licensing.render_jobs
  where organization_id = p_organization_id
    and target_worker_device_id = p_device_id
    and status in ('waiting_for_worker', 'waiting_for_sync', 'queued')
    and not cancel_requested
  order by created_at, id
  limit 1
  for update;

  if not found then
    return null;
  end if;
  if p_job_id is not null and next_job.id <> p_job_id then
    raise exception 'render_job_not_next';
  end if;
  if next_job.status <> 'queued' or next_job.stage <> 'ready' then
    return null;
  end if;
  if next_job.attempt_count >= next_job.max_attempts then
    update licensing.render_jobs
    set status = 'failed', stage = 'failed', last_error_code = 'lease_lost',
        finished_at = now(), updated_at = now()
    where id = next_job.id;
    return jsonb_build_object(
      'jobId', next_job.id,
      'attemptLimitReached', true
    );
  end if;
  if next_job.output_conflict then
    raise exception 'render_output_conflict';
  end if;
  if next_job.project_sha256 <> p_observed_project_sha256
    or (p_observed_project_size_bytes is not null
      and next_job.project_size_bytes <> p_observed_project_size_bytes)
  then
    raise exception 'render_project_hash_mismatch';
  end if;

  next_lease_id := gen_random_uuid();
  next_generation := next_job.lease_generation + 1;
  -- Lease time must start when the claim is actually committed, not at the
  -- beginning of a transaction that may have waited for queue row locks.
  next_expiry := clock_timestamp() + interval '45 seconds';

  update licensing.render_jobs
  set
    status = 'claimed',
    stage = 'preparing',
    progress_percent = 0,
    lease_id = next_lease_id,
    lease_generation = next_generation,
    lease_expires_at = next_expiry,
    claimed_worker_session_id = p_worker_session_id,
    attempt_count = attempt_count + 1,
    claimed_at = now(),
    started_at = null,
    finished_at = null,
    last_error_code = null,
    updated_at = now()
  where id = next_job.id;

  return jsonb_build_object(
    'jobId', next_job.id,
    'leaseId', next_lease_id,
    'leaseGeneration', next_generation,
    'leaseExpiresAt', next_expiry,
    'reused', false
  );
end;
$$;

create or replace function licensing.render_reassign_job(
  p_organization_id uuid,
  p_requester_member_id uuid,
  p_requester_device_id uuid,
  p_job_id uuid,
  p_target_worker_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  job licensing.render_jobs%rowtype;
  target_worker licensing.render_workers%rowtype;
  next_status text;
begin
  if not licensing.render_device_context_is_active(
    p_organization_id, p_requester_member_id, p_requester_device_id
  ) then
    raise exception 'render_device_not_active';
  end if;

  -- Lock the prospective worker before any queue row. If it is already this
  -- job's target, this single lock also provides the required serialization.
  select worker.* into target_worker
  from licensing.render_workers worker
  where worker.device_id = p_target_worker_device_id
    and worker.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'render_target_worker_not_found';
  end if;
  if not exists (
    select 1
    from licensing.devices device
    join licensing.members member on member.id = device.member_id
    join licensing.organizations organization on organization.id = device.organization_id
    where device.id = target_worker.device_id
      and device.organization_id = target_worker.organization_id
      and device.member_id = target_worker.member_id
      and member.organization_id = target_worker.organization_id
      and device.status = 'active'
      and member.status = 'active'
      and organization.status = 'active'
  )
    or not target_worker.enabled
    or target_worker.reported_availability <> 'available'
    or target_worker.status_code is not null
    or target_worker.protocol_version <> 1
    or target_worker.render_recipe <> 'arizona-render-v1'
    or target_worker.heartbeat_at < clock_timestamp() - interval '45 seconds'
  then
    raise exception 'render_worker_not_available';
  end if;

  perform licensing.render_refresh_queue_states(p_organization_id);

  select * into job from licensing.render_jobs where id = p_job_id for update;
  if not found or job.organization_id <> p_organization_id then
    raise exception 'render_job_not_found';
  end if;
  if job.requester_member_id <> p_requester_member_id then
    raise exception 'render_reassign_not_allowed';
  end if;
  if job.status in ('claimed', 'rendering', 'publishing') then
    raise exception 'render_job_in_progress';
  end if;
  if job.status in ('completed', 'failed', 'cancelled') then
    raise exception 'render_job_already_finished';
  end if;

  next_status := 'waiting_for_sync';

  -- Queue refresh and the job lock may have taken time. Availability fields
  -- cannot change while this transaction owns the worker row lock, but the
  -- heartbeat can still age, so re-evaluate it immediately before assignment.
  if target_worker.heartbeat_at < clock_timestamp() - interval '45 seconds' then
    raise exception 'render_worker_not_available';
  end if;

  update licensing.render_jobs
  set
    previous_target_worker_device_ids = array_remove(
      case
        when target_worker_device_id = any(previous_target_worker_device_ids)
          then previous_target_worker_device_ids
        else array_append(previous_target_worker_device_ids, target_worker_device_id)
      end,
      p_target_worker_device_id
    ),
    target_worker_device_id = p_target_worker_device_id,
    status = next_status,
    stage = next_status,
    progress_percent = 0,
    cancel_requested = false,
    cancel_requested_by_member_id = null,
    cancel_requested_by_device_id = null,
    lease_id = null,
    lease_generation = lease_generation + 1,
    lease_expires_at = null,
    claimed_worker_session_id = null,
    last_error_code = null,
    assigned_at = now(),
    updated_at = now()
  where id = job.id
  returning * into job;

  return jsonb_build_object(
    'jobId', job.id,
    'status', job.status,
    'targetWorkerDeviceId', job.target_worker_device_id,
    'assignedAt', job.assigned_at
  );
end;
$$;
