import type {
  LayerOption,
  OfferEditorActionResult,
  OfferImageInfo,
  OfferSummary,
} from "../types";
import { expandTemplateIdentity, getTemplateIdentities, withTemplateIdentities } from "../../template/templateIdentities";
import { isTemplateOfferLayerComment, readTemplateOfferSlot, resolveTemplateIdentity } from "../../project/resolveTemplateIdentity";

const OFFER_SELECTION_OFFSET_FRAMES = 30;
const LABEL_TO_MARKER_INDEX: { [label: number]: number } = {
  1: 1,
  2: 2,
  8: 3,
  9: 4,
  10: 5,
  11: 6,
};

export const getOffersComp = (
  openInViewer: boolean = false,
  errors?: string[]
): CompItem | null => {
  if (app.project === null) return null;
  let compName: string;
  try { compName = getTemplateIdentities().named.offersComp; } catch (error) {
    if (errors) addError(errors, String(error));
    return null;
  }
  let found: CompItem | null = null;

  for (let index = 1; index <= app.project.numItems; index += 1) {
    const item = app.project.item(index);

    if (item instanceof CompItem && item.name === compName) {
      if (found !== null) {
        if (errors) addError(errors, 'Mais de uma precomp se chama "' + compName + '".');
        return null;
      }
      found = item;
    }
  }
  if (found !== null && openInViewer) openCompInViewer(found);
  return found;
};

export const openCompInViewer = (comp: CompItem): void => {
  if (app.project !== null && app.project.activeItem === comp) {
    return;
  }

  const viewer = comp.openInViewer();
  if (viewer !== null) {
    viewer.setActive();
  }
};

export const openOfferSourceInViewer = (offer: Layer): void => {
  try {
    if (offer instanceof AVLayer && offer.source instanceof CompItem) {
      openCompInViewer(offer.source);
    }
  } catch (error) {
  }
};

export const getOfferByLayerIndex = (
  offerLayerIndex: number,
  result: OfferEditorActionResult
): Layer | null => withTemplateIdentities(() => {
  const comp = getOffersComp(false, result.errors);

  if (comp === null) {
    result.message = result.errors.length > 0 ? result.errors[0] : 'Precomp "Miolo" nao encontrada.';
    return null;
  }

  const offers = getOfferLayers(comp, result.errors);
  for (let index = 0; index < offers.length; index += 1) {
    if (offers[index].index === offerLayerIndex) return offers[index];
  }
  result.message = result.errors.length > 0 ? result.errors[0] : "Oferta nao encontrada.";
  return null;
});

export const getOfferLayers = (comp: CompItem, errors?: string[]): Layer[] => withTemplateIdentities(() => {
  const offers: Layer[] = [];
  try {
    const config = getTemplateIdentities();
    const candidates: Layer[] = [];
    const slots: number[] = [];
    const seen: { [slot: string]: boolean } = {};
    for (let index = 1; index <= comp.numLayers; index += 1) {
      const layer = getLayerByIndex(comp, index);
      if (layer === null) continue;
      candidates.push(layer);
      const slot = readTemplateOfferSlot(layer);
      if (slot !== null && !seen["$" + slot]) {
        seen["$" + slot] = true;
        slots.push(slot);
      }
    }
    const resolved: Layer[] = [];
    for (let index = 0; index < slots.length; index += 1) {
      const identity = expandTemplateIdentity(config.offerLayers.offer, slots[index]);
      const matches = resolveTemplateIdentity(candidates, identity,
        config.fallback.offerLayers, isTemplateOfferLayerComment).matches;
      if (matches.length === 1) resolved.push(matches[0]);
      else if (matches.length > 1 && errors) {
        addError(errors, 'A identidade "' + identity.comment + '" corresponde a mais de uma camada de oferta.');
      }
    }
    // Preserve the editor's bottom-to-top timeline ordering.
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      for (let matchIndex = 0; matchIndex < resolved.length; matchIndex += 1) {
        if (candidates[index] === resolved[matchIndex]) { offers.push(candidates[index]); break; }
      }
    }
  } catch (error) {
    if (errors) addError(errors, String(error));
    return [];
  }
  return offers;
});

export const createOfferSummaries = (offers: Layer[]): OfferSummary[] => {
  const summaries: OfferSummary[] = [];

  for (let index = 0; index < offers.length; index += 1) {
    const offer = offers[index];
    const label = offer.label;

    summaries.push({
      layerIndex: offer.index,
      name: offer.name,
      label,
      markerIndex: LABEL_TO_MARKER_INDEX[label] || 0,
      startTime: offer.startTime,
      selected: offer.selected,
      enabled: offer.enabled,
    });
  }

  return summaries;
};

