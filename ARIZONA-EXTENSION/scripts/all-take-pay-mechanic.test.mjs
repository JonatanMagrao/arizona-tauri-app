import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_TAKE_PAY_MECHANIC_NAME_PATTERN,
  ALL_TAKE_PAY_MECHANIC_TYPE,
  isAllTakePayMechanicType,
} from "../src/shared/allTakePayMechanic.js";

const duplicatedPrecompPattern = new RegExp(
  `^${ALL_TAKE_PAY_MECHANIC_NAME_PATTERN}(?:\\s+\\d+)?$`,
  "i"
);

test("recognizes the new Todos A Com Leve X Pague Y name", () => {
  assert.equal(ALL_TAKE_PAY_MECHANIC_TYPE, "Todos A Com Leve X Pague Y");
  assert.equal(isAllTakePayMechanicType("Todos A Com Leve X Pague Y"), true);
  assert.equal(duplicatedPrecompPattern.test("TODOS A COM LEVE X PAGUE Y"), true);
  assert.equal(duplicatedPrecompPattern.test("TODOS A COM LEVE X PAGUE Y 2"), true);
});

test("keeps legacy AEPs compatible without accepting nearby names", () => {
  assert.equal(isAllTakePayMechanicType("Todos A Leve X Pague Y"), true);
  assert.equal(duplicatedPrecompPattern.test("TODOS A LEVE X PAGUE Y"), true);
  assert.equal(duplicatedPrecompPattern.test("TODOS COM LEVE X PAGUE Y"), false);
  assert.equal(duplicatedPrecompPattern.test("TODOS A COM LEVE 3 PAGUE 2"), false);
});
