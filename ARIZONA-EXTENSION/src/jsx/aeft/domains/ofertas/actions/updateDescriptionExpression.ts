import type { OfferEditorActionResult } from "../types";
import { setPropertyExpressionEnabled } from "../layers/textFields";
import { updateOfferProduct } from "./shared";

export const updateOfferDescriptionExpression = (
  offerLayerIndex: number,
  productIndex: number,
  enabled: boolean
): OfferEditorActionResult => {
  return updateOfferProduct(
    offerLayerIndex,
    productIndex,
    enabled
      ? "Sincronizar descritivo"
      : "Desativar sincronizacao do descritivo",
    (product) => {
      setPropertyExpressionEnabled(product.descriptionProperty, enabled);
      return enabled
        ? "Sincronizacao do descritivo ativada."
        : "Sincronizacao do descritivo desativada.";
    }
  );
};
