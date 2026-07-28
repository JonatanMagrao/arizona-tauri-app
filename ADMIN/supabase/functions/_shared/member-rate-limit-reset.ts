export function memberRateLimitSubjects(
  memberId: unknown,
  email: unknown,
): string[] {
  const normalizedMemberId = typeof memberId === "string"
    ? memberId.trim().toLowerCase()
    : "";
  const normalizedEmail = typeof email === "string"
    ? email.trim().toLowerCase()
    : "";

  return [...new Set([
    normalizedMemberId,
    normalizedEmail,
    normalizedMemberId ? `member:${normalizedMemberId}` : "",
  ].filter(Boolean))];
}
