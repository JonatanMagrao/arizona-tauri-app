import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RENDER_ERROR_CODES,
  RENDER_RECIPE,
  RenderContractError,
  relativePath,
  renderHistoryCursorTimestamp,
  renderOutputsValue,
  renderResultOutputsValue,
  workerAvailabilityValue,
  workerStatusCodeValue,
} from "../supabase/functions/_shared/render-queue-contract.ts";

const validOutputs = [
  {
    kind: "mov",
    comp: "EXPORT",
    template: "PROXY",
    destinationRelativePath: "JOB/OUT/RENDER/MOV/projeto.mov",
    replaceExisting: true,
    existingFingerprint: "size:10;mtime:123",
  },
  {
    kind: "mp4",
    comp: "EXPORT_MP4",
    template: "MP4",
    destinationRelativePath: "JOB/OUT/RENDER/MP4/projeto.mp4",
    replaceExisting: false,
  },
];

test("history cursors preserve PostgreSQL microseconds without accepting raw filters", () => {
  const timestamp = "2026-08-18T12:00:00.123456+00:00";
  assert.equal(renderHistoryCursorTimestamp(timestamp, "invalid_cursor"), timestamp);
  for (const invalid of [
    "2026-02-30T12:00:00.000000Z",
    "2026-08-18 12:00:00Z",
    "2026-08-18T12:00:00.000000Z,id.gt.0",
    "2026-08-18T25:00:00Z",
  ]) {
    assert.throws(
      () => renderHistoryCursorTimestamp(invalid, "invalid_cursor"),
      (error) => error instanceof RenderContractError && error.code === "invalid_cursor",
    );
  }
});

test("accepts MOV, MP4, or both only through the closed render profiles", () => {
  assert.equal(RENDER_RECIPE, "arizona-render-v1");
  assert.deepEqual(renderOutputsValue([validOutputs[0]]), [validOutputs[0]]);
  assert.deepEqual(renderOutputsValue([validOutputs[1]]), [validOutputs[1]]);
  assert.deepEqual(renderOutputsValue(validOutputs), validOutputs);
  assert.deepEqual(renderOutputsValue([validOutputs[1], validOutputs[0]]), validOutputs);
  assert.throws(
    () => renderOutputsValue([]),
    (error) => error instanceof RenderContractError && error.code === "invalid_render_outputs",
  );
  assert.throws(
    () => renderOutputsValue([validOutputs[0], { ...validOutputs[0] }]),
    (error) => error instanceof RenderContractError && error.code === "invalid_render_outputs",
  );
  assert.throws(
    () => renderOutputsValue([...validOutputs, { ...validOutputs[0] }]),
    (error) => error instanceof RenderContractError && error.code === "invalid_render_outputs",
  );
  assert.throws(
    () => renderOutputsValue([{ ...validOutputs[0], template: "Lossless" }, validOutputs[1]]),
    (error) => error instanceof RenderContractError && error.code === "invalid_render_outputs",
  );
  assert.throws(
    () => renderOutputsValue([{ ...validOutputs[0], executable: "cmd.exe" }, validOutputs[1]]),
    (error) => error instanceof RenderContractError && error.code === "invalid_render_outputs",
  );
});

test("normalizes relative Drive paths and rejects traversal or local roots", () => {
  assert.equal(
    relativePath("CLIENTE\\JOB\\projeto.aep", ".aep", "invalid_path"),
    "CLIENTE/JOB/projeto.aep",
  );
  for (const path of [
    "C:/CLIENTE/JOB/projeto.aep",
    "/CLIENTE/JOB/projeto.aep",
    "CLIENTE/../JOB/projeto.aep",
    "CLIENTE//JOB/projeto.aep",
    "CLIENTE/JOB:alternativo/projeto.aep",
    "CLIENTE/JOB. /projeto.aep",
    "CLIENTE/JOB/projeto.txt",
  ]) {
    assert.throws(
      () => relativePath(path, ".aep", "invalid_path"),
      (error) => error instanceof RenderContractError && error.code === "invalid_path",
    );
  }
});

