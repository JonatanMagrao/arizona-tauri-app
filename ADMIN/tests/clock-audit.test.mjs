import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { accessPolicy } from "../supabase/functions/_shared/access-policy.ts";
import {
  boundedClockSkewSeconds,
  CLOCK_AUDIT_INTERVAL_MS,
  shouldRecordClockAudit,
} from "../supabase/functions/_shared/clock-audit.ts";

const nowMillis = Date.parse("2026-08-24T12:00:00.000Z");
const validateLicenseSource = readFileSync(
  new URL("../supabase/functions/validate-license/index.ts", import.meta.url),
  "utf8",
);

// Execute the endpoint's actual clock checks without its network calls or
// Deno server. Keep the production policy and date parsing in this fixture.
const parseDateStart = validateLicenseSource.indexOf("function parseDate(");
const parseDateEnd = validateLicenseSource.indexOf("\nDeno.serve(", parseDateStart);
const clockChecksStart = validateLicenseSource.indexOf("    const clockToleranceSeconds =");
const clockChecksEnd = validateLicenseSource.indexOf("\n    await admin", clockChecksStart);
assert.ok(parseDateStart >= 0 && parseDateEnd > parseDateStart);
assert.ok(clockChecksStart >= 0 && clockChecksEnd > clockChecksStart);
const clockCheckSource = stripTypeScriptTypes([
  validateLicenseSource.slice(parseDateStart, parseDateEnd),
  validateLicenseSource.slice(clockChecksStart, clockChecksEnd),
].join("\n"));
const evaluateClock = new Function(
  "accessPolicy",
  "body",
  "now",
  "organization = {}",
  `${clockCheckSource}\nreturn { clockStatus, clockSkewSeconds };`,
).bind(null, accessPolicy);

function clockTime(offsetSeconds) {
  return new Date(nowMillis + offsetSeconds * 1000).toISOString();
}

test("license validation accepts clock differences through one hour in either direction", () => {
  for (const offsetSeconds of [-3600, -627, 0, 627, 3600]) {
    assert.deepEqual(
      evaluateClock({ clientLocalTime: clockTime(offsetSeconds) }, new Date(nowMillis)),
      { clockStatus: "ok", clockSkewSeconds: offsetSeconds },
      `clock offset ${offsetSeconds}s`,
    );
  }
});

test("license validation rejects clocks more than one hour ahead or behind", () => {
  for (const offsetSeconds of [-3601, 3601]) {
    assert.deepEqual(
      evaluateClock({ clientLocalTime: clockTime(offsetSeconds) }, new Date(nowMillis)),
      { clockStatus: "suspicious", clockSkewSeconds: offsetSeconds },
      `clock offset ${offsetSeconds}s`,
    );
  }
});

test("license validation allows one hour of rollback against each saved clock marker", () => {
  for (const marker of ["lastLocalTimeSeen", "lastServerTimeSeen"]) {
    for (const secondsAhead of [627, 3600, 3601]) {
      assert.deepEqual(
        evaluateClock({
          clientLocalTime: clockTime(0),
          [marker]: clockTime(secondsAhead),
        }, new Date(nowMillis)),
        {
          clockStatus: secondsAhead > 3600 ? "suspicious" : "ok",
          clockSkewSeconds: 0,
        },
        `${marker} ${secondsAhead}s ahead of the current clock`,
      );
    }
  }
});

test("license validation applies the configured tolerance to offsets and saved clock markers", () => {
  for (const minutes of [1, 5, 15, 120, 1440]) {
    const organization = { clock_tolerance_minutes: minutes };
    const boundarySeconds = minutes * 60;
    for (const direction of [-1, 1]) {
      for (const excessSeconds of [0, 1]) {
        const offsetSeconds = direction * (boundarySeconds + excessSeconds);
        assert.deepEqual(
          evaluateClock({ clientLocalTime: clockTime(offsetSeconds) }, new Date(nowMillis), organization),
          {
            clockStatus: excessSeconds ? "suspicious" : "ok",
            clockSkewSeconds: offsetSeconds,
          },
          `${minutes}min tolerance, offset ${offsetSeconds}s`,
        );
      }
    }
    for (const marker of ["lastLocalTimeSeen", "lastServerTimeSeen"]) {
      for (const excessSeconds of [0, 1]) {
        assert.deepEqual(
          evaluateClock({
            clientLocalTime: clockTime(0),
            [marker]: clockTime(boundarySeconds + excessSeconds),
          }, new Date(nowMillis), organization),
          {
            clockStatus: excessSeconds ? "suspicious" : "ok",
            clockSkewSeconds: 0,
          },
          `${minutes}min tolerance, ${marker} ${boundarySeconds + excessSeconds}s ahead`,
        );
      }
    }
  }
});

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
