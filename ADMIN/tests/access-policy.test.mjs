import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  ACCESS_POLICY_SELECT,
  DEFAULT_ACCESS_POLICY,
  accessPolicy,
  accessPolicyColumns,
} from "../supabase/functions/_shared/access-policy.ts";

const FIXTURE_KEY = Symbol.for("arizona.clock-tolerance.fixture");
const functionsUrl = new URL("../supabase/functions/", import.meta.url).href;
const supabaseUrl = new URL("_shared/supabase.ts", functionsUrl).href;
const supabaseStubUrl = `data:text/javascript,${encodeURIComponent(`
  const state = () => globalThis[Symbol.for("arizona.clock-tolerance.fixture")];
  export const createAdminClient = () => state().client;
  export const getAuthUser = async () => state().user;
  export function requirePublishableKey(request) {
    if (request.headers.get("apikey") !== "test-publishable-key") {
      throw new Error("invalid_publishable_key");
    }
  }
  export function bearerToken(request) {
    const value = request.headers.get("authorization");
    if (!value?.startsWith("Bearer ")) throw new Error("missing_bearer_token");
    return value.slice(7);
  }
`)}`;

// Isolate the handler's module graph from other endpoint fixtures while
// executing the real policy parsing, master resolution and Google OAuth gate.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(functionsUrl) && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (url.href === supabaseUrl) return { url: supabaseStubUrl, shortCircuit: true };
      url.search = "clock-tolerance-test";
      return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let handler;
const previousDeno = globalThis.Deno;
try {
  globalThis.Deno = { serve(value) { handler = value; } };
  await import(new URL("master-create-organization/index.ts?clock-tolerance-test", functionsUrl));
} finally {
  hooks.deregister();
  if (previousDeno === undefined) delete globalThis.Deno;
  else globalThis.Deno = previousDeno;
}
assert.equal(typeof handler, "function");

function fixture({ existing = true, tolerance = 90, concurrentTolerance } = {}) {
  const rows = {
    organizations: existing ? [{
      id: "organization",
      name: "Arizona",
      slug: "arizona",
      status: "active",
      seats_allowed: 10,
      allowed_email_domain: "arizona.global",
      license_expires_on: null,
      daily_auth_reset_hour: 4,
      ...accessPolicyColumns(DEFAULT_ACCESS_POLICY),
      clock_tolerance_minutes: tolerance,
    }] : [],
    members: [],
    master_accounts: [{
      id: "master",
      auth_user_id: "master-auth",
      email: "master@arizona.global",
      status: "active",
    }],
    audit_log: [],
  };
  const state = {
    rows,
    mutations: [],
    user: { id: "master-auth", email: "master@arizona.global", providers: ["google"] },
  };

  class Query {
    constructor(table) {
      assert.ok(Object.hasOwn(rows, table), `Unexpected table ${table}`);
      this.table = table;
      this.filters = [];
      this.operation = "select";
    }
    select() { return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    update(patch) { this.operation = "update"; this.patch = patch; return this; }
    insert(patch) { this.operation = "insert"; this.patch = patch; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      let result = rows[this.table].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") {
        if (this.table === "organizations" && concurrentTolerance !== undefined) {
          rows.organizations[0].clock_tolerance_minutes = concurrentTolerance;
        }
        state.mutations.push({ table: this.table, patch: this.patch });
        for (const row of result) Object.assign(row, this.patch);
      } else if (this.operation === "insert") {
        const values = Array.isArray(this.patch) ? this.patch : [this.patch];
        result = values.map((value) => ({ id: `inserted-${this.table}`, ...value }));
        rows[this.table].push(...result);
        state.mutations.push({ table: this.table, patch: this.patch });
      }
      if (single) assert.ok(result.length <= 1);
      return { data: structuredClone(single ? result[0] ?? null : result), error: null };
    }
  }

  state.client = {
    schema(name) { assert.equal(name, "licensing"); return this; },
    from(table) { return new Query(table); },
    async rpc(name) {
      if (name === "consumed_seats") return { data: 0, error: null };
      assert.equal(name, "consume_rate_limit_v2");
      return { data: { allowed: true }, error: null };
    },
  };
  return state;
}

