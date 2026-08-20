import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  errorResponse,
  handleOptions,
  jsonResponse,
  readJsonBody,
  requirePost,
} from "../_shared/http.ts";
import {
  createAdminClient,
  getAuthUser,
  requirePublishableKey,
} from "../_shared/supabase.ts";
import { licenseExpiryInstant, normalizeDailyAuthResetHour } from "../_shared/auth-cycle.ts";
import { normalizeFingerprint } from "../_shared/device-fingerprint.ts";
import { enforceRateLimit, RateLimitError } from "../_shared/security.ts";
import {
  optionalPositiveSafeInteger,
  optionalUuid,
  positiveSafeInteger,
  progressValue,
  recipeValue,
  relativePath,
  renderErrorCodeValue,
  RenderContractError,
  renderOutputsValue,
  renderHistoryCursorTimestamp,
  renderResultOutputsValue,
  requiredText,
  RENDER_PROTOCOL_VERSION,
  RENDER_RECIPE,
  sha256Value,
  stageValue,
  statusMessageValue,
  uuidValue,
  workerAvailabilityValue,
  workerStatusCodeValue,
  finishOutcomeValue,
  type RenderOutput,
  type RenderResultOutput,
  type WorkerAvailability,
} from "../_shared/render-queue-contract.ts";

type RenderQueueBody = Record<string, unknown> & {
  action?: unknown;
  installId?: unknown;
  deviceFingerprintHash?: unknown;
  workerSessionId?: unknown;
};

type QueueContext = {
  organization: {
    id: string;
    name: string;
  };
  member: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "user";
  };
  device: {
    id: string;
    installId: string;
    label: string | null;
  };
  workerSessionId: string;
};

const ACTIONS = [
  "status",
  "history",
  "set_availability",
  "create_job",
  "claim",
  "heartbeat",
  "finish",
  "cancel",
  "reassign",
] as const;
type QueueAction = typeof ACTIONS[number];

const PENDING_STATUSES = ["waiting_for_worker", "waiting_for_sync", "queued"];
const ACTIVE_STATUSES = ["claimed", "rendering", "publishing"];
const NONTERMINAL_STATUSES = [...PENDING_STATUSES, ...ACTIVE_STATUSES];
const HEARTBEAT_FRESH_MS = 45_000;

const ACTION_RATE_LIMITS: Record<QueueAction, number> = {
  status: 1000,
  history: 240,
  set_availability: 240,
  create_job: 60,
  claim: 600,
  heartbeat: 1000,
  finish: 240,
  cancel: 240,
  reassign: 120,
};

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new RenderContractError(code);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, code: string): boolean {
  if (value === undefined || value === null) return fallback;
  return booleanValue(value, code);
}

function integerValue(value: unknown, minimum: number, maximum: number, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RenderContractError(code);
  }
  return value;
}

function optionalAfterEffectsYear(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return integerValue(value, 2020, 2100, "invalid_after_effects_year");
}

function historyPageSize(value: unknown): number {
  if (value === undefined || value === null) return 50;
  return integerValue(value, 1, 100, "invalid_render_history_limit");
}

function historyCursor(body: RenderQueueBody): { createdAt: string; id: string } | null {
  const hasCreatedAt = body.beforeCreatedAt !== undefined && body.beforeCreatedAt !== null;
  const hasId = body.beforeId !== undefined && body.beforeId !== null;
  if (!hasCreatedAt && !hasId) return null;
  if (!hasCreatedAt || !hasId) throw new RenderContractError("invalid_render_history_cursor");

  return {
    createdAt: renderHistoryCursorTimestamp(
      body.beforeCreatedAt,
      "invalid_render_history_cursor",
    ),
    id: uuidValue(body.beforeId, "invalid_render_history_cursor"),
  };
}

function queueAction(value: unknown): QueueAction {
  if (!ACTIONS.includes(value as QueueAction)) throw new RenderContractError("invalid_render_action");
  return value as QueueAction;
}

function outputConflictCode(value: unknown, conflict: boolean): string | null {
  if (!conflict && (value === undefined || value === null || value === "")) return null;
  const code = requiredText(value, 64, "invalid_output_conflict_code");
  if (code !== "existing_output_found" && code !== "existing_output_changed") {
    throw new RenderContractError("invalid_output_conflict_code");
  }
  return code;
}

function idempotencyKey(value: unknown): string {
  const key = requiredText(value, 128, "invalid_idempotency_key");
  if (key.length < 8) throw new RenderContractError("invalid_idempotency_key");
  return key;
}

function projectNameValue(value: unknown): string {
  return requiredText(value, 255, "invalid_project_name");
}

function projectRegionFromName(value: unknown): string | null {
  const fileName = String(value || "").trim().split(/[\\/]/u).pop() || "";
  const stem = fileName.replace(/\.aep$/iu, "");
  const region = stem.split("_")[1]?.trim().toUpperCase() || "";
  return region && region.length <= 32 && /^[\p{L}\p{N}-]+$/u.test(region) ? region : null;
}

function protocolVersionValue(value: unknown): number {
  if (value === undefined || value === null) return RENDER_PROTOCOL_VERSION;
  const version = integerValue(value, 1, 1, "unsupported_worker_protocol");
  return version;
}

function recipeOrDefault(value: unknown): typeof RENDER_RECIPE {
  return value === undefined || value === null ? RENDER_RECIPE : recipeValue(value);
}

async function rpc(
  admin: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await admin.schema("licensing").rpc(name, parameters);
  if (error) throw new Error(error.message || `render_rpc_${name}_failed`);
  return data;
}

