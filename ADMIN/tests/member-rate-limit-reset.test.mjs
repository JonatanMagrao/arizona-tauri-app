import assert from "node:assert/strict";
import test from "node:test";

import { memberRateLimitSubjects } from "../supabase/functions/_shared/member-rate-limit-reset.ts";

test("builds every rate-limit subject attributable to a member", () => {
  assert.deepEqual(
    memberRateLimitSubjects(" MEMBER-ID ", " User@Arizona.Global "),
    ["member-id", "user@arizona.global", "member:member-id"],
  );
});

test("ignores invalid values and does not duplicate subjects", () => {
  assert.deepEqual(memberRateLimitSubjects("", null), []);
  assert.deepEqual(
    memberRateLimitSubjects("member:abc", "MEMBER:ABC"),
    ["member:abc", "member:member:abc"],
  );
});
