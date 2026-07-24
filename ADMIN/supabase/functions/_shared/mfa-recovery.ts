type MfaFactor = {
  id?: unknown;
  status?: unknown;
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
