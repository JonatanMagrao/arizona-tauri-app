type MfaFactor = {
  id?: unknown;
  status?: unknown;
  factor_type?: unknown;
};

/**
 * Device recovery must not invalidate an authenticator that the user already
 * verified. Only incomplete enrollments are safe to discard before the app
 * resumes authentication.
 */
export function unverifiedMfaFactorIds(factors: MfaFactor[]): string[] {
  return [...new Set(
    factors
      .filter((factor) => factor?.status === "unverified")
      .map((factor) => typeof factor?.id === "string" ? factor.id.trim() : "")
      .filter(Boolean),
  )];
}

export function totpFactorIds(
  factors: MfaFactor[],
  knownTotpFactors: MfaFactor[] = [],
): string[] {
  return [...new Set(
    [
      ...knownTotpFactors,
      ...factors.filter((factor) => factor?.factor_type === "totp"),
    ]
      .map((factor) => typeof factor?.id === "string" ? factor.id.trim() : "")
      .filter(Boolean),
  )];
}
