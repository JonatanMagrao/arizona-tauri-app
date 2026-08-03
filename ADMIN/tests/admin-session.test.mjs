import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_IDLE_TIMEOUT_MS,
  ADMIN_SESSION_MAX_MS,
  adminSessionExpiryReason,
  nextAdminSessionExpiryAt,
  normalizeAdminSessionTiming,
} from "../src/admin-session.js";

const startedAt = Date.parse("2026-07-28T12:00:00.000Z");

test("normalizes timing for an existing Admin session", () => {
  const session = normalizeAdminSessionTiming({ accessToken: "token" }, startedAt);

  assert.equal(session.sessionStartedAt, startedAt);
  assert.equal(session.lastActivityAt, startedAt);
});

test("expires the Admin locally after thirty minutes without activity", () => {
  const session = {
    accessToken: "token",
    sessionStartedAt: startedAt,
    lastActivityAt: startedAt + 10_000,
  };

  assert.equal(
    adminSessionExpiryReason(session, session.lastActivityAt + ADMIN_IDLE_TIMEOUT_MS),
    "inactivity",
  );
});

test("caps the Admin session at eight hours even with recent activity", () => {
  const session = {
    accessToken: "token",
    sessionStartedAt: startedAt,
    lastActivityAt: startedAt + ADMIN_SESSION_MAX_MS - 1_000,
  };

  assert.equal(
    adminSessionExpiryReason(session, startedAt + ADMIN_SESSION_MAX_MS),
    "max_lifetime",
  );
  assert.equal(
    nextAdminSessionExpiryAt(session),
    startedAt + ADMIN_SESSION_MAX_MS,
  );
});
