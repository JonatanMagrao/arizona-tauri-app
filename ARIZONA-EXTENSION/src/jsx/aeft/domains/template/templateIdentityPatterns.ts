export interface TemplateIdentity {
  comment: string;
  names: string[];
}

export const normalizeTemplateIdentity = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

export const expandTemplatePattern = (pattern: string, slot?: number): string => {
  if (pattern.indexOf("{n}") < 0 && pattern.indexOf("{nn}") < 0) return pattern;
  if (typeof slot !== "number" || !isFinite(slot) || slot < 1 || Math.floor(slot) !== slot) {
    throw new Error("O indice da identidade deve ser um inteiro positivo.");
  }
  const value = String(slot);
  return pattern.replace(/\{nn\}/g, value.length < 2 ? "0" + value : value).replace(/\{n\}/g, value);
};

export const expandTemplateIdentity = (identity: TemplateIdentity, slot?: number): TemplateIdentity => {
  const names: string[] = [];
  for (let index = 0; index < identity.names.length; index += 1) {
    names.push(expandTemplatePattern(identity.names[index], slot));
  }
  return { comment: expandTemplatePattern(identity.comment, slot), names };
};

// Patterns accept exactly one explicit slot, never a free-form regular
// expression. {nn} means zero-padded to at least two digits (01, 12, 100).
export const matchTemplatePattern = (value: string, pattern: string): number | null => {
  const normalized = normalizeTemplateIdentity(pattern);
  const marker = normalized.indexOf("{NN}") >= 0 ? "{NN}" : "{N}";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return null;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp("^" + escape(normalized.substring(0, markerIndex)) + "([0-9]+)" +
    escape(normalized.substring(markerIndex + marker.length)) + "$");
  const found = matcher.exec(normalizeTemplateIdentity(value));
  if (found === null) return null;
  const slot = Number(found[1]);
  if (!isFinite(slot) || slot < 1 || Math.floor(slot) !== slot || slot > 9007199254740991) return null;
  return normalizeTemplateIdentity(expandTemplatePattern(pattern, slot)) === normalizeTemplateIdentity(value) ? slot : null;
};
