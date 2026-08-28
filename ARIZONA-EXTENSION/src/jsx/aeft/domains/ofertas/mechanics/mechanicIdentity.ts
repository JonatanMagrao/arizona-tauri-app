export interface MechanicSourceIdentity {
  comment: string;
  sourceName: string;
  candidates: string[];
}

export const normalizeMechanicIdentity = (
  value: string | null | undefined
): string => String(value || "").replace(/^\s+|\s+$/g, "");

export const buildMechanicSourceIdentity = (
  sourceComment: string | null | undefined,
  sourceName: string | null | undefined
): MechanicSourceIdentity => {
  const comment = normalizeMechanicIdentity(sourceComment);
  const normalizedSourceName = normalizeMechanicIdentity(sourceName);
  const candidates: string[] = [];

  if (comment !== "") {
    candidates.push(comment);
  }

  if (normalizedSourceName !== "" && normalizedSourceName !== comment) {
    candidates.push(normalizedSourceName);
  }

  return {
    comment,
    sourceName: normalizedSourceName,
    candidates,
  };
};
