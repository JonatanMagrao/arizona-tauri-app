import type { InternalOfferProduct } from "../types";
import { getLayerByIndex, getLayerSource, nameMatches } from "../layers/findLayers";
import { readMechanic } from "../mechanics/registry";

// Match the editor's product order while reading only the fields used by Roteiro.
export const getFirstOfferProductForValidation = (
  offer: Layer
): Pick<InternalOfferProduct, "index" | "mechanic"> | null => {
  const errors: string[] = [];
  const offerSource = getLayerSource(offer, "oferta", errors);
  if (offerSource === null) return null;

  for (let index = 1; index <= offerSource.numLayers; index += 1) {
    const descriptionPrecomp = offerSource.layer(index);
    if (
      !descriptionPrecomp.enabled ||
      !nameMatches(descriptionPrecomp.name, /DESCRITIVO/)
    ) {
      continue;
    }

    const valueLayer = getLayerByIndex(offerSource, descriptionPrecomp.index + 1);
    if (valueLayer === null) continue;

    return { index: 0, mechanic: readMechanic(valueLayer, errors) };
  }

  return null;
};
