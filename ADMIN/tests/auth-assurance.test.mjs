import assert from "node:assert/strict";
import test from "node:test";

import {
  requireRecentGoogleOAuthClaims,
  requireRecentTotpClaims,
} from "../supabase/functions/_shared/auth-assurance.ts";

const boundary = new Date("2026-07-28T07:00:00.000Z");
const recent = Math.floor(new Date("2026-07-28T12:00:00.000Z").getTime() / 1000);
const stale = Math.floor(new Date("2026-07-27T12:00:00.000Z").getTime() / 1000);

test("accepts a recent Google OAuth session at aal1", () => {
  const authenticatedAt = requireRecentGoogleOAuthClaims({
    aal: "aal1",
    amr: [{ method: "oauth", timestamp: recent }],
  }, boundary);

  assert.equal(authenticatedAt.toISOString(), "2026-07-28T12:00:00.000Z");
});

test("rejects a password session for the standalone admin", () => {
  assert.throws(
    () => requireRecentGoogleOAuthClaims({
      aal: "aal1",
      amr: [{ method: "password", timestamp: recent }],
    }, boundary),
    /google_oauth_required/,
  );
});

test("requires a new Google login after the daily boundary", () => {
  assert.throws(
    () => requireRecentGoogleOAuthClaims({
      aal: "aal1",
      amr: [{ method: "oauth", timestamp: stale }],
    }, boundary),
    /daily_google_oauth_required/,
  );
});

test("keeps TOTP at aal2 for Tauri members", () => {
  assert.throws(
    () => requireRecentTotpClaims({
      aal: "aal1",
      amr: [{ method: "totp", timestamp: recent }],
    }, boundary),
    /mfa_required/,
  );

  const authenticatedAt = requireRecentTotpClaims({
    aal: "aal2",
    amr: [{ method: "totp", timestamp: recent }],
  }, boundary);
  assert.equal(authenticatedAt.toISOString(), "2026-07-28T12:00:00.000Z");
});