async function authorizeQueueRequest(
  req: Request,
  admin: SupabaseClient,
  body: RenderQueueBody,
): Promise<QueueContext> {
  const installId = requiredText(body.installId, 128, "missing_install_id");
  const workerSessionId = uuidValue(body.workerSessionId, "missing_worker_session_id");
  const incomingFingerprint = sha256Value(
    body.deviceFingerprintHash,
    "device_identity_required",
  );
  const user = await getAuthUser(req);

  const { data: members, error: memberError } = await admin
    .schema("licensing")
    .from("members")
    .select("id,organization_id,name,email,role,status")
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .limit(2);
  if (memberError) throw memberError;
  if (!members || members.length !== 1) {
    throw new RenderContractError("member_not_authorized");
  }
  const member = members[0];

  const { data: organization, error: organizationError } = await admin
    .schema("licensing")
    .from("organizations")
    .select("id,name,status,license_expires_on,daily_auth_reset_hour")
    .eq("id", member.organization_id)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization || organization.status !== "active") {
    throw new RenderContractError("organization_not_active");
  }
  const resetHour = normalizeDailyAuthResetHour(organization.daily_auth_reset_hour);
  const expiresAt = licenseExpiryInstant(organization.license_expires_on, resetHour);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new RenderContractError("license_expired");
  }

  const { data: device, error: deviceError } = await admin
    .schema("licensing")
    .from("devices")
    .select("id,install_id,device_label,device_fingerprint_hash,status")
    .eq("organization_id", member.organization_id)
    .eq("member_id", member.id)
    .eq("install_id", installId)
    .maybeSingle();
  if (deviceError) throw deviceError;
  if (!device || device.status !== "active") {
    throw new RenderContractError("device_not_active");
  }
  const storedFingerprint = normalizeFingerprint(device.device_fingerprint_hash).toLowerCase();
  if (!storedFingerprint || storedFingerprint !== incomingFingerprint) {
    throw new RenderContractError("device_not_active");
  }

  return {
    organization: { id: organization.id, name: organization.name },
    member: {
      id: member.id,
      name: String(member.name || member.email || "Usuário"),
      email: String(member.email || user.email),
      role: member.role,
    },
    device: {
      id: device.id,
      installId,
      label: device.device_label || null,
    },
    workerSessionId,
  };
}

async function touchWorker(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
  options: {
    setEnabled: boolean;
    enabled: boolean;
    updateHealth: boolean;
    availability: WorkerAvailability;
    statusCode: string | null;
    statusMessage: string | null;
  },
) {
  return await rpc(admin, "render_touch_worker", {
    p_organization_id: context.organization.id,
    p_member_id: context.member.id,
    p_device_id: context.device.id,
    p_worker_session_id: context.workerSessionId,
    p_set_enabled: options.setEnabled,
    p_enabled: options.enabled,
    p_update_health: options.updateHealth,
    p_reported_availability: options.availability,
    p_status_code: options.statusCode,
    p_status_message: options.statusMessage,
    p_protocol_version: protocolVersionValue(body.protocolVersion),
    p_render_recipe: recipeOrDefault(body.recipe),
    p_after_effects_year: optionalAfterEffectsYear(body.afterEffectsYear),
  });
}

