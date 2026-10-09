import type { OfferEditorActionResult } from "../types";
import {
  getOfferByLayerIndex,
  openOfferSourceInViewer,
} from "../layers/findLayers";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";
import {
  assertOfferProductAssociation,
  createActionResult,
  findOfferProductByIndex,
} from "./shared";

interface LayerSwapState {
  layer: AVLayer;
  source: AVItem;
  scale: TwoDPoint | ThreeDPoint;
  rollbackScale: TwoDPoint | ThreeDPoint;
  name: string;
  preserveName: boolean;
}

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
    const sourceProduct = findOfferProductByIndex(details.products, sourceProductIndex);
    const targetProduct = findOfferProductByIndex(details.products, targetProductIndex);
    result.errors = details.errors.slice(0);

    if (!sourceProduct || !targetProduct) {
      throw new Error("Produto de origem ou destino nao encontrado.");
    }
    assertOfferProductAssociation(sourceProduct);
    assertOfferProductAssociation(targetProduct);

    // Capture and validate all six layers before the first native write.
    const sourceLayers = [sourceProduct.descriptionLayer, sourceProduct.mechanicLayer, sourceProduct.imageLayer];
    const targetLayers = [targetProduct.descriptionLayer, targetProduct.mechanicLayer, targetProduct.imageLayer];
    const roles = ["DESCRITIVO", "MECANICA", "PRODUTO"];
    const firstStates: LayerSwapState[] = [];
    const secondStates: LayerSwapState[] = [];
    const allStates: LayerSwapState[] = [];
    for (let index = 0; index < roles.length; index += 1) {
      const first = captureLayerState(sourceLayers[index], roles[index] + " " + (sourceProduct.index + 1));
      const second = captureLayerState(targetLayers[index], roles[index] + " " + (targetProduct.index + 1));
      const pair = [first, second];
      for (let pairIndex = 0; pairIndex < pair.length; pairIndex += 1) {
        for (let stateIndex = 0; stateIndex < allStates.length; stateIndex += 1) {
          if (allStates[stateIndex].layer === pair[pairIndex].layer) {
            throw new Error("Uma camada está associada a mais de uma posição na troca.");
          }
        }
        allStates.push(pair[pairIndex]);
      }
      firstStates.push(first);
      secondStates.push(second);
    }

    const touched: LayerSwapState[] = [];
    try {
      for (let index = 0; index < firstStates.length; index += 1) {
        applyLayerState(firstStates[index], secondStates[index], touched);
        applyLayerState(secondStates[index], firstStates[index], touched);
      }
    } catch (error) {
      restoreLayerStates(touched, result.errors);
      throw error;
    }

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

const captureLayerState = (layer: Layer | null, role: string): LayerSwapState => {
  if (layer === null || !(layer instanceof AVLayer)) {
    throw new Error("Camada ausente ou inválida para trocar " + role + ".");
  }
  const source = layer.source;
  if (source === null || typeof source === "undefined") {
    throw new Error("Source ausente para trocar " + role + ".");
  }
  if (layer.scale.numKeys > 0) {
    throw new Error("A escala de " + role + " possui keyframes e não pode ser trocada por valor.");
  }
  const comment = String(layer.comment || "").replace(/^\s+|\s+$/g, "").toUpperCase();
  const scale = copyScale(layer.scale.value);
  const rollbackScale = layer.scale.expressionEnabled
    ? copyScale(layer.scale.valueAtTime(layer.containingComp.time, true))
    : copyScale(scale);
  return {
    layer,
    source,
    scale,
    rollbackScale,
    name: layer.name,
    // In fallback mode the name itself identifies the slot and must stay put.
    preserveName: comment !== role,
  };
};

const copyScale = (value: TwoDPoint | ThreeDPoint): TwoDPoint | ThreeDPoint =>
  value.length === 3
    ? [value[0], value[1], (value as ThreeDPoint)[2]]
    : [value[0], value[1]];

const applyLayerState = (
  destination: LayerSwapState,
  source: LayerSwapState,
  touched: LayerSwapState[]
): void => {
  touched.push(destination);
  destination.layer.replaceSource(source.source, true);
  destination.layer.scale.setValue(source.scale);
  destination.layer.name = destination.preserveName ? destination.name : source.name;
};

const restoreLayerStates = (states: LayerSwapState[], errors: string[]): void => {
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    try {
      state.layer.replaceSource(state.source, true);
      state.layer.scale.setValue(state.rollbackScale);
      state.layer.name = state.name;
    } catch (error) {
      errors.push("Não foi possível restaurar " + state.name + ". Desfaça a troca pelo Undo do After Effects.");
    }
  }
};
