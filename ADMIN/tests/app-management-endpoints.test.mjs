import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const ORGANIZATION_ID = "1b1f3d14-3cea-430f-ba31-d26dbe09af02";
const OWNER_AUTH_ID = "eb8001bd-5816-45d7-9918-93616d9a6ded";
const OWNER_MEMBER_ID = "ed370d64-ea34-4ebe-9a44-535b543b8824";
const OWNER_EMAIL = "jonatan.silva.ext@arizona.global";
const OTHER_AUTH_ID = "other-admin-auth";
const OTHER_MEMBER_ID = "other-admin-member";
const TARGET_MEMBER_ID = "target-manager-member";
const MASTER_MEMBER_ID = "protected-master-member";
const FIXTURE_KEY = "arizona.app-management-endpoints.fixture";

// Replace only the network boundary. The actual actors, JWT claims, permission
// policy, rate limits and endpoint handlers execute against the fixture below.
const supabaseStubUrl = `data:text/javascript,${encodeURIComponent(`
  const state = () => globalThis[Symbol.for(${JSON.stringify(FIXTURE_KEY)})];
  export const createAdminClient = () => state().client;
  export function bearerToken(request) {
    const value = request.headers.get("authorization");
    if (!value?.startsWith("Bearer ")) throw new Error("missing_bearer_token");
    return value.slice(7);
  }
  export function requirePublishableKey(request) {
    if (request.headers.get("apikey") !== "test-publishable-key") {
      throw new Error("invalid_publishable_key");
    }
  }
  export async function getAuthUser(request) {
    if (bearerToken(request) !== state().token) throw new Error("invalid_user_token");
    return state().user;
  }
`)}`;

