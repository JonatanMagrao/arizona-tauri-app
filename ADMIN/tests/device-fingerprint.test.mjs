import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintDecision,
  fingerprintPrefix,
  normalizeFingerprint,
} from "../supabase/functions/_shared/device-fingerprint.ts";

const storedHash = "a".repeat(64);
const otherHash = "b".repeat(64);

test("stores the first non-empty fingerprint", () => {
  assert.deepEqual(fingerprintDecision(null, storedHash), {
    outcome: "store",
    fingerprint: storedHash,
  });
  assert.deepEqual(fingerprintDecision("", `  ${storedHash}  `), {
    outcome: "store",
    fingerprint: storedHash,
  });
});

test("keeps the stored fingerprint when the incoming one is equal", () => {
  assert.deepEqual(fingerprintDecision(storedHash, storedHash), { outcome: "keep" });
  assert.deepEqual(fingerprintDecision(storedHash, `  ${storedHash}  `), { outcome: "keep" });
});

test("keeps silence when nothing was ever stored", () => {
  // The decision helper stays neutral on empty values; validate-license and
  // the binding path both reject an empty incoming fingerprint outright
  // before ever consulting it, which is what retires v2.1.1.
  assert.deepEqual(fingerprintDecision(null, ""), { outcome: "keep" });
  assert.deepEqual(fingerprintDecision("", null), { outcome: "keep" });
  assert.deepEqual(fingerprintDecision(undefined, undefined), { outcome: "keep" });
});

test("flags a downgrade when a device that had a fingerprint stops sending one", () => {
  assert.deepEqual(fingerprintDecision(storedHash, ""), { outcome: "missing", stored: storedHash });
  assert.deepEqual(fingerprintDecision(storedHash, null), {
    outcome: "missing",
    stored: storedHash,
  });
  assert.deepEqual(fingerprintDecision(storedHash, undefined), {
    outcome: "missing",
    stored: storedHash,
  });
  assert.deepEqual(fingerprintDecision(storedHash, 42), {
    outcome: "missing",
    stored: storedHash,
  });
});

test("flags a mismatch when both fingerprints are set and differ", () => {
  assert.deepEqual(fingerprintDecision(storedHash, otherHash), {
    outcome: "mismatch",
    stored: storedHash,
    incoming: otherHash,
  });
});

test("treats non-string values as empty", () => {
  assert.equal(normalizeFingerprint(42), "");
  assert.equal(normalizeFingerprint({}), "");
  assert.deepEqual(fingerprintDecision(42, otherHash), {
    outcome: "store",
    fingerprint: otherHash,
  });
});

test("prefixes expose only the first twelve characters", () => {
  assert.equal(fingerprintPrefix(storedHash), "a".repeat(12));
  assert.equal(fingerprintPrefix("short"), "short");
});
