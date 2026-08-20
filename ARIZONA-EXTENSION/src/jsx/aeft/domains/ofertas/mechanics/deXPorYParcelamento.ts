import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  addError,
  findPropertyDeep,
  getLayerByIndex,
  getLayerSource,
  isNumericValueProperty,
} from "../layers/findLayers";
import {
  makeControllerOptionGroup,
  makeIndexedTextField,
} from "./shared";
import {
  applyInstallmentJump,
  type InstallmentJumpDefinition,
  readInstallmentJump,
} from "./parcelamento";

export const DE_X_POR_Y_INSTALLMENT_MECHANIC_TYPE =
  "De X Por Y Parcelamento";

const MECHANIC_CONTROLLER_LAYER_INDEX = 5;
const MECHANIC_CONTROLLER_LAYER_NAME = "Controlador de Mecânica";
const MECHANIC_CONDITION_EFFECT_NAME = "Condição";
const DE_X_POR_Y_INSTALLMENT_JUMP_DEFINITION: InstallmentJumpDefinition = {
  markerLayerIndex: 1,
  fullPriceLayerIndex: 2,
  installmentPriceLayerIndex: 3,
  context: "De X Por Y Parcelamento",
  markerLayerName: "Marcadores",
  fullPriceLayerName: "PULO PREÇO CHEIO",
  installmentPriceLayerName: "PULO PARCELA",
};

const getMechanicConditionProperty = (
  source: CompItem | null,
  errors: string[]
): Property | null => {
  const controllerLayer = getLayerByIndex(
    source,
    MECHANIC_CONTROLLER_LAYER_INDEX
  );

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 5 Controlador de Mecanica em De X Por Y Parcelamento."
    );
    return null;
  }

  if (
    String(controllerLayer.name).toLowerCase() !==
    MECHANIC_CONTROLLER_LAYER_NAME.toLowerCase()
  ) {
    addError(
      errors,
      'A layer 5 deveria se chamar "' + MECHANIC_CONTROLLER_LAYER_NAME + '".'
    );
    return null;
  }

  let effects: PropertyGroup | null = null;

  try {
    effects = controllerLayer.property("ADBE Effect Parade") as PropertyGroup;
  } catch (error) {
    effects = null;
  }

  if (effects === null) {
    addError(errors, "A layer Controlador de Mecanica nao possui efeitos.");
    return null;
  }

  let conditionEffect: PropertyBase | null = null;

  try {
    conditionEffect = effects.property(
      MECHANIC_CONDITION_EFFECT_NAME
    ) as PropertyBase;
  } catch (error) {
    conditionEffect = null;
  }

  if (conditionEffect === null) {
    addError(
      errors,
      'Nao encontrei o dropdown "' + MECHANIC_CONDITION_EFFECT_NAME + '".'
    );
    return null;
  }

  const property = findPropertyDeep(
    conditionEffect,
    isNumericValueProperty
  );

  if (property === null) {
    addError(
      errors,
      'Nao encontrei o valor do dropdown "' +
        MECHANIC_CONDITION_EFFECT_NAME +
        '".'
    );
  }

  return property;
};

export const readDeXPorYInstallmentMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => {
  const source = getLayerSource(
    valueLayer,
    "De X Por Y Parcelamento",
    errors
  );
  const conditionProperty = getMechanicConditionProperty(source, errors);

  return {
    type: DE_X_POR_Y_INSTALLMENT_MECHANIC_TYPE,
    fields: [
      makeIndexedTextField(
        source,
        6,
        "De",
        "price",
        "de x por y parcelamento",
        errors
      ),
      makeIndexedTextField(
        source,
        11,
        "Preco",
        "price",
        "de x por y parcelamento",
        errors
      ),
      makeIndexedTextField(
        source,
        17,
        "Parcela",
        "price",
        "de x por y parcelamento",
        errors
      ),
      makeIndexedTextField(
        source,
        20,
        "Parcelas",
        "integer",
        "de x por y parcelamento",
        errors
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup(
        "mechanicCondition",
        "Mecânica",
        conditionProperty,
        [
          { label: "Cartão Carrefour" },
          { label: "Plano Controle" },
          { label: "Cartão Carrefour/Plano Controle" },
          { label: "De/Por no Cartão Carrefour" },
          { label: "De/Por no Plano Controle" },
          { label: "De/Por no Cartão Carrefour/Plano Controle" },
          { label: "De/Por no Cartão Carrefour PB" },
        ],
        "header"
      ),
    ],
    installmentJump: readInstallmentJump(
      source,
      DE_X_POR_Y_INSTALLMENT_JUMP_DEFINITION
    ),
  };
};

export const applyDeXPorYInstallmentJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyInstallmentJump(
    product,
    target,
    DE_X_POR_Y_INSTALLMENT_JUMP_DEFINITION
  );
