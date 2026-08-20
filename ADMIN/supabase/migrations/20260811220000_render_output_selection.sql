-- Allow each distributed render job to request MOV, MP4, or both while keeping
-- the recipe and result manifest closed to the two approved output profiles.

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
  if outputs_value is null
    or jsonb_typeof(outputs_value) is distinct from 'array'
  then
    return false;
  end if;
  if jsonb_array_length(outputs_value) not between 1 and 2 then
    return false;
  end if;

  for output_value in select value from jsonb_array_elements(outputs_value)
  loop
    if jsonb_typeof(output_value) is distinct from 'object' then
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
        jsonb_typeof(output_value -> 'existingFingerprint') is distinct from 'string'
        or length(output_value ->> 'existingFingerprint') not between 1 and 256
        or output_value ->> 'existingFingerprint' ~ '[[:cntrl:]]'
      )
    then
      return false;
    end if;

    output_kind := output_value ->> 'kind';
    if output_kind = 'mov' then
      if output_value ->> 'comp' is distinct from 'EXPORT'
        or output_value ->> 'template' is distinct from 'PROXY'
        or not licensing.render_relative_path_is_valid(
          output_value ->> 'destinationRelativePath',
          '.mov'
        )
      then
        return false;
      end if;
      mov_count := mov_count + 1;
    elsif output_kind = 'mp4' then
      if output_value ->> 'comp' is distinct from 'EXPORT_MP4'
        or output_value ->> 'template' is distinct from 'MP4'
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

  if mov_count > 1 or mp4_count > 1 then
    return false;
  end if;
  if (
    select count(distinct lower(output_item.value ->> 'destinationRelativePath'))
    from jsonb_array_elements(outputs_value) as output_item(value)
  ) <> jsonb_array_length(outputs_value) then
    return false;
  end if;

  return mov_count + mp4_count = jsonb_array_length(outputs_value);
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
  output_size numeric;
  mov_count integer := 0;
  mp4_count integer := 0;
begin
  if outputs_value is null then
    return true;
  end if;
  if jsonb_typeof(outputs_value) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(outputs_value) not between 1 and 2 then
    return false;
  end if;

  for output_value in select value from jsonb_array_elements(outputs_value)
  loop
    if jsonb_typeof(output_value) is distinct from 'object' then
      return false;
    end if;
    if exists (
      select 1
      from jsonb_object_keys(output_value) as key(value)
      where key.value not in ('kind', 'destinationRelativePath', 'sizeBytes', 'sha256')
    )
      or jsonb_typeof(output_value -> 'sizeBytes') is distinct from 'number'
      or jsonb_typeof(output_value -> 'sha256') is distinct from 'string'
      or coalesce(output_value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
    then
      return false;
    end if;

    output_size := (output_value ->> 'sizeBytes')::numeric;
    if output_size <= 0
      or output_size <> trunc(output_size)
      or output_size > 9007199254740991
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

  if mov_count > 1 or mp4_count > 1 then
    return false;
  end if;
  if (
    select count(distinct lower(output_item.value ->> 'destinationRelativePath'))
    from jsonb_array_elements(outputs_value) as output_item(value)
  ) <> jsonb_array_length(outputs_value) then
    return false;
  end if;

  return mov_count + mp4_count = jsonb_array_length(outputs_value);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
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
  if p_outcome = 'completed' and p_result_outputs is null then
    raise exception 'render_invalid_result_outputs';
  end if;
  if p_result_outputs is not null
    and not licensing.render_result_outputs_are_valid(p_result_outputs)
  then
    raise exception 'render_invalid_result_outputs';
  end if;
  -- A result manifest, when present, must be exactly the requested manifest:
  -- same count and the same unique kind/path pairs, regardless of order.
  if p_result_outputs is not null and (
    jsonb_array_length(p_result_outputs) <> jsonb_array_length(job.outputs)
    or exists (
      select 1
      from jsonb_array_elements(p_result_outputs) result_output
      where not exists (
        select 1
        from jsonb_array_elements(job.outputs) expected_output
        where expected_output ->> 'kind' = result_output ->> 'kind'
          and expected_output ->> 'destinationRelativePath'
            = result_output ->> 'destinationRelativePath'
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(job.outputs) expected_output
      where not exists (
        select 1
        from jsonb_array_elements(p_result_outputs) result_output
        where result_output ->> 'kind' = expected_output ->> 'kind'
          and result_output ->> 'destinationRelativePath'
            = expected_output ->> 'destinationRelativePath'
      )
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

revoke all on function licensing.render_outputs_are_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function licensing.render_result_outputs_are_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function licensing.render_finish_job(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function licensing.render_outputs_are_valid(jsonb) to service_role;
grant execute on function licensing.render_result_outputs_are_valid(jsonb) to service_role;
grant execute on function licensing.render_finish_job(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) to service_role;
