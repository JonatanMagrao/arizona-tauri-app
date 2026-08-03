import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";
import { isAtOrAfterSecond } from "./auth-assurance.ts";

// The grant is one-shot and normally spent seconds after the code is consumed;
// with no TOTP enrollment left in the flow, this window only bounds an
// activation somebody abandoned between the code and the first launch. Kept
// well above the client's request timeouts and human retry pace.
export const DEVICE_BIND_GRANT_TTL_MINUTES = 30;

export function deviceBindGrantExpiryInstant(now = new Date()): Date {
  return new Date(now.getTime() + DEVICE_BIND_GRANT_TTL_MINUTES * 60_000);
}

function grantInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

// Ordering the session against the grant proves that this very session is the
// one the activation created: an older session — a copied credential, for
// instance — cannot piggyback on somebody else's activation in progress.
// Revoking a device also voids any grant issued before the revocation:
// otherwise the released installation could spend it and silently take its own
// seat back. Only a code consumed after the release may bring it back.
export async function clearDeviceBindGrant(
  admin: SupabaseClient,
  memberId: string,
  now: string,
): Promise<void> {
  const { error } = await admin
    .schema("licensing")
    .from("members")
    .update({
      device_bind_not_before: null,
      device_bind_expires_at: null,
      updated_at: now,
    })
    .eq("id", memberId);
  if (error) throw error;
}

export function hasDeviceBindGrant(
  notBeforeValue: unknown,
  expiresAtValue: unknown,
  sessionSignedInAt: Date | null,
  now = new Date(),
): boolean {
  const notBefore = grantInstant(notBeforeValue);
  const expiresAt = grantInstant(expiresAtValue);
  if (!notBefore || !expiresAt || !sessionSignedInAt) return false;
  if (expiresAt.getTime() <= now.getTime()) return false;
  return isAtOrAfterSecond(sessionSignedInAt, notBefore);
}
