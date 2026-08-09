import type { OfferEditorActionResult } from "../types";
import {
  getLayerByIndex,
  getOffersComp,
  nameMatches,
  selectOffer,
} from "../layers/findLayers";
import { createActionResult } from "./shared";

export const swapOfferSources = (
  sourceOfferLayerIndex: number,
  targetOfferLayerIndex: number
): OfferEditorActionResult => {
  const result = createActionResult();
  const comp = getOffersComp(true);

  if (comp === null) {
    result.message = 'Precomp "Miolo" nao encontrada.';
    return result;
  }

  const sourceOffer = getLayerByIndex(comp, sourceOfferLayerIndex);
  const targetOffer = getLayerByIndex(comp, targetOfferLayerIndex);

  if (
    sourceOffer === null ||
    targetOffer === null ||
    !nameMatches(sourceOffer.name, /Oferta_/) ||
    !nameMatches(targetOffer.name, /Oferta_/)
  ) {
    result.message = "Oferta de origem ou destino nao encontrada.";
    return result;
  }

  if (sourceOffer.index === targetOffer.index) {
    result.ok = true;
    result.selectedOfferLayerIndex = targetOffer.index;
    result.message = "A oferta ja esta nessa posicao.";
    return result;
  }

  if (
    !(sourceOffer instanceof AVLayer) ||
    !(targetOffer instanceof AVLayer) ||
    !(sourceOffer.source instanceof CompItem) ||
    !(targetOffer.source instanceof CompItem)
  ) {
    result.message = "As duas ofertas precisam possuir uma precomp valida.";
    return result;
  }

  const sourceComp = sourceOffer.source;
  const targetComp = targetOffer.source;
  const sourceScale = sourceOffer.scale.value;
  const targetScale = targetOffer.scale.value;
  const sourceLayerName = sourceOffer.name;
  const targetLayerName = targetOffer.name;
  let sourceWasReplaced = false;
  let targetWasReplaced = false;

  app.beginUndoGroup("Trocar conteudo das ofertas");

  try {
    // Both comps remain valid during this bidirectional swap, so expression
    // text must not be rewritten in either half. Keep the source, scale,
    // layer-name and target selection changes in the same undo step.
    sourceOffer.replaceSource(targetComp, false);
    sourceWasReplaced = true;
    sourceOffer.scale.setValue(targetScale);
    sourceOffer.name = sourceLayerName;

    targetOffer.replaceSource(sourceComp, false);
    targetWasReplaced = true;
    targetOffer.scale.setValue(sourceScale);
    targetOffer.name = targetLayerName;

    selectOffer(comp, targetOffer);

    result.ok = true;
    result.selectedOfferLayerIndex = targetOffer.index;
    result.message =
      'Conteudo de "' +
      sourceLayerName +
      '" e "' +
      targetLayerName +
      '" trocado.';
  } catch (error) {
    try {
      if (targetWasReplaced) {
        targetOffer.replaceSource(targetComp, false);
        targetOffer.scale.setValue(targetScale);
      }

      if (sourceWasReplaced) {
        sourceOffer.replaceSource(sourceComp, false);
        sourceOffer.scale.setValue(sourceScale);
      }

      sourceOffer.name = sourceLayerName;
      targetOffer.name = targetLayerName;
    } catch (rollbackError) {
      result.errors.push("Nao foi possivel desfazer a troca incompleta.");
    }

    result.message =
      error instanceof Error
        ? error.message
        : "Erro ao trocar o conteudo das ofertas.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};
