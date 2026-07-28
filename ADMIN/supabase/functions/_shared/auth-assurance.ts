export type AuthMethodReference = {
  method?: unknown;
  timestamp?: unknown;
};

export type AuthAssuranceClaims = {
  aal?: unknown;
  amr?: unknown;
};

type RecentMethodOptions = {
  requiredAal?: string;
  missingError: string;
  staleError: string;
};

function recentMethodAt(claims: AuthAssuranceClaims, method: string): Date | null {
  if (!Array.isArray(claims.amr)) return null;

  const timestamps = (claims.amr as AuthMethodReference[])
    .filter((entry) => entry?.method === method)
    .map((entry) => Number(entry.timestamp))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps) * 1000);
}

export function requireRecentAuthMethod(
  claims: AuthAssuranceClaims,
  method: string,
  notBefore: Date,
  options: RecentMethodOptions,
): Date {
  if (options.requiredAal && claims.aal !== options.requiredAal) {
    throw new Error(options.missingError);
  }

  const authenticatedAt = recentMethodAt(claims, method);
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

export function requireRecentTotpClaims(
  claims: AuthAssuranceClaims,
  notBefore: Date,
): Date {
  return requireRecentAuthMethod(claims, "totp", notBefore, {
    requiredAal: "aal2",
    missingError: "mfa_required",
    staleError: "daily_mfa_required",
  });
}