test("result metadata is structured and never accepts stdout or arbitrary fields", () => {
  const result = [
    {
      kind: "mov",
      destinationRelativePath: "JOB/OUT/RENDER/MOV/projeto.mov",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    },
    {
      kind: "mp4",
      destinationRelativePath: "JOB/OUT/RENDER/MP4/projeto.mp4",
      sizeBytes: 11,
      sha256: "b".repeat(64),
    },
  ];
  assert.deepEqual(renderResultOutputsValue([result[0]]), [result[0]]);
  assert.deepEqual(renderResultOutputsValue([result[1]]), [result[1]]);
  assert.deepEqual(renderResultOutputsValue(result), result);
  assert.deepEqual(renderResultOutputsValue([result[1], result[0]]), result);
  assert.throws(
    () => renderResultOutputsValue([]),
    (error) => error instanceof RenderContractError && error.code === "invalid_result_outputs",
  );
  assert.throws(
    () => renderResultOutputsValue([result[0], { ...result[0] }]),
    (error) => error instanceof RenderContractError && error.code === "invalid_result_outputs",
  );
  assert.throws(
    () => renderResultOutputsValue([{ ...result[0], stdout: "technical output" }, result[1]]),
    (error) => error instanceof RenderContractError && error.code === "invalid_result_outputs",
  );
});

test("worker health and render failures use finite allowlists", () => {
  assert.equal(workerAvailabilityValue("degraded", "available"), "degraded");
  assert.equal(workerStatusCodeValue("after_effects_open"), "after_effects_open");
  assert.equal(
    workerStatusCodeValue("publication_recovery_pending"),
    "publication_recovery_pending",
  );
  assert.throws(() => workerStatusCodeValue("powershell_failed"), RenderContractError);
  assert.ok(RENDER_ERROR_CODES.includes("sync_timeout"));
  assert.ok(RENDER_ERROR_CODES.includes("lease_lost"));
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  const workersStart = migration.indexOf("create table licensing.render_workers (");
  const workersEnd = migration.indexOf("create table licensing.render_jobs (", workersStart);
  assert.ok(workersStart >= 0 && workersEnd > workersStart);
  assert.match(
    migration.slice(workersStart, workersEnd),
    /'publication_recovery_pending'/u,
  );
});

test("render queue action limits stay within the shared rate limiter contract", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  const configuredLimits = [...source.matchAll(/\b(?:status|history|set_availability|create_job|claim|heartbeat|finish|cancel|reassign):\s*(\d+)/g)]
    .map((match) => Number(match[1]));

  assert.equal(configuredLimits.length, 9);
  assert.ok(configuredLimits.every((limit) => Number.isInteger(limit) && limit >= 1 && limit <= 1000));
});

test("render history preserves member requests, device execution, and stable keyset pagination", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /"history"/u);
  assert.match(source, /requester_member_id\.eq\.\$\{context\.member\.id\}/u);
  assert.match(source, /target_worker_device_id\.eq\.\$\{context\.device\.id\}/u);
  assert.match(
    source,
    /created_at\.lt\.\$\{cursor\.createdAt\}[\s\S]*?created_at\.eq\.\$\{cursor\.createdAt\}[\s\S]*?id\.lt\.\$\{cursor\.id\}/u,
  );
  assert.match(source, /\.order\("created_at", \{ ascending: false \}\)[\s\S]*?\.order\("id", \{ ascending: false \}\)/u);

  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260818170000_render_queue_history_indexes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /organization_id,[\s\S]*?requester_member_id,[\s\S]*?created_at desc,[\s\S]*?id desc/iu);
  assert.match(migration, /organization_id,[\s\S]*?target_worker_device_id,[\s\S]*?created_at desc,[\s\S]*?id desc/iu);
});

test("migration locks the queue behind forced RLS and atomic RPCs", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table licensing\.render_workers force row level security/i);
  assert.match(migration, /alter table licensing\.render_jobs force row level security/i);
  assert.match(migration, /render_jobs_one_active_per_target_uidx/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /render_claim_job/i);
  assert.match(migration, /render_heartbeat_job/i);
  assert.match(migration, /render_finish_job/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /stdout|stderr/i);
});

