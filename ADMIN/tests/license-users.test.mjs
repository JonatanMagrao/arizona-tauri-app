import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUserContent,
  resizeUsersForSeatInput,
} from "../src/license-users.js";

function user(id, values = {}) {
  return {
    id,
    memberId: null,
    name: "",
    email: "",
    isManager: false,
    activeDevice: null,
    ...values,
  };
}

function emptyUserFactory() {
  let nextId = 1;
  return () => user(`new-${nextId++}`);
}

test("preserves every existing user while a multi-digit seat count is typed", () => {
  const existingUsers = Array.from(
    { length: 9 },
    (_, index) => user(`row-${index + 1}`, { memberId: `member-${index + 1}` }),
  );

  const intermediate = resizeUsersForSeatInput(existingUsers, "1", emptyUserFactory());
  const expanded = resizeUsersForSeatInput(intermediate, "10", emptyUserFactory());

  assert.deepEqual(intermediate.map(({ id }) => id), existingUsers.map(({ id }) => id));
  assert.deepEqual(expanded.slice(0, 9).map(({ id }) => id), existingUsers.map(({ id }) => id));
  assert.equal(expanded.length, 10);
});

test("preserves unsaved user data and blank input states", () => {
  const users = [
    user("row-1", { memberId: "member-1" }),
    user("row-2"),
    user("row-3", { name: "Pessoa em edição" }),
  ];

  assert.equal(resizeUsersForSeatInput(users, "", emptyUserFactory()).length, 3);
  assert.equal(resizeUsersForSeatInput(users, "1", emptyUserFactory()).length, 3);
  assert.equal(hasUserContent(users[2]), true);
});

test("removes only trailing empty rows when the seat count is reduced", () => {
  const users = [
    user("row-1", { memberId: "member-1" }),
    user("row-2"),
    user("row-3"),
  ];

  const resized = resizeUsersForSeatInput(users, "1", emptyUserFactory());

  assert.deepEqual(resized.map(({ id }) => id), ["row-1"]);
});
