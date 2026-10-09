import { OFFER_LAYER_NAME_FALLBACK_ENABLED } from "./config";
import { addError, getLayerByIndex } from "./findLayers";

export interface OfferProductLayerSet {
  slot: number;
  descriptionLayer: Layer;
  mechanicLayer: Layer | null;
  imageLayer: Layer | null;
  valid: boolean;
}

interface RoleMatch {
  layer: Layer | null;
  count: number;
}

const normalizeIdentity = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

const offerContext = (source: CompItem): string =>
  'na oferta "' + source.name + '"';

const readIdentity = (layer: Layer, byName: boolean): string => {
  try {
    return normalizeIdentity(byName ? layer.name : layer.comment);
  } catch (error) {
    return "";
  }
};

const isOfferRoleIdentity = (identity: string): boolean => {
  if (identity === "TEXTO LEGAL" || identity === "MARCADORES") return true;
  for (let slot = 1; slot <= 3; slot += 1) {
    if (
      identity === "DESCRITIVO " + slot ||
      identity === "MECANICA " + slot ||
      identity === "PRODUTO " + slot
    ) return true;
  }
  return false;
};

const scanRole = (
  source: CompItem,
  role: string,
  byName: boolean
): RoleMatch => {
  const expected = normalizeIdentity(role);
  let found: Layer | null = null;
  let count = 0;

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null || readIdentity(layer, byName) !== expected) continue;
    if (byName) {
      const comment = readIdentity(layer, false);
      // A recognized comment already assigns this layer to an offer role. A
      // different name cannot repurpose it, even when name fallback is enabled.
      if (comment !== expected && isOfferRoleIdentity(comment)) continue;
    }
    found = layer;
    count += 1;
  }

  return { layer: count === 1 ? found : null, count };
};

const findRole = (
  source: CompItem,
  role: string,
  errors: string[],
  required: boolean
): RoleMatch => {
  let result = scanRole(source, role, false);
  let byName = false;

  if (result.count === 0 && OFFER_LAYER_NAME_FALLBACK_ENABLED) {
    result = scanRole(source, role, true);
    byName = true;
  }

  if (result.count > 1) {
    addError(
      errors,
      'Mais de uma camada tem o ' + (byName ? "nome" : "comentário") +
        ' "' + role + '" ' + offerContext(source) + "."
    );
  } else if (result.count === 0 && required) {
    addError(
      errors,
      'Não encontrei a camada com o comentário "' + role + '" ' +
        offerContext(source) +
        (OFFER_LAYER_NAME_FALLBACK_ENABLED
          ? ". Também não encontrei o nome correspondente."
          : ". O fallback por nome está desativado.")
    );
  }

  return result;
};

const isPrecompLayer = (layer: Layer): boolean => {
  try {
    return layer instanceof AVLayer && layer.source instanceof CompItem;
  } catch (error) {
    return false;
  }
};

const isProductImageLayer = (layer: Layer): boolean => {
  try {
    return layer instanceof AVLayer &&
      (layer.source instanceof FootageItem || layer.source instanceof CompItem);
  } catch (error) {
    return false;
  }
};

const validateRoleLayer = (
  source: CompItem,
  role: string,
  layer: Layer | null,
  errors: string[],
  isImage: boolean
): Layer | null => {
  if (layer === null) return null;
  if (isImage ? isProductImageLayer(layer) : isPrecompLayer(layer)) return layer;

  addError(
    errors,
    'A camada "' + role + '" ' + offerContext(source) +
      (isImage
        ? " não possui uma origem de imagem válida."
        : " não possui uma precomp válida.")
  );
  return null;
};

const shareLayer = (
  first: OfferProductLayerSet,
  second: OfferProductLayerSet
): boolean => {
  const firstLayers = [first.descriptionLayer, first.mechanicLayer, first.imageLayer];
  const secondLayers = [second.descriptionLayer, second.mechanicLayer, second.imageLayer];
  for (let firstIndex = 0; firstIndex < firstLayers.length; firstIndex += 1) {
    if (firstLayers[firstIndex] === null) continue;
    for (let secondIndex = 0; secondIndex < secondLayers.length; secondIndex += 1) {
      if (firstLayers[firstIndex] === secondLayers[secondIndex]) return true;
    }
  }
  return false;
};

