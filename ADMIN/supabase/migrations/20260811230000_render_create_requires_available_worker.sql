-- Serialize a new submission with availability changes on its target worker.
-- Idempotent retries are resolved first: a request whose job was already
-- committed must keep returning that same job even if the worker later went
-- offline.

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
      or existing_job.target_worker_device_id <> p_target_worker_device_id
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

  -- Use the same row lock as render_touch_worker. Whichever transaction wins
  -- decides atomically whether this new job was accepted before or after the
  -- worker switched itself off. Busy workers still report themselves as
  -- available operationally and may receive additional FIFO work.
  select worker.* into target_worker
  from licensing.render_workers worker
  join licensing.devices device on device.id = worker.device_id
  where worker.device_id = p_target_worker_device_id
    and device.organization_id = p_organization_id
    and device.status = 'active'
  for update of worker;

  if not found then
    raise exception 'render_target_worker_not_found';
  end if;
  if not licensing.render_worker_is_accepting(p_target_worker_device_id) then
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
