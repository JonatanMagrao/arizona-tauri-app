import type { InternalOfferMechanic } from "../types";
import { getLayerSource } from "../layers/findLayers";
import { makeIndexedTextField } from "./shared";

export const readCrfCardValueDiscountMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => {
  const source = getLayerSource(
    valueLayer,
    "desconto em valor Cartao Carrefour",
    errors
  );

  return {
    type: "Desconto R$ Cartao CRF",
    fields: [
      makeIndexedTextField(
        source,
        4,
        "Desconto",
        "price",
        "desconto em valor Cartao Carrefour",
        errors
      ),
    ],
    optionGroups: [],
  };
};