export const resolveOfferProductLayers = (
  source: CompItem | null,
  errors: string[],
  unresolvedSlots?: number[]
): OfferProductLayerSet[] => {
  const products: OfferProductLayerSet[] = [];
  if (source === null) return products;

  for (let slot = 1; slot <= 3; slot += 1) {
    const descriptionRole = "DESCRITIVO " + slot;
    const mechanicRole = "MECANICA " + slot;
    const imageRole = "PRODUTO " + slot;
    const descriptionMatch = findRole(source, descriptionRole, errors, false);

    // An ambiguous description never chooses one of its layers. Consumers use
    // the slot identity, so a missing/invalid slot cannot shift another product.
    if (descriptionMatch.count > 1) {
      if (unresolvedSlots) unresolvedSlots.push(slot);
      continue;
    }

    const descriptionLayer = descriptionMatch.layer;
    if (descriptionLayer !== null && !descriptionLayer.enabled) continue;

    const mechanicMatch = findRole(source, mechanicRole, errors, false);
    const imageMatch = findRole(source, imageRole, errors, false);

    if (descriptionLayer === null) {
      if (mechanicMatch.count > 0 || imageMatch.count > 0) {
        if (unresolvedSlots) unresolvedSlots.push(slot);
        addError(
          errors,
          'Há camadas do produto ' + slot + ' sem a camada "' +
            descriptionRole + '" ' + offerContext(source) + "."
        );
      }
      continue;
    }

    if (mechanicMatch.count === 0) {
      findRole(source, mechanicRole, errors, true);
    }
    if (imageMatch.count === 0) {
      findRole(source, imageRole, errors, true);
    }

    const validDescription = validateRoleLayer(
      source, descriptionRole, descriptionLayer, errors, false
    );
    let mechanicLayer = validateRoleLayer(
      source, mechanicRole, mechanicMatch.layer, errors, false
    );
    let imageLayer = validateRoleLayer(
      source, imageRole, imageMatch.layer, errors, true
    );

    if (
      (mechanicLayer !== null && mechanicLayer === descriptionLayer) ||
      (imageLayer !== null && imageLayer === descriptionLayer) ||
      (mechanicLayer !== null && imageLayer !== null && mechanicLayer === imageLayer)
    ) {
      addError(
        errors,
        'Uma camada corresponde a mais de uma função do produto ' + slot +
          ' ' + offerContext(source) + "."
      );
      mechanicLayer = null;
      imageLayer = null;
    }

    products.push({
      slot,
      descriptionLayer,
      mechanicLayer,
      imageLayer,
      valid: validDescription !== null && mechanicLayer !== null && imageLayer !== null,
    });
  }

  // A comment on one slot and a fallback name on another must not associate the
  // same native layer with two products. Keep both slot identities but block edits.
  for (let firstIndex = 0; firstIndex < products.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < products.length; secondIndex += 1) {
      const first = products[firstIndex];
      const second = products[secondIndex];
      if (!shareLayer(first, second)) continue;
      first.valid = false;
      second.valid = false;
      addError(
        errors,
        'Uma camada está associada aos produtos ' + first.slot + " e " +
          second.slot + " " + offerContext(source) + "."
      );
    }
  }

  return products;
};

export const findOfferStructureLayer = (
  source: CompItem | null,
  role: "legal" | "markers",
  errors: string[]
): Layer | null => {
  if (source === null) return null;
  const identity = role === "legal" ? "TEXTO LEGAL" : "MARCADORES";
  const found = findRole(source, identity, errors, true).layer;
  return role === "legal"
    ? validateRoleLayer(source, identity, found, errors, false)
    : found;
};

// Offer markers are optional while resolving products. This helper can be used
// by an operation that specifically needs them without changing other timelines.
export const getOfferMarkerLayer = (
  source: CompItem | null,
  errors: string[]
): Layer | null => source === null
  ? null
  : findRole(source, "MARCADORES", errors, false).layer;
