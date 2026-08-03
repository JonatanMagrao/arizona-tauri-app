import assert from "node:assert/strict";
import test from "node:test";

import {
  SWITCHABLE_ORGANIZATION_STATUSES,
  parseSwitchableOrganizationStatus,
} from "../supabase/functions/_shared/organization-status.ts";

test("accepts only the two switchable statuses", () => {
  assert.deepEqual([...SWITCHABLE_ORGANIZATION_STATUSES], ["active", "paused"]);
  assert.equal(parseSwitchableOrganizationStatus("active"), "active");
  assert.equal(parseSwitchableOrganizationStatus("paused"), "paused");
});

test("normalizes case and surrounding whitespace", () => {
  assert.equal(parseSwitchableOrganizationStatus("  Active  "), "active");
  assert.equal(parseSwitchableOrganizationStatus("PAUSED"), "paused");
});

test("rejects every other enum value and shape", () => {
  // 'blocked' and 'deleted' exist in licensing.organization_status but are
  // not reachable through the kill switch; nothing else may slip through.
  assert.equal(parseSwitchableOrganizationStatus("blocked"), null);
  assert.equal(parseSwitchableOrganizationStatus("deleted"), null);
  assert.equal(parseSwitchableOrganizationStatus(""), null);
  assert.equal(parseSwitchableOrganizationStatus("   "), null);
  assert.equal(parseSwitchableOrganizationStatus(null), null);
  assert.equal(parseSwitchableOrganizationStatus(undefined), null);
  assert.equal(parseSwitchableOrganizationStatus(42), null);
  assert.equal(parseSwitchableOrganizationStatus({ status: "active" }), null);
  assert.equal(parseSwitchableOrganizationStatus(["active"]), null);
});