test("concurrent create retries share the same idempotency namespace lock", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  const createStart = migration.indexOf("create or replace function licensing.render_create_job(");
  const createEnd = migration.indexOf(
    "create or replace function licensing.render_claim_job(",
    createStart,
  );
  assert.ok(createStart >= 0 && createEnd > createStart);
  const createSource = migration.slice(createStart, createEnd);
  const lockIndex = createSource.indexOf("pg_advisory_xact_lock(hashtextextended(");
  const lookupIndex = createSource.indexOf("select * into existing_job");
  const insertIndex = createSource.indexOf("insert into licensing.render_jobs");
  assert.ok(lockIndex >= 0, "create_job must serialize concurrent uses of the same key");
  assert.ok(lockIndex < lookupIndex, "idempotency lock must precede the existing-job lookup");
  assert.ok(lookupIndex < insertIndex, "existing job must be returned before any insert");
  assert.match(
    createSource,
    /p_requester_device_id::text\s*\|\|\s*':'\s*\|\|\s*p_idempotency_key/u,
  );
});

test("a new job is serialized with the target worker availability change", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260811230000_render_create_requires_available_worker.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const idempotentReturnIndex = migration.indexOf("return existing_job.id;");
  const workerLookupIndex = migration.indexOf("select worker.* into target_worker");
  const workerLockIndex = migration.indexOf("for update of worker;");
  const acceptingIndex = migration.indexOf(
    "not licensing.render_worker_is_accepting(p_target_worker_device_id)",
  );
  const unavailableIndex = migration.indexOf("render_worker_not_available");
  const pathLockIndex = migration.indexOf("'render-output:'");
  const insertIndex = migration.indexOf("insert into licensing.render_jobs");

  assert.ok(idempotentReturnIndex >= 0, "an already-created job must remain retryable");
  assert.ok(
    idempotentReturnIndex < workerLookupIndex,
    "idempotent retries must return before checking current worker availability",
  );
  assert.ok(workerLookupIndex < workerLockIndex, "the selected worker row must be locked");
  assert.ok(workerLockIndex < acceptingIndex, "availability must be checked under the row lock");
  assert.ok(acceptingIndex < unavailableIndex);
  assert.ok(unavailableIndex < pathLockIndex);
  assert.ok(pathLockIndex < insertIndex, "an unavailable target must be rejected before insert");
  assert.match(
    migration,
    /device\.organization_id = p_organization_id[\s\S]*?device\.status = 'active'[\s\S]*?for update of worker/iu,
  );
  assert.match(
    migration,
    /p_outputs, 'waiting_for_sync', 'waiting_for_sync'/u,
  );
});

