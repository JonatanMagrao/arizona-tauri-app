import type {
  LayerOption,
  OfferEditorActionResult,
  OfferImageInfo,
  OfferSummary,
} from "../types";

const COMP_NAME = "Miolo";
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
  openInViewer: boolean = false
): CompItem | null => {
  if (app.project === null) return null;

  for (let index = 1; index <= app.project.numItems; index += 1) {
    const item = app.project.item(index);

    if (item instanceof CompItem && item.name === COMP_NAME) {
      if (openInViewer) {
        openCompInViewer(item);
      }

      return item;
    }
  }

  return null;
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
): Layer | null => {
  const comp = getOffersComp();

  if (comp === null) {
    result.message = 'Precomp "Miolo" nao encontrada.';
    return null;
  }

  const offer = getLayerByIndex(comp, offerLayerIndex);

  if (offer === null || !nameMatches(offer.name, /Oferta_/)) {
    result.message = "Oferta nao encontrada.";
    return null;
  }

  return offer;
};

export const getOfferLayers = (comp: CompItem): Layer[] => {
  const offers: Layer[] = [];

  for (let index = comp.numLayers; index > 0; index -= 1) {
    const layer = comp.layer(index);
    if (nameMatches(layer.name, /Oferta_/)) {
      offers.push(layer);
    }
  }

  return offers;
};

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
): Layer | null => {
  if (typeof requestedOfferLayerIndex === "number" && requestedOfferLayerIndex > 0) {
    const requestedOffer = getLayerByIndex(comp, requestedOfferLayerIndex);
    if (requestedOffer !== null && nameMatches(requestedOffer.name, /Oferta_/)) {
      return requestedOffer;
    }
  }

  const selectedLayers = comp.selectedLayers;

  if (selectedLayers && selectedLayers.length === 1) {
    const selectedLayer = selectedLayers[0];
    if (nameMatches(selectedLayer.name, /Oferta_/)) {
      return selectedLayer;
    }
  }

  return offers.length > 0 ? offers[0] : null;
};

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

export const findLayerByNamePart = (
  source: CompItem | null,
  namePart: string
): Layer | null => {
  if (source === null) return null;

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = source.layer(index);
    if (String(layer.name).indexOf(namePart) >= 0) {
      return layer;
    }
  }

  return null;
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