function parseDateMs(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function memberLabel(member: Record<string, unknown> | undefined): string {
  return String(member?.name || member?.email || "Usuário");
}

function effectiveWorkerState(
  worker: Record<string, unknown>,
  currentJobId: string | null,
  nowMs: number,
) {
  const enabled = worker.enabled === true;
  const fresh = nowMs - parseDateMs(worker.heartbeat_at) <= HEARTBEAT_FRESH_MS;
  const reported = String(worker.reported_availability || "unavailable");
  const acceptingJobs = enabled
    && fresh
    && reported === "available"
    && !worker.status_code
    && Number(worker.protocol_version) === RENDER_PROTOCOL_VERSION
    && worker.render_recipe === RENDER_RECIPE;

  let availability = "unavailable";
  let statusCode = worker.status_code || null;
  let statusMessage = worker.status_message || null;
  if (enabled && !fresh) {
    statusCode = "worker_not_responding";
    statusMessage = "O Arizona não está respondendo nesta máquina.";
  } else if (enabled && currentJobId) {
    availability = "busy";
  } else if (enabled && worker.status_code) {
    availability = reported === "unavailable" ? "unavailable" : "degraded";
  } else if (enabled && reported === "available") {
    availability = "available";
  } else if (enabled && reported === "degraded") {
    availability = "degraded";
  }

  return { enabled, availability, acceptingJobs, statusCode, statusMessage, fresh };
}

function formatJob(
  row: Record<string, unknown>,
  membersById: Map<string, Record<string, unknown>>,
  devicesById: Map<string, Record<string, unknown>>,
  queuePositions: Map<string, number>,
) {
  const requesterMemberId = String(row.requester_member_id);
  const requesterDeviceId = String(row.requester_device_id);
  const targetDeviceId = String(row.target_worker_device_id);
  const targetDevice = devicesById.get(targetDeviceId);
  const targetMemberId = String(targetDevice?.member_id || "");
  const requesterMemberLabel = memberLabel(membersById.get(requesterMemberId));
  const targetMemberLabel = targetMemberId
    ? memberLabel(membersById.get(targetMemberId))
    : "Outro usuário";
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  const projectRegion = projectRegionFromName(row.project_name);
  const manifest = {
    schemaVersion: Number(row.schema_version || 1),
    jobId: String(row.id),
    targetWorkerDeviceId: targetDeviceId,
    jobaoCod: String(row.jobao_cod),
    jobinhoCod: String(row.jobinho_cod),
    projectName: String(row.project_name),
    projectRegion,
    projectRelativePath: String(row.project_relative_path),
    projectSizeBytes: Number(row.project_size_bytes),
    projectSha256: String(row.project_sha256),
    recipe: String(row.recipe),
    outputs,
    createdAt: row.created_at,
  };
  return {
    id: String(row.id),
    jobaoCod: String(row.jobao_cod),
    jobinhoCod: String(row.jobinho_cod),
    projectName: String(row.project_name),
    projectRegion,
    requesterId: requesterMemberId,
    requesterMemberId,
    requesterLabel: requesterMemberLabel,
    requesterDeviceId,
    requesterDeviceLabel: requesterMemberLabel,
    targetId: targetDeviceId,
    targetDeviceId,
    targetWorkerDeviceId: targetDeviceId,
    targetLabel: targetMemberLabel,
    targetDeviceLabel: targetMemberLabel,
    targetMemberId: targetMemberId || null,
    targetMemberLabel: targetMemberId ? targetMemberLabel : null,
    status: String(row.status),
    stage: String(row.stage),
    progressPercent: Number(row.progress_percent || 0),
    queuePosition: queuePositions.get(String(row.id)) || null,
    cancelRequested: row.cancel_requested === true,
    outputConflict: row.output_conflict === true,
    outputConflictCode: row.output_conflict_code || null,
    attemptCount: Number(row.attempt_count || 0),
    lastErrorCode: row.last_error_code || null,
    resultOutputs: row.result_outputs || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAt: row.assigned_at,
    claimedAt: row.claimed_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    cancelledAt: row.cancelled_at || null,
    leaseExpiresAt: ACTIVE_STATUSES.includes(String(row.status)) ? row.lease_expires_at || null : null,
    timestamps: {
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedAt: row.assigned_at,
      claimedAt: row.claimed_at || null,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      cancelledAt: row.cancelled_at || null,
    },
    manifest,
  };
}

function historyDirection(row: Record<string, unknown>, context: QueueContext): string {
  const requestedHere = String(row.requester_device_id) === context.device.id;
  const requestedByMember = String(row.requester_member_id) === context.member.id;
  const renderedHere = String(row.target_worker_device_id) === context.device.id;
  if (requestedHere && renderedHere) return "both";
  if (renderedHere) return "received";
  if (requestedHere) return "sent";
  if (requestedByMember) return "account_sent";
  return "sent";
}

async function loadStatus(
  admin: SupabaseClient,
  context: QueueContext,
): Promise<Record<string, unknown>> {
  await rpc(admin, "render_refresh_queue_states", {
    target_organization_id: context.organization.id,
  });

  const visibleFilter = [
    `requester_member_id.eq.${context.member.id}`,
    `target_worker_device_id.eq.${context.device.id}`,
  ].join(",");
  const [
    workersResult,
    devicesResult,
    membersResult,
    queueResult,
    visibleJobsResult,
    nextJobResult,
    recoverableJobResult,
  ] =
    await Promise.all([
      admin.schema("licensing").from("render_workers").select("*")
        .eq("organization_id", context.organization.id).limit(500),
      admin.schema("licensing").from("devices")
        .select("id,member_id,device_label,status,last_seen_at")
        .eq("organization_id", context.organization.id).limit(500),
      admin.schema("licensing").from("members")
        .select("id,name,email,status")
        .eq("organization_id", context.organization.id).limit(500),
      admin.schema("licensing").from("render_jobs")
        .select("id,target_worker_device_id,status,created_at")
        .eq("organization_id", context.organization.id)
        .in("status", NONTERMINAL_STATUSES)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }).limit(1000),
      admin.schema("licensing").from("render_jobs").select("*")
        .eq("organization_id", context.organization.id)
        .or(visibleFilter)
        .order("created_at", { ascending: false }).limit(200),
      admin.schema("licensing").from("render_jobs").select("*")
        .eq("organization_id", context.organization.id)
        .eq("target_worker_device_id", context.device.id)
        .in("status", PENDING_STATUSES)
        .eq("cancel_requested", false)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin.schema("licensing").from("render_jobs").select("*")
        .eq("organization_id", context.organization.id)
        .eq("target_worker_device_id", context.device.id)
        .eq("claimed_worker_session_id", context.workerSessionId)
        .in("status", ACTIVE_STATUSES)
        .gt("lease_expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle(),
    ]);
  for (const result of [
    workersResult,
    devicesResult,
    membersResult,
    queueResult,
    visibleJobsResult,
    nextJobResult,
    recoverableJobResult,
  ]) {
    if (result.error) throw result.error;
  }

  const workers = (workersResult.data || []) as Record<string, unknown>[];
  const devices = (devicesResult.data || []) as Record<string, unknown>[];
  const members = (membersResult.data || []) as Record<string, unknown>[];
  const queueRows = (queueResult.data || []) as Record<string, unknown>[];
  const visibleRows = (visibleJobsResult.data || []) as Record<string, unknown>[];
  const nextJobRow = (nextJobResult.data || null) as Record<string, unknown> | null;
  const recoverableJobRow = (recoverableJobResult.data || null) as Record<string, unknown> | null;
  const devicesById = new Map(devices.map((item) => [String(item.id), item]));
  const membersById = new Map(members.map((item) => [String(item.id), item]));

  const pendingByTarget = new Map<string, Record<string, unknown>[]>();
  const activeByTarget = new Map<string, Record<string, unknown>>();
  for (const item of queueRows) {
    const targetId = String(item.target_worker_device_id);
    if (PENDING_STATUSES.includes(String(item.status))) {
      const current = pendingByTarget.get(targetId) || [];
      current.push(item);
      pendingByTarget.set(targetId, current);
    } else if (ACTIVE_STATUSES.includes(String(item.status))) {
      activeByTarget.set(targetId, item);
    }
  }
  const queuePositions = new Map<string, number>();
  for (const pending of pendingByTarget.values()) {
    pending.forEach((item, index) => queuePositions.set(String(item.id), index + 1));
  }
  // This row comes from a dedicated FIFO query and must remain useful even if
  // the organization has more than the 1,000 rows used for aggregate panels.
  if (nextJobRow) queuePositions.set(String(nextJobRow.id), 1);

  const nowMs = Date.now();
  const machines = workers
    .filter((worker) => devicesById.get(String(worker.device_id))?.status === "active")
    .map((worker) => {
      const targetId = String(worker.device_id);
      const currentJobId = activeByTarget.has(targetId)
        ? String(activeByTarget.get(targetId)?.id)
        : null;
      const device = devicesById.get(targetId);
      const memberId = String(device?.member_id || worker.member_id || "");
      const publicMemberName = memberId ? memberLabel(membersById.get(memberId)) : "Usuário";
      const state = effectiveWorkerState(worker, currentJobId, nowMs);
      return {
        deviceId: targetId,
        deviceLabel: publicMemberName,
        memberId: memberId || null,
        memberName: publicMemberName,
        enabled: state.enabled,
        availability: state.availability,
        acceptingJobs: state.acceptingJobs,
        queueDepth: pendingByTarget.get(targetId)?.length || 0,
        currentJobId,
        statusCode: state.statusCode,
        statusMessage: state.statusMessage,
        protocolVersion: Number(worker.protocol_version || 1),
        recipe: String(worker.render_recipe || RENDER_RECIPE),
        afterEffectsYear: worker.after_effects_year || null,
        heartbeatAt: worker.heartbeat_at,
      };
    })
    .sort((left, right) => {
      if (left.acceptingJobs !== right.acceptingJobs) return left.acceptingJobs ? -1 : 1;
      return left.memberName.localeCompare(right.memberName, "pt-BR");
    });

  const currentMachine = machines.find((machine) => machine.deviceId === context.device.id);
  const worker = currentMachine || {
    deviceId: context.device.id,
    deviceLabel: context.member.name,
    memberId: context.member.id,
    memberName: context.member.name,
    enabled: false,
    availability: "unavailable",
    acceptingJobs: false,
    queueDepth: 0,
    currentJobId: null,
    statusCode: null,
    statusMessage: null,
    protocolVersion: RENDER_PROTOCOL_VERSION,
    recipe: RENDER_RECIPE,
    afterEffectsYear: null,
    heartbeatAt: null,
  };

  const jobs = visibleRows.map((row) => formatJob(row, membersById, devicesById, queuePositions));
  const nextJob = nextJobRow
    ? formatJob(nextJobRow, membersById, devicesById, queuePositions)
    : null;
  const recoverableJob = recoverableJobRow
    ? formatJob(recoverableJobRow, membersById, devicesById, queuePositions)
    : null;
  return {
    ok: true,
    serverTime: new Date().toISOString(),
    organization: context.organization,
    worker,
    machines,
    jobs,
    nextJob,
    recoverableJob,
  };
}