test("queue assignments validate the locked worker with wall-clock freshness", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260811240000_render_queue_worker_locking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const createStart = migration.indexOf(
    "create or replace function licensing.render_create_job(",
  );
  const claimStart = migration.indexOf(
    "create or replace function licensing.render_claim_job(",
    createStart,
  );
  const reassignStart = migration.indexOf(
    "create or replace function licensing.render_reassign_job(",
    claimStart,
  );
  assert.ok(createStart >= 0 && claimStart > createStart && reassignStart > claimStart);

  const createSource = migration.slice(createStart, claimStart);
  const claimSource = migration.slice(claimStart, reassignStart);
  const reassignSource = migration.slice(reassignStart);
  const directAvailabilityPattern = /device\.status = 'active'[\s\S]*?member\.status = 'active'[\s\S]*?organization\.status = 'active'[\s\S]*?not target_worker\.enabled[\s\S]*?target_worker\.reported_availability <> 'available'[\s\S]*?target_worker\.status_code is not null[\s\S]*?target_worker\.protocol_version <> 1[\s\S]*?target_worker\.render_recipe <> 'arizona-render-v1'[\s\S]*?target_worker\.heartbeat_at < clock_timestamp\(\) - interval '45 seconds'/iu;

  assert.match(
    createSource,
    /select worker\.\* into target_worker\s+from licensing\.render_workers worker\s+where worker\.device_id = p_target_worker_device_id\s+and worker\.organization_id = p_organization_id\s+for update;/iu,
  );
  assert.match(
    createSource,
    /device\.organization_id = target_worker\.organization_id[\s\S]*?device\.member_id = target_worker\.member_id[\s\S]*?member\.organization_id = target_worker\.organization_id/iu,
  );
  assert.match(createSource, directAvailabilityPattern);
  assert.match(reassignSource, directAvailabilityPattern);
  assert.match(
    reassignSource,
    /select worker\.\* into target_worker\s+from licensing\.render_workers worker\s+where worker\.device_id = p_target_worker_device_id\s+and worker\.organization_id = p_organization_id\s+for update;/iu,
  );
  assert.doesNotMatch(createSource, /render_worker_is_accepting/iu);
  assert.doesNotMatch(reassignSource, /render_worker_is_accepting/iu);

  assert.match(
    claimSource,
    /select \* into worker\s+from licensing\.render_workers\s+where device_id = p_device_id\s+for update;/iu,
  );
  assert.match(
    claimSource,
    /device\.organization_id = worker\.organization_id[\s\S]*?device\.member_id = worker\.member_id[\s\S]*?member\.organization_id = worker\.organization_id/iu,
  );
  assert.match(
    claimSource,
    /worker\.organization_id <> p_organization_id[\s\S]*?worker\.member_id <> p_member_id[\s\S]*?worker\.worker_session_id <> p_worker_session_id[\s\S]*?device\.status = 'active'[\s\S]*?member\.status = 'active'[\s\S]*?organization\.status = 'active'[\s\S]*?not worker\.enabled[\s\S]*?worker\.reported_availability <> 'available'[\s\S]*?worker\.status_code is not null[\s\S]*?worker\.protocol_version <> 1[\s\S]*?worker\.render_recipe <> 'arizona-render-v1'[\s\S]*?worker\.heartbeat_at < clock_timestamp\(\) - interval '45 seconds'/iu,
  );
  assert.doesNotMatch(claimSource, /render_worker_is_accepting/iu);
});

test("create, claim and reassign keep worker-before-job lock ordering", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260811240000_render_queue_worker_locking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const createStart = migration.indexOf(
    "create or replace function licensing.render_create_job(",
  );
  const claimStart = migration.indexOf(
    "create or replace function licensing.render_claim_job(",
    createStart,
  );
  const reassignStart = migration.indexOf(
    "create or replace function licensing.render_reassign_job(",
    claimStart,
  );
  const createSource = migration.slice(createStart, claimStart);
  const claimSource = migration.slice(claimStart, reassignStart);
  const reassignSource = migration.slice(reassignStart);

  const idempotentReturnIndex = createSource.indexOf("return existing_job.id;");
  const createWorkerLockIndex = createSource.indexOf("select worker.* into target_worker");
  const outputLockIndex = createSource.indexOf("'render-output:'");
  const createFreshnessIndexes = [...createSource.matchAll(
    /target_worker\.heartbeat_at < clock_timestamp\(\) - interval '45 seconds'/gu,
  )].map((match) => match.index);
  const insertIndex = createSource.indexOf("insert into licensing.render_jobs");
  assert.ok(idempotentReturnIndex < createWorkerLockIndex);
  assert.ok(createWorkerLockIndex < outputLockIndex);
  assert.equal(createFreshnessIndexes.length, 2);
  assert.ok(outputLockIndex < createFreshnessIndexes[1]);
  assert.ok(createFreshnessIndexes[1] < insertIndex);

  const claimWorkerLockIndex = claimSource.indexOf("select * into worker");
  const claimRefreshIndex = claimSource.indexOf("render_refresh_queue_states");
  const heartbeatIndex = claimSource.indexOf("set heartbeat_at = clock_timestamp()");
  const activeJobIndex = claimSource.indexOf("select * into active_job");
  assert.ok(claimWorkerLockIndex >= 0);
  assert.ok(claimWorkerLockIndex < claimRefreshIndex);
  assert.ok(claimRefreshIndex < heartbeatIndex);
  assert.ok(heartbeatIndex < activeJobIndex);
  assert.match(claimSource, /active_job\.lease_expires_at > clock_timestamp\(\)/u);
  assert.match(
    claimSource,
    /next_expiry := clock_timestamp\(\) \+ interval '45 seconds'/u,
  );

  const reassignWorkerLockIndex = reassignSource.indexOf(
    "select worker.* into target_worker",
  );
  const reassignUnavailableIndex = reassignSource.indexOf(
    "raise exception 'render_worker_not_available'",
  );
  const reassignRefreshIndex = reassignSource.indexOf("render_refresh_queue_states");
  const jobLockIndex = reassignSource.indexOf(
    "select * into job from licensing.render_jobs where id = p_job_id for update",
  );
  const reassignFreshnessIndexes = [...reassignSource.matchAll(
    /target_worker\.heartbeat_at < clock_timestamp\(\) - interval '45 seconds'/gu,
  )].map((match) => match.index);
  const reassignUpdateIndex = reassignSource.indexOf("update licensing.render_jobs");
  assert.ok(reassignWorkerLockIndex >= 0);
  assert.ok(reassignWorkerLockIndex < reassignUnavailableIndex);
  assert.ok(reassignUnavailableIndex < reassignRefreshIndex);
  assert.ok(reassignRefreshIndex < jobLockIndex);
  assert.equal(reassignFreshnessIndexes.length, 2);
  assert.ok(jobLockIndex < reassignFreshnessIndexes[1]);
  assert.ok(reassignFreshnessIndexes[1] < reassignUpdateIndex);
});

