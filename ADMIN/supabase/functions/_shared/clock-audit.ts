export type ClockAuditStatus = "ok" | "suspicious";

export const CLOCK_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

type ClockAuditDecision = {
  currentStatus: ClockAuditStatus;
  latestStatus: ClockAuditStatus | null;
  latestCreatedAtMillis: number | null;
  nowMillis: number;
};

export function shouldRecordClockAudit({
  currentStatus,
  latestStatus,
  latestCreatedAtMillis,
  nowMillis,
}: ClockAuditDecision): boolean {
  if (latestCreatedAtMillis === null) return true;
  if (latestStatus !== currentStatus) return true;
  return nowMillis - latestCreatedAtMillis >= CLOCK_AUDIT_INTERVAL_MS;
}

export function boundedClockSkewSeconds(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(POSTGRES_INTEGER_MIN, Math.min(POSTGRES_INTEGER_MAX, Math.round(value)));
}
