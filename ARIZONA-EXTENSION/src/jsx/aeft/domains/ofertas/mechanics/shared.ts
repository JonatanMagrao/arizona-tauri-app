import type {
  InternalOptionGroup,
  InternalTextField,
  LayerOption,
  OfferFieldFormat,
  OfferOption,
  OfferOptionGroupPlacement,
  RawLayerOption,
} from "../types";
import {
  addError,
  findLayerByNamePart,
  findPropertyDeep,
  getLayerByOption,
  isNumericValueProperty,
} from "../layers/findLayers";
import {
  createFieldId,
  getTextPropertyByLayerName,
  readText,
  readValueProperty,
} from "../layers/textFields";

export { makeIndexedTextField } from "../layers/textFields";

export const makeTextField = (
  source: CompItem | null,
  layerName: string,
  label: string,
  format: OfferFieldFormat,
  context: string,
  errors: string[]
): InternalTextField => {
  const property = getTextPropertyByLayerName(source, layerName, context, errors);

  return {
    id: createFieldId(layerName),
    label,
    value: readText(property),
    format,
    enabled: property !== null,
    property,
    valueKind: "text",
  };
};

export const makeValueField = (
  id: string,
  label: string,
  format: OfferFieldFormat,
  property: Property | null
): InternalTextField => ({
  id,
  label,
  value: readValueProperty(property),
  format,
  enabled: property !== null,
  property,
  valueKind: "value",
});

export const makeLayerOptionGroup = (
  id: string,
  label: string,
  source: CompItem | null,
  rawOptions: RawLayerOption[]
): InternalOptionGroup => {
  const options = normalizeLayerOptions(source, rawOptions);
  const publicOptions: OfferOption[] = [];

  for (let index = 0; index < options.length; index += 1) {
    publicOptions.push({ label: options[index].label });
  }

  return {
    id,
    type: "layers",
    label,
    source,
    layerOptions: options,
    options: publicOptions,
    selectedIndex: getSelectedLayerOptionIndex(source, options),
    enabled: source !== null && options.length > 0,
  };
};

export const makeControllerOptionGroup = (
  id: string,
  label: string,
  controllerProperty: Property | null,
  options: OfferOption[],
  placement: OfferOptionGroupPlacement = "controls"
): InternalOptionGroup => {
  let selectedIndex = 0;

  if (controllerProperty !== null) {
    selectedIndex = Math.round(Number(controllerProperty.value)) - 1;

    if (selectedIndex < 0 || selectedIndex >= options.length) {
      selectedIndex = 0;
    }
  }

  return {
    id,
    type: "controller",
    placement,
    label,
    controllerProperty,
    options,
    selectedIndex,
    enabled: controllerProperty !== null,
  };
};

export const applyOptionGroupSelection = (
  optionGroup: InternalOptionGroup,
  selectedIndex: number
): void => {
  if (selectedIndex < 0 || selectedIndex >= optionGroup.options.length) {
    throw new Error("Opcao invalida.");
  }

  if (optionGroup.type === "layers") {
    setLayerOptionSelection(
      optionGroup.source || null,
      optionGroup.layerOptions || [],
      selectedIndex
    );
  }

  if (
    optionGroup.type === "controller" &&
    optionGroup.controllerProperty !== null &&
    typeof optionGroup.controllerProperty !== "undefined"
  ) {
    optionGroup.controllerProperty.setValue(selectedIndex + 1);
  }
};

const normalizeLayerOptions = (
  source: CompItem | null,
  rawOptions: RawLayerOption[]
): LayerOption[] => {
  const options: LayerOption[] = [];

  for (let index = 0; index < rawOptions.length; index += 1) {
    const option: LayerOption = {
      label: rawOptions[index].label || "",
      layerName: rawOptions[index].layerName,
      layerIndex: rawOptions[index].layerIndex,
    };

    if (!option.label) {
      const layer = getLayerByOption(source, option);
      option.label = layer !== null ? layer.name : "Opcao " + (index + 1);
    }

    options.push(option);
  }

  return options;
};

const getSelectedLayerOptionIndex = (
  source: CompItem | null,
  options: LayerOption[]
): number => {
  if (source === null) return -1;

  for (let index = 0; index < options.length; index += 1) {
    const layer = getLayerByOption(source, options[index]);
    if (layer !== null && layer.enabled) {
      return index;
    }
  }

  return -1;
};

const setLayerOptionSelection = (
  source: CompItem | null,
  options: LayerOption[],
  selectedIndex: number
): void => {
  if (source === null) return;

  for (let index = 0; index < options.length; index += 1) {
    const layer = getLayerByOption(source, options[index]);

    if (layer !== null) {
      layer.enabled = index === selectedIndex;
    }
  }
};

export const getInstallmentControllerProperty = (
  source: CompItem | null,
  errors: string[]
): Property | null => {
  if (source === null) return null;

  const controllerLayer = findLayerByNamePart(source, "Controlador");
  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer Controlador da mecanica de parcelamento."
    );
    return null;
  }

  let effects: PropertyGroup | null = null;

  try {
    effects = controllerLayer.property("ADBE Effect Parade") as PropertyGroup;
  } catch (error) {
    effects = null;
  }

  let property = findPropertyDeep(effects, (candidate) =>
    candidate !== null &&
    candidate.matchName === "Pseudo/@@yTkh8nJETS2o0/FMnF3Nlw-0001"
  );

  if (property === null) {
    property = findPropertyDeep(effects, (candidate) => {
      try {
        return (
          candidate !== null &&
          candidate.propertyValueType === PropertyValueType.OneD &&
          typeof candidate.value === "number"
        );
      } catch (error) {
        return false;
      }
    });
  }

  if (property === null) {
    addError(
      errors,
      "Nao encontrei o controle de opcoes da mecanica de parcelamento."
    );
  }

  return property;
};

export const getEffectControlValueProperty = (
  controllerLayer: Layer | null,
  effectIndex: number,
  label: string,
  context: string,
  errors: string[]
): Property | null => {
  if (controllerLayer === null) return null;

  let effects: PropertyGroup | null = null;

  try {
    effects = controllerLayer.property("ADBE Effect Parade") as PropertyGroup;
  } catch (error) {
    effects = null;
  }

  if (effects === null) {
    addError(errors, 'A layer Controlador nao possui efeitos em ' + context + ".");
    return null;
  }

  let effect: PropertyBase | null = null;

  try {
    effect = effects.property(effectIndex) as PropertyBase;
  } catch (error) {
    effect = null;
  }

  if (effect === null) {
    addError(
      errors,
      'Nao encontrei o controle "' +
        label +
        '" na posicao ' +
        effectIndex +
        " em " +
        context +
        "."
    );
    return null;
  }

  const property = findPropertyDeep(effect, isNumericValueProperty);

  if (property === null) {
    addError(
      errors,
      'Nao encontrei o valor numerico do controle "' +
        label +
        '" em ' +
        context +
        "."
    );
  }

  return property;
};