async function loadHistory(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Record<string, unknown>> {
  const pageSize = historyPageSize(body.limit);
  const cursor = historyCursor(body);
  const visibilityFilter = [
    `requester_member_id.eq.${context.member.id}`,
    `target_worker_device_id.eq.${context.device.id}`,
  ].join(",");

  let jobsQuery = admin.schema("licensing").from("render_jobs")
    .select("*")
    .eq("organization_id", context.organization.id)
    .or(visibilityFilter)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (cursor) {
    jobsQuery = jobsQuery.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const [jobsResult, countResult] = await Promise.all([
    jobsQuery,
    admin.schema("licensing").from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.organization.id)
      .or(visibilityFilter),
  ]);
  for (const result of [jobsResult, countResult]) {
    if (result.error) throw result.error;
  }

  const pageRows = (jobsResult.data || []) as Record<string, unknown>[];
  const hasMore = pageRows.length > pageSize;
  const rows = pageRows.slice(0, pageSize);
  const relevantDeviceIds = [...new Set(rows.flatMap((row) => [
    String(row.requester_device_id),
    String(row.target_worker_device_id),
  ]))];
  const devicesResult = relevantDeviceIds.length > 0
    ? await admin.schema("licensing").from("devices")
      .select("id,member_id,device_label,status,last_seen_at")
      .eq("organization_id", context.organization.id)
      .in("id", relevantDeviceIds)
    : { data: [], error: null };
  if (devicesResult.error) throw devicesResult.error;
  const devices = (devicesResult.data || []) as Record<string, unknown>[];
  const relevantMemberIds = [...new Set([
    ...rows.map((row) => String(row.requester_member_id)),
    ...devices.map((device) => String(device.member_id)),
  ])];
  const membersResult = relevantMemberIds.length > 0
    ? await admin.schema("licensing").from("members")
      .select("id,name,email,status")
      .eq("organization_id", context.organization.id)
      .in("id", relevantMemberIds)
    : { data: [], error: null };
  if (membersResult.error) throw membersResult.error;
  const members = (membersResult.data || []) as Record<string, unknown>[];
  const devicesById = new Map(devices.map((item) => [String(item.id), item]));
  const membersById = new Map(members.map((item) => [String(item.id), item]));
  const jobs = rows.map((row) => {
    const job = formatJob(row, membersById, devicesById, new Map<string, number>());
    return {
      ...job,
      direction: historyDirection(row, context),
    };
  });
  const lastRow = rows.at(-1);

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    localDeviceId: context.device.id,
    localMemberId: context.member.id,
    jobs,
    pagination: {
      pageSize,
      total: Number(countResult.count || 0),
      hasMore,
      nextCursor: hasMore && lastRow
        ? {
          beforeCreatedAt: lastRow.created_at,
          beforeId: String(lastRow.id),
        }
        : null,
    },
  };
}