test("create idempotency survives reassignment to a known target", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260811240000_render_queue_worker_locking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const createStart = migration.indexOf(
    "create or replace function licensing.render_create_job(",
  );
  const claimStart = migration.indexOf(
    "create or replace function licensing.render_claim_job(",
    createStart,
  );
  const createSource = migration.slice(createStart, claimStart);

  assert.match(
    createSource,
    /existing_job\.target_worker_device_id <> p_target_worker_device_id[\s\S]*?p_target_worker_device_id = any\(existing_job\.previous_target_worker_device_ids\)/iu,
  );
  assert.match(createSource, /raise exception 'render_idempotency_conflict'/u);
  assert.ok(
    createSource.indexOf("return existing_job.id;")
      < createSource.indexOf("select worker.* into target_worker"),
  );
});

test("nonterminal jobs reserve output destinations across workers", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  const createStart = migration.indexOf("create or replace function licensing.render_create_job(");
  const createEnd = migration.indexOf(
    "create or replace function licensing.render_claim_job(",
    createStart,
  );
  assert.ok(createStart >= 0 && createEnd > createStart);
  const createSource = migration.slice(createStart, createEnd);
  const idempotentReturnIndex = createSource.indexOf("return existing_job.id;");
  const pathLockIndex = createSource.indexOf("'render-output:'");
  const conflictIndex = createSource.indexOf("render_output_destination_in_use");
  const insertIndex = createSource.indexOf("insert into licensing.render_jobs");
  assert.ok(idempotentReturnIndex >= 0);
  assert.ok(idempotentReturnIndex < pathLockIndex, "same-job retry must return before path locking");
  assert.ok(pathLockIndex < conflictIndex, "path locks must precede the authoritative conflict check");
  assert.ok(conflictIndex < insertIndex, "destination conflicts must be rejected before insert");
  assert.match(
    createSource,
    /select distinct lower\(requested_output\.value ->> 'destinationRelativePath'\)[\s\S]*?order by 1[\s\S]*?pg_advisory_xact_lock/iu,
  );
  assert.match(
    createSource,
    /job\.organization_id = p_organization_id[\s\S]*?job\.status not in \('completed', 'failed', 'cancelled'\)[\s\S]*?jsonb_array_elements\(job\.outputs\)[\s\S]*?jsonb_array_elements\(p_outputs\)[\s\S]*?for update/iu,
  );
  assert.match(
    migration,
    /render_jobs_org_nonterminal_destinations_idx[\s\S]*?where status not in \('completed', 'failed', 'cancelled'\)/iu,
  );

  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.match(/render_output_destination_in_use/gu)?.length,
    2,
    "the database code must be both allowlisted and translated",
  );
  assert.match(
    source,
    /Outro render já está usando um dos arquivos finais escolhidos\./u,
  );
});

