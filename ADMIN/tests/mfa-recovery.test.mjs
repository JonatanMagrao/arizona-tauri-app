import assert from "node:assert/strict";
import test from "node:test";

import {
  unverifiedMfaFactorIds,
} from "../supabase/functions/_shared/mfa-recovery.ts";

test("preserves an already verified TOTP factor during device recovery", () => {
  assert.deepEqual(
    unverifiedMfaFactorIds([
      { id: "verified-totp", status: "verified", factor_type: "totp" },
      { id: "pending-totp", status: "unverified", factor_type: "totp" },
    ]),
    ["pending-totp"],
  );
});

test("preserves factors whose status is not explicitly unverified", () => {
  assert.deepEqual(
    unverifiedMfaFactorIds([
      { id: "verified-totp", status: "verified" },
      { id: "unknown-status" },
      { id: "unexpected-status", status: "pending" },
    ]),
    [],
  );
});

test("deduplicates and ignores invalid pending factor identifiers", () => {
  assert.deepEqual(
    unverifiedMfaFactorIds([
      { id: " pending-totp ", status: "unverified" },
      { id: "pending-totp", status: "unverified" },
      { id: "", status: "unverified" },
      { id: null, status: "unverified" },
    ]),
    ["pending-totp"],
  );
});
