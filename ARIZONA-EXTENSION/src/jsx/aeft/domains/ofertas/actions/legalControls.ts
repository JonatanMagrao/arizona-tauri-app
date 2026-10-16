import { withMechanicsSchema } from "../mechanics/schemaRuntime";
import type { OfferEditorActionResult, OfferLegalOptionsContext } from "../types";
import { assertBannerContext, BANNER_CONTROL_ID, resolveBannerOptions } from "../layers/bannerOptions";
import {
  getLayerByIndex,
  getLayerSource,
  getOfferByLayerIndex,
} from "../layers/findLayers";
import {
  findInternalLegalControl,
  findLegalControl,
  getLegalControlEffectProperty,
  getLegalTextSource,
} from "../layers/legalControls";
import { setFieldValue, setLegalText } from "../layers/textFields";
import { applyOptionGroupSelection } from "../mechanics/shared";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";
import { createActionResult } from "./shared";

export const updateOfferLegalText = (
  offerLayerIndex: number,
  value: string
): OfferEditorActionResult => withMechanicsSchema(() => {
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
});

export const updateOfferLegalControl = (
  offerLayerIndex: number,
  controlId: string,
  enabled: boolean,
  expectedContext?: OfferLegalOptionsContext
): OfferEditorActionResult => withMechanicsSchema(() => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  if (controlId === BANNER_CONTROL_ID) return updateBanner(offer, null, enabled, expectedContext);

  app.beginUndoGroup("Atualizar configuracao do texto legal");

  try {
    const offerSource = getLayerSource(offer, "oferta", result.errors);
    const legalSource = getLegalTextSource(offerSource, result.errors);
    const control = findLegalControl(controlId);

    if (control === null) {
      throw new Error("Controle de texto legal nao encontrado.");
    }

    if (control.kind === "slider") {
      throw new Error(control.label + " deve ser atualizado pelo valor.");
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

    if (control.kind === "checkbox") {
      const property = getLegalControlEffectProperty(layer, control);
      if (property === null) {
        throw new Error("Checkbox de " + control.label + " nao encontrado.");
      }
      property.setValue(enabled ? 1 : 0);
    } else {
      layer.enabled = enabled;
    }
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
});

export const updateOfferLegalControlValue = (
  offerLayerIndex: number,
  controlId: string,
  value: string
): OfferEditorActionResult => withMechanicsSchema(() => {
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
});

export const updateOfferLegalControlOption = (
  offerLayerIndex: number,
  controlId: string,
  selectedIndex: number,
  expectedContext?: OfferLegalOptionsContext
): OfferEditorActionResult => withMechanicsSchema(() => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  if (controlId === BANNER_CONTROL_ID) return updateBanner(offer, selectedIndex, null, expectedContext);

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
});

// Banner selection is a transaction over the current source comp. An index is
// accepted only with the exact snapshot revision that produced that menu.
const updateBanner = (
  offer: Layer,
  selectedIndex: number | null,
  enabled: boolean | null,
  expectedContext?: OfferLegalOptionsContext
): OfferEditorActionResult => {
  const result = createActionResult();
  let undoOpened = false;
  const changedLayers: Layer[] = [];
  const previous: boolean[] = [];
  try {
    const offerSource = getLayerSource(offer, "oferta", result.errors);
    const legalSource = getLegalTextSource(offerSource, result.errors);
    if (legalSource === null) throw new Error("Texto legal indisponivel para Eletro/Pneu.");
    const resolved = resolveBannerOptions(legalSource, offer);
    assertBannerContext(resolved.context, expectedContext);
    if (offer.locked === true || resolved.layer.locked === true) throw new Error("A camada da oferta ou da tarja esta bloqueada.");
    if (selectedIndex !== null) {
      if (typeof selectedIndex !== "number" || !isFinite(selectedIndex) || Math.floor(selectedIndex) !== selectedIndex ||
        selectedIndex < 0 || selectedIndex >= resolved.candidates.length) throw new Error("Opcao Eletro/Pneu invalida.");
      for (let index = 0; index < resolved.candidates.length; index += 1) {
        const layer = resolved.candidates[index];
        if (layer.locked === true) throw new Error("Ha texto bloqueado na tarja Eletro/Pneu.");
        changedLayers.push(layer);
        previous.push(layer.enabled);
      }
    } else {
      if (typeof enabled !== "boolean") throw new Error("Visibilidade Eletro/Pneu invalida.");
      changedLayers.push(resolved.layer);
      previous.push(resolved.layer.enabled);
    }
    let needsChange = false;
    for (let index = 0; index < changedLayers.length; index += 1) {
      if (previous[index] !== (selectedIndex === null ? enabled : index === selectedIndex)) needsChange = true;
    }
    if (needsChange) {
      app.beginUndoGroup("Atualizar Eletro/Pneu");
      undoOpened = true;
      for (let index = 0; index < changedLayers.length; index += 1) {
        const next = selectedIndex === null ? enabled === true : index === selectedIndex;
        if (changedLayers[index].enabled !== next) changedLayers[index].enabled = next;
      }
    }
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Eletro/Pneu atualizado.";
  } catch (error) {
    result.message = String(error) || "Erro ao atualizar Eletro/Pneu.";
    result.errors.push(result.message);
    if (undoOpened) {
      for (let index = 0; index < changedLayers.length; index += 1) {
        try {
          if (changedLayers[index].enabled !== previous[index]) changedLayers[index].enabled = previous[index];
        } catch (rollbackError) {
          result.errors.push("Nao foi possivel restaurar a visibilidade da camada " + changedLayers[index].name + ": " + String(rollbackError));
        }
      }
    }
  } finally {
    if (undoOpened) app.endUndoGroup();
  }
  return result;
};
