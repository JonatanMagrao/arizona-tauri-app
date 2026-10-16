import type { OfferEditorActionResult, OfferEditorSnapshot } from "../types";

// A patch contains a fresh read of the whole affected offer, including fields
// driven by expressions. Never predict native values from the requested edit.
export const mergeOfferUpdate = (
  current: OfferEditorSnapshot | null,
  result: OfferEditorActionResult
): OfferEditorSnapshot | null => {
  const update = result.offerUpdate;
  const previous = current?.selectedOfferContext;
  const next = update?.context;
  if (!result.ok || !current?.ok || !current.selectedOffer || !previous || !next ||
      !update?.offer || !Array.isArray(current.discoveryErrors) ||
      !Array.isArray(update.offer.products) || !Array.isArray(update.offer.legalControls) ||
      !Array.isArray(update.offer.errors) || !previous.projectKey ||
      previous.projectKey !== next.projectKey || previous.compItemId !== next.compItemId ||
      previous.offerLayerId !== next.offerLayerId || previous.sourceItemId !== next.sourceItemId ||
      previous.offerLayerIndex !== next.offerLayerIndex ||
      current.selectedOfferLayerIndex !== next.offerLayerIndex ||
      current.selectedOffer.layerIndex !== next.offerLayerIndex ||
      result.selectedOfferLayerIndex !== next.offerLayerIndex ||
      update.offer.layerIndex !== next.offerLayerIndex) return null;

  return {
    ...current,
    selectedOffer: update.offer,
    selectedOfferContext: next,
    message: update.offer.products.length > 0
      ? "Oferta carregada."
      : "Nenhum produto ativo encontrado nesta oferta.",
    errors: current.discoveryErrors.concat(update.offer.errors),
  };
};
