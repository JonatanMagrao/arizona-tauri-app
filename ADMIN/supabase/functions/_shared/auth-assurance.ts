export type AuthMethodReference = {
  method?: unknown;
  timestamp?: unknown;
};

export type AuthAssuranceClaims = {
  aal?: unknown;
  amr?: unknown;
};

export const ADMIN_GOOGLE_OAUTH_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function adminGoogleOAuthNotBefore(now = new Date()): Date {
  return new Date(now.getTime() - ADMIN_GOOGLE_OAUTH_MAX_AGE_MS);
}

type RecentMethodOptions = {
  missingError: string;
  staleError: string;
};

// Only the activation-code exchange may prove how fresh a sign-in is: GoTrue's
// verify endpoint records "otp" for the implicit flow this app uses and
// "magiclink" on the PKCE path. Everything else fails closed — password, oauth,
// token_refresh, anonymous, sso/saml, passkey, second factors and any method
// added later — because a session that is already signed in can mint most of
// them without ever presenting an activation code.
const ACTIVATION_SIGN_IN_METHODS = new Set(["otp", "magiclink"]);

function isSignInMethod(method: unknown): boolean {
  const name = typeof method === "string" ? method.trim().toLowerCase() : "";
  return ACTIVATION_SIGN_IN_METHODS.has(name);
}

function amrTimestamps(
  claims: AuthAssuranceClaims,
  accepts: (method: unknown) => boolean,
): number[] {
  if (!Array.isArray(claims.amr)) return [];

  return (claims.amr as AuthMethodReference[])
    .filter((entry) => accepts(entry?.method))
    .map((entry) => Number(entry?.timestamp))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function latestOf(timestamps: number[]): Date | null {
  return timestamps.length ? new Date(Math.max(...timestamps) * 1000) : null;
}

export function authMethodAt(claims: AuthAssuranceClaims, method: string): Date | null {
  return latestOf(amrTimestamps(claims, (candidate) => candidate === method));
}

export function latestSignInAt(claims: AuthAssuranceClaims): Date | null {
  return latestOf(amrTimestamps(claims, isSignInMethod));
}

// AMR timestamps carry whole seconds, so a boundary captured moments earlier
// with millisecond precision must be floored before comparing.
export function isAtOrAfterSecond(instant: Date, boundary: Date): boolean {
  return instant.getTime() >= Math.floor(boundary.getTime() / 1000) * 1000;
}

export function requireRecentAuthMethod(
  claims: AuthAssuranceClaims,
  method: string,
  notBefore: Date,
  options: RecentMethodOptions,
): Date {
  const authenticatedAt = authMethodAt(claims, method);
  if (!authenticatedAt) throw new Error(options.missingError);
  if (authenticatedAt.getTime() < notBefore.getTime()) {
    throw new Error(options.staleError);
  }

  return authenticatedAt;
}

export function requireRecentGoogleOAuthClaims(
  claims: AuthAssuranceClaims,
  notBefore: Date,
): Date {
  return requireRecentAuthMethod(claims, "oauth", notBefore, {
    missingError: "google_oauth_required",
    staleError: "daily_google_oauth_required",
  });
}