export const resolveSelectedOffer = (
  comp: CompItem,
  offers: Layer[],
  requestedOfferLayerIndex?: number
): Layer | null => withTemplateIdentities(() => {
  const eligible = getOfferLayers(comp);
  const contains = (layer: Layer): boolean => {
    for (let index = 0; index < eligible.length; index += 1) if (eligible[index] === layer) return true;
    return false;
  };
  if (typeof requestedOfferLayerIndex === "number" && requestedOfferLayerIndex > 0) {
    const requestedOffer = getLayerByIndex(comp, requestedOfferLayerIndex);
    if (requestedOffer !== null && contains(requestedOffer)) {
      return requestedOffer;
    }
  }

  const selectedLayers = comp.selectedLayers;

  if (selectedLayers && selectedLayers.length === 1) {
    const selectedLayer = selectedLayers[0];
    if (contains(selectedLayer)) {
      return selectedLayer;
    }
  }

  for (let index = 0; index < offers.length; index += 1) if (contains(offers[index])) return offers[index];
  return null;
});

export const selectOffer = (comp: CompItem, offer: Layer): void => {
  comp.time = clampTime(
    offer.startTime + comp.frameDuration * OFFER_SELECTION_OFFSET_FRAMES,
    comp
  );
  clearLayerSelection(comp);
  offer.selected = true;
};

export const clampTime = (time: number, comp: CompItem): number =>
  Math.max(0, Math.min(comp.duration, time));

export const clearLayerSelection = (comp: CompItem): void => {
  for (let index = 1; index <= comp.numLayers; index += 1) {
    comp.layer(index).selected = false;
  }
};

export const getLayerSource = (
  layer: Layer | null,
  context: string,
  errors: string[]
): CompItem | null => {
  if (layer === null) {
    addError(errors, "Layer ausente em " + context + ".");
    return null;
  }

  try {
    if (layer instanceof AVLayer && layer.source instanceof CompItem) {
      return layer.source;
    }
  } catch (error) {
  }

  addError(errors, 'A layer "' + layer.name + '" nao possui source em ' + context + ".");
  return null;
};

export const readProductImageInfo = (
  layer: Layer | null,
  context: string,
  errors: string[]
): OfferImageInfo | null => {
  if (layer === null) {
    addError(errors, "Nao encontrei a layer de imagem em " + context + ".");
    return null;
  }

  const image: OfferImageInfo = {
    layerIndex: layer.index,
    layerName: layer.name,
    sourceName: "",
    filePath: "",
    enabled: layer.enabled,
  };

  try {
    if (layer instanceof AVLayer) {
      const source = layer.source;

      if (source !== null && typeof source !== "undefined") {
        image.sourceName = String(source.name || "");
        image.filePath = findFootageFilePath(source, 0);
      }
    }
  } catch (error) {
  }

  if (image.sourceName === "") {
    addError(errors, 'A layer "' + layer.name + '" nao possui source de imagem.');
  }

  return image;
};

export const findFootageFilePath = (source: Item, depth: number): string => {
  if (depth > 4) return "";

  try {
    if (
      source instanceof FootageItem &&
      source.mainSource instanceof FileSource
    ) {
      return source.mainSource.file.fsName;
    }
  } catch (error) {
  }

  try {
    if (source instanceof CompItem) {
      for (let index = 1; index <= source.numLayers; index += 1) {
        const layer = source.layer(index);

        if (layer instanceof AVLayer) {
          const found = findFootageFilePath(layer.source, depth + 1);
          if (found !== "") return found;
        }
      }
    }
  } catch (error) {
  }

  return "";
};

export const getLayerByName = (
  source: CompItem | null,
  name: string
): Layer | null => {
  if (source === null) return null;

  try {
    return source.layer(name);
  } catch (error) {
    return null;
  }
};

export const getLayerByIndex = (
  source: CompItem | null,
  index: number
): Layer | null => {
  if (source === null || index < 1 || index > source.numLayers) {
    return null;
  }

  try {
    return source.layer(index);
  } catch (error) {
    return null;
  }
};

export const getLayerByOption = (
  source: CompItem | null,
  option: LayerOption
): Layer | null => {
  let layer: Layer | null = null;

  if (option.layerName) {
    layer = getLayerByName(source, option.layerName);
  }

  if (layer === null && option.layerIndex) {
    layer = getLayerByIndex(source, option.layerIndex);
  }

  return layer;
};

export const findPropertyDeep = (
  group: PropertyBase | null,
  matcher: (candidate: Property) => boolean
): Property | null => {
  if (group === null) return null;

  try {
    if (group instanceof Property && matcher(group)) {
      return group;
    }
  } catch (error) {
  }

  let count = 0;
  try {
    count = group.numProperties;
  } catch (error) {
    count = 0;
  }

  for (let index = 1; index <= count; index += 1) {
    let child: PropertyBase | null = null;

    try {
      child = group.property(index) as PropertyBase;
    } catch (error) {
      child = null;
    }

    const found = findPropertyDeep(child, matcher);
    if (found !== null) return found;
  }

  return null;
};

export const isNumericValueProperty = (candidate: Property): boolean => {
  try {
    return (
      candidate !== null &&
      candidate.propertyValueType === PropertyValueType.OneD &&
      typeof candidate.value === "number"
    );
  } catch (error) {
    return false;
  }
};

export const nameMatches = (name: string, pattern: RegExp): boolean =>
  String(name).match(pattern) !== null;

export const addError = (errors: string[], message: string): void => {
  errors.push(message);
};
