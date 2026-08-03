import assert from "node:assert/strict";
import test from "node:test";

import {
  adminGoogleOAuthNotBefore,
  authMethodAt,
  isAtOrAfterSecond,
  latestSignInAt,
  requireRecentGoogleOAuthClaims,
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

test("reads the newest timestamp of a specific method", () => {
  const verifiedAt = authMethodAt({
    amr: [
      { method: "totp", timestamp: stale },
      { method: "totp", timestamp: recent },
      { method: "oauth", timestamp: recent + 600 },
    ],
  }, "totp");
  assert.equal(verifiedAt?.toISOString(), "2026-07-28T12:00:00.000Z");
  assert.equal(authMethodAt({ amr: [{ method: "oauth", timestamp: recent }] }, "totp"), null);
  assert.equal(authMethodAt({}, "totp"), null);
});

test("takes the newest sign-in timestamp across AMR entries", () => {
  const sessionAt = latestSignInAt({
    amr: [
      { method: "password", timestamp: stale },
      { method: "otp", timestamp: recent },
      { method: "magiclink", timestamp: stale },
    ],
  });
  assert.equal(sessionAt?.toISOString(), "2026-07-28T12:00:00.000Z");
});

test("accepts only the activation-code exchange as a sign-in", () => {
  // Anything else is reachable from a session that never presented a code: a
  // session younger than 24h can set a password and re-log with grant_type
  // password, and an email change mints its own AMR entry.
  assert.equal(latestSignInAt({ amr: [{ method: "password", timestamp: recent }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "token_refresh", timestamp: recent }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "oauth", timestamp: recent }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "anonymous", timestamp: recent }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "sso/saml", timestamp: recent }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "passkey", timestamp: recent }] }), null);
  assert.equal(
    latestSignInAt({ amr: [{ method: " OTP ", timestamp: recent }] })?.toISOString(),
    "2026-07-28T12:00:00.000Z",
  );
  assert.equal(
    latestSignInAt({ amr: [{ method: "magiclink", timestamp: recent }] })?.toISOString(),
    "2026-07-28T12:00:00.000Z",
  );
});

test("ignores second factors, which any signed-in session can mint", () => {
  const claims = {
    amr: [
      { method: "otp", timestamp: stale },
      { method: "totp", timestamp: recent },
      { method: "phone", timestamp: recent },
      { method: "mfa/webauthn", timestamp: recent },
    ],
  };
  assert.equal(latestSignInAt(claims)?.toISOString(), "2026-07-27T12:00:00.000Z");
  assert.equal(latestSignInAt({ amr: [{ method: "totp", timestamp: recent }] }), null);
});

test("returns null when no AMR entry has a usable timestamp", () => {
  assert.equal(latestSignInAt({}), null);
  assert.equal(latestSignInAt({ amr: [] }), null);
  assert.equal(latestSignInAt({ amr: "otp" }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "otp", timestamp: "soon" }] }), null);
  assert.equal(latestSignInAt({ amr: [{ method: "otp", timestamp: 0 }] }), null);
});

test("compares whole seconds so a sub-second boundary still accepts the session", () => {
  // AMR timestamps floor to the second; the recovery boundary is captured with
  // milliseconds moments before the session is created.
  const signedIn = new Date("2026-07-28T12:00:05.000Z");
  assert.equal(isAtOrAfterSecond(signedIn, new Date("2026-07-28T12:00:05.400Z")), true);
  assert.equal(isAtOrAfterSecond(signedIn, new Date("2026-07-28T12:00:05.000Z")), true);
  assert.equal(isAtOrAfterSecond(signedIn, new Date("2026-07-28T12:00:06.000Z")), false);
  assert.equal(isAtOrAfterSecond(signedIn, new Date("2026-07-28T12:00:04.900Z")), true);
});
