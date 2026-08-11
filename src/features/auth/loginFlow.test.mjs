import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RATE_LIMIT_RETRY_SECONDS,
  LOGIN_SCREENS,
  OUTDATED_BACKEND_MESSAGE,
  RESUME_BLOCKED_RETRY_MS,
  RESUME_NETWORK_RETRY_MS,
  acquireSubmission,
  automaticResumeRetryDelayMs,
  authFlowErrorMessage,
  authRetryState,
  loginScreenForFlow,
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

test("uses the retry delay returned by the access service", () => {
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

test("shows activation only after the access check asks for user input", () => {
  assert.equal(
    loginScreenForFlow({ state: "activation_required" }),
    LOGIN_SCREENS.ACTIVATION,
  );
  assert.equal(
    loginScreenForFlow({ state: "authenticated" }),
    LOGIN_SCREENS.CHECKING,
  );
});

test("separates connection failures from license blocks during resume", () => {
  assert.equal(
    loginScreenForFlow({ state: "error", code: "network_error" }),
    LOGIN_SCREENS.CONNECTION,
  );
  assert.equal(
    loginScreenForFlow({ state: "error", code: "license_expired" }),
    LOGIN_SCREENS.BLOCKED,
  );
  assert.equal(
    loginScreenForFlow({ state: "error", code: "organization_not_active" }),
    LOGIN_SCREENS.BLOCKED,
  );
});

test("keeps the form available when activation itself cannot finish", () => {
  for (const code of ["network_error", "rate_limited", "activation_invalid", "device_limit_reached"]) {
    assert.equal(
      loginScreenForFlow({ state: "error", code }, { source: "activation" }),
      LOGIN_SCREENS.ACTIVATION,
      `code=${code}`,
    );
  }
});

test("reopens activation when the saved access can no longer be used", () => {
  for (const code of [
    "device_activation_expired",
    "device_not_active",
    "device_revoked",
    "invalid_user_token",
    "member_not_authorized",
  ]) {
    assert.equal(
      loginScreenForFlow({ state: "error", code }),
      LOGIN_SCREENS.ACTIVATION,
      `code=${code}`,
    );
  }
});

test("applies a safe local delay when a rate limit omits retry-after", () => {
  const retry = authRetryState({ code: "over_request_rate_limit" });

  assert.equal(retry.retryAfterSeconds, DEFAULT_RATE_LIMIT_RETRY_SECONDS);
  assert.equal(retry.isRetryBlocked, true);
});

test("maps an outdated backend that still demands MFA to an error state", () => {
  const flow = normalizeAuthFlow({ state: "daily_mfa_required" });

  assert.equal(flow.state, "error");
  assert.equal(flow.code, "daily_mfa_required");
  assert.equal(flow.message, OUTDATED_BACKEND_MESSAGE);
  assert.equal(authFlowErrorMessage(flow), OUTDATED_BACKEND_MESSAGE);
  assert.equal(loginScreenForFlow(flow), LOGIN_SCREENS.BLOCKED);
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

test("recovers an activation if the connection drops after the code may have been accepted", () => {
  assert.equal(
    automaticResumeRetryDelayMs(
      { state: "error", code: "network_error" },
      { source: "activation" },
    ),
    RESUME_NETWORK_RETRY_MS,
  );
  assert.equal(
    automaticResumeRetryDelayMs(
      { state: "error", code: "license_expired" },
      { source: "activation" },
    ),
    RESUME_BLOCKED_RETRY_MS,
  );
  assert.equal(
    automaticResumeRetryDelayMs(
      { state: "error", code: "activation_invalid" },
      { source: "activation" },
    ),
    null,
  );
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
