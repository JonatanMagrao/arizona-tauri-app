import assert from "node:assert/strict";
import test from "node:test";

import { canManageManagersFromApp } from "../supabase/functions/_shared/app-management-permissions.ts";

const email = "jonatan.silva.ext@arizona.global";
const authUserId = "eb8001bd-5816-45d7-9918-93616d9a6ded";
const memberId = "ed370d64-ea34-4ebe-9a44-535b543b8824";
const organizationId = "1b1f3d14-3cea-430f-ba31-d26dbe09af02";
const signedInAt = Math.floor(new Date("2026-10-20T12:00:00.000Z").getTime() / 1000);

const user = (patch = {}) => ({ id: authUserId, email, providers: ["email"], ...patch });
const actor = (patch = {}) => ({
  kind: "member",
  id: memberId,
  organizationId,
  email,
  role: "admin",
  status: "active",
  ...patch,
});
const claims = (method = "otp") => ({
  aal: "aal1",
  amr: [{ method, timestamp: signedInAt }],
});

test("the explicitly authorized active manager can manage managers after activation-code exchange", () => {
  for (const method of ["otp", "magiclink"]) {
    assert.equal(canManageManagersFromApp(user(), actor(), claims(method)), true, method);
  }
});

test("refreshing an activation session preserves its management capability", () => {
  for (const method of ["otp", "magiclink"]) {
    assert.equal(canManageManagersFromApp(user(), actor(), {
      amr: [
        { method, timestamp: signedInAt },
        { method: "token_refresh", timestamp: signedInAt + 3600 },
      ],
    }), true, method);
  }
});

test("the email alone never authorizes another Auth user, member or organization", () => {
  const substitutions = [
    ["different authenticated user", user({ id: "other-auth-user" }), actor()],
    ["different member with the same email", user(), actor({ id: "other-member" })],
    ["different organization with the same email", user(), actor({ organizationId: "other-organization" })],
    ["missing authenticated user id", user({ id: undefined }), actor()],
    ["missing member id", user(), actor({ id: undefined })],
    ["missing organization id", user(), actor({ organizationId: undefined })],
  ];
  for (const [description, authenticatedUser, memberActor] of substitutions) {
    assert.equal(canManageManagersFromApp(authenticatedUser, memberActor, claims()), false, description);
  }
});

test("both the authenticated email and the stored member email must match the grant", () => {
  const substitutions = [
    ["different authenticated email", user({ email: "other@arizona.global" }), actor()],
    ["different member email", user(), actor({ email: "other@arizona.global" })],
    ["missing authenticated email", user({ email: "" }), actor()],
    ["missing member email", user(), actor({ email: "" })],
    ["email suffix impersonation", user({ email: `${email}.example.test` }), actor()],
    ["member email suffix impersonation", user(), actor({ email: `${email}.example.test` })],
  ];
  for (const [description, authenticatedUser, memberActor] of substitutions) {
    assert.equal(canManageManagersFromApp(authenticatedUser, memberActor, claims()), false, description);
  }
});

test("untrusted profile metadata cannot substitute for the authenticated identity", () => {
  const spoofedUser = user({
    id: "other-auth-user",
    email: "other@arizona.global",
    user_metadata: { id: authUserId, email, role: "master" },
    app_metadata: { id: authUserId, email, role: "master" },
  });
  assert.equal(canManageManagersFromApp(spoofedUser, actor(), claims()), false);
});

test("the grant stops applying when the pinned member is no longer an active manager", () => {
  for (const status of ["invited", "revoked", "disabled", "removed", undefined]) {
    assert.equal(canManageManagersFromApp(user(), actor({ status }), claims()), false, String(status));
  }
  for (const role of ["user", "master", undefined]) {
    assert.equal(canManageManagersFromApp(user(), actor({ role }), claims()), false, String(role));
  }
});

test("ordinary managers and standalone master actors do not receive this app-specific grant", () => {
  assert.equal(canManageManagersFromApp(
    user({ id: "another-manager-auth", email: "manager@arizona.global" }),
    actor({ id: "another-manager", email: "manager@arizona.global" }),
    claims(),
  ), false);
  assert.equal(canManageManagersFromApp(user(), {
    kind: "master", id: memberId, email,
  }, claims()), false);
});

test("OAuth sessions keep their separate authorization path even when an activation AMR is present", () => {
  assert.equal(canManageManagersFromApp(user(), actor(), claims("oauth")), false);
  assert.equal(canManageManagersFromApp(user(), actor(), {
    amr: [
      { method: "otp", timestamp: signedInAt },
      { method: "oauth", timestamp: signedInAt - 24 * 3600 },
      { method: "token_refresh", timestamp: signedInAt + 3600 },
    ],
  }), false);
});

test("password, refresh-only and second-factor sessions cannot obtain the activation-session grant", () => {
  for (const method of ["password", "token_refresh", "totp", "phone", "mfa/webauthn", "anonymous", "sso/saml", "passkey"]) {
    assert.equal(canManageManagersFromApp(user(), actor(), claims(method)), false, method);
  }
});

test("missing or malformed activation assurance fails closed", () => {
  for (const assurance of [
    {},
    { amr: [] },
    { amr: "otp" },
    { amr: [{ method: "otp" }] },
    { amr: [{ method: "otp", timestamp: 0 }] },
    { amr: [{ method: "otp", timestamp: "soon" }] },
    { amr: [{ method: "unknown", timestamp: signedInAt }] },
  ]) {
    assert.equal(canManageManagersFromApp(user(), actor(), assurance), false);
  }
});

test("checking the grant leaves the authenticated user, member actor and claims unchanged", () => {
  const authenticatedUser = Object.freeze(user({ providers: Object.freeze(["email"]) }));
  const memberActor = Object.freeze(actor());
  const assurance = Object.freeze({
    aal: "aal1",
    amr: Object.freeze([Object.freeze({ method: "otp", timestamp: signedInAt })]),
  });
  const before = structuredClone({ authenticatedUser, memberActor, assurance });
  assert.equal(canManageManagersFromApp(authenticatedUser, memberActor, assurance), true);
  assert.deepEqual({ authenticatedUser, memberActor, assurance }, before);
});
