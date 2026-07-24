const MILLISECONDS_PER_DAY = 86_400_000;

export type DeviceSwitchLock = {
  retryAfterSeconds: number;
  retryAt: string;
};

export function deviceSwitchLock(
  activatedAt: unknown,
  intervalDays: number,
  now = new Date(),
): DeviceSwitchLock | null {
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) return null;
  if (typeof activatedAt !== "string" || !activatedAt.trim()) return null;

  const activated = new Date(activatedAt);
  if (!Number.isFinite(activated.getTime())) return null;

  const availableAt = new Date(
    activated.getTime() + intervalDays * MILLISECONDS_PER_DAY,
  );
  const retryAfterSeconds = Math.ceil(
    (availableAt.getTime() - now.getTime()) / 1000,
  );

  return retryAfterSeconds > 0
    ? {
      retryAfterSeconds,
      retryAt: availableAt.toISOString(),
    }
    : null;
}