async function directQueuePosition(
  admin: SupabaseClient,
  context: QueueContext,
  row: Record<string, unknown>,
): Promise<number | null> {
  if (!PENDING_STATUSES.includes(String(row.status)) || row.cancel_requested === true) return null;
  const commonQuery = () => admin
    .schema("licensing")
    .from("render_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", context.organization.id)
    .eq("target_worker_device_id", String(row.target_worker_device_id))
    .in("status", PENDING_STATUSES)
    .eq("cancel_requested", false);
  const [beforeTime, sameTime] = await Promise.all([
    commonQuery().lt("created_at", String(row.created_at)),
    commonQuery()
      .eq("created_at", String(row.created_at))
      .lt("id", String(row.id)),
  ]);
  if (beforeTime.error) throw beforeTime.error;
  if (sameTime.error) throw sameTime.error;
  return Number(beforeTime.count || 0) + Number(sameTime.count || 0) + 1;
}

async function loadOneJob(
  admin: SupabaseClient,
  context: QueueContext,
  jobId: string,
) {
  const { data, error } = await admin
    .schema("licensing")
    .from("render_jobs")
    .select("*")
    .eq("organization_id", context.organization.id)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  const row = (data || null) as Record<string, unknown> | null;
  const previousTargetDeviceIds = row && Array.isArray(row.previous_target_worker_device_ids)
    ? row.previous_target_worker_device_ids.filter((value): value is string => (
      typeof value === "string"
    ))
    : [];
  if (
    !row
    || (
      String(row.requester_member_id) !== context.member.id
      && String(row.target_worker_device_id) !== context.device.id
      && !previousTargetDeviceIds.includes(context.device.id)
    )
  ) {
    // Previous targets may need one exact lookup to reconcile local publication
    // journals after reassignment. No other device can use this direct path.
    // Missing and unrelated jobs deliberately share the same response.
    throw new RenderContractError("render_job_not_found");
  }

  const relevantDeviceIds = [
    String(row.requester_device_id),
    String(row.target_worker_device_id),
  ];
  const { data: devices, error: devicesError } = await admin
    .schema("licensing")
    .from("devices")
    .select("id,member_id,device_label,status,last_seen_at")
    .eq("organization_id", context.organization.id)
    .in("id", relevantDeviceIds);
  if (devicesError) throw devicesError;
  const deviceRows = (devices || []) as Record<string, unknown>[];
  const devicesById = new Map(deviceRows.map((item) => [String(item.id), item]));
  const relevantMemberIds = [...new Set([
    String(row.requester_member_id),
    ...deviceRows.map((item) => String(item.member_id)),
  ])];
  const { data: members, error: membersError } = await admin
    .schema("licensing")
    .from("members")
    .select("id,name,email,status")
    .eq("organization_id", context.organization.id)
    .in("id", relevantMemberIds);
  if (membersError) throw membersError;
  const memberRows = (members || []) as Record<string, unknown>[];
  const membersById = new Map(memberRows.map((item) => [String(item.id), item]));
  const queuePosition = await directQueuePosition(admin, context, row);
  const queuePositions = new Map<string, number>();
  if (queuePosition !== null) queuePositions.set(String(row.id), queuePosition);
  return formatJob(row, membersById, devicesById, queuePositions);
}

async function handleStatus(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  await touchWorker(admin, context, body, {
    setEnabled: false,
    enabled: false,
    updateHealth: false,
    availability: "available",
    statusCode: null,
    statusMessage: null,
  });
  const status = await loadStatus(admin, context);
  const requestedJobId = optionalUuid(body.jobId, "invalid_job_id");
  if (!requestedJobId) return jsonResponse(status);
  const job = await loadOneJob(admin, context, requestedJobId);
  return jsonResponse({ ...status, job });
}

async function handleHistory(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  return jsonResponse(await loadHistory(admin, context, body));
}

async function handleSetAvailability(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  const enabled = booleanValue(body.enabled, "missing_enabled");
  const statusCode = enabled ? workerStatusCodeValue(body.statusCode) : null;
  const availability = enabled
    ? workerAvailabilityValue(body.availability, statusCode ? "degraded" : "available")
    : "unavailable";
  const statusMessage = enabled ? statusMessageValue(body.statusMessage) : null;
  await touchWorker(admin, context, body, {
    setEnabled: true,
    enabled,
    updateHealth: true,
    availability,
    statusCode,
    statusMessage,
  });
  return jsonResponse(await loadStatus(admin, context));
}

