import { publicErrorMessage } from "../../utils/publicErrors.js";

export const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;

export const RESUME_NETWORK_RETRY_MS = 15000;
export const RESUME_BLOCKED_RETRY_MS = 60000;

export const LOGIN_SCREENS = Object.freeze({
  CHECKING: "checking",
  ACTIVATION: "activation",
  CONNECTION: "connection",
  BLOCKED: "blocked",
});

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

const ACTIVATION_RECOVERY_RETRY_CODES = new Set([
  ...RESUME_BLOCKED_RETRY_CODES,
  "network_error",
]);

const CONNECTION_CODES = new Set([
  "network_error",
  "request_failed",
  "invalid_server_response",
  ...RATE_LIMIT_CODES,
]);

const REACTIVATION_CODES = new Set([
  "activation_required",
  "device_activation_expired",
  "device_limit_reached",
  "device_not_active",
  "device_revoked",
  "invalid_grant",
  "invalid_refresh_token",
  "invalid_user_token",
  "member_not_authorized",
  "refresh_token_not_found",
]);

const BLOCKED_ACCESS_CODES = new Set([
  ...RESUME_BLOCKED_RETRY_CODES,
  "daily_mfa_required",
  "device_identity_required",
  "mfa_required",
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
    return {
      ...flow,
      state: "error",
      code: code || state,
      message: OUTDATED_BACKEND_MESSAGE,
    };
  }
  return flow;
}

// Chooses what the login window should show without exposing transient
// authentication details to the React component. Errors from an activation
// attempt deliberately keep the form visible so the user's input is never
// lost behind a status screen.
export function loginScreenForFlow(flow, { source = "resume" } = {}) {
  const normalized = normalizeAuthFlow(flow);
  if (!normalized || normalized.state === "authenticated") {
    return LOGIN_SCREENS.CHECKING;
  }

  const state = String(normalized.state || "").trim().toLowerCase();
  const code = String(normalized.code || "").trim().toLowerCase();

  if (state === "activation_required" || REACTIVATION_CODES.has(code)) {
    return LOGIN_SCREENS.ACTIVATION;
  }
  if (BLOCKED_ACCESS_CODES.has(code)) {
    return LOGIN_SCREENS.BLOCKED;
  }
  if (source === "activation") {
    return LOGIN_SCREENS.ACTIVATION;
  }
  if (CONNECTION_CODES.has(code) || state === "error") {
    return LOGIN_SCREENS.CONNECTION;
  }
  return LOGIN_SCREENS.ACTIVATION;
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

export function automaticResumeRetryDelayMs(flow, { source = "resume" } = {}) {
  if (!flow || flow.state === "authenticated") return null;

  const code = String(flow.code || "").trim().toLowerCase();
  if (source === "activation" && !ACTIVATION_RECOVERY_RETRY_CODES.has(code)) {
    return null;
  }

  const fixedDelay = resumeRetryDelayMs(code);
  if (fixedDelay != null) return fixedDelay;

  const retry = authRetryState(flow);
  return source !== "activation" && retry.isRateLimited
    ? retry.retryAfterSeconds * 1000
    : null;
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
