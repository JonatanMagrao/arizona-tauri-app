export const ADMIN_SESSION_MAX_MS = 8 * 60 * 60 * 1000;
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function normalizeAdminSessionTiming(session, now = Date.now()) {
  if (!session || typeof session !== "object") return session;

  const sessionStartedAt = positiveTimestamp(session.sessionStartedAt) || now;
  const lastActivityAt = Math.max(
    sessionStartedAt,
    positiveTimestamp(session.lastActivityAt) || now,
  );

  return {
    ...session,
    sessionStartedAt,
    lastActivityAt,
  };
}

export function adminSessionExpiryReason(session, now = Date.now()) {
  if (!session?.accessToken) return "";

  const normalized = normalizeAdminSessionTiming(session, now);
  if (now >= normalized.sessionStartedAt + ADMIN_SESSION_MAX_MS) {
    return "max_lifetime";
  }
  if (now >= normalized.lastActivityAt + ADMIN_IDLE_TIMEOUT_MS) {
    return "inactivity";
  }
  return "";
}

export function nextAdminSessionExpiryAt(session, now = Date.now()) {
  if (!session?.accessToken) return 0;
  const normalized = normalizeAdminSessionTiming(session, now);
  return Math.min(
    normalized.sessionStartedAt + ADMIN_SESSION_MAX_MS,
    normalized.lastActivityAt + ADMIN_IDLE_TIMEOUT_MS,
  );
}

function positiveTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}
