import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";
import { errorResponse } from "./http.ts";
import { bearerToken } from "./supabase.ts";

type AmrEntry = {
  method?: unknown;
  timestamp?: unknown;
};

type JwtClaims = {
  aal?: unknown;
  amr?: unknown;
  exp?: unknown;
  sub?: unknown;
};

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export function jwtClaims(req: Request): JwtClaims {
  const token = bearerToken(req);
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_user_token");

  try {
    const claims = JSON.parse(decodeBase64Url(parts[1])) as JwtClaims;
    if (!claims || typeof claims !== "object") throw new Error("invalid_user_token");
    return claims;
  } catch {
    throw new Error("invalid_user_token");
  }
}

export function requireRecentTotp(req: Request, notBefore: Date): Date {
  // getAuthUser() must be called before this helper. It validates the JWT signature
  // against Supabase Auth; this helper only inspects the already validated claims.
  const claims = jwtClaims(req);
  if (claims.aal !== "aal2" || !Array.isArray(claims.amr)) {
    throw new Error("mfa_required");
  }

  const notBeforeSeconds = Math.floor(notBefore.getTime() / 1000);
  const timestamps = (claims.amr as AmrEntry[])
    .filter((entry) => entry?.method === "totp")
    .map((entry) => Number(entry.timestamp))
    .filter((value) => Number.isFinite(value));

  const mostRecent = timestamps.length ? Math.max(...timestamps) : 0;
  if (mostRecent < notBeforeSeconds) throw new Error("daily_mfa_required");
  return new Date(mostRecent * 1000);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function requestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly action: string;

  constructor(action: string, retryAfterSeconds: number) {
    super("rate_limited");
    this.name = "RateLimitError";
    this.action = action;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export function rateLimitResponse(error: unknown): Response | null {
  if (!(error instanceof RateLimitError)) return null;
  const retryAt = new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString();
  return errorResponse("rate_limited", "Try again later.", 429, {
    retryAfterSeconds: error.retryAfterSeconds,
    retryAt,
  });
}

export async function enforceRateLimit(
  admin: SupabaseClient,
  action: string,
  subject: string,
  maximumEvents: number,
  windowSeconds: number,
): Promise<void> {
  const subjectHash = await sha256Hex(subject.trim().toLowerCase());
  const { data, error } = await admin
    .schema("licensing")
    .rpc("consume_rate_limit_v2", {
      target_action: action,
      target_subject_hash: subjectHash,
      maximum_events: maximumEvents,
      window_seconds: windowSeconds,
    });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.allowed !== true) {
    throw new RateLimitError(action, Number(result?.retry_after_seconds || windowSeconds));
  }
}
