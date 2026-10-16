import { expandTemplateIdentity, getTemplateIdentities, withTemplateIdentities } from "../../template/templateIdentities";
import { isTemplateOfferLayerComment } from "../../project/resolveTemplateIdentity";
import { addError, getLayerByIndex } from "./findLayers";

export interface OfferProductLayerSet {
  slot: number;
  descriptionLayer: Layer;
  mechanicLayer: Layer | null;
  mechanicUnavailableLabel?: string;
  imageLayer: Layer | null;
  valid: boolean;
  disabledReason?: string;
  disabledSummary?: string;
}

interface RoleMatch {
  layer: Layer | null;
  count: number;
}

const normalizeIdentity = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

// Role IDs stay stable for actions; configurable comments and names live in the asset.
export const getOfferRoleIdentity = (role: string): { comment: string; names: string[] } => {
  const map = getTemplateIdentities().offerLayers;
  if (role === "TEXTO LEGAL") return map.legal;
  if (role === "MARCADORES") return map.markers;
  const match = /^(DESCRITIVO|MECANICA|PRODUTO) ([1-3])$/.exec(role);
  if (match === null) throw new Error("Papel de camada desconhecido: " + role);
  const identity = match[1] === "DESCRITIVO" ? map.description
    : match[1] === "MECANICA" ? map.mechanic : map.product;
  return expandTemplateIdentity(identity, Number(match[2]));
};

const offerContext = (source: CompItem): string =>
  'na oferta "' + source.name + '"';

const addDisabledSummary = (summaries: string[] | undefined, summary: string): void => {
  if (!summaries) return;
  for (let index = 0; index < summaries.length; index += 1) {
    if (summaries[index] === summary) return;
  }
  summaries.push(summary);
};

const roleLayerLabel = (role: string): string => {
  if (role.indexOf("MECANICA ") === 0) return "camada da mecânica";
  if (role.indexOf("PRODUTO ") === 0) return "camada da imagem do produto";
  if (role.indexOf("DESCRITIVO ") === 0) return "camada do descritivo";
  return role === "TEXTO LEGAL" ? "camada da precomp de texto legal" : "camada de marcadores";
};

const readIdentity = (layer: Layer, byName: boolean): string => {
  try {
    return normalizeIdentity(byName ? layer.name : layer.comment);
  } catch (error) {
    return "";
  }
};