test("a committed cancellation wins the race against completed finish", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811220000_render_output_selection.sql", import.meta.url),
    "utf8",
  );
  const finishStart = migration.indexOf(
    "create or replace function licensing.render_finish_job(",
  );
  const finishEnd = migration.indexOf("revoke all on function", finishStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart);
  const finishSource = migration.slice(finishStart, finishEnd);
  const jobLockIndex = finishSource.indexOf(
    "select * into job from licensing.render_jobs where id = p_job_id for update;",
  );
  const cancelGuardIndex = finishSource.indexOf(
    "if p_outcome = 'completed' and job.cancel_requested then",
  );
  const mutationIndex = finishSource.indexOf("update licensing.render_jobs");
  assert.ok(jobLockIndex >= 0, "finish must lock the authoritative job row");
  assert.ok(jobLockIndex < cancelGuardIndex, "cancel must be checked after acquiring the job lock");
  assert.ok(cancelGuardIndex < mutationIndex, "cancelled completion must fail before any mutation");
  assert.match(
    finishSource,
    /if p_outcome = 'completed' and job\.cancel_requested then\s+raise exception 'render_cancel_requested';\s+end if;/u,
  );

  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.match(/render_cancel_requested/gu)?.length,
    2,
    "the cancellation race code must be both allowlisted and translated",
  );
  assert.match(
    source,
    /O cancelamento deste render já foi solicitado\./u,
  );
});

test("selected output migration preserves profiles and requires exact finish results", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811220000_render_output_selection.sql", import.meta.url),
    "utf8",
  );
  const outputsStart = migration.indexOf(
    "create or replace function licensing.render_outputs_are_valid(",
  );
  const resultsStart = migration.indexOf(
    "create or replace function licensing.render_result_outputs_are_valid(",
    outputsStart,
  );
  const finishStart = migration.indexOf(
    "create or replace function licensing.render_finish_job(",
    resultsStart,
  );
  const finishEnd = migration.indexOf("revoke all on function", finishStart);
  assert.ok(outputsStart >= 0 && resultsStart > outputsStart);
  assert.ok(finishStart > resultsStart && finishEnd > finishStart);

  const outputsSource = migration.slice(outputsStart, resultsStart);
  const resultsSource = migration.slice(resultsStart, finishStart);
  const finishSource = migration.slice(finishStart, finishEnd);
  for (const validatorSource of [outputsSource, resultsSource]) {
    assert.match(validatorSource, /jsonb_array_length\(outputs_value\) not between 1 and 2/iu);
    assert.match(validatorSource, /mov_count > 1 or mp4_count > 1/iu);
    assert.match(
      validatorSource,
      /count\(distinct lower\(output_item\.value ->> 'destinationRelativePath'\)\)/u,
    );
  }
  assert.match(outputsSource, /'EXPORT'[\s\S]*?'PROXY'[\s\S]*?'\.mov'/u);
  assert.match(outputsSource, /'EXPORT_MP4'[\s\S]*?'MP4'[\s\S]*?'\.mp4'/u);
  assert.match(
    finishSource,
    /jsonb_array_length\(p_result_outputs\) <> jsonb_array_length\(job\.outputs\)/u,
  );
  assert.equal(
    finishSource.match(/from jsonb_array_elements\(p_result_outputs\) result_output/gu)?.length,
    2,
    "finish must compare result-to-request and request-to-result",
  );
  assert.equal(
    finishSource.match(/from jsonb_array_elements\(job\.outputs\) expected_output/gu)?.length,
    2,
    "finish must compare both manifest directions",
  );
});

