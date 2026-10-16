import {
  getTemplateIdentities,
  matchTemplatePattern,
  normalizeTemplateIdentity,
} from "../template/templateIdentities";

interface NamedIdentity {
  comment: string;
  names: string[];
}

interface NamedCandidate {
  name: string;
  comment: string;
}

export interface TemplateIdentityMatches<T> {
  matches: T[];
  by: "comment" | "name";
}

const matchesPattern = (value: string, pattern: string): boolean =>
  normalizeTemplateIdentity(value) === normalizeTemplateIdentity(pattern) ||
  matchTemplatePattern(value, pattern) !== null;

export const isTemplateOfferLayerComment = (comment: string): boolean => {
  const definitions: { [key: string]: NamedIdentity } = getTemplateIdentities().offerLayers;
  for (const key in definitions) {
    if (Object.prototype.hasOwnProperty.call(definitions, key) &&
      matchesPattern(comment, definitions[key].comment)) return true;
  }
  return false;
};

// Derive the slot from the primary comment, or from an enabled exact name
// pattern. Callers still resolve uniqueness across the complete composition.
export const readTemplateOfferSlot = (layer: Layer): number | null => {
  const config = getTemplateIdentities();
  let comment: string;
  try { comment = normalizeTemplateIdentity(layer.comment); } catch (error) { return null; }
  let slot = matchTemplatePattern(comment, config.offerLayers.offer.comment);
  if (slot !== null || !config.fallback.offerLayers || isTemplateOfferLayerComment(comment)) return slot;
  let name: string;
  try { name = layer.name; } catch (error) { return null; }
  for (let index = 0; index < config.offerLayers.offer.names.length; index += 1) {
    const candidate = matchTemplatePattern(name, config.offerLayers.offer.names[index]);
    if (candidate !== null) {
      if (slot !== null && slot !== candidate) return null;
      slot = candidate;
    }
  }
  return slot;
};

export const isTemplateProjectItemComment = (comment: string): boolean => {
  const config = getTemplateIdentities();
  const items: { [key: string]: NamedIdentity } = config.projectItems;
  const mechanics: { [key: string]: NamedIdentity & { sourceNames: string[] } } = config.mechanics;
  for (const key in items) {
    if (Object.prototype.hasOwnProperty.call(items, key) &&
      matchesPattern(comment, items[key].comment)) return true;
  }
  for (const key in config.layouts) {
    if (Object.prototype.hasOwnProperty.call(config.layouts, key) &&
      matchesPattern(comment, config.layouts[key].comment)) return true;
  }
  for (const key in mechanics) {
    if (!Object.prototype.hasOwnProperty.call(mechanics, key)) continue;
    if (matchesPattern(comment, mechanics[key].comment)) return true;
    const familyNames = [key, mechanics[key].comment].concat(mechanics[key].sourceNames);
    for (let index = 0; index < familyNames.length; index += 1) {
      const literal = normalizeTemplateIdentity(familyNames[index]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("^" + literal + "(?:\\s+\\d+)?$").test(normalizeTemplateIdentity(comment))) return true;
    }
  }
  return false;
};

// Keep every match so callers fail closed on ambiguity. A comment wins across
// the whole search scope; a known different identity cannot be stolen by a name.
export const resolveTemplateIdentity = <T extends NamedCandidate>(
  candidates: T[],
  identity: NamedIdentity,
  allowNameFallback: boolean,
  recognizesComment: (comment: string) => boolean
): TemplateIdentityMatches<T> => {
  const comments: T[] = [];
  const names: T[] = [];
  const expected = normalizeTemplateIdentity(identity.comment);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let comment: string;
    try {
      comment = normalizeTemplateIdentity(candidate.comment);
    } catch (error) {
      // An unreadable comment cannot authorize a name fallback.
      continue;
    }
    if (comment === expected) {
      comments.push(candidate);
      continue;
    }
    if (!allowNameFallback || recognizesComment(comment)) continue;
    try {
      const name = normalizeTemplateIdentity(candidate.name);
      for (let aliasIndex = 0; aliasIndex < identity.names.length; aliasIndex += 1) {
        if (name === normalizeTemplateIdentity(identity.names[aliasIndex])) {
          names.push(candidate);
          break;
        }
      }
    } catch (error) {
      // An unavailable native name is not an identity.
    }
  }
  return comments.length > 0 ? { matches: comments, by: "comment" } : { matches: names, by: "name" };
};
