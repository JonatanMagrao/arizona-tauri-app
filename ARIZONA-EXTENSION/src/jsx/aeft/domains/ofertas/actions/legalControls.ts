import type { OfferEditorActionResult } from "../types";
import {
  getLayerByIndex,
  getLayerSource,
  getOfferByLayerIndex,
} from "../layers/findLayers";
import {
  findInternalLegalControl,
  findLegalControl,
  getLegalTextSource,
} from "../layers/legalControls";
import { setFieldValue, setLegalText } from "../layers/textFields";
import { applyOptionGroupSelection } from "../mechanics/shared";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";
import { createActionResult } from "./shared";

export const updateOfferLegalText = (
  offerLayerIndex: number,
  value: string
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Atualizar texto legal");

  try {
    const details = generateOfferData(offer);

    if (details.legalTextProperty === null) {
      throw new Error("Texto legal nao encontrado.");
    }

    setLegalText(details.legalTextProperty, value);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Texto legal atualizado.";
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao atualizar texto legal.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};

export const updateOfferLegalControl = (
  offerLayerIndex: number,
  controlId: string,
  enabled: boolean
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Atualizar configuracao do texto legal");

  try {
    const offerSource = getLayerSource(offer, "oferta", result.errors);
    const legalSource = getLegalTextSource(offerSource, result.errors);
    const control = findLegalControl(controlId);

    if (control === null) {
      throw new Error("Controle de texto legal nao encontrado.");
    }

    if (control.locked && !enabled) {
      throw new Error(control.label + " sempre fica visivel.");
    }

    const layer = getLayerByIndex(legalSource, control.layerIndex);

    if (layer === null) {
      throw new Error(
        "Layer " +
          control.layerIndex +
          " nao encontrada na precomp de texto legal."
      );
    }

    layer.enabled = enabled;
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = control.label + (enabled ? " ativado." : " desativado.");
  } catch (error) {
    result.message =
      error instanceof Error
        ? error.message
        : "Erro ao atualizar configuracao do texto legal.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};

export const updateOfferLegalControlValue = (
  offerLayerIndex: number,
  controlId: string,
  value: string
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Atualizar configuracao da oferta");

  try {
    const details = generateOfferData(offer);
    const control = findInternalLegalControl(details.legalControls, controlId);
    result.errors = details.errors.slice(0);

    if (control === null || !control.slider || control.slider.property === null) {
      throw new Error("Slider de " + controlId + " nao encontrado.");
    }

    setFieldValue(control.slider, value);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = control.label + " atualizado.";
  } catch (error) {
    result.message =
      error instanceof Error
        ? error.message
        : "Erro ao atualizar configuracao da oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};

export const updateOfferLegalControlOption = (
  offerLayerIndex: number,
  controlId: string,
  selectedIndex: number
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Atualizar menu da oferta");

  try {
    const details = generateOfferData(offer);
    const control = findInternalLegalControl(details.legalControls, controlId);
    result.errors = details.errors.slice(0);

    if (control === null || !control.optionGroup) {
      throw new Error("Menu de " + controlId + " nao encontrado.");
    }

    applyOptionGroupSelection(control.optionGroup, selectedIndex);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = control.label + " atualizado.";
  } catch (error) {
    result.message =
      error instanceof Error
        ? error.message
        : "Erro ao atualizar menu da oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};
