// The org kill switch only ever moves between these two states. Every other
// enum value (or arbitrary string) is rejected before touching the row, so a
// typo can never wedge the fleet into a status the panel cannot undo.
export const SWITCHABLE_ORGANIZATION_STATUSES = ["active", "paused"] as const;

export type SwitchableOrganizationStatus =
  typeof SWITCHABLE_ORGANIZATION_STATUSES[number];

export function parseSwitchableOrganizationStatus(
  value: unknown,
): SwitchableOrganizationStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SWITCHABLE_ORGANIZATION_STATUSES as readonly string[]).includes(normalized)
    ? normalized as SwitchableOrganizationStatus
    : null;
}
