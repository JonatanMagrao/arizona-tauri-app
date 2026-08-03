import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_BIND_GRANT_TTL_MINUTES,
  deviceBindGrantExpiryInstant,
  hasDeviceBindGrant,
} from "../supabase/functions/_shared/device-bind-grant.ts";

const issuedAt = "2026-08-03T12:00:00.000Z";
const expiresAt = "2026-08-03T12:30:00.000Z";
const now = new Date("2026-08-03T12:10:00.000Z");

test("the grant bounds an abandoned activation to half an hour", () => {
  assert.equal(DEVICE_BIND_GRANT_TTL_MINUTES, 30);
  assert.equal(
    deviceBindGrantExpiryInstant(new Date(issuedAt)).toISOString(),
    expiresAt,
  );
});

test("accepts the session the activation created", () => {
  assert.equal(
    hasDeviceBindGrant(issuedAt, expiresAt, new Date("2026-08-03T12:00:00.000Z"), now),
    true,
  );
  assert.equal(
    hasDeviceBindGrant(issuedAt, expiresAt, new Date("2026-08-03T12:30:00.000Z"), now),
    true,
  );
});

test("rejects a session older than the grant, which never saw the code", () => {
  assert.equal(
    hasDeviceBindGrant(issuedAt, expiresAt, new Date("2026-08-03T11:59:58.000Z"), now),
    false,
  );
});

test("compares whole seconds, since AMR timestamps floor to the second", () => {
  assert.equal(
    hasDeviceBindGrant(
      "2026-08-03T12:00:00.400Z",
      expiresAt,
      new Date("2026-08-03T12:00:00.000Z"),
      now,
    ),
    true,
  );
});

test("rejects an expired grant", () => {
  assert.equal(
    hasDeviceBindGrant(
      issuedAt,
      expiresAt,
      new Date("2026-08-03T12:00:00.000Z"),
      new Date(expiresAt),
    ),
    false,
  );
  assert.equal(
    hasDeviceBindGrant(
      issuedAt,
      expiresAt,
      new Date("2026-08-03T12:00:00.000Z"),
      new Date("2026-08-04T12:00:01.000Z"),
    ),
    false,
  );
});

test("rejects when either column is absent, so a cleared grant cannot be replayed", () => {
  const signedIn = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(hasDeviceBindGrant(null, null, signedIn, now), false);
  assert.equal(hasDeviceBindGrant(issuedAt, null, signedIn, now), false);
  assert.equal(hasDeviceBindGrant(null, expiresAt, signedIn, now), false);
  assert.equal(hasDeviceBindGrant("", "", signedIn, now), false);
  assert.equal(hasDeviceBindGrant("not-a-date", expiresAt, signedIn, now), false);
  assert.equal(hasDeviceBindGrant(issuedAt, 1754222400000, signedIn, now), false);
});

test("rejects a session with no usable sign-in claim", () => {
  assert.equal(hasDeviceBindGrant(issuedAt, expiresAt, null, now), false);
});
