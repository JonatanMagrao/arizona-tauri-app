import assert from "node:assert/strict";
import test from "node:test";

import {
  currentAuthDayStart,
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