const supabaseModuleUrl = new URL("../supabase/functions/_shared/supabase.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith("file:")
      && new URL(specifier, context.parentURL).href === supabaseModuleUrl) {
      return { url: supabaseStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const handlers = {};
const previousDeno = globalThis.Deno;
try {
  for (const endpoint of [
    "admin-list-members",
    "admin-release-device",
    "admin-remove-member",
    "admin-generate-activation-code",
  ]) {
    globalThis.Deno = { serve(handler) { handlers[endpoint] = handler; } };
    await import(new URL(`../supabase/functions/${endpoint}/index.ts`, import.meta.url));
    assert.equal(typeof handlers[endpoint], "function");
  }
} finally {
  hooks.deregister();
  if (previousDeno === undefined) delete globalThis.Deno;
  else globalThis.Deno = previousDeno;
}

function member(id, authId, email, role = "admin") {
  return {
    id,
    auth_user_id: authId,
    organization_id: ORGANIZATION_ID,
    name: email.split("@")[0],
    email,
    role,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    device_bind_not_before: "2026-01-01T00:00:00.000Z",
    device_bind_expires_at: "2099-01-01T00:00:00.000Z",
  };
}

function fixture({ actor = "owner", organizationStatus = "active" } = {}) {
  const rows = {
    organizations: [{
      id: ORGANIZATION_ID,
      name: "Arizona",
      status: organizationStatus,
      seats_allowed: 11,
      license_expires_on: "2099-12-31",
      daily_auth_reset_hour: 4,
      device_switch_interval_days: 0,
    }],
    members: [
      member(OWNER_MEMBER_ID, OWNER_AUTH_ID, OWNER_EMAIL),
      member(OTHER_MEMBER_ID, OTHER_AUTH_ID, "other-admin@arizona.global"),
      member(TARGET_MEMBER_ID, "target-manager-auth", "target-manager@arizona.global"),
      member(MASTER_MEMBER_ID, "protected-master-auth", "protected-master@arizona.global", "user"),
    ],
    master_accounts: [{
      id: "protected-master-account",
      auth_user_id: "protected-master-auth",
      email: "protected-master@arizona.global",
      status: "active",
    }],
    devices: [{
      id: "target-device",
      organization_id: ORGANIZATION_ID,
      member_id: TARGET_MEMBER_ID,
      install_id: "target-installation",
      device_label: "Target computer",
      status: "active",
      activated_at: "2026-01-01T00:00:00.000Z",
    }],
    license_sessions: [{
      id: "target-session",
      member_id: TARGET_MEMBER_ID,
      device_id: "target-device",
      status: "active",
    }],
    activation_codes: [],
    audit_log: [],
  };
  const actorMemberId = actor === "master" ? MASTER_MEMBER_ID : actor === "owner" ? OWNER_MEMBER_ID : OTHER_MEMBER_ID;
  const selectedActor = rows.members.find((row) => row.id === actorMemberId);
  const state = {
    rows,
    user: { id: selectedActor.auth_user_id, email: selectedActor.email, providers: actor === "master" ? ["google"] : ["email"] },
    mutations: [],
    rateLimits: [],
    blockedRateLimit: null,
  };

  class Query {
    constructor(table) {
      assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`);
      this.table = table;
      this.filters = [];
      this.operation = "select";
      this.maximum = Infinity;
    }
    select() { return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order() { return this; }
    limit(maximum) { this.maximum = maximum; return this; }
    update(patch) { this.operation = "update"; this.patch = patch; return this; }
    insert(patch) { this.operation = "insert"; this.patch = patch; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      let result = rows[this.table].filter((row) => this.filters.every((filter) => filter(row))).slice(0, this.maximum);
      if (this.operation === "update") {
        state.mutations.push({ table: this.table, operation: "update", ids: result.map((row) => row.id), patch: this.patch });
        for (const row of result) Object.assign(row, this.patch);
      } else if (this.operation === "insert") {
        const inserted = { id: `inserted-${this.table}-${rows[this.table].length}`, ...this.patch };
        rows[this.table].push(inserted);
        state.mutations.push({ table: this.table, operation: "insert", patch: this.patch });
        result = [inserted];
      }
      if (single) assert.ok(result.length <= 1, `Expected one ${this.table} row`);
      return { data: single ? result[0] ?? null : result, error: null };
    }
  }

  state.client = {
    schema(name) { assert.equal(name, "licensing"); return this; },
    from(table) { return new Query(table); },
    async rpc(name, parameters) {
      if (name === "consumed_seats") return { data: 4, error: null };
      if (name === "is_active_master_email") return { data: false, error: null };
      assert.equal(name, "consume_rate_limit_v2");
      state.rateLimits.push(parameters.target_action);
      return {
        data: { allowed: parameters.target_action !== state.blockedRateLimit, retry_after_seconds: 60 },
        error: null,
      };
    },
  };
  return state;
}

async function invoke(endpoint, state, body = {}, claims = {}) {
  const payload = {
    sub: state.user.id,
    amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
    ...claims,
  };
  state.token = `test.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  globalThis[Symbol.for(FIXTURE_KEY)] = state;
  const response = await handlers[endpoint](new Request(`https://example.invalid/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: "test-publishable-key",
      authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({ organizationId: ORGANIZATION_ID, ...body }),
  }));
  return { status: response.status, body: await response.json() };
}

function assertNoTargetMutation(state) {
  assert.equal(state.rows.members.find((row) => row.id === TARGET_MEMBER_ID)?.status, "active");
  assert.equal(state.rows.devices[0].status, "active");
  assert.equal(state.rows.license_sessions[0].status, "active");
  assert.equal(state.rows.activation_codes.length, 0);
  assert.equal(state.rows.audit_log.length, 0);
  assert.equal(state.mutations.some((mutation) => mutation.patch.device_bind_not_before === null), false);
}

test("app management handlers apply the exclusive permission at the authenticated boundary", async (t) => {
  t.mock.method(console, "error", () => {});
  t.after(() => { delete globalThis[Symbol.for(FIXTURE_KEY)]; });

  await t.test("every management endpoint rejects missing or invalid publishable keys before authentication", async () => {
    for (const endpoint of Object.keys(handlers)) {
      for (const publishableKey of [null, "invalid-publishable-key"]) {
        const state = fixture();
        globalThis[Symbol.for(FIXTURE_KEY)] = {
          get client() { assert.fail("An invalid API key must not create an admin client"); },
          get user() { assert.fail("An invalid API key must not resolve an authenticated user"); },
        };
        const headers = { "content-type": "application/json" };
        if (publishableKey !== null) headers.apikey = publishableKey;
        const response = await handlers[endpoint](new Request(`https://example.invalid/${endpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ organizationId: ORGANIZATION_ID, memberId: TARGET_MEMBER_ID }),
        }));
        const body = await response.json();
        assert.equal(response.status, 401, endpoint);
        assert.equal(body.error.code, "invalid_publishable_key", endpoint);
        assertNoTargetMutation(state);
        assert.equal(state.mutations.length, 0);
        assert.equal(state.rateLimits.length, 0);
      }
    }
  });

  await t.test("lists the pinned app identity with manager controls and no master account or OAuth", async () => {
    const state = fixture();
    const result = await invoke("admin-list-members", state);
    assert.equal(result.status, 200);
    assert.equal(result.body.canManageManagers, true);
    assert.equal(result.body.actor.kind, "member");
    assert.equal(result.body.currentMemberId, OWNER_MEMBER_ID);
    assert.equal(state.rows.master_accounts.some((row) => row.auth_user_id === OWNER_AUTH_ID), false);
  });

  await t.test("releases another manager and revokes its session with member audit attribution", async () => {
    const state = fixture();
    const result = await invoke("admin-release-device", state, { memberId: TARGET_MEMBER_ID });
    assert.equal(result.status, 200);
    assert.equal(result.body.released, true);
    assert.equal(state.rows.devices[0].status, "revoked");
    assert.equal(state.rows.license_sessions[0].status, "revoked");
    assert.equal(state.rows.members.find((row) => row.id === TARGET_MEMBER_ID).device_bind_not_before, null);
    assert.equal(state.rows.audit_log[0].actor_member_id, OWNER_MEMBER_ID);
    assert.equal(state.rows.audit_log[0].actor_master_id, null);
  });

  await t.test("a Google OAuth master retains manager controls and can release another manager", async () => {
    const oauthClaims = { amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) }] };
    const listed = await invoke("admin-list-members", fixture({ actor: "master" }), {}, oauthClaims);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.canManageManagers, true);
    assert.equal(listed.body.actor.kind, "master");
    assert.equal(listed.body.actor.id, "protected-master-account");

    const releaseState = fixture({ actor: "master" });
    const released = await invoke("admin-release-device", releaseState, { memberId: TARGET_MEMBER_ID }, oauthClaims);
    assert.equal(released.status, 200);
    assert.equal(released.body.released, true);
    assert.equal(releaseState.rows.devices[0].status, "revoked");
    assert.equal(releaseState.rows.license_sessions[0].status, "revoked");
    assert.equal(releaseState.rows.audit_log[0].actor_master_id, "protected-master-account");
    assert.equal(releaseState.rows.audit_log[0].actor_member_id, null);
  });

  await t.test("a master with expired Google OAuth must reauthenticate before listing or releasing", async () => {
    const staleClaims = { amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 9 * 60 * 60 }] };
    for (const endpoint of ["admin-list-members", "admin-release-device"]) {
      const state = fixture({ actor: "master" });
      const result = await invoke(endpoint, state, { memberId: TARGET_MEMBER_ID }, staleClaims);
      assert.equal(result.status, 401, endpoint);
      assert.equal(result.body.error.code, "admin_google_oauth_required", endpoint);
      assertNoTargetMutation(state);
      assert.equal(state.mutations.length, 0);
      assert.equal(state.rateLimits.length, 0);
    }
  });

  await t.test("removes another manager with the same exclusive permission", async () => {
    const state = fixture();
    const result = await invoke("admin-remove-member", state, { memberId: TARGET_MEMBER_ID });
    assert.equal(result.status, 200);
    assert.equal(result.body.member.status, "revoked");
    assert.equal(state.rows.devices[0].status, "revoked");
    assert.equal(state.rows.license_sessions[0].status, "revoked");
    assert.equal(state.rows.audit_log[0].actor_member_id, OWNER_MEMBER_ID);
  });

  await t.test("generates a recovery code for another manager", async () => {
    const state = fixture();
    const result = await invoke("admin-generate-activation-code", state, { memberId: TARGET_MEMBER_ID });
    assert.equal(result.status, 200);
    assert.equal(result.body.activation.memberId, TARGET_MEMBER_ID);
    assert.equal(result.body.activation.purpose, "recovery");
    assert.equal(result.body.activation.code.replaceAll("-", "").length, 12);
    assert.equal(state.rows.activation_codes[0].created_by_member_id, OWNER_MEMBER_ID);
    assert.equal(state.rows.activation_codes[0].created_by_master_id, null);
  });

  for (const endpoint of ["admin-release-device", "admin-remove-member", "admin-generate-activation-code"]) {
    await t.test(`${endpoint} refuses another admin despite owner details supplied in the body`, async () => {
      const state = fixture({ actor: "other" });
      const result = await invoke(endpoint, state, {
        memberId: TARGET_MEMBER_ID,
        authUserId: OWNER_AUTH_ID,
        email: OWNER_EMAIL,
        actor: { id: OWNER_MEMBER_ID, role: "master" },
      });
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, "forbidden");
      assertNoTargetMutation(state);
    });

    await t.test(`${endpoint} refuses a changed Auth ID even when the email and member match`, async () => {
      const state = fixture();
      state.user.id = "different-auth-id";
      state.rows.members.find((row) => row.id === OWNER_MEMBER_ID).auth_user_id = state.user.id;
      const result = await invoke(endpoint, state, { memberId: TARGET_MEMBER_ID });
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, "forbidden");
      assertNoTargetMutation(state);
    });

    await t.test(`${endpoint} preserves the protection of a master target`, async () => {
      const state = fixture();
      const result = await invoke(endpoint, state, { memberId: MASTER_MEMBER_ID });
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, "protected_identity");
      assert.equal(state.rows.members.find((row) => row.id === MASTER_MEMBER_ID).status, "active");
      assertNoTargetMutation(state);
    });
  }

  await t.test("another admin receives no manager controls", async () => {
    const result = await invoke("admin-list-members", fixture({ actor: "other" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.canManageManagers, false);
  });

  await t.test("a changed member ID does not inherit manager controls", async () => {
    const state = fixture();
    state.rows.members.find((row) => row.id === OWNER_MEMBER_ID).id = "different-member-id";
    const result = await invoke("admin-list-members", state);
    assert.equal(result.status, 200);
    assert.equal(result.body.canManageManagers, false);
  });

  for (const endpoint of ["admin-remove-member", "admin-generate-activation-code"]) {
    await t.test(`${endpoint} still refuses the authorized user's own member`, async () => {
      const state = fixture();
      const result = await invoke(endpoint, state, { memberId: OWNER_MEMBER_ID });
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, "forbidden");
      assert.equal(state.rows.members.find((row) => row.id === OWNER_MEMBER_ID).status, "active");
      assertNoTargetMutation(state);
    });
  }

  await t.test("the authorized account still respects the device switch interval before revocation", async () => {
    const state = fixture();
    state.rows.organizations[0].device_switch_interval_days = 7;
    state.rows.devices[0].activated_at = new Date().toISOString();
    const result = await invoke("admin-release-device", state, { memberId: TARGET_MEMBER_ID });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "device_switch_interval");
    assertNoTargetMutation(state);
  });

  await t.test("the authorized account still respects the member release rate limit before revocation", async () => {
    const state = fixture();
    state.blockedRateLimit = "device.release.member";
    const result = await invoke("admin-release-device", state, { memberId: TARGET_MEMBER_ID });
    assert.equal(result.status, 429);
    assert.equal(result.body.error.code, "rate_limited");
    assert.ok(state.rateLimits.includes("device.release.member"));
    assertNoTargetMutation(state);
  });
});
