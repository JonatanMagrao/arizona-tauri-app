import { MECHANIC_LAYER_NAME_FALLBACK_ENABLED } from "../mechanics/config";
import { addError, getLayerByIndex } from "./findLayers";

interface LayerIdentity {
  comment: string;
  fallbackNames: string[];
  context: string;
}

const normalizeIdentity = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

export const findLayerByIdentity = (
  source: CompItem | null,
  identity: LayerIdentity,
  errors: string[]
): Layer | null => {
  if (source === null) return null;

  const expectedComment = normalizeIdentity(identity.comment);
  let found: Layer | null = null;

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null) continue;

    let comment = "";
    try {
      comment = normalizeIdentity(layer.comment);
    } catch (error) {
    }

    if (comment !== expectedComment) continue;

    if (found !== null) {
      addError(
        errors,
        'Mais de uma camada tem o comentário "' + identity.comment +
          '" em ' + identity.context + "."
      );
      return null;
    }
    found = layer;
  }

  if (found !== null) return found;

  if (!MECHANIC_LAYER_NAME_FALLBACK_ENABLED) {
    addError(
      errors,
      'Não encontrei uma camada com o comentário "' + identity.comment +
        '" em ' + identity.context + ". O fallback por nome está desativado."
    );
    return null;
  }

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null) continue;

    const name = normalizeIdentity(layer.name);
    let matchesName = false;
    for (let ni = 0; ni < identity.fallbackNames.length; ni += 1) {
      if (name === normalizeIdentity(identity.fallbackNames[ni])) {
        matchesName = true;
        break;
      }
    }
    if (!matchesName) continue;

    if (found !== null) {
      addError(
        errors,
        'Mais de uma camada corresponde ao nome de "' + identity.comment +
          '" em ' + identity.context + "."
      );
      return null;
    }
    found = layer;
  }

  if (found === null) {
    addError(
      errors,
      'Não encontrei a camada "' + identity.comment +
        '" por comentário ou nome em ' + identity.context + "."
    );
  }
  return found;
};