async function saveLicense(state, body = {}, method = "oauth") {
  globalThis[FIXTURE_KEY] = state;
  const claims = { sub: state.user.id, amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] };
  const token = `test.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const response = await handler(new Request("https://example.invalid/master-create-organization", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: "test-publishable-key",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ seatsAllowed: 10, licenseIsIndefinite: true, users: [], ...body }),
  }));
  return { status: response.status, body: await response.json() };
}

test("clock tolerance policy reads configured minutes and defaults legacy rows to one hour", () => {
  assert.ok(ACCESS_POLICY_SELECT.split(",").includes("clock_tolerance_minutes"));
  for (const row of [undefined, null, {}, { clock_tolerance_minutes: 0 }, { clock_tolerance_minutes: 1441 }]) {
    assert.equal(accessPolicy(row).clockToleranceMinutes, 60);
  }
  for (const minutes of [1, 60, 90, 1440]) {
    const policy = accessPolicy({ clock_tolerance_minutes: minutes });
    assert.equal(policy.clockToleranceMinutes, minutes);
    assert.equal(accessPolicyColumns(policy).clock_tolerance_minutes, minutes);
  }
});

test("master license save persists valid tolerance values and audits the saved policy", async () => {
  for (const minutes of [1, "90", 1440]) {
    const state = fixture();
    const result = await saveLicense(state, { clockToleranceMinutes: minutes });
    assert.equal(result.status, 200);
    assert.equal(state.rows.organizations[0].clock_tolerance_minutes, Number(minutes));
    assert.equal(result.body.organization.clock_tolerance_minutes, Number(minutes));
    assert.equal(state.rows.audit_log[0].metadata.target.accessPolicy.clockToleranceMinutes, Number(minutes));
  }
});

test("master license save rejects empty, fractional, boolean and out-of-range tolerances", async () => {
  for (const value of ["", " ", null, false, true, [], {}, 0, -1, 1.5, "1.5", 1441, "invalid"]) {
    const state = fixture();
    const result = await saveLicense(state, { clockToleranceMinutes: value });
    assert.equal(result.status, 400, JSON.stringify(value));
    assert.equal(result.body.error.code, "invalid_access_policy");
    assert.equal(state.mutations.length, 0);
  }
});

test("legacy saves preserve the configured tolerance including concurrent changes", async () => {
  for (const concurrentTolerance of [undefined, 120]) {
    const state = fixture({ tolerance: 90, concurrentTolerance });
    const result = await saveLicense(state);
    const expectedMinutes = concurrentTolerance ?? 90;
    assert.equal(result.status, 200);
    assert.equal(state.rows.organizations[0].clock_tolerance_minutes, expectedMinutes);
    assert.equal(result.body.organization.clock_tolerance_minutes, expectedMinutes);
    const update = state.mutations.find((mutation) => mutation.table === "organizations");
    assert.equal(Object.hasOwn(update.patch, "clock_tolerance_minutes"), false);
    assert.equal(state.rows.audit_log[0].metadata.target.accessPolicy.clockToleranceMinutes, expectedMinutes);
  }
});

test("new licenses default to one hour when older clients omit clock tolerance", async () => {
  const state = fixture({ existing: false });
  const result = await saveLicense(state);
  assert.equal(result.status, 200);
  assert.equal(state.rows.organizations[0].clock_tolerance_minutes, 60);
});

test("changing clock tolerance retains the master Google OAuth requirement", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const providers of [["google"], ["email"]]) {
    const state = fixture();
    state.user.providers = providers;
    const result = await saveLicense(state, { clockToleranceMinutes: 120 }, "otp");
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, "admin_google_oauth_required");
    assert.equal(state.rows.organizations[0].clock_tolerance_minutes, 90);
    assert.equal(state.mutations.length, 0);
  }
});

test.after(() => { delete globalThis[FIXTURE_KEY]; });
