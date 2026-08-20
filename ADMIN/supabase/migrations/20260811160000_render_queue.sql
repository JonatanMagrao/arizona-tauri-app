-- Distributed render queue control plane.
-- Large project/output files never pass through Supabase. This schema stores
-- only the allowlisted manifest, operational state, enumerated codes and
-- timestamps required to coordinate the two authenticated Tauri devices.

create or replace function licensing.render_relative_path_is_valid(
  path_value text,
  expected_extension text
)
returns boolean
language sql
immutable
set search_path = licensing, public
as $$
  select path_value is not null
    and length(path_value) between 1 and 1024
    and path_value = btrim(path_value)
    and path_value !~ '[[:cntrl:]]'
    and path_value !~ '^[\\/]'
    and path_value !~* '^[a-z]:'
    and path_value !~ '[:*?"<>|]'
    and position('\\' in path_value) = 0
    and position('//' in path_value) = 0
    and not exists (
      select 1
      from unnest(string_to_array(path_value, '/')) as segment(value)
      where segment.value in ('', '.', '..')
        or segment.value ~ '[. ]$'
    )
    and lower(right(path_value, length(expected_extension))) = lower(expected_extension);
$$;

create or replace function licensing.render_outputs_are_valid(outputs_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = licensing, public
as $$
declare
  output_value jsonb;
  output_kind text;
  mov_count integer := 0;
  mp4_count integer := 0;
begin
  if jsonb_typeof(outputs_value) <> 'array' or jsonb_array_length(outputs_value) <> 2 then
    return false;
  end if;

  for output_value in select value from jsonb_array_elements(outputs_value)
  loop
    if jsonb_typeof(output_value) <> 'object' then
      return false;
    end if;
    if exists (
      select 1
      from jsonb_object_keys(output_value) as key(value)
      where key.value not in (
        'kind', 'comp', 'template', 'destinationRelativePath',
        'replaceExisting', 'existingFingerprint'
      )
    ) then
      return false;
    end if;
    if jsonb_typeof(output_value -> 'replaceExisting') is distinct from 'boolean' then
      return false;
    end if;
    if output_value ? 'existingFingerprint'
      and (
        jsonb_typeof(output_value -> 'existingFingerprint') <> 'string'
        or length(output_value ->> 'existingFingerprint') not between 1 and 256
        or output_value ->> 'existingFingerprint' ~ '[[:cntrl:]]'
      )
    then
      return false;
    end if;

    output_kind := output_value ->> 'kind';
    if output_kind = 'mov' then
      if output_value ->> 'comp' <> 'EXPORT'
        or output_value ->> 'template' <> 'PROXY'
        or not licensing.render_relative_path_is_valid(
          output_value ->> 'destinationRelativePath',
          '.mov'
        )
      then
        return false;
      end if;
      mov_count := mov_count + 1;
    elsif output_kind = 'mp4' then
      if output_value ->> 'comp' <> 'EXPORT_MP4'
        or output_value ->> 'template' <> 'MP4'
        or not licensing.render_relative_path_is_valid(
          output_value ->> 'destinationRelativePath',
          '.mp4'
        )
      then
        return false;
      end if;
      mp4_count := mp4_count + 1;
    else
      return false;
    end if;
  end loop;

  return mov_count = 1 and mp4_count = 1;
end;
$$;

create or replace function licensing.render_result_outputs_are_valid(outputs_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = licensing, public
as $$
declare
  output_value jsonb;
  output_kind text;
  mov_count integer := 0;
  mp4_count integer := 0;
begin
  if outputs_value is null then
    return true;
  end if;
  if jsonb_typeof(outputs_value) <> 'array' or jsonb_array_length(outputs_value) <> 2 then
    return false;
  end if;
  for output_value in select value from jsonb_array_elements(outputs_value)
  loop
    if jsonb_typeof(output_value) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(output_value) as key(value)
        where key.value not in ('kind', 'destinationRelativePath', 'sizeBytes', 'sha256')
      )
      or jsonb_typeof(output_value -> 'sizeBytes') is distinct from 'number'
      or (output_value ->> 'sizeBytes')::numeric <= 0
      or coalesce(output_value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
    then
      return false;
    end if;
    output_kind := output_value ->> 'kind';
    if output_kind = 'mov' then
      if not licensing.render_relative_path_is_valid(
        output_value ->> 'destinationRelativePath', '.mov'
      ) then
        return false;
      end if;
      mov_count := mov_count + 1;
    elsif output_kind = 'mp4' then
      if not licensing.render_relative_path_is_valid(
        output_value ->> 'destinationRelativePath', '.mp4'
      ) then
        return false;
      end if;
      mp4_count := mp4_count + 1;
    else
      return false;
    end if;
  end loop;
  return mov_count = 1 and mp4_count = 1;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

create table licensing.render_workers (
  device_id uuid primary key references licensing.devices(id) on delete cascade,
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  member_id uuid not null references licensing.members(id) on delete cascade,
  worker_session_id uuid not null,
  enabled boolean not null default false,
  reported_availability text not null default 'unavailable'
    check (reported_availability in ('available', 'degraded', 'unavailable')),
  status_code text check (
    status_code is null or status_code in (
      'after_effects_open', 'drive_unavailable', 'recipe_unavailable',
      'aerender_unavailable', 'project_not_synced', 'project_hash_mismatch',
      'output_conflict', 'publication_recovery_pending'
    )
  ),
  status_message text check (
    status_message is null
    or (length(status_message) between 1 and 240 and status_message !~ '[[:cntrl:]]')
  ),
  protocol_version smallint not null default 1 check (protocol_version = 1),
  render_recipe text not null default 'arizona-render-v1'
    check (render_recipe = 'arizona-render-v1'),
  after_effects_year smallint check (after_effects_year between 2020 and 2100),
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table licensing.render_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references licensing.organizations(id) on delete cascade,
  requester_member_id uuid not null references licensing.members(id),
  requester_device_id uuid not null references licensing.devices(id),
  target_worker_device_id uuid not null references licensing.devices(id),
  previous_target_worker_device_ids uuid[] not null default '{}'::uuid[]
    check (array_position(previous_target_worker_device_ids, null) is null)
    check (not (target_worker_device_id = any(previous_target_worker_device_ids))),
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 128
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  schema_version smallint not null default 1 check (schema_version = 1),
  jobao_cod text not null check (length(jobao_cod) between 1 and 128 and jobao_cod !~ '[[:cntrl:]]'),
  jobinho_cod text not null check (length(jobinho_cod) between 1 and 128 and jobinho_cod !~ '[[:cntrl:]]'),
  project_name text not null check (length(project_name) between 1 and 255 and project_name !~ '[[:cntrl:]]'),
  project_relative_path text not null check (
    licensing.render_relative_path_is_valid(project_relative_path, '.aep')
  ),
  project_size_bytes bigint not null check (project_size_bytes > 0),
  project_sha256 text not null check (project_sha256 ~ '^[0-9a-f]{64}$'),
  recipe text not null check (recipe = 'arizona-render-v1'),
  outputs jsonb not null check (licensing.render_outputs_are_valid(outputs)),
  status text not null default 'waiting_for_worker' check (
    status in (
      'waiting_for_worker', 'waiting_for_sync', 'queued', 'claimed',
      'rendering', 'publishing', 'completed', 'failed', 'cancelled'
    )
  ),
  stage text not null default 'waiting_for_worker' check (
    stage in (
      'waiting_for_worker', 'waiting_for_sync', 'ready', 'preparing',
      'rendering_proxy', 'rendering_mp4', 'publishing',
      'completed', 'failed', 'cancelled'
    )
  ),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  cancel_requested boolean not null default false,
  cancel_requested_by_member_id uuid references licensing.members(id),
  cancel_requested_by_device_id uuid references licensing.devices(id),
  output_conflict boolean not null default false,
  output_conflict_code text check (
    output_conflict_code is null
    or output_conflict_code in ('existing_output_found', 'existing_output_changed')
  ),
  lease_id uuid,
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  claimed_worker_session_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  last_error_code text check (
    last_error_code is null or last_error_code in (
      'after_effects_open', 'drive_unavailable', 'project_not_synced',
      'project_missing', 'project_hash_mismatch', 'sync_timeout',
      'recipe_unavailable', 'aerender_unavailable', 'aerender_failed',
      'output_conflict', 'output_missing', 'cancelled_by_requester',
      'cancelled_by_worker', 'lease_lost', 'machine_unavailable',
      'unexpected_failure'
    )
  ),
  result_outputs jsonb check (licensing.render_result_outputs_are_valid(result_outputs)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  unique (requester_device_id, idempotency_key),
  check ((lease_id is null) = (lease_expires_at is null)),
  check ((output_conflict_code is null) or output_conflict)
);

create index render_workers_org_heartbeat_idx
  on licensing.render_workers (organization_id, heartbeat_at desc);

create index render_jobs_target_queue_idx
  on licensing.render_jobs (target_worker_device_id, created_at, id)
  where status in ('waiting_for_worker', 'waiting_for_sync', 'queued');

create unique index render_jobs_one_active_per_target_uidx
  on licensing.render_jobs (target_worker_device_id)
  where status in ('claimed', 'rendering', 'publishing');

create index render_jobs_requester_created_idx
  on licensing.render_jobs (requester_member_id, created_at desc);

create index render_jobs_org_updated_idx
  on licensing.render_jobs (organization_id, updated_at desc);

create index render_jobs_org_nonterminal_destinations_idx
  on licensing.render_jobs (organization_id, created_at, id)
  where status not in ('completed', 'failed', 'cancelled');

create index render_jobs_active_lease_idx
  on licensing.render_jobs (lease_expires_at)
  where status in ('claimed', 'rendering', 'publishing');

drop trigger if exists render_workers_set_updated_at on licensing.render_workers;
create trigger render_workers_set_updated_at
before update on licensing.render_workers
for each row execute function licensing.set_updated_at();

drop trigger if exists render_jobs_set_updated_at on licensing.render_jobs;
create trigger render_jobs_set_updated_at
before update on licensing.render_jobs
for each row execute function licensing.set_updated_at();

create or replace function licensing.render_worker_is_accepting(target_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = licensing, public
as $$
  select exists (
    select 1
    from licensing.render_workers worker
    join licensing.devices device on device.id = worker.device_id
    where worker.device_id = target_device_id
      and device.status = 'active'
      and worker.enabled
      and worker.reported_availability = 'available'
      and worker.status_code is null
      and worker.protocol_version = 1
      and worker.render_recipe = 'arizona-render-v1'
      and worker.heartbeat_at >= now() - interval '45 seconds'
  );
$$;

create or replace function licensing.render_device_context_is_active(
  target_organization_id uuid,
  target_member_id uuid,
  target_device_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = licensing, public
as $$
  select exists (
    select 1
    from licensing.devices device
    join licensing.members member on member.id = device.member_id
    join licensing.organizations organization on organization.id = device.organization_id
    where device.id = target_device_id
      and device.organization_id = target_organization_id
      and device.member_id = target_member_id
      and device.status = 'active'
      and member.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function licensing.render_refresh_queue_states(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public, extensions
as $$
declare
  expired_count integer := 0;
  waiting_count integer := 0;
  resumed_count integer := 0;
begin
  update licensing.render_jobs job
  set
    status = case
      when job.cancel_requested then 'cancelled'
      when job.attempt_count >= job.max_attempts then 'failed'
      when licensing.render_worker_is_accepting(job.target_worker_device_id) then 'waiting_for_sync'
      else 'waiting_for_worker'
    end,
    stage = case
      when job.cancel_requested then 'cancelled'
      when job.attempt_count >= job.max_attempts then 'failed'
      when licensing.render_worker_is_accepting(job.target_worker_device_id) then 'waiting_for_sync'
      else 'waiting_for_worker'
    end,
    progress_percent = case when job.cancel_requested then job.progress_percent else 0 end,
    lease_id = null,
    lease_generation = job.lease_generation + 1,
    lease_expires_at = null,
    claimed_worker_session_id = null,
    last_error_code = case
      when job.cancel_requested then coalesce(job.last_error_code, 'cancelled_by_requester')
      else 'lease_lost'
    end,
    cancelled_at = case when job.cancel_requested then now() else job.cancelled_at end,
    finished_at = case
      when job.cancel_requested or job.attempt_count >= job.max_attempts then now()
      else null
    end,
    updated_at = now()
  where job.organization_id = target_organization_id
    and job.status in ('claimed', 'rendering', 'publishing')
    and job.lease_expires_at <= now();
  get diagnostics expired_count = row_count;

  update licensing.render_jobs job
  set
    status = 'waiting_for_worker',
    stage = 'waiting_for_worker',
    updated_at = now()
  where job.organization_id = target_organization_id
    and job.status in ('waiting_for_sync', 'queued')
    and not licensing.render_worker_is_accepting(job.target_worker_device_id);
  get diagnostics waiting_count = row_count;

  update licensing.render_jobs job
  set
    status = 'waiting_for_sync',
    stage = 'waiting_for_sync',
    updated_at = now()
  where job.organization_id = target_organization_id
    and job.status = 'waiting_for_worker'
    and not job.cancel_requested
    and licensing.render_worker_is_accepting(job.target_worker_device_id);
  get diagnostics resumed_count = row_count;

  return jsonb_build_object(
    'expiredLeases', expired_count,
    'waitingForWorker', waiting_count,
    'resumedForSync', resumed_count
  );
end;
$$;

create or replace function licensing.render_touch_worker(
  p_organization_id uuid,
  p_member_id uuid,
  p_device_id uuid,
  p_worker_session_id uuid,
  p_set_enabled boolean,
  p_enabled boolean,
  p_update_health boolean,
  p_reported_availability text,
  p_status_code text,
  p_status_message text,
  p_protocol_version integer,
  p_render_recipe text,
  p_after_effects_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public, extensions
as $$
declare
  worker licensing.render_workers%rowtype;
  session_changed boolean := false;
begin
  if not licensing.render_device_context_is_active(
    p_organization_id, p_member_id, p_device_id
  ) then
    raise exception 'render_device_not_active';
  end if;
  if p_protocol_version <> 1 or p_render_recipe <> 'arizona-render-v1' then
    raise exception 'render_recipe_not_supported';
  end if;
  if p_reported_availability not in ('available', 'degraded', 'unavailable') then
    raise exception 'render_invalid_availability';
  end if;

  select * into worker
  from licensing.render_workers
  where device_id = p_device_id
  for update;

  if not found then
    insert into licensing.render_workers (
      device_id, organization_id, member_id, worker_session_id,
      enabled, reported_availability, protocol_version, render_recipe,
      after_effects_year, heartbeat_at
    ) values (
      p_device_id, p_organization_id, p_member_id, p_worker_session_id,
      false, 'unavailable', p_protocol_version, p_render_recipe,
      p_after_effects_year, now()
    ) returning * into worker;
    session_changed := true;
  elsif worker.worker_session_id <> p_worker_session_id then
    update licensing.render_workers
    set
      worker_session_id = p_worker_session_id,
      enabled = false,
      reported_availability = 'unavailable',
      status_code = null,
      status_message = null,
      protocol_version = p_protocol_version,
      render_recipe = p_render_recipe,
      after_effects_year = coalesce(p_after_effects_year, after_effects_year),
      heartbeat_at = now()
    where device_id = p_device_id
    returning * into worker;
    session_changed := true;
  end if;

  update licensing.render_workers
  set
    enabled = case when p_set_enabled then p_enabled else enabled end,
    reported_availability = case
      when p_set_enabled and not p_enabled then 'unavailable'
      when p_update_health then p_reported_availability
      else reported_availability
    end,
    status_code = case
      when p_set_enabled and not p_enabled then null
      when p_update_health then p_status_code
      else status_code
    end,
    status_message = case
      when p_set_enabled and not p_enabled then null
      when p_update_health then p_status_message
      else status_message
    end,
    protocol_version = p_protocol_version,
    render_recipe = p_render_recipe,
    after_effects_year = coalesce(p_after_effects_year, after_effects_year),
    -- Status/history actions still register a new process session, but they
    -- must not impersonate the operational worker heartbeat. Only explicit
    -- health updates keep an already-known session fresh.
    heartbeat_at = case when p_update_health then now() else heartbeat_at end
  where device_id = p_device_id
  returning * into worker;

  perform licensing.render_refresh_queue_states(p_organization_id);

  return jsonb_build_object(
    'deviceId', worker.device_id,
    'workerSessionId', worker.worker_session_id,
    'sessionChanged', session_changed,
    'enabled', worker.enabled,
    'reportedAvailability', worker.reported_availability,
    'statusCode', worker.status_code,
    'statusMessage', worker.status_message,
    'heartbeatAt', worker.heartbeat_at
  );
end;
$$;

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
  created_job_id uuid;
  conflicting_job_id uuid;
  destination_path text;
  initial_status text;
begin
  if not licensing.render_device_context_is_active(
    p_organization_id, p_requester_member_id, p_requester_device_id
  ) then
    raise exception 'render_requester_device_not_active';
  end if;
  if not exists (
    select 1
    from licensing.devices device
    join licensing.render_workers worker on worker.device_id = device.id
    where device.id = p_target_worker_device_id
      and device.organization_id = p_organization_id
      and device.status = 'active'
  ) then
    raise exception 'render_target_worker_not_found';
  end if;
  if p_recipe <> 'arizona-render-v1'
    or p_project_sha256 !~ '^[0-9a-f]{64}$'
    or not licensing.render_relative_path_is_valid(p_project_relative_path, '.aep')
    or not licensing.render_outputs_are_valid(p_outputs)
  then
    raise exception 'render_invalid_manifest';
  end if;

  -- A missing row cannot be protected with SELECT ... FOR UPDATE. Serialize
  -- the idempotency namespace before looking it up so concurrent retries with
  -- the same device/key cannot race into the unique constraint. Hash
  -- collisions only serialize unrelated submissions; they never merge them.
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

  -- Output paths are a cross-worker fencing namespace. Lock every normalized
  -- path in deterministic order before checking the authoritative job state,
  -- otherwise two devices could both observe an empty destination set and
  -- publish to the same MOV/MP4 concurrently.
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

  initial_status := case
    when licensing.render_worker_is_accepting(p_target_worker_device_id)
      then 'waiting_for_sync'
    else 'waiting_for_worker'
  end;

  insert into licensing.render_jobs (
    organization_id, requester_member_id, requester_device_id,
    target_worker_device_id, idempotency_key, jobao_cod, jobinho_cod,
    project_name, project_relative_path, project_size_bytes, project_sha256,
    recipe, outputs, status, stage
  ) values (
    p_organization_id, p_requester_member_id, p_requester_device_id,
    p_target_worker_device_id, p_idempotency_key, p_jobao_cod, p_jobinho_cod,
    p_project_name, p_project_relative_path, p_project_size_bytes, p_project_sha256,
    p_recipe, p_outputs, initial_status, initial_status
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
  perform licensing.render_refresh_queue_states(p_organization_id);

  select * into worker
  from licensing.render_workers
  where device_id = p_device_id
  for update;
  if not found
    or worker.organization_id <> p_organization_id
    or worker.member_id <> p_member_id
    or worker.worker_session_id <> p_worker_session_id
    or not licensing.render_device_context_is_active(
      p_organization_id, p_member_id, p_device_id
    )
    or not worker.enabled
    or worker.reported_availability <> 'available'
    or worker.status_code is not null
    or worker.protocol_version <> 1
    or worker.render_recipe <> 'arizona-render-v1'
    or worker.heartbeat_at < now() - interval '45 seconds'
  then
    raise exception 'render_worker_not_available';
  end if;

  update licensing.render_workers set heartbeat_at = now() where device_id = p_device_id;

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
      and active_job.lease_expires_at > now()
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
  next_expiry := now() + interval '45 seconds';

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

create or replace function licensing.render_heartbeat_job(
  p_organization_id uuid,
  p_member_id uuid,
  p_device_id uuid,
  p_worker_session_id uuid,
  p_job_id uuid,
  p_has_lease boolean,
  p_lease_id uuid,
  p_lease_generation bigint,
  p_progress_percent integer,
  p_stage text,
  p_reported_availability text,
  p_status_code text,
  p_status_message text,
  p_output_conflict boolean,
  p_output_conflict_code text,
  p_pending_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public, extensions
as $$
declare
  worker licensing.render_workers%rowtype;
  job licensing.render_jobs%rowtype;
  next_status text;
  next_expiry timestamptz;
begin
  select * into worker
  from licensing.render_workers
  where device_id = p_device_id
  for update;
  if not found
    or worker.organization_id <> p_organization_id
    or worker.member_id <> p_member_id
    or worker.worker_session_id <> p_worker_session_id
    or not licensing.render_device_context_is_active(
      p_organization_id, p_member_id, p_device_id
    )
  then
    raise exception 'render_worker_session_invalid';
  end if;

  update licensing.render_workers
  set
    reported_availability = case when enabled then p_reported_availability else 'unavailable' end,
    status_code = case when enabled then p_status_code else null end,
    status_message = case when enabled then p_status_message else null end,
    heartbeat_at = now()
  where device_id = p_device_id;

  if p_job_id is null then
    perform licensing.render_refresh_queue_states(p_organization_id);
    return jsonb_build_object('jobId', null, 'heartbeatAt', now());
  end if;

  select * into job
  from licensing.render_jobs
  where id = p_job_id
  for update;
  if not found or job.organization_id <> p_organization_id
    or job.target_worker_device_id <> p_device_id
  then
    raise exception 'render_job_not_found';
  end if;

  if p_has_lease then
    if p_lease_id is null or p_lease_generation is null
      or job.status not in ('claimed', 'rendering', 'publishing')
      or job.lease_id <> p_lease_id
      or job.lease_generation <> p_lease_generation
      or job.claimed_worker_session_id <> p_worker_session_id
      or job.lease_expires_at <= now()
    then
      raise exception 'render_lease_lost';
    end if;
    if p_stage not in ('preparing', 'rendering_proxy', 'rendering_mp4', 'publishing') then
      raise exception 'render_invalid_stage';
    end if;
    next_status := case
      when p_stage = 'publishing' then 'publishing'
      when p_stage in ('rendering_proxy', 'rendering_mp4') then 'rendering'
      else 'claimed'
    end;
    next_expiry := now() + interval '45 seconds';
    update licensing.render_jobs
    set
      status = next_status,
      stage = p_stage,
      progress_percent = greatest(progress_percent, p_progress_percent),
      lease_expires_at = next_expiry,
      started_at = case
        when p_stage in ('rendering_proxy', 'rendering_mp4', 'publishing')
          then coalesce(started_at, now())
        else started_at
      end,
      updated_at = now()
    where id = job.id
    returning * into job;
    return jsonb_build_object(
      'jobId', job.id,
      'status', job.status,
      'stage', job.stage,
      'progressPercent', job.progress_percent,
      'cancelRequested', job.cancel_requested,
      'leaseExpiresAt', next_expiry
    );
  end if;

  if job.status not in ('waiting_for_worker', 'waiting_for_sync', 'queued') then
    raise exception 'render_job_not_pending';
  end if;
  if exists (
    select 1
    from licensing.render_jobs earlier
    where earlier.target_worker_device_id = p_device_id
      and earlier.status in ('waiting_for_worker', 'waiting_for_sync', 'queued')
      and not earlier.cancel_requested
      and (earlier.created_at, earlier.id) < (job.created_at, job.id)
  ) then
    raise exception 'render_job_not_next';
  end if;
  if p_pending_error_code is not null then
    if p_pending_error_code not in ('sync_timeout', 'project_hash_mismatch') then
      raise exception 'render_invalid_pending_error';
    end if;
    update licensing.render_jobs
    set
      status = 'failed',
      stage = 'failed',
      last_error_code = p_pending_error_code,
      finished_at = now(),
      updated_at = now()
    where id = job.id
    returning * into job;
    return jsonb_build_object(
      'jobId', job.id,
      'status', job.status,
      'stage', job.stage,
      'progressPercent', job.progress_percent,
      'cancelRequested', job.cancel_requested,
      'leaseExpiresAt', null
    );
  end if;
  if p_stage not in ('waiting_for_worker', 'waiting_for_sync', 'ready') then
    raise exception 'render_invalid_stage';
  end if;

  if p_stage = 'ready'
    and licensing.render_worker_is_accepting(p_device_id)
    and not p_output_conflict
  then
    next_status := 'queued';
  elsif p_stage = 'waiting_for_worker'
    or not licensing.render_worker_is_accepting(p_device_id)
  then
    next_status := 'waiting_for_worker';
  else
    next_status := 'waiting_for_sync';
  end if;

  update licensing.render_jobs
  set
    status = next_status,
    stage = case when next_status = 'queued' then 'ready' else next_status end,
    output_conflict = p_output_conflict,
    output_conflict_code = case when p_output_conflict then p_output_conflict_code else null end,
    updated_at = now()
  where id = job.id
  returning * into job;

  return jsonb_build_object(
    'jobId', job.id,
    'status', job.status,
    'stage', job.stage,
    'progressPercent', job.progress_percent,
    'cancelRequested', job.cancel_requested,
    'leaseExpiresAt', null
  );
end;
$$;

create or replace function licensing.render_finish_job(
  p_organization_id uuid,
  p_member_id uuid,
  p_device_id uuid,
  p_worker_session_id uuid,
  p_job_id uuid,
  p_lease_id uuid,
  p_lease_generation bigint,
  p_outcome text,
  p_error_code text,
  p_result_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  worker licensing.render_workers%rowtype;
  job licensing.render_jobs%rowtype;
begin
  select * into worker
  from licensing.render_workers
  where device_id = p_device_id
  for update;
  if not found or worker.organization_id <> p_organization_id
    or worker.member_id <> p_member_id
    or worker.worker_session_id <> p_worker_session_id
    or not licensing.render_device_context_is_active(
      p_organization_id, p_member_id, p_device_id
    )
  then
    raise exception 'render_worker_session_invalid';
  end if;
  select * into job from licensing.render_jobs where id = p_job_id for update;
  if not found or job.organization_id <> p_organization_id
    or job.target_worker_device_id <> p_device_id
  then
    raise exception 'render_job_not_found';
  end if;
  if job.status not in ('claimed', 'rendering', 'publishing')
    or job.lease_id <> p_lease_id
    or job.lease_generation <> p_lease_generation
    or job.claimed_worker_session_id <> p_worker_session_id
    or job.lease_expires_at <= now()
  then
    raise exception 'render_lease_lost';
  end if;
  if p_outcome not in ('completed', 'failed', 'cancelled') then
    raise exception 'render_invalid_outcome';
  end if;
  -- Cancellation and completion are serialized by the job row lock above.
  -- Once a cancellation request commits, a late publisher must retain its
  -- recovery journal/backups instead of declaring the outputs completed.
  if p_outcome = 'completed' and job.cancel_requested then
    raise exception 'render_cancel_requested';
  end if;
  if p_outcome = 'completed'
    and (p_result_outputs is null
      or not licensing.render_result_outputs_are_valid(p_result_outputs))
  then
    raise exception 'render_invalid_result_outputs';
  end if;
  if p_outcome = 'completed' and exists (
    select 1
    from jsonb_array_elements(p_result_outputs) result_output
    where not exists (
      select 1
      from jsonb_array_elements(job.outputs) expected_output
      where expected_output ->> 'kind' = result_output ->> 'kind'
        and expected_output ->> 'destinationRelativePath'
          = result_output ->> 'destinationRelativePath'
    )
  ) then
    raise exception 'render_invalid_result_outputs';
  end if;
  if p_outcome = 'failed' and p_error_code is null then
    raise exception 'render_error_code_required';
  end if;

  update licensing.render_jobs
  set
    status = p_outcome,
    stage = p_outcome,
    progress_percent = case when p_outcome = 'completed' then 100 else progress_percent end,
    last_error_code = case
      when p_outcome = 'cancelled'
        then coalesce(p_error_code, last_error_code, 'cancelled_by_worker')
      else p_error_code
    end,
    result_outputs = p_result_outputs,
    finished_at = now(),
    cancelled_at = case when p_outcome = 'cancelled' then now() else cancelled_at end,
    updated_at = now()
  where id = job.id
  returning * into job;

  return jsonb_build_object(
    'jobId', job.id,
    'status', job.status,
    'stage', job.stage,
    'progressPercent', job.progress_percent,
    'finishedAt', job.finished_at
  );
end;
$$;

create or replace function licensing.render_cancel_job(
  p_organization_id uuid,
  p_actor_member_id uuid,
  p_actor_device_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  job licensing.render_jobs%rowtype;
begin
  perform licensing.render_refresh_queue_states(p_organization_id);
  if not licensing.render_device_context_is_active(
    p_organization_id, p_actor_member_id, p_actor_device_id
  ) then
    raise exception 'render_device_not_active';
  end if;
  select * into job from licensing.render_jobs where id = p_job_id for update;
  if not found or job.organization_id <> p_organization_id then
    raise exception 'render_job_not_found';
  end if;
  if job.requester_member_id <> p_actor_member_id
    and job.target_worker_device_id <> p_actor_device_id
  then
    raise exception 'render_cancel_not_allowed';
  end if;
  if job.status = 'cancelled' then
    return jsonb_build_object(
      'jobId', job.id, 'status', job.status, 'cancelRequested', true
    );
  end if;
  if job.status in ('completed', 'failed') then
    raise exception 'render_job_already_finished';
  end if;

  if job.status in ('waiting_for_worker', 'waiting_for_sync', 'queued') then
    update licensing.render_jobs
    set
      status = 'cancelled',
      stage = 'cancelled',
      cancel_requested = true,
      cancel_requested_by_member_id = p_actor_member_id,
      cancel_requested_by_device_id = p_actor_device_id,
      last_error_code = case
        when requester_member_id = p_actor_member_id then 'cancelled_by_requester'
        else 'cancelled_by_worker'
      end,
      cancelled_at = now(),
      finished_at = now(),
      updated_at = now()
    where id = job.id
    returning * into job;
  else
    update licensing.render_jobs
    set
      cancel_requested = true,
      cancel_requested_by_member_id = p_actor_member_id,
      cancel_requested_by_device_id = p_actor_device_id,
      last_error_code = case
        when requester_member_id = p_actor_member_id then 'cancelled_by_requester'
        else 'cancelled_by_worker'
      end,
      updated_at = now()
    where id = job.id
    returning * into job;
  end if;

  return jsonb_build_object(
    'jobId', job.id,
    'status', job.status,
    'cancelRequested', job.cancel_requested
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
  next_status text;
begin
  perform licensing.render_refresh_queue_states(p_organization_id);
  if not licensing.render_device_context_is_active(
    p_organization_id, p_requester_member_id, p_requester_device_id
  ) then
    raise exception 'render_device_not_active';
  end if;
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
  if not exists (
    select 1
    from licensing.devices device
    join licensing.render_workers worker on worker.device_id = device.id
    where device.id = p_target_worker_device_id
      and device.organization_id = p_organization_id
      and device.status = 'active'
  ) then
    raise exception 'render_target_worker_not_found';
  end if;

  next_status := case
    when licensing.render_worker_is_accepting(p_target_worker_device_id)
      then 'waiting_for_sync'
    else 'waiting_for_worker'
  end;

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

create or replace function licensing.render_disable_worker_when_device_inactive()
returns trigger
language plpgsql
security definer
set search_path = licensing, public
as $$
begin
  if new.status = 'active' then
    return new;
  end if;
  update licensing.render_workers
  set enabled = false, reported_availability = 'unavailable',
      status_code = null, status_message = null, updated_at = now()
  where device_id = new.id;
  update licensing.render_jobs
  set
    status = case
      when status in ('waiting_for_worker', 'waiting_for_sync', 'queued') then 'waiting_for_worker'
      else status
    end,
    stage = case
      when status in ('waiting_for_worker', 'waiting_for_sync', 'queued') then 'waiting_for_worker'
      else stage
    end,
    cancel_requested = case
      when status in ('claimed', 'rendering', 'publishing') then true
      else cancel_requested
    end,
    last_error_code = case
      when status in ('claimed', 'rendering', 'publishing') then 'machine_unavailable'
      else last_error_code
    end,
    updated_at = now()
  where target_worker_device_id = new.id
    and status not in ('completed', 'failed', 'cancelled');
  return new;
end;
$$;

drop trigger if exists devices_disable_render_worker_when_inactive on licensing.devices;
create trigger devices_disable_render_worker_when_inactive
after update of status on licensing.devices
for each row
when (old.status is distinct from new.status)
execute function licensing.render_disable_worker_when_device_inactive();

create or replace function licensing.purge_render_queue(terminal_retention_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  deleted_jobs integer := 0;
begin
  if terminal_retention_days < 1 then
    raise exception 'invalid_retention';
  end if;
  delete from licensing.render_jobs
  where status in ('completed', 'failed', 'cancelled')
    and finished_at < now() - make_interval(days => terminal_retention_days);
  get diagnostics deleted_jobs = row_count;
  return jsonb_build_object('renderJobs', deleted_jobs);
end;
$$;

alter table licensing.render_workers enable row level security;
alter table licensing.render_workers force row level security;
alter table licensing.render_jobs enable row level security;
alter table licensing.render_jobs force row level security;

revoke all on licensing.render_workers from public, anon, authenticated;
revoke all on licensing.render_jobs from public, anon, authenticated;

revoke all on function licensing.render_relative_path_is_valid(text, text)
  from public, anon, authenticated;
revoke all on function licensing.render_outputs_are_valid(jsonb)
  from public, anon, authenticated;
revoke all on function licensing.render_result_outputs_are_valid(jsonb)
  from public, anon, authenticated;
revoke all on function licensing.render_worker_is_accepting(uuid)
  from public, anon, authenticated;
revoke all on function licensing.render_device_context_is_active(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function licensing.render_refresh_queue_states(uuid)
  from public, anon, authenticated;
revoke all on function licensing.render_touch_worker(
  uuid, uuid, uuid, uuid, boolean, boolean, boolean, text, text, text,
  integer, text, integer
) from public, anon, authenticated;
revoke all on function licensing.render_create_job(
  uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text, jsonb
) from public, anon, authenticated;
revoke all on function licensing.render_claim_job(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function licensing.render_heartbeat_job(
  uuid, uuid, uuid, uuid, uuid, boolean, uuid, bigint, integer, text,
  text, text, text, boolean, text, text
) from public, anon, authenticated;
revoke all on function licensing.render_finish_job(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) from public, anon, authenticated;
revoke all on function licensing.render_cancel_job(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function licensing.render_reassign_job(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function licensing.render_disable_worker_when_device_inactive()
  from public, anon, authenticated;
revoke all on function licensing.purge_render_queue(integer)
  from public, anon, authenticated;

grant all privileges on licensing.render_workers to service_role;
grant all privileges on licensing.render_jobs to service_role;
grant execute on function licensing.render_relative_path_is_valid(text, text) to service_role;
grant execute on function licensing.render_outputs_are_valid(jsonb) to service_role;
grant execute on function licensing.render_result_outputs_are_valid(jsonb) to service_role;
grant execute on function licensing.render_worker_is_accepting(uuid) to service_role;
grant execute on function licensing.render_device_context_is_active(uuid, uuid, uuid) to service_role;
grant execute on function licensing.render_refresh_queue_states(uuid) to service_role;
grant execute on function licensing.render_touch_worker(
  uuid, uuid, uuid, uuid, boolean, boolean, boolean, text, text, text,
  integer, text, integer
) to service_role;
grant execute on function licensing.render_create_job(
  uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text, jsonb
) to service_role;
grant execute on function licensing.render_claim_job(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) to service_role;
grant execute on function licensing.render_heartbeat_job(
  uuid, uuid, uuid, uuid, uuid, boolean, uuid, bigint, integer, text,
  text, text, text, boolean, text, text
) to service_role;
grant execute on function licensing.render_finish_job(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) to service_role;
grant execute on function licensing.render_cancel_job(uuid, uuid, uuid, uuid) to service_role;
grant execute on function licensing.render_reassign_job(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function licensing.render_disable_worker_when_device_inactive() to service_role;
grant execute on function licensing.purge_render_queue(integer) to service_role;