test("non-health actions cannot renew the operational worker heartbeat", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  const touchStart = migration.indexOf("create or replace function licensing.render_touch_worker(");
  const touchEnd = migration.indexOf(
    "create or replace function licensing.render_create_job(",
    touchStart,
  );
  assert.ok(touchStart >= 0 && touchEnd > touchStart);
  const touchSource = migration.slice(touchStart, touchEnd);
  assert.match(
    touchSource,
    /heartbeat_at\s*=\s*case\s+when\s+p_update_health\s+then\s+now\(\)\s+else\s+heartbeat_at\s+end/iu,
  );
  const steadyUpdateStart = touchSource.indexOf(
    "update licensing.render_workers\n  set\n    enabled = case",
  );
  assert.ok(steadyUpdateStart >= 0);
  assert.doesNotMatch(
    touchSource.slice(steadyUpdateStart),
    /heartbeat_at\s*=\s*now\(\)\s*\n\s*where device_id/iu,
  );

  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  for (const [handler, nextHandler] of [
    ["handleStatus", "handleSetAvailability"],
    ["handleCreateJob", "handleClaim"],
    ["handleCancel", "handleReassign"],
    ["handleReassign", "contractErrorResponse"],
  ]) {
    const start = source.indexOf(`async function ${handler}(`);
    const end = source.indexOf(`function ${nextHandler}(`, start);
    assert.ok(start >= 0 && end > start, `${handler} source must be present`);
    assert.match(source.slice(start, end), /updateHealth:\s*false/u);
  }
});

test("Edge Function does not upload or print technical diagnostics", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/u);
  assert.doesNotMatch(source, /stdout|stderr/u);
  assert.match(source, /requester_member_id\.eq/);
  assert.match(source, /target_worker_device_id\.eq/);
});

