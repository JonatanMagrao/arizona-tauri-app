import type {
  InternalLegalControl,
  InternalTextField,
  RawLayerOption,
} from "../types";
import {
  addError,
  findPropertyDeep,
  getLayerByIndex,
  getLayerSource,
  isNumericValueProperty,
} from "./findLayers";
import {
  getSourceTextProperty,
  readValueProperty,
} from "./textFields";
import { makeLayerOptionGroup } from "../mechanics/shared";

interface LegalTextLayerControlConfig {
  id: string;
  label: string;
  layerIndex: number;
  locked?: boolean;
  slider?: boolean;
  optionGroup?: {
    id: string;
    label: string;
    options: RawLayerOption[];
  };
}

const LEGAL_TEXT_LAYER_CONTROLS: LegalTextLayerControlConfig[] = [
  {
    id: "tarja-validade",
    label: "Validade",
    layerIndex: 1,
    locked: true,
    slider: true,
  },
  {
    id: "texto-legal",
    label: "Texto legal",
    layerIndex: 3,
    locked: true,
    slider: true,
  },
  { id: "selo-leite", label: "Selo leite", layerIndex: 4 },
  { id: "selo-moderacao", label: "Selo beba com moderacao", layerIndex: 5 },
  {
    id: "tarja-eletro-pneu",
    label: "Eletro/Pneu",
    layerIndex: 6,
    optionGroup: {
      id: "eletro-pneu-menu",
      label: "Menu",
      options: [
        { layerIndex: 4 },
        { layerIndex: 5 },
        { layerIndex: 6 },
        { layerIndex: 7 },
        { layerIndex: 8 },
        { layerIndex: 9 },
      ],
    },
  },
];

export const getLegalTextSource = (
  offerSource: CompItem | null,
  errors: string[]
): CompItem | null => {
  if (offerSource === null) return null;

  const legalPrecompLayer = getLayerByIndex(offerSource, 1);
  if (legalPrecompLayer === null) {
    addError(
      errors,
      "Nao encontrei a precomp de texto legal na layer 1 da oferta."
    );
    return null;
  }

  return getLayerSource(legalPrecompLayer, "texto legal", errors);
};

export const getLegalTextProperty = (
  legalSource: CompItem | null,
  errors: string[]
): Property | null => {
  const legalLayer = getLayerByIndex(legalSource, 3);
  if (legalLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 3 dentro da precomp de texto legal."
    );
    return null;
  }

  const property = getSourceTextProperty(legalLayer);
  if (property === null) {
    addError(errors, "A layer de texto legal nao possui Source Text.");
  }

  return property;
};

export const readLegalControls = (
  legalSource: CompItem | null,
  errors: string[]
): InternalLegalControl[] => {
  const controls: InternalLegalControl[] = [];

  for (let index = 0; index < LEGAL_TEXT_LAYER_CONTROLS.length; index += 1) {
    const control = LEGAL_TEXT_LAYER_CONTROLS[index];
    const layer = getLayerByIndex(legalSource, control.layerIndex);
    const slider = control.slider
      ? makeLegalControlSliderField(control.id, control.label, layer, errors)
      : null;
    const optionSource =
      control.optionGroup && layer !== null
        ? getLayerSource(layer, control.label, errors)
        : null;
    const optionGroup =
      control.optionGroup && layer !== null
        ? makeLayerOptionGroup(
            control.optionGroup.id,
            control.optionGroup.label,
            optionSource,
            control.optionGroup.options
          )
        : null;

    if (control.locked && layer !== null) {
      layer.enabled = true;
    }

    controls.push({
      id: control.id,
      label: control.label,
      layerIndex: control.layerIndex,
      enabled: control.locked && layer !== null ? true : layer !== null ? layer.enabled : false,
      available: layer !== null,
      locked: control.locked === true,
      slider,
      optionGroup,
    });
  }

  return controls;
};

const makeLegalControlSliderField = (
  controlId: string,
  label: string,
  layer: Layer | null,
  errors: string[]
): InternalTextField | null => {
  const property = getFirstEffectNumericProperty(
    layer,
    "slider de " + label,
    errors
  );

  if (property === null) return null;

  return {
    id: controlId + "-slider",
    label: "Valor",
    value: readValueProperty(property),
    format: "text",
    enabled: true,
    property,
    valueKind: "value",
  };
};

const getFirstEffectNumericProperty = (
  layer: Layer | null,
  context: string,
  errors: string[]
): Property | null => {
  if (layer === null) return null;

  let effects: PropertyGroup | null = null;

  try {
    effects = layer.property("ADBE Effect Parade") as PropertyGroup;
  } catch (error) {
    effects = null;
  }

  if (effects === null) {
    addError(errors, 'A layer "' + layer.name + '" nao possui efeitos em ' + context + ".");
    return null;
  }

  const property = findPropertyDeep(effects, isNumericValueProperty);

  if (property === null) {
    addError(errors, 'Nao encontrei slider na layer "' + layer.name + '".');
  }

  return property;
};

export const findLegalControl = (
  controlId: string
): {
  id: string;
  label: string;
  layerIndex: number;
  locked?: boolean;
} | null => {
  for (let index = 0; index < LEGAL_TEXT_LAYER_CONTROLS.length; index += 1) {
    const control = LEGAL_TEXT_LAYER_CONTROLS[index];

    if (control.id === controlId) return control;
  }

  return null;
};

export const findInternalLegalControl = (
  controls: InternalLegalControl[],
  controlId: string
): InternalLegalControl | null => {
  for (let index = 0; index < controls.length; index += 1) {
    if (controls[index].id === controlId) return controls[index];
  }

  return null;
};
