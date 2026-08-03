export type FingerprintDecision =
  | { outcome: "keep" }
  | { outcome: "store"; fingerprint: string }
  | { outcome: "missing"; stored: string }
  | { outcome: "mismatch"; stored: string; incoming: string };

export function normalizeFingerprint(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

// A stored non-empty fingerprint is never overwritten by an empty one; a
// different non-empty fingerprint means the credential moved to other hardware.
// "missing" is the downgrade: a device that already proved it can produce a
// hash stopped sending one, which a patched client does to dodge the check.
export function fingerprintDecision(
  storedValue: unknown,
  incomingValue: unknown,
): FingerprintDecision {
  const stored = normalizeFingerprint(storedValue);
  const incoming = normalizeFingerprint(incomingValue);
  if (!incoming) return stored ? { outcome: "missing", stored } : { outcome: "keep" };
  if (incoming === stored) return { outcome: "keep" };
  if (!stored) return { outcome: "store", fingerprint: incoming };
  return { outcome: "mismatch", stored, incoming };
}

export function fingerprintPrefix(value: string): string {
  return value.slice(0, 12);
}
