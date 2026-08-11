import { publicErrorMessage } from "../../utils/publicErrors.js";

export const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;

export const RESUME_NETWORK_RETRY_MS = 15000;
export const RESUME_BLOCKED_RETRY_MS = 60000;

export const OUTDATED_BACKEND_MESSAGE =
  "Não foi possível confirmar seu acesso com esta versão do aplicativo. Atualize o Arizona App ou contate o suporte.";

const RATE_LIMIT_CODES = new Set([
  "rate_limited",
  "over_request_rate_limit",
]);

const RETRY_BLOCK_CODES = new Set([
  ...RATE_LIMIT_CODES,
  "device_cooldown",
]);

const OUTDATED_BACKEND_SIGNALS = new Set([
  "daily_mfa_required",
  "mfa_required",
]);

// Reversible org-wide blocks: the stored credential is kept, so the login
// window silently retries resume until the license returns.
const RESUME_BLOCKED_RETRY_CODES = new Set([
  "license_expired",
  "organization_not_active",
]);

export function acquireSubmission(lockRef) {
  if (!lockRef || lockRef.current) return false;
  lockRef.current = true;
  return true;
}

export function releaseSubmission(lockRef) {
  if (lockRef) lockRef.current = false;
}

export function normalizeAuthFlow(flow) {
  if (!flow) return flow;
  const state = String(flow.state || "").trim().toLowerCase();
  const code = String(flow.code || "").trim().toLowerCase();
  if (OUTDATED_BACKEND_SIGNALS.has(state) || OUTDATED_BACKEND_SIGNALS.has(code)) {
    return { ...flow, state: "error", message: OUTDATED_BACKEND_MESSAGE };
  }
  return flow;
}

export function authRetryState(flow) {
  const code = String(flow?.code || "").trim().toLowerCase();
  const isRateLimited = RATE_LIMIT_CODES.has(code);
  const isRetryBlocked = RETRY_BLOCK_CODES.has(code);
  const suppliedSeconds = positiveSeconds(
    flow?.retryAfterSeconds ?? flow?.retry_after_seconds,
  );
  const retryAfterSeconds = suppliedSeconds
    || (isRateLimited ? DEFAULT_RATE_LIMIT_RETRY_SECONDS : 0);

  return {
    code,
    isRateLimited,
    isRetryBlocked,
    retryAfterSeconds,
  };
}

// Delay before the login window silently retries resume for the given flow
// code, or null when the code does not auto-recover.
export function resumeRetryDelayMs(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "network_error") return RESUME_NETWORK_RETRY_MS;
  if (RESUME_BLOCKED_RETRY_CODES.has(normalized)) return RESUME_BLOCKED_RETRY_MS;
  return null;
}

export function authFlowErrorMessage(flow) {
  const code = String(flow?.code || "").trim().toLowerCase();
  if (RATE_LIMIT_CODES.has(code)) {
    return "Muitas tentativas. Aguarde o tempo indicado antes de tentar novamente.";
  }
  return publicErrorMessage(flow, "Não foi possível confirmar o acesso.");
}

function positiveSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds);
}
