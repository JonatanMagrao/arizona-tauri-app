import assert from "node:assert/strict";
import test from "node:test";

import { deviceSwitchLock } from "../supabase/functions/_shared/device-switch.ts";

test("allows an immediate release when the interval is zero", () => {
  assert.equal(
    deviceSwitchLock("2026-07-23T12:00:00.000Z", 0, new Date("2026-07-23T12:00:01.000Z")),
    null,
  );
});

test("blocks release until the configured number of days after activation", () => {
  assert.deepEqual(
    deviceSwitchLock(
      "2026-07-23T12:00:00.000Z",
      7,
      new Date("2026-07-25T12:00:00.000Z"),
    ),
    {
      retryAfterSeconds: 5 * 86_400,
      retryAt: "2026-07-30T12:00:00.000Z",
    },
  );
});

test("allows release as soon as the interval has elapsed", () => {
  assert.equal(
    deviceSwitchLock(
      "2026-07-23T12:00:00.000Z",
      7,
      new Date("2026-07-30T12:00:00.000Z"),
    ),
    null,
  );
});
