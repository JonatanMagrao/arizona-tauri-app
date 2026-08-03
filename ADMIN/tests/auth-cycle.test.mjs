import assert from "node:assert/strict";
import test from "node:test";

import {
  currentAuthDayStart,
  licenseExpiryInstant,
  nextAuthDayStart,
  normalizeDailyAuthResetHour,
  serverAuthDay,
} from "../supabase/functions/_shared/auth-cycle.ts";

test("uses 04:00 in America/Sao_Paulo as the default reset hour", () => {
  assert.equal(normalizeDailyAuthResetHour(undefined), 4);
  assert.equal(normalizeDailyAuthResetHour("4"), 4);
  assert.equal(normalizeDailyAuthResetHour(24), 4);
});

test("keeps times before 04:00 in the previous authentication day", () => {
  const beforeReset = new Date("2026-07-24T06:59:59.000Z");
  assert.equal(serverAuthDay(beforeReset, 4), "2026-07-23");
  assert.equal(nextAuthDayStart(beforeReset, 4).toISOString(), "2026-07-24T07:00:00.000Z");
});

test("starts a new authentication day at 04:00 in Sao Paulo", () => {
  const atReset = new Date("2026-07-24T07:00:00.000Z");
  assert.equal(serverAuthDay(atReset, 4), "2026-07-24");
  assert.equal(nextAuthDayStart(atReset, 4).toISOString(), "2026-07-25T07:00:00.000Z");
});

test("supports a per-license reset hour", () => {
  const midday = new Date("2026-07-23T15:00:00.000Z");
  assert.equal(serverAuthDay(midday, 12), "2026-07-23");
  assert.equal(nextAuthDayStart(midday, 12).toISOString(), "2026-07-24T15:00:00.000Z");
});

test("returns today's reset boundary after 04:00", () => {
  const afterReset = new Date("2026-07-23T10:00:00.000Z");
  assert.equal(
    currentAuthDayStart(afterReset, 4).toISOString(),
    "2026-07-23T07:00:00.000Z",
  );
});

test("returns yesterday's reset boundary before 04:00", () => {
  const beforeReset = new Date("2026-07-23T06:59:59.000Z");
  assert.equal(
    currentAuthDayStart(beforeReset, 4).toISOString(),
    "2026-07-22T07:00:00.000Z",
  );
});

test("license expires at 04:00 Sao Paulo of the day after the last valid day", () => {
  assert.equal(
    licenseExpiryInstant("2026-07-29", 4).toISOString(),
    "2026-07-30T07:00:00.000Z",
  );
  assert.equal(
    licenseExpiryInstant("2026-07-29", undefined).toISOString(),
    "2026-07-30T07:00:00.000Z",
  );
});

test("license expiry follows the per-license reset hour", () => {
  assert.equal(
    licenseExpiryInstant("2026-07-29", 0).toISOString(),
    "2026-07-30T03:00:00.000Z",
  );
  assert.equal(
    licenseExpiryInstant("2026-07-29", 12).toISOString(),
    "2026-07-30T15:00:00.000Z",
  );
});

test("license expiry rolls over months and years", () => {
  assert.equal(
    licenseExpiryInstant("2026-07-31", 4).toISOString(),
    "2026-08-01T07:00:00.000Z",
  );
  assert.equal(
    licenseExpiryInstant("2026-12-31", 4).toISOString(),
    "2027-01-01T07:00:00.000Z",
  );
});

test("license expiry accepts a timestamp prefix and rejects bad input", () => {
  assert.equal(
    licenseExpiryInstant("2026-07-29T00:00:00+00:00", 4).toISOString(),
    "2026-07-30T07:00:00.000Z",
  );
  assert.equal(licenseExpiryInstant(null, 4), null);
  assert.equal(licenseExpiryInstant(undefined, 4), null);
  assert.equal(licenseExpiryInstant("", 4), null);
  assert.equal(licenseExpiryInstant("29/07/2026", 4), null);
  assert.equal(licenseExpiryInstant("2026-02-30", 4), null);
});
