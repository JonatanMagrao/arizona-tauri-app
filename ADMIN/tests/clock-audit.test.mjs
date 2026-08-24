import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  boundedClockSkewSeconds,
  CLOCK_AUDIT_INTERVAL_MS,
  shouldRecordClockAudit,
} from "../supabase/functions/_shared/clock-audit.ts";

const nowMillis = Date.parse("2026-08-24T12:00:00.000Z");

function decision(overrides = {}) {
  return shouldRecordClockAudit({
    currentStatus: "ok",
    latestStatus: "ok",
    latestCreatedAtMillis: nowMillis - 1_000,
    nowMillis,
    ...overrides,
  });
}

test("clock audits record first observations and status transitions immediately", () => {
  assert.equal(decision({ latestStatus: null, latestCreatedAtMillis: null }), true);
  assert.equal(decision({ currentStatus: "suspicious", latestStatus: "ok" }), true);
  assert.equal(decision({ currentStatus: "ok", latestStatus: "suspicious" }), true);
});

test("repeated suspicious clock denials are limited to one per hour", () => {
  assert.equal(decision({ currentStatus: "suspicious", latestStatus: "suspicious" }), false);
  assert.equal(decision({
    currentStatus: "suspicious",
    latestStatus: "suspicious",
    latestCreatedAtMillis: nowMillis - CLOCK_AUDIT_INTERVAL_MS,
  }), true);
});

test("extreme device clocks remain representable by PostgreSQL integer", () => {
  assert.equal(boundedClockSkewSeconds(null), null);
  assert.equal(boundedClockSkewSeconds(301), 301);
  assert.equal(boundedClockSkewSeconds(Number.POSITIVE_INFINITY), null);
  assert.equal(boundedClockSkewSeconds(9_999_999_999), 2_147_483_647);
  assert.equal(boundedClockSkewSeconds(-9_999_999_999), -2_147_483_648);
});

test("activity view keeps clock details minimal and accessible only to the backend", () => {
  const migration = readFileSync(
    fileURLToPath(new URL(
      "../supabase/migrations/20260824120000_clock_suspicious_activity_log.sql",
      import.meta.url,
    )),
    "utf8",
  );

  assert.doesNotMatch(migration, /alter\s+column|drop\s+column/u);
  assert.match(migration, /view licensing\.activity_log[\s\S]*security_invoker = true/u);
  assert.match(migration, /'access\.clock_suspicious'::text as action/u);
  assert.match(migration, /where clock\.status = 'suspicious'/u);
  assert.match(migration, /'clockSkewSeconds', clock\.clock_skew_seconds/u);
  assert.match(
    migration,
    /revoke all on table licensing\.activity_log from public, anon, authenticated, service_role/u,
  );
  assert.match(migration, /grant select on table licensing\.activity_log to service_role/u);
  assert.match(migration, /notify pgrst, 'reload schema'/u);
  assert.doesNotMatch(migration, /client_local_time|last_server_time_seen|last_local_time_seen/u);
});

test("clock audit failures remain fail-open and the Admin reads the unified view", () => {
  const validateLicense = readFileSync(
    fileURLToPath(new URL(
      "../supabase/functions/validate-license/index.ts",
      import.meta.url,
    )),
    "utf8",
  );
  const listAuditLog = readFileSync(
    fileURLToPath(new URL(
      "../supabase/functions/master-list-audit-log/index.ts",
      import.meta.url,
    )),
    "utf8",
  );

  assert.match(validateLicense, /error: latestClockAuditError/u);
  assert.match(validateLicense, /error: clockAuditError/u);
  assert.match(validateLicense, /validate-license clock audit insert failed/u);
  assert.match(
    validateLicense,
    /if \(clockStatus === "suspicious"\) \{\s*return errorResponse\("clock_suspicious"/u,
  );
  assert.match(listAuditLog, /\.from\("activity_log"\)/u);
  assert.match(
    listAuditLog,
    /action === CLOCK_SUSPICIOUS_AUDIT_ACTION[\s\S]*optionalNumber\(metadata\.clockSkewSeconds\)/u,
  );
});
