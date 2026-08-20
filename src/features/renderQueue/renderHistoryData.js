function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function readRenderHistoryPage(rawResponse) {
  const payload = rawResponse && typeof rawResponse === "object"
    ? firstObject(rawResponse.data, rawResponse)
    : {};
  const pagination = firstObject(payload.pagination, payload.page);
  const totalValue = Number(pagination.total ?? payload.total ?? 0);
  const nextCursor = firstObject(pagination.nextCursor, pagination.next_cursor);
  const beforeCreatedAt = firstText(
    nextCursor.beforeCreatedAt,
    nextCursor.before_created_at,
    nextCursor.createdAt,
    nextCursor.created_at
  );
  const beforeId = firstText(nextCursor.beforeId, nextCursor.before_id, nextCursor.id);

  return {
    jobs: firstArray(payload.jobs, payload.items, payload.history),
    localDeviceId: firstText(
      payload.localDeviceId,
      payload.local_device_id,
      payload.currentDeviceId,
      payload.current_device_id
    ),
    localMemberId: firstText(
      payload.localMemberId,
      payload.local_member_id,
      payload.currentMemberId,
      payload.current_member_id
    ),
    total: Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : 0,
    hasMore: pagination.hasMore === true || pagination.has_more === true,
    nextCursor: beforeCreatedAt && beforeId ? { beforeCreatedAt, beforeId } : null,
  };
}

export function renderDirectionForDevice(rawJob, localDeviceId, localMemberId = "") {
  const job = rawJob && typeof rawJob === "object" ? rawJob : {};
  const localId = firstText(localDeviceId);
  const requesterDeviceId = firstText(
    job.requesterDeviceId,
    job.requester_device_id
  );
  const targetDeviceId = firstText(
    job.targetWorkerDeviceId,
    job.target_worker_device_id,
    job.targetDeviceId,
    job.target_device_id
  );
  const requesterMemberId = firstText(job.requesterMemberId, job.requester_member_id);
  const requestedHere = Boolean(localId && requesterDeviceId === localId);
  const renderedHere = Boolean(localId && targetDeviceId === localId);

  if (requestedHere && renderedHere) return "both";
  if (renderedHere) return "received";
  if (requestedHere) return "sent";
  if (localMemberId && requesterMemberId === localMemberId) return "account_sent";

  const fallback = firstText(job.direction).toLowerCase();
  return ["sent", "received", "both", "account_sent"].includes(fallback) ? fallback : "sent";
}

export function mergeRenderHistoryEntries(currentEntries, incomingEntries) {
  const merged = new Map();
  for (const entry of Array.isArray(currentEntries) ? currentEntries : []) {
    if (entry?.id) merged.set(String(entry.id), entry);
  }
  for (const entry of Array.isArray(incomingEntries) ? incomingEntries : []) {
    if (!entry?.id) continue;
    const id = String(entry.id);
    merged.set(id, { ...(merged.get(id) || {}), ...entry });
  }
  return [...merged.values()];
}

export function reconcilePolledRenderHistory({
  currentEntries,
  currentCursor,
  incomingEntries,
  incomingCursor,
  total,
}) {
  const current = Array.isArray(currentEntries) ? currentEntries : [];
  const incoming = Array.isArray(incomingEntries) ? incomingEntries : [];
  if (total === 0) return { entries: [], cursor: null, hasMore: false };

  const currentIds = new Set(current.map((entry) => String(entry?.id || "")).filter(Boolean));
  const overlaps = incoming.some((entry) => entry?.id && currentIds.has(String(entry.id)));
  if (current.length > 0 && incoming.length > 0 && !overlaps) {
    return {
      entries: incoming,
      cursor: incomingCursor,
      hasMore: incoming.length < total && Boolean(incomingCursor),
    };
  }

  const entries = mergeRenderHistoryEntries(current, incoming);
  const cursor = current.length === 0 ? incomingCursor : currentCursor;
  return {
    entries,
    cursor,
    hasMore: entries.length < total && Boolean(cursor),
  };
}

export function compareHistoryIds(leftValue, rightValue) {
  const left = String(leftValue ?? "");
  const right = String(rightValue ?? "");
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
  }
  return left.localeCompare(right);
}
