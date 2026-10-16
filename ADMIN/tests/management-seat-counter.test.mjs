import assert from "node:assert/strict";
import test from "node:test";

import { managementSeatCounter } from "../supabase/functions/_shared/management-seat-counter.ts";

const manager = (patch = {}) => ({
  id: "current-manager", email: "manager@example.test", role: "admin", status: "active", ...patch,
});
const actor = (patch = {}) => ({
  kind: "member", id: "current-manager", organizationId: "organization-1",
  email: "manager@example.test", role: "admin", ...patch,
});
const input = (patch = {}) => ({
  actor: actor(), members: [manager()], seatsAllowed: 11, consumedSeats: 4, ...patch,
});

function client(reply = { data: false, error: null }) {
  const calls = [];
  return {
    calls,
    admin: {
      schema(schema) {
        assert.equal(schema, "licensing");
        return {
          async rpc(name, args) {
            calls.push({ schema, name, args });
            assert.equal(name, "is_active_master_email");
            return typeof reply === "function" ? reply() : reply;
          },
        };
      },
    },
  };
}

test("the current manager is removed from both displayed counters while seven real vacancies remain", async () => {
  const env = client();
  const result = await managementSeatCounter(env.admin, input());
  assert.deepEqual(result, { seatsAllowed: 10, consumedSeats: 3, availableSeats: 7 });
  assert.deepEqual(env.calls, [{
    schema: "licensing", name: "is_active_master_email", args: { email_value: "manager@example.test" },
  }]);
});

test("an invited current manager has the same seat adjustment as an active manager", async () => {
  const env = client();
  assert.deepEqual(await managementSeatCounter(env.admin, input({ members: [manager({ status: "invited" })] })),
    { seatsAllowed: 10, consumedSeats: 3, availableSeats: 7 });
  assert.equal(env.calls.length, 1);
});

test("a master actor retains real totals and never queries a member seat exemption", async () => {
  const env = client(() => { throw new Error("A master must not query its own exemption"); });
  assert.deepEqual(await managementSeatCounter(env.admin, input({
    actor: { kind: "master", id: "current-manager", email: "manager@example.test" },
  })), { seatsAllowed: 11, consumedSeats: 4, availableSeats: 7 });
  assert.deepEqual(env.calls, []);
});

test("an active master resolved as an organization manager is not discounted twice", async () => {
  const env = client({ data: true, error: null });
  assert.deepEqual(await managementSeatCounter(env.admin, input()),
    { seatsAllowed: 11, consumedSeats: 4, availableSeats: 7 });
  assert.equal(env.calls.length, 1);
});

test("other admins remain counted and the current server member supplies the exemption email", async () => {
  const env = client();
  const members = [
    manager({ id: "other-manager", email: "other@example.test" }),
    manager({ email: "latest@example.test" }),
    manager({ id: "third-manager", email: "third@example.test", status: "invited" }),
    manager({ id: "team-member", email: "team@example.test", role: "user" }),
  ];
  assert.deepEqual(await managementSeatCounter(env.admin, input({
    actor: actor({ email: "previous@example.test" }), members, seatsAllowed: 5, consumedSeats: 4,
  })), { seatsAllowed: 4, consumedSeats: 3, availableSeats: 1 });
  assert.deepEqual(env.calls[0].args, { email_value: "latest@example.test" });
  assert.equal(env.calls.length, 1);
});

test("missing, inactive and non-manager identities do not hide someone else's occupied seat", async () => {
  const cases = [
    { members: [] },
    { members: [manager({ id: "different-id" })] },
    { members: [manager({ status: "removed" })] },
    { members: [manager({ status: "disabled" })] },
    { members: [manager({ role: "user" })] },
    { actor: actor({ role: "user" }) },
  ];
  for (const patch of cases) {
    const env = client();
    assert.deepEqual(await managementSeatCounter(env.admin, input(patch)),
      { seatsAllowed: 11, consumedSeats: 4, availableSeats: 7 });
    assert.deepEqual(env.calls, []);
  }
});

test("zero totals or consumption never produce negative displayed counts or query an exemption", async () => {
  for (const [seatsAllowed, consumedSeats] of [[0, 0], [1, 0], [0, 1], [0, 5]]) {
    const env = client();
    assert.deepEqual(await managementSeatCounter(env.admin, input({ seatsAllowed, consumedSeats })),
      { seatsAllowed, consumedSeats, availableSeats: Math.max(0, seatsAllowed - consumedSeats) });
    assert.deepEqual(env.calls, []);
  }
});

test("a one-seat license occupied only by its manager displays zero without inventing a vacancy", async () => {
  const env = client();
  assert.deepEqual(await managementSeatCounter(env.admin, input({ seatsAllowed: 1, consumedSeats: 1 })),
    { seatsAllowed: 0, consumedSeats: 0, availableSeats: 0 });
});

test("overcapacity remains visible and available seats stay clamped at zero", async () => {
  const env = client();
  assert.deepEqual(await managementSeatCounter(env.admin, input({ seatsAllowed: 2, consumedSeats: 5 })),
    { seatsAllowed: 1, consumedSeats: 4, availableSeats: 0 });
});

test("the adjusted counters preserve actual availability for every capacity boundary", async () => {
  const env = client();
  for (const seatsAllowed of [0, 1, 2, 11, Number.MAX_SAFE_INTEGER]) {
    for (const consumedSeats of [0, 1, 2, 12, Number.MAX_SAFE_INTEGER]) {
      const result = await managementSeatCounter(env.admin, input({ seatsAllowed, consumedSeats }));
      assert.equal(result.availableSeats, Math.max(0, seatsAllowed - consumedSeats));
      assert.equal(Math.max(0, result.seatsAllowed - result.consumedSeats), result.availableSeats);
      assert.equal(seatsAllowed - result.seatsAllowed, consumedSeats - result.consumedSeats);
      assert.ok(result.seatsAllowed >= 0 && result.consumedSeats >= 0);
    }
  }
});

test("negative, fractional, unsafe and nonfinite counts fail before the exemption lookup", async () => {
  for (const field of ["seatsAllowed", "consumedSeats"]) {
    for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "11", null]) {
      const env = client();
      await assert.rejects(managementSeatCounter(env.admin, input({ [field]: invalid })),
        /invalid_management_seat_count/);
      assert.deepEqual(env.calls, []);
    }
  }
});

test("RPC errors and transport failures propagate rather than guessing whether the manager consumes a seat", async () => {
  const failure = new Error("Exemption lookup unavailable");
  const database = client({ data: false, error: failure });
  await assert.rejects(managementSeatCounter(database.admin, input()), (error) => error === failure);
  const transport = client(async () => { throw failure; });
  await assert.rejects(managementSeatCounter(transport.admin, input()), (error) => error === failure);
});

test("only an actual boolean false authorizes the adjustment", async () => {
  for (const invalid of [null, undefined, 0, 1, "false", "true", [], {}]) {
    const env = client({ data: invalid, error: null });
    await assert.rejects(managementSeatCounter(env.admin, input()), /invalid_master_seat_exemption/);
    assert.equal(env.calls.length, 1);
  }
});

test("presentation calculations preserve the server actor, members and real license inputs", async () => {
  const payload = Object.freeze(input({
    actor: Object.freeze(actor()),
    members: Object.freeze([Object.freeze(manager()), Object.freeze(manager({ id: "other-manager" }))]),
  }));
  const before = structuredClone(payload);
  const env = client();
  await managementSeatCounter(env.admin, payload);
  assert.deepEqual(payload, before);
});
