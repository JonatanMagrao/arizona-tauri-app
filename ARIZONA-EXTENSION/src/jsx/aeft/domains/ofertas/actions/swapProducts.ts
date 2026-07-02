import type { OfferEditorActionResult } from "../types";
import {
  getOfferByLayerIndex,
  openOfferSourceInViewer,
} from "../layers/findLayers";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";
import { createActionResult } from "./shared";

export const swapOfferProducts = (
  offerLayerIndex: number,
  sourceProductIndex: number,
  targetProductIndex: number,
  openOfferPrecomp?: boolean
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  if (sourceProductIndex === targetProductIndex) {
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Produtos ja estao na mesma posicao.";
    return result;
  }

  app.beginUndoGroup("Trocar produtos da oferta");

  try {
    const details = generateOfferData(offer);
    const sourceProduct = details.products[sourceProductIndex];
    const targetProduct = details.products[targetProductIndex];
    result.errors = details.errors.slice(0);

    if (!sourceProduct || !targetProduct) {
      throw new Error("Produto de origem ou destino nao encontrado.");
    }

    swapLayerSourceScaleAndName(
      sourceProduct.descriptionLayer,
      targetProduct.descriptionLayer,
      "descritivo"
    );
    swapLayerSourceScaleAndName(
      sourceProduct.mechanicLayer,
      targetProduct.mechanicLayer,
      "mecanica"
    );
    swapLayerSourceScaleAndName(
      sourceProduct.imageLayer,
      targetProduct.imageLayer,
      "imagem"
    );

    if (openOfferPrecomp === true) {
      openOfferSourceInViewer(offer);
    }

    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message =
      "Produtos " +
      (sourceProductIndex + 1) +
      " e " +
      (targetProductIndex + 1) +
      " trocados.";
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao trocar produtos.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};

const swapLayerSourceScaleAndName = (
  firstLayer: Layer | null,
  secondLayer: Layer | null,
  context: string,
  shouldSwapScale?: boolean
): void => {
  if (firstLayer === null || secondLayer === null) {
    throw new Error("Layer ausente para trocar " + context + ".");
  }

  if (!(firstLayer instanceof AVLayer) || !(secondLayer instanceof AVLayer)) {
    throw new Error("As layers de " + context + " precisam ser AVLayer.");
  }

  const firstSource = firstLayer.source;
  const secondSource = secondLayer.source;

  if (
    firstSource === null ||
    secondSource === null ||
    typeof firstSource === "undefined" ||
    typeof secondSource === "undefined"
  ) {
    throw new Error("Source ausente para trocar " + context + ".");
  }

  const swapScale = shouldSwapScale !== false;
  const firstScale = swapScale ? firstLayer.scale.value : null;
  const secondScale = swapScale ? secondLayer.scale.value : null;
  const firstName = firstLayer.name;
  const secondName = secondLayer.name;

  firstLayer.replaceSource(secondSource, true);
  if (swapScale && secondScale !== null) {
    firstLayer.scale.setValue(secondScale);
  }
  firstLayer.name = secondName;

  secondLayer.replaceSource(firstSource, true);
  if (swapScale && firstScale !== null) {
    secondLayer.scale.setValue(firstScale);
  }
  secondLayer.name = firstName;
};