async function handleCreateJob(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  await touchWorker(admin, context, body, {
    setEnabled: false,
    enabled: false,
    updateHealth: false,
    availability: "available",
    statusCode: null,
    statusMessage: null,
  });
  const targetWorkerDeviceId = uuidValue(
    body.targetWorkerDeviceId,
    "missing_target_worker_device_id",
  );
  const outputs: RenderOutput[] = renderOutputsValue(body.outputs);
  const data = await rpc(admin, "render_create_job", {
    p_organization_id: context.organization.id,
    p_requester_member_id: context.member.id,
    p_requester_device_id: context.device.id,
    p_target_worker_device_id: targetWorkerDeviceId,
    p_idempotency_key: idempotencyKey(body.idempotencyKey),
    p_jobao_cod: requiredText(body.jobaoCod, 128, "missing_jobao_cod"),
    p_jobinho_cod: requiredText(body.jobinhoCod, 128, "missing_jobinho_cod"),
    p_project_name: projectNameValue(body.projectName),
    p_project_relative_path: relativePath(
      body.projectRelativePath,
      ".aep",
      "invalid_project_relative_path",
    ),
    p_project_size_bytes: positiveSafeInteger(body.projectSizeBytes, "invalid_project_size"),
    p_project_sha256: sha256Value(body.projectSha256, "invalid_project_sha256"),
    p_recipe: recipeValue(body.recipe),
    p_outputs: outputs,
  });
  const jobId = String(data || "");
  if (!jobId) throw new Error("render_create_job_missing_id");
  const job = await loadOneJob(admin, context, jobId);
  return jsonResponse({ ok: true, job });
}

async function handleClaim(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  const jobId = optionalUuid(body.jobId, "invalid_job_id");
  const observedProjectSha256 = sha256Value(
    body.observedProjectSha256,
    "missing_observed_project_sha256",
  );
  const data = await rpc(admin, "render_claim_job", {
    p_organization_id: context.organization.id,
    p_member_id: context.member.id,
    p_device_id: context.device.id,
    p_worker_session_id: context.workerSessionId,
    p_job_id: jobId,
    p_observed_project_sha256: observedProjectSha256,
    p_observed_project_size_bytes: optionalPositiveSafeInteger(
      body.observedProjectSizeBytes,
      "invalid_observed_project_size",
    ),
  }) as Record<string, unknown> | null;
  if (!data?.jobId) return jsonResponse({ ok: true, job: null });
  if (data.attemptLimitReached === true) {
    throw new RenderContractError("render_attempt_limit_reached");
  }
  const claimedJobId = String(data.jobId);
  const job = await loadOneJob(admin, context, claimedJobId);
  return jsonResponse({
    ok: true,
    job,
    leaseId: data.leaseId,
    leaseGeneration: Number(data.leaseGeneration),
    leaseExpiresAt: data.leaseExpiresAt,
    reused: data.reused === true,
  });
}

async function handleHeartbeat(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  const jobId = optionalUuid(body.jobId, "invalid_job_id");
  const leaseId = optionalUuid(body.leaseId, "invalid_lease_id");
  const hasGeneration = body.leaseGeneration !== undefined && body.leaseGeneration !== null;
  if ((leaseId === null) !== !hasGeneration) {
    throw new RenderContractError("incomplete_render_lease");
  }
  const leaseGeneration = hasGeneration
    ? integerValue(body.leaseGeneration, 1, Number.MAX_SAFE_INTEGER, "invalid_lease_generation")
    : null;
  const stage = jobId ? stageValue(body.stage) : "waiting_for_worker";
  const statusCode = workerStatusCodeValue(body.statusCode);
  const availability = workerAvailabilityValue(
    body.availability,
    statusCode ? "degraded" : "available",
  );
  const outputConflict = optionalBoolean(body.outputConflict, false, "invalid_output_conflict");
  const outputConflictValue = outputConflictCode(body.outputConflictCode, outputConflict);
  const pendingErrorCode = body.errorCode === undefined || body.errorCode === null
    ? null
    : renderErrorCodeValue(body.errorCode, false);
  if (pendingErrorCode && (leaseId || !["sync_timeout", "project_hash_mismatch"].includes(pendingErrorCode))) {
    throw new RenderContractError("invalid_pending_render_error");
  }
  const data = await rpc(admin, "render_heartbeat_job", {
    p_organization_id: context.organization.id,
    p_member_id: context.member.id,
    p_device_id: context.device.id,
    p_worker_session_id: context.workerSessionId,
    p_job_id: jobId,
    p_has_lease: leaseId !== null,
    p_lease_id: leaseId,
    p_lease_generation: leaseGeneration,
    p_progress_percent: progressValue(body.progressPercent),
    p_stage: stage,
    p_reported_availability: availability,
    p_status_code: statusCode,
    p_status_message: statusMessageValue(body.statusMessage),
    p_output_conflict: outputConflict,
    p_output_conflict_code: outputConflictValue,
    p_pending_error_code: pendingErrorCode,
  }) as Record<string, unknown>;
  return jsonResponse({ ok: true, ...data });
}

async function handleFinish(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  const jobId = uuidValue(body.jobId, "missing_job_id");
  const leaseId = uuidValue(body.leaseId, "missing_lease_id");
  const leaseGeneration = integerValue(
    body.leaseGeneration,
    1,
    Number.MAX_SAFE_INTEGER,
    "invalid_lease_generation",
  );
  const outcome = finishOutcomeValue(body.outcome);
  let errorCode = renderErrorCodeValue(body.errorCode, outcome === "failed");
  if (outcome === "completed") errorCode = null;
  let outputs: RenderResultOutput[] | null = null;
  if (outcome === "completed") {
    outputs = renderResultOutputsValue(body.outputs);
  } else if (body.outputs !== undefined && body.outputs !== null) {
    outputs = renderResultOutputsValue(body.outputs);
  }
  const data = await rpc(admin, "render_finish_job", {
    p_organization_id: context.organization.id,
    p_member_id: context.member.id,
    p_device_id: context.device.id,
    p_worker_session_id: context.workerSessionId,
    p_job_id: jobId,
    p_lease_id: leaseId,
    p_lease_generation: leaseGeneration,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_result_outputs: outputs,
  }) as Record<string, unknown>;
  const job = await loadOneJob(admin, context, String(data.jobId));
  return jsonResponse({ ok: true, job });
}

