import type { InternalOfferProduct } from "../types";
import { getLayerSource } from "../layers/findLayers";
import { resolveOfferProductLayers } from "../layers/offerStructure";
import { readMechanic } from "../mechanics/registry";
import { withMechanicsSchema } from "../mechanics/schemaRuntime";

// Use the same numbered slots as the editor, without reading legal text or previews.
export const getFirstOfferProductForValidation = (
  offer: Layer
): Pick<InternalOfferProduct, "index" | "mechanic"> | null => withMechanicsSchema(() => {
  const errors: string[] = [];
  const offerSource = getLayerSource(offer, "oferta", errors);
  if (offerSource === null) return null;

  const unresolvedSlots: number[] = [];
  const products = resolveOfferProductLayers(offerSource, errors, unresolvedSlots);
  const first = products.length > 0 ? products[0] : null;
  let unresolvedBeforeFirst = false;
  for (let index = 0; index < unresolvedSlots.length; index += 1) {
    if (first === null || unresolvedSlots[index] <= first.slot) {
      unresolvedBeforeFirst = true;
    }
  }
  // An ambiguous or missing slot must not redirect a Roteiro correction to
  // another product. Keep the read empty until the offer structure is repaired.
  if (unresolvedBeforeFirst || (first !== null && !first.valid)) {
    return {
      index: first === null ? 0 : first.slot - 1,
      mechanic: {
        type: "Associação de produto inválida",
        fields: [],
        optionGroups: [],
        unsupported: true,
      },
    };
  }
  return first === null || first.mechanicLayer === null
    ? null
    : { index: first.slot - 1, mechanic: readMechanic(first.mechanicLayer, errors) };
});