const scanRole = (
  source: CompItem,
  role: string,
  byName: boolean
): RoleMatch => {
  const identity = getOfferRoleIdentity(role);
  const expected = normalizeIdentity(identity.comment);
  let found: Layer | null = null;
  let count = 0;

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null) continue;
    const actual = readIdentity(layer, byName);
    let matches = actual === expected;
    if (byName) {
      matches = false;
      for (let ni = 0; ni < identity.names.length; ni += 1) {
        if (actual === normalizeIdentity(identity.names[ni])) { matches = true; break; }
      }
    }
    if (!matches) continue;
    if (byName) {
      let comment: string;
      try { comment = normalizeIdentity(layer.comment); } catch (error) { continue; }
      // A recognized comment already assigns this layer to an offer role. A
      // different name cannot repurpose it, even when name fallback is enabled.
      if (comment !== expected && isTemplateOfferLayerComment(comment)) continue;
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
  required: boolean,
  disabledReasons?: string[],
  disabledSummaries?: string[]
): RoleMatch => {
  const displayRole = getOfferRoleIdentity(role).comment;
  let result = scanRole(source, role, false);
  let byName = false;

  if (result.count === 0 && getTemplateIdentities().fallback.offerLayers) {
    result = scanRole(source, role, true);
    byName = true;
  }

  if (result.count > 1) {
    addDisabledSummary(disabledSummaries, byName
      ? 'Mais de uma camada possui o nome "' + displayRole + '" nesta oferta.'
      : 'Mais de uma camada possui o comentário "' + displayRole + '" nesta oferta.');
    if (disabledReasons) {
      disabledReasons.push(
        (byName ? 'Nome "' : 'Comentário "') + displayRole + '" repetido ' +
          offerContext(source) + ". Mantenha-o apenas na " + roleLayerLabel(role) + "."
      );
    }
    addError(
      errors,
      'Mais de uma camada tem o ' + (byName ? "nome" : "comentário") +
        ' "' + displayRole + '" ' + offerContext(source) + "."
    );
  } else if (result.count === 0 && required) {
    addDisabledSummary(disabledSummaries,
      'Não foi encontrada uma camada com o comentário "' + displayRole + '" nesta oferta.');
    if (disabledReasons) {
      disabledReasons.push(
        'Falta o comentário "' + displayRole + '". Adicione-o à ' +
          roleLayerLabel(role) + " " + offerContext(source) + "."
      );
    }
    addError(
      errors,
      'Não encontrei a camada com o comentário "' + displayRole + '" ' +
        offerContext(source) +
        (getTemplateIdentities().fallback.offerLayers
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
  isImage: boolean,
  disabledReasons?: string[],
  disabledSummaries?: string[]
): Layer | null => {
  if (layer === null) return null;
  const displayRole = getOfferRoleIdentity(role).comment;
  if (isImage ? isProductImageLayer(layer) : isPrecompLayer(layer)) return layer;

  addDisabledSummary(disabledSummaries,
    'A origem da camada com o comentário "' + displayRole + '" não é ' + (isImage
      ? "uma imagem ou precomp válida."
      : "uma precomp válida."));

  if (disabledReasons) {
    disabledReasons.push(
      'A camada com o comentário "' + displayRole + '" ' + offerContext(source) +
        (isImage
          ? " precisa ter uma imagem ou precomp válida como origem."
          : " precisa ter uma precomp válida como origem.")
    );
  }

  addError(
    errors,
    'A camada "' + displayRole + '" ' + offerContext(source) +
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
): OfferProductLayerSet[] => withTemplateIdentities(() => {
  const products: OfferProductLayerSet[] = [];
  if (source === null) return products;
  try { getTemplateIdentities(); } catch (error) {
    addError(errors, String(error));
    if (unresolvedSlots) unresolvedSlots.push(1, 2, 3);
    return products;
  }

  for (let slot = 1; slot <= 3; slot += 1) {
    const disabledReasons: string[] = [];
    const disabledSummaries: string[] = [];
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

    const mechanicMatch = findRole(source, mechanicRole, errors, false, disabledReasons, disabledSummaries);
    const imageMatch = findRole(source, imageRole, errors, false, disabledReasons, disabledSummaries);

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
      findRole(source, mechanicRole, errors, true, disabledReasons, disabledSummaries);
    }
    if (imageMatch.count === 0) {
      findRole(source, imageRole, errors, true, disabledReasons, disabledSummaries);
    }

    const validDescription = validateRoleLayer(
      source, descriptionRole, descriptionLayer, errors, false, disabledReasons, disabledSummaries
    );
    let mechanicLayer = validateRoleLayer(
      source, mechanicRole, mechanicMatch.layer, errors, false, disabledReasons, disabledSummaries
    );
    let imageLayer = validateRoleLayer(
      source, imageRole, imageMatch.layer, errors, true, disabledReasons, disabledSummaries
    );
    let mechanicUnavailableLabel = mechanicLayer !== null ? undefined
      : "Mecânica do produto " + slot + (mechanicMatch.count === 0
        ? " não identificada"
        : mechanicMatch.count > 1 ? " ambígua" : " sem precomp válida");

    if (
      (mechanicLayer !== null && mechanicLayer === descriptionLayer) ||
      (imageLayer !== null && imageLayer === descriptionLayer) ||
      (mechanicLayer !== null && imageLayer !== null && mechanicLayer === imageLayer)
    ) {
      addDisabledSummary(disabledSummaries, "Uma camada está associada a mais de uma função do produto.");
      disabledReasons.push(
        'Use os comentários "' + descriptionRole + '", "' + mechanicRole +
          '" e "' + imageRole + '" em camadas separadas ' + offerContext(source) + "."
      );
      addError(
        errors,
        'Uma camada corresponde a mais de uma função do produto ' + slot +
          ' ' + offerContext(source) + "."
      );
      mechanicLayer = null;
      mechanicUnavailableLabel = "Mecânica do produto " + slot + " com associação ambígua";
      imageLayer = null;
    }

    products.push({
      slot,
      descriptionLayer,
      mechanicLayer,
      mechanicUnavailableLabel,
      imageLayer,
      valid: validDescription !== null && mechanicLayer !== null && imageLayer !== null,
      disabledReason: disabledReasons.length > 0 ? disabledReasons.join(" ") : undefined,
      disabledSummary: disabledSummaries.length > 0 ? disabledSummaries.join(" ") : undefined,
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
      const reason = 'Use camadas separadas para os comentários dos produtos ' +
        first.slot + " e " + second.slot + " " + offerContext(source) + ".";
      first.disabledReason = first.disabledReason ? first.disabledReason + " " + reason : reason;
      second.disabledReason = second.disabledReason ? second.disabledReason + " " + reason : reason;
      first.disabledSummary = "Uma mesma camada está associada a mais de um produto.";
      second.disabledSummary = first.disabledSummary;
      addError(
        errors,
        'Uma camada está associada aos produtos ' + first.slot + " e " +
          second.slot + " " + offerContext(source) + "."
      );
    }
  }

  return products;
});

export const findOfferStructureLayer = (
  source: CompItem | null,
  role: "legal" | "markers",
  errors: string[],
  disabledReasons?: string[],
  disabledSummaries?: string[]
): Layer | null => withTemplateIdentities(() => {
  if (source === null) {
    if (disabledReasons) disabledReasons.push("Confira a origem da camada da oferta.");
    addDisabledSummary(disabledSummaries, "A precomp da oferta não foi encontrada.");
    return null;
  }
  try { getTemplateIdentities(); } catch (error) {
    addError(errors, String(error));
    if (disabledReasons) disabledReasons.push(String(error));
    addDisabledSummary(disabledSummaries, "Não foi possível ler o mapa de nomes do template.");
    return null;
  }
  const identity = role === "legal" ? "TEXTO LEGAL" : "MARCADORES";
  const found = findRole(source, identity, errors, true, disabledReasons, disabledSummaries).layer;
  return role === "legal"
    ? validateRoleLayer(source, identity, found, errors, false, disabledReasons, disabledSummaries)
    : found;
});

// Offer markers are optional while resolving products. This helper can be used
// by an operation that specifically needs them without changing other timelines.
export const getOfferMarkerLayer = (
  source: CompItem | null,
  errors: string[]
): Layer | null => source === null
  ? null
  : findRole(source, "MARCADORES", errors, false).layer;