test("job region is the safe second token of the AEP file stem", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  const declaration = source.match(
    /function projectRegionFromName\(value: unknown\): string \| null \{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(declaration, "the project region parser must be present");

  const runnableDeclaration = declaration.replace(
    "(value: unknown): string | null",
    "(value)",
  );
  const projectRegionFromName = Function(`return (${runnableDeclaration});`)();

  assert.equal(projectRegionFromName("15181_RJ_oferta.aep"), "RJ");
  assert.equal(projectRegionFromName("Z:\\Jobs\\15181_cur_oferta.AEP"), "CUR");
  assert.equal(projectRegionFromName("/mnt/jobs/15181_BH_oferta.aep"), "BH");
  assert.equal(projectRegionFromName("15181__oferta.aep"), null);
  assert.equal(projectRegionFromName("/mnt/cliente/nome-do-projeto.aep"), null);
  assert.equal(projectRegionFromName("15181_RJ INTERIOR_oferta.aep"), null);
  assert.equal(projectRegionFromName("15181_RJ/arquivo-tecnico.aep"), null);

  const formatJobStart = source.indexOf("function formatJob(");
  const formatJobEnd = source.indexOf("async function loadStatus(", formatJobStart);
  assert.ok(formatJobStart >= 0 && formatJobEnd > formatJobStart);
  const formatJobSource = source.slice(formatJobStart, formatJobEnd);
  assert.match(formatJobSource, /const projectRegion = projectRegionFromName\(row\.project_name\)/u);
  assert.equal(
    formatJobSource.match(/\bprojectRegion,/gu)?.length,
    2,
    "the safe region code must be exposed in both the manifest and job summary",
  );
});

test("status and action responses load their authoritative job directly", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /nextJobResult/u);
  assert.match(source, /recoverableJobResult/u);
  assert.match(source, /target_worker_device_id", context\.device\.id/u);
  assert.match(source, /nextJob,\s*\n\s*recoverableJob,\s*\n\s*\};/u);

  const loadOneStart = source.indexOf("async function loadOneJob(");
  const loadOneEnd = source.indexOf("async function handleStatus(", loadOneStart);
  assert.ok(loadOneStart >= 0 && loadOneEnd > loadOneStart);
  const loadOneSource = source.slice(loadOneStart, loadOneEnd);
  assert.match(loadOneSource, /from\("render_jobs"\)/u);
  assert.match(loadOneSource, /eq\("organization_id", context\.organization\.id\)/u);
  assert.match(loadOneSource, /eq\("id", jobId\)/u);
  assert.match(loadOneSource, /requester_member_id/u);
  assert.match(loadOneSource, /target_worker_device_id/u);
  assert.match(loadOneSource, /previous_target_worker_device_ids/u);
  assert.match(loadOneSource, /previousTargetDeviceIds\.includes\(context\.device\.id\)/u);
  assert.doesNotMatch(loadOneSource, /loadStatus\(/u);

  const statusStart = source.indexOf("async function handleStatus(");
  const statusEnd = source.indexOf("async function handleSetAvailability(", statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  const statusSource = source.slice(statusStart, statusEnd);
  assert.match(statusSource, /optionalUuid\(body\.jobId/u);
  assert.match(statusSource, /loadOneJob\(admin, context, requestedJobId\)/u);
  assert.match(statusSource, /\{ \.\.\.status, job \}/u);
});

test("status exposes only the current session's live active job for claim recovery", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  const loadStatusStart = source.indexOf("async function loadStatus(");
  const loadStatusEnd = source.indexOf("async function directQueuePosition(", loadStatusStart);
  assert.ok(loadStatusStart >= 0 && loadStatusEnd > loadStatusStart);
  const loadStatusSource = source.slice(loadStatusStart, loadStatusEnd);
  assert.match(
    loadStatusSource,
    /eq\("target_worker_device_id", context\.device\.id\)[\s\S]*?eq\("claimed_worker_session_id", context\.workerSessionId\)[\s\S]*?in\("status", ACTIVE_STATUSES\)[\s\S]*?gt\("lease_expires_at", new Date\(\)\.toISOString\(\)\)/u,
  );
  assert.match(
    loadStatusSource,
    /const recoverableJob = recoverableJobRow\s*\? formatJob\(recoverableJobRow, membersById, devicesById, queuePositions\)\s*:\s*null/u,
  );
  assert.match(loadStatusSource, /nextJob,\s*\n\s*recoverableJob,/u);
});

test("render queue public labels use member names instead of hostnames", () => {
  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  const formatJobStart = source.indexOf("function formatJob(");
  const formatJobEnd = source.indexOf("async function loadStatus(", formatJobStart);
  const loadStatusEnd = source.indexOf("async function directQueuePosition(", formatJobEnd);
  const publicShapeSource = source.slice(formatJobStart, loadStatusEnd);

  assert.match(publicShapeSource, /requesterDeviceLabel: requesterMemberLabel/u);
  assert.match(publicShapeSource, /targetDeviceLabel: targetMemberLabel/u);
  assert.match(publicShapeSource, /deviceLabel: publicMemberName/u);
  assert.doesNotMatch(publicShapeSource, /deviceLabel: device\?\.device_label/u);
});

test("reassignment preserves only allowlisted previous targets for exact reconciliation", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260811160000_render_queue.sql", import.meta.url),
    "utf8",
  );
  const jobsStart = migration.indexOf("create table licensing.render_jobs (");
  const jobsEnd = migration.indexOf("create index render_workers_org_heartbeat_idx", jobsStart);
  assert.ok(jobsStart >= 0 && jobsEnd > jobsStart);
  const jobsSource = migration.slice(jobsStart, jobsEnd);
  assert.match(
    jobsSource,
    /previous_target_worker_device_ids uuid\[\] not null default '\{\}'::uuid\[\]/u,
  );
  assert.match(
    jobsSource,
    /not \(target_worker_device_id = any\(previous_target_worker_device_ids\)\)/u,
  );

  const reassignStart = migration.indexOf(
    "create or replace function licensing.render_reassign_job(",
  );
  const reassignEnd = migration.indexOf(
    "create or replace function licensing.render_disable_worker_when_device_inactive(",
    reassignStart,
  );
  assert.ok(reassignStart >= 0 && reassignEnd > reassignStart);
  const reassignSource = migration.slice(reassignStart, reassignEnd);
  assert.match(
    reassignSource,
    /previous_target_worker_device_ids\s*=\s*array_remove\([\s\S]*?array_append\(previous_target_worker_device_ids, target_worker_device_id\)[\s\S]*?p_target_worker_device_id[\s\S]*?target_worker_device_id\s*=\s*p_target_worker_device_id/iu,
  );

  const source = readFileSync(
    new URL("../supabase/functions/render-queue/index.ts", import.meta.url),
    "utf8",
  );
  const loadStatusStart = source.indexOf("async function loadStatus(");
  const loadStatusEnd = source.indexOf("async function directQueuePosition(", loadStatusStart);
  assert.ok(loadStatusStart >= 0 && loadStatusEnd > loadStatusStart);
  assert.doesNotMatch(
    source.slice(loadStatusStart, loadStatusEnd),
    /previous_target_worker_device_ids/u,
  );
});