async function handleCancel(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  await touchWorker(admin, context, body, {
    setEnabled: false,
    enabled: false,
    updateHealth: false,
    availability: "available",
    statusCode: null,
    statusMessage: null,
  });
  const jobId = uuidValue(body.jobId, "missing_job_id");
  const data = await rpc(admin, "render_cancel_job", {
    p_organization_id: context.organization.id,
    p_actor_member_id: context.member.id,
    p_actor_device_id: context.device.id,
    p_job_id: jobId,
  }) as Record<string, unknown>;
  const job = await loadOneJob(admin, context, String(data.jobId));
  return jsonResponse({ ok: true, job });
}

async function handleReassign(
  admin: SupabaseClient,
  context: QueueContext,
  body: RenderQueueBody,
): Promise<Response> {
  await touchWorker(admin, context, body, {
    setEnabled: false,
    enabled: false,
    updateHealth: false,
    availability: "available",
    statusCode: null,
    statusMessage: null,
  });
  const jobId = uuidValue(body.jobId, "missing_job_id");
  const targetWorkerDeviceId = uuidValue(
    body.targetWorkerDeviceId,
    "missing_target_worker_device_id",
  );
  const data = await rpc(admin, "render_reassign_job", {
    p_organization_id: context.organization.id,
    p_requester_member_id: context.member.id,
    p_requester_device_id: context.device.id,
    p_job_id: jobId,
    p_target_worker_device_id: targetWorkerDeviceId,
  }) as Record<string, unknown>;
  const job = await loadOneJob(admin, context, String(data.jobId));
  return jsonResponse({ ok: true, job });
}

function contractErrorResponse(code: string): Response {
  const responses: Record<string, [string, number]> = {
    invalid_render_action: ["Esta ação da fila não é reconhecida.", 400],
    missing_install_id: ["Não foi possível identificar esta instalação.", 400],
    missing_worker_session_id: ["Reabra o Arizona para continuar.", 400],
    device_identity_required: ["Não foi possível confirmar a identidade deste computador.", 403],
    member_not_authorized: ["Seu usuário não tem acesso à fila de renderização.", 403],
    organization_not_active: ["A fila está indisponível enquanto a licença estiver pausada.", 403],
    license_expired: ["A licença precisa ser renovada para usar a fila.", 403],
    device_not_active: ["Este computador não está autorizado. Ative-o novamente.", 403],
    missing_target_worker_device_id: ["Escolha um computador para renderizar.", 400],
    render_target_worker_not_found: ["O computador escolhido não está mais disponível.", 404],
    render_worker_not_available: ["Este computador não está aceitando renders agora.", 409],
    render_worker_already_busy: ["Este computador já está cuidando de outro render.", 409],
    render_worker_session_invalid: ["A disponibilidade desta sessão terminou. Ative-a novamente.", 409],
    render_job_not_found: ["Este trabalho de renderização não foi encontrado.", 404],
    render_job_not_next: ["Há outro trabalho antes deste na fila.", 409],
    render_attempt_limit_reached: ["Este render foi interrompido várias vezes e precisa ser enviado novamente.", 409],
    render_job_not_pending: ["Este trabalho não está mais aguardando na fila.", 409],
    render_job_in_progress: ["Aguarde o render terminar ou cancele antes de trocar de computador.", 409],
    render_job_already_finished: ["Este trabalho já foi encerrado.", 409],
    render_cancel_requested: [
      "O cancelamento deste render já foi solicitado. A máquina está concluindo a interrupção com segurança.",
      409,
    ],
    render_cancel_not_allowed: ["Você não pode cancelar este trabalho.", 403],
    render_reassign_not_allowed: ["Somente quem enviou o trabalho pode escolher outro computador.", 403],
    render_lease_lost: ["Este computador perdeu a autorização temporária do render.", 409],
    render_project_hash_mismatch: ["O projeto recebido ainda não corresponde ao arquivo enviado.", 409],
    render_output_conflict: ["Um arquivo de saída mudou desde a confirmação.", 409],
    render_output_destination_in_use: [
      "Outro render já está usando um dos arquivos finais escolhidos. Aguarde a conclusão ou cancele o trabalho anterior.",
      409,
    ],
    render_idempotency_conflict: ["Este envio já foi usado com informações diferentes.", 409],
    unsupported_render_recipe: ["Este computador ainda não suporta esta receita de render.", 409],
    unsupported_worker_protocol: ["Atualize o Arizona para participar da fila.", 409],
    invalid_worker_availability: ["O estado informado para este computador é inválido.", 400],
    invalid_worker_status_code: ["O aviso informado pelo computador não é reconhecido.", 400],
    invalid_status_message: ["O aviso do computador é inválido.", 400],
    invalid_render_stage: ["A etapa informada para o render é inválida.", 400],
    invalid_finish_outcome: ["O resultado informado para o render é inválido.", 400],
    invalid_render_error_code: ["O motivo informado para o render não é reconhecido.", 400],
    invalid_pending_render_error: ["Este motivo não pode encerrar um trabalho que ainda sincroniza.", 400],
    missing_render_error_code: ["Informe por que o render não pôde ser concluído.", 400],
    incomplete_render_lease: ["A autorização temporária do render está incompleta.", 400],
    invalid_render_outputs: ["Os formatos ou destinos escolhidos para o render não são válidos.", 400],
    invalid_result_outputs: ["Não foi possível validar os arquivos produzidos.", 400],
    invalid_project_relative_path: ["O projeto precisa estar dentro da pasta compartilhada.", 400],
    invalid_project_name: ["Escolha um projeto válido do After Effects.", 400],
    invalid_project_size: ["Não foi possível validar o tamanho do projeto.", 400],
    invalid_project_sha256: ["Não foi possível validar o conteúdo do projeto.", 400],
    missing_observed_project_sha256: ["O projeto precisa terminar de sincronizar antes do render.", 400],
    invalid_observed_project_size: ["O tamanho observado do projeto é inválido.", 400],
    invalid_progress_percent: ["O progresso informado é inválido.", 400],
    invalid_output_conflict: ["A confirmação dos arquivos existentes é inválida.", 400],
    invalid_output_conflict_code: ["O conflito informado para a saída não é reconhecido.", 400],
    invalid_idempotency_key: ["Não foi possível identificar este envio.", 400],
    invalid_render_history_limit: ["A quantidade de renders solicitada é inválida.", 400],
    invalid_render_history_cursor: ["A página do histórico de renders é inválida.", 400],
    missing_jobao_cod: ["Informe o Jobão deste projeto.", 400],
    missing_jobinho_cod: ["Informe o Jobinho deste projeto.", 400],
    missing_job_id: ["Escolha um trabalho da fila.", 400],
    invalid_job_id: ["Este trabalho da fila é inválido.", 400],
    missing_lease_id: ["A autorização temporária do render não foi encontrada.", 400],
    invalid_lease_id: ["A autorização temporária do render é inválida.", 400],
    invalid_lease_generation: ["A versão da autorização do render é inválida.", 400],
    missing_enabled: ["Informe se este computador deve aceitar renders.", 400],
    invalid_after_effects_year: ["A versão do After Effects informada é inválida.", 400],
  };
  const [message, status] = responses[code]
    || ["Os dados enviados para a fila não são válidos.", 400];
  return errorResponse(code, message, status);
}

