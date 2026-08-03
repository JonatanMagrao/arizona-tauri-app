export const AUTH_TIME_ZONE = "America/Sao_Paulo";
export const DEFAULT_DAILY_AUTH_RESET_HOUR = 4;

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
};

function zonedParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AUTH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function calendarDateParts(value: Date, dayOffset = 0): ZonedDateParts {
  const parts = zonedParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatDateParts(parts: ZonedDateParts): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function normalizeDailyAuthResetHour(value: unknown): number {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? hour
    : DEFAULT_DAILY_AUTH_RESET_HOUR;
}

export function serverAuthDay(value: Date, resetHour: number): string {
  const parts = zonedParts(value);
  return formatDateParts(calendarDateParts(value, parts.hour < resetHour ? -1 : 0));
}

function zonedDateTime(year: number, month: number, day: number, hour: number): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour + 3, 0, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(candidate);
    const observed = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const target = Date.UTC(year, month - 1, day, hour, 0, 0);
    candidate = new Date(candidate.getTime() + target - observed);
  }
  return candidate;
}

export function nextAuthDayStart(value: Date, resetHour: number): Date {
  const parts = zonedParts(value);
  const boundaryDate = calendarDateParts(value, parts.hour < resetHour ? 0 : 1);
  return zonedDateTime(boundaryDate.year, boundaryDate.month, boundaryDate.day, resetHour);
}

export function currentAuthDayStart(value: Date, resetHour: number): Date {
  const parts = zonedParts(value);
  const boundaryDate = calendarDateParts(value, parts.hour < resetHour ? -1 : 0);
  return zonedDateTime(boundaryDate.year, boundaryDate.month, boundaryDate.day, resetHour);
}

// license_expires_on marks the last FULL valid day: access ends at the daily
// reset hour (America/Sao_Paulo) of the following day.
export function licenseExpiryInstant(
  licenseExpiresOn: string | null | undefined,
  resetHour: unknown,
): Date | null {
  if (typeof licenseExpiresOn !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(licenseExpiresOn.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const base = new Date(Date.UTC(year, month - 1, day));
  if (
    base.getUTCFullYear() !== year
    || base.getUTCMonth() !== month - 1
    || base.getUTCDate() !== day
  ) {
    return null;
  }
  const dayAfter = new Date(Date.UTC(year, month - 1, day + 1));
  return zonedDateTime(
    dayAfter.getUTCFullYear(),
    dayAfter.getUTCMonth() + 1,
    dayAfter.getUTCDate(),
    normalizeDailyAuthResetHour(resetHour),
  );
}
