import type { OfferEditorActionResult } from "../types";
import { setText } from "../layers/textFields";
import { updateOfferProduct } from "./shared";

export const updateOfferDescription = (
  offerLayerIndex: number,
  productIndex: number,
  value: string
): OfferEditorActionResult => {
  return updateOfferProduct(
    offerLayerIndex,
    productIndex,
    "Atualizar descricao",
    (product) => {
      setText(product.descriptionProperty, String(value).toUpperCase());
      return "Descricao atualizada.";
    }
  );
};