function postgresErrorCode(message: string): string | null {
  const known = [
    "render_device_not_active",
    "render_recipe_not_supported",
    "render_invalid_availability",
    "render_requester_device_not_active",
    "render_target_worker_not_found",
    "render_invalid_manifest",
    "render_idempotency_conflict",
    "render_output_destination_in_use",
    "render_worker_not_available",
    "render_worker_already_busy",
    "render_job_not_next",
    "render_output_conflict",
    "render_project_hash_mismatch",
    "render_worker_session_invalid",
    "render_job_not_found",
    "render_lease_lost",
    "render_invalid_stage",
    "render_invalid_pending_error",
    "render_job_not_pending",
    "render_invalid_outcome",
    "render_invalid_result_outputs",
    "render_error_code_required",
    "render_cancel_requested",
    "render_cancel_not_allowed",
    "render_job_already_finished",
    "render_reassign_not_allowed",
    "render_job_in_progress",
  ];
  return known.find((code) => message.includes(code)) || null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<RenderQueueBody>(req);
    const action = queueAction(body.action);
    const admin = createAdminClient();
    const context = await authorizeQueueRequest(req, admin, body);
    await enforceRateLimit(
      admin,
      `render.queue.${action}`,
      context.device.id,
      ACTION_RATE_LIMITS[action],
      3600,
    );

    switch (action) {
      case "status":
        return await handleStatus(admin, context, body);
      case "history":
        return await handleHistory(admin, context, body);
      case "set_availability":
        return await handleSetAvailability(admin, context, body);
      case "create_job":
        return await handleCreateJob(admin, context, body);
      case "claim":
        return await handleClaim(admin, context, body);
      case "heartbeat":
        return await handleHeartbeat(admin, context, body);
      case "finish":
        return await handleFinish(admin, context, body);
      case "cancel":
        return await handleCancel(admin, context, body);
      case "reassign":
        return await handleReassign(admin, context, body);
    }
  } catch (error) {
    if (error instanceof RenderContractError) return contractErrorResponse(error.code);
    if (error instanceof RateLimitError) {
      return errorResponse("rate_limited", "Aguarde um pouco antes de tentar novamente.", 429, {
        retryAfterSeconds: error.retryAfterSeconds,
        retryAt: new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString(),
      });
    }
    const message = String((error as { message?: unknown })?.message || error || "");
    const databaseCode = postgresErrorCode(message);
    if (databaseCode) {
      const aliases: Record<string, string> = {
        render_device_not_active: "device_not_active",
        render_requester_device_not_active: "device_not_active",
        render_recipe_not_supported: "unsupported_render_recipe",
        render_invalid_availability: "invalid_worker_availability",
        render_invalid_manifest: "invalid_render_outputs",
        render_invalid_stage: "invalid_render_stage",
        render_invalid_pending_error: "invalid_pending_render_error",
        render_invalid_outcome: "invalid_finish_outcome",
        render_invalid_result_outputs: "invalid_result_outputs",
        render_error_code_required: "missing_render_error_code",
      };
      return contractErrorResponse(aliases[databaseCode] || databaseCode);
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Sua sessão terminou. Entre novamente.", 401);
    }
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Não foi possível confirmar este aplicativo.", 401);
    }
    if (message === "invalid_json_body") {
      return errorResponse("invalid_json_body", "Os dados enviados não puderam ser lidos.", 400);
    }
    return errorResponse(
      "render_queue_unavailable",
      "Não foi possível acessar a fila agora. Tente novamente em instantes.",
      500,
    );
  }
});
