import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_MODES,
  DEFAULT_RATE_LIMIT_RETRY_SECONDS,
  acquireSubmission,
  authFlowErrorMessage,
  authFlowInstruction,
  authRetryState,
  releaseSubmission,
  shouldResetTotp,
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

test("distinguishes enrollment from an existing TOTP factor", () => {
  assert.match(
    authFlowInstruction("totp_enrollment_required"),
    /QR Code cria uma nova entrada/,
  );
  assert.match(
    authFlowInstruction("totp_required"),
    /entrada Arizona App já cadastrada/,
  );
});

test("explains that an old factor cannot verify a recovery enrollment", () => {
  const flow = { code: "mfa_verification_failed" };

  assert.match(authFlowErrorMessage(flow, AUTH_MODES.ENROLLMENT), /entrada antiga/);
  assert.doesNotMatch(authFlowErrorMessage(flow, AUTH_MODES.TOTP), /entrada antiga/);
  assert.equal(shouldResetTotp(flow), true);
});
