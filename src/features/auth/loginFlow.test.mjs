import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RATE_LIMIT_RETRY_SECONDS,
  OUTDATED_BACKEND_MESSAGE,
  RESUME_BLOCKED_RETRY_MS,
  RESUME_NETWORK_RETRY_MS,
  acquireSubmission,
  authFlowErrorMessage,
  authRetryState,
  normalizeAuthFlow,
  releaseSubmission,
  resumeRetryDelayMs,
} from "./loginFlow.js";

test("submission lock is acquired only once until it is released", () => {
  const lock = { current: false };

  assert.equal(acquireSubmission(lock), true);
  assert.equal(acquireSubmission(lock), false);
  releaseSubmission(lock);
  assert.equal(acquireSubmission(lock), true);
});

test("uses the server retry delay for Supabase rate limits", () => {
  assert.deepEqual(
    authRetryState({
      code: "over_request_rate_limit",
      retryAfterSeconds: 91.2,
    }),
    {
      code: "over_request_rate_limit",
      isRateLimited: true,
      isRetryBlocked: true,
      retryAfterSeconds: 92,
    },
  );
});

test("applies a safe local delay when a rate limit omits retry-after", () => {
  const retry = authRetryState({ code: "over_request_rate_limit" });

  assert.equal(retry.retryAfterSeconds, DEFAULT_RATE_LIMIT_RETRY_SECONDS);
  assert.equal(retry.isRetryBlocked, true);
});

test("maps an outdated backend that still demands MFA to an error state", () => {
  const flow = normalizeAuthFlow({ state: "error", code: "daily_mfa_required" });

  assert.equal(flow.state, "error");
  assert.equal(flow.message, OUTDATED_BACKEND_MESSAGE);
  assert.equal(authFlowErrorMessage(flow), OUTDATED_BACKEND_MESSAGE);
});

test("keeps the supported auth flow states untouched", () => {
  const activation = { state: "activation_required", message: "Informe o código." };
  const authenticated = { state: "authenticated" };

  assert.deepEqual(normalizeAuthFlow(activation), activation);
  assert.deepEqual(normalizeAuthFlow(authenticated), authenticated);
});

test("silently retries resume for network drops and reversible org blocks", () => {
  assert.equal(resumeRetryDelayMs("network_error"), RESUME_NETWORK_RETRY_MS);
  assert.equal(resumeRetryDelayMs("license_expired"), RESUME_BLOCKED_RETRY_MS);
  assert.equal(resumeRetryDelayMs("organization_not_active"), RESUME_BLOCKED_RETRY_MS);
  assert.equal(resumeRetryDelayMs(" License_Expired "), RESUME_BLOCKED_RETRY_MS);
});

test("never schedules a resume retry for terminal or unknown codes", () => {
  for (const code of [
    "member_not_authorized",
    "device_revoked",
    "device_not_active",
    "device_activation_expired",
    "invalid_user_token",
    "device_identity_required",
    "rate_limited",
    "activation_invalid",
    "",
    undefined,
  ]) {
    assert.equal(resumeRetryDelayMs(code), null, `code=${String(code)}`);
  }
});

test("falls back to the flow message for generic errors", () => {
  assert.equal(
    authFlowErrorMessage({ state: "error", code: "license_expired", message: "Licença expirada." }),
    "Licença expirada.",
  );
  assert.equal(
    authFlowErrorMessage({ state: "error" }),
    "Não foi possível confirmar o acesso.",
  );
  assert.equal(
    authFlowErrorMessage({ state: "error", code: "rate_limited", message: "x" }),
    "Muitas tentativas. Aguarde o tempo indicado antes de tentar novamente.",
  );
});
