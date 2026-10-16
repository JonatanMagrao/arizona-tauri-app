import type { OfferEditorActionResult } from "../types";
import {
  getOfferByLayerIndex,
  getOffersComp,
  selectOffer,
} from "../layers/findLayers";
import { createActionResult } from "./shared";
import { withTemplateIdentities } from "../../template/templateIdentities";

const AE_UNDO_COMMAND_ID = 16;
const AE_UNDO_SCHEDULE_DELAY_MS = 10;

export const selectOfferForEditor = (
  offerLayerIndex: number
): OfferEditorActionResult => withTemplateIdentities(() => {
  const result = createActionResult();
  const comp = getOffersComp(true, result.errors);

  if (comp === null) {
    result.message = result.errors.length > 0 ? result.errors[0] : 'Precomp "Miolo" nao encontrada.';
    return result;
  }

  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Selecionar oferta");

  try {
    selectOffer(comp, offer);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = offer.name + " selecionada.";
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao selecionar oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
});

export const openOfferPrecompForEditor = (
  offerLayerIndex: number
): OfferEditorActionResult => withTemplateIdentities(() => {
  const result = createActionResult();
  const comp = getOffersComp(true, result.errors);

  if (comp === null) {
    result.message = result.errors.length > 0 ? result.errors[0] : 'Precomp "Miolo" nao encontrada.';
    return result;
  }

  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Abrir precomp da oferta");

  try {
    selectOffer(comp, offer);

    if (!(offer instanceof AVLayer) || !(offer.source instanceof CompItem)) {
      throw new Error("A oferta nao possui precomp para abrir.");
    }

    offer.source.openInViewer();
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = 'Precomp "' + offer.source.name + '" aberta.';
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao abrir precomp da oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
});

export const undoOffersEditorAction = (): OfferEditorActionResult => {
  const result = createActionResult();

  try {
    app.scheduleTask(
      "app.executeCommand(" + AE_UNDO_COMMAND_ID + ")",
      AE_UNDO_SCHEDULE_DELAY_MS,
      false
    );

    result.ok = true;
    result.message = "Undo solicitado.";
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao executar undo.";
    result.errors.push(result.message);
  }

  return result;
};
