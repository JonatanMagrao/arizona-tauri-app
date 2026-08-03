import assert from "node:assert/strict";
import test from "node:test";

import {
  adminGoogleOAuthNotBefore,
  masterAuthenticationMethod,
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

test("accepts Google OAuth until the Admin eight-hour boundary", () => {
  const now = new Date("2026-07-28T20:00:00.000Z");
  const notBefore = adminGoogleOAuthNotBefore(now);
  const authenticatedAt = requireRecentGoogleOAuthClaims({
    aal: "aal1",
    amr: [{
      method: "oauth",
      timestamp: Math.floor(new Date("2026-07-28T12:01:00.000Z").getTime() / 1000),
    }],
  }, notBefore);

  assert.equal(notBefore.toISOString(), "2026-07-28T12:00:00.000Z");
  assert.equal(authenticatedAt.toISOString(), "2026-07-28T12:01:00.000Z");
});

test("requires a new Google login after eight hours", () => {
  assert.throws(
    () => requireRecentGoogleOAuthClaims({
      aal: "aal1",
      amr: [{ method: "oauth", timestamp: stale }],
    }, adminGoogleOAuthNotBefore(new Date("2026-07-28T20:00:00.000Z"))),
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

test("keeps Tauri TOTP separate and gives OAuth precedence in Admin tokens", () => {
  assert.equal(
    masterAuthenticationMethod({
      aal: "aal2",
      amr: [{ method: "totp", timestamp: recent }],
    }),
    "totp",
  );
  assert.equal(
    masterAuthenticationMethod({
      aal: "aal2",
      amr: [
        { method: "totp", timestamp: recent },
        { method: "oauth", timestamp: stale },
      ],
    }),
    "oauth",
  );
});
