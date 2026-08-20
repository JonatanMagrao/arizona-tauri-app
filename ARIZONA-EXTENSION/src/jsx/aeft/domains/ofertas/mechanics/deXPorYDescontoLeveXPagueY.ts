import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import { addError, getLayerByIndex, getLayerSource } from "../layers/findLayers";
import {
  getEffectControlValueProperty,
  makeControllerOptionGroup,
  makeValueField,
} from "./shared";
import {
  applyInstallmentJump,
  type InstallmentJumpDefinition,
  readInstallmentJump,
} from "./parcelamento";

export const DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE =
  "De X Por Y | X% Desconto | Leve X Pague Y";

const CONTROLLER_LAYER_INDEX = 5;
const CONTROLLER_LAYER_NAME = "Controlador de Mecânica";
const SHARED_MECHANIC_JUMP_DEFINITION: InstallmentJumpDefinition = {
  markerLayerIndex: 1,
  fullPriceLayerIndex: 2,
  installmentPriceLayerIndex: 3,
  context: "De X Por Y | X% Desconto | Leve X Pague Y",
  markerLayerName: "Marcadores",
  fullPriceLayerName: "PULO PREÇO CHEIO",
  installmentPriceLayerName: "PULO",
};

export const readDeXPorYDiscountTakePayMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => {
  const source = getLayerSource(
    valueLayer,
    "De X Por Y | X% Desconto | Leve X Pague Y",
    errors
  );
  const candidateControllerLayer = getLayerByIndex(
    source,
    CONTROLLER_LAYER_INDEX
  );
  let controllerLayer: Layer | null = candidateControllerLayer;

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 5 Controlador de Mecanica na mecanica compartilhada."
    );
  } else if (
    String(controllerLayer.name).toLowerCase() !==
    CONTROLLER_LAYER_NAME.toLowerCase()
  ) {
    addError(
      errors,
      'A layer 5 deveria se chamar "' + CONTROLLER_LAYER_NAME + '".'
    );
    controllerLayer = null;
  }

  const typeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Tipo",
    "mecanica compartilhada",
    errors
  );
  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    2,
    "Subtipo",
    "mecanica compartilhada",
    errors
  );
  const unitProperty = getEffectControlValueProperty(
    controllerLayer,
    3,
    "Unidade",
    "mecanica compartilhada",
    errors
  );
  const quantityProperty = getEffectControlValueProperty(
    controllerLayer,
    4,
    "Quantidade X",
    "mecanica compartilhada",
    errors
  );

  return {
    type: DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE,
    fields: [
      makeValueField(
        "quantidade-x",
        "Quantidade X",
        "integer",
        quantityProperty
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup(
        "mechanicType",
        "Tipo",
        typeProperty,
        [
          { label: "De Por" },
          { label: "Nesta Embalagem" },
          { label: "Levando X Unidades" },
          { label: "Com o Desconto" },
          { label: "A partir de X Unidades" },
        ],
        "header"
      ),
      makeControllerOptionGroup(
        "mechanicSubtype",
        "Subtipo",
        subtypeProperty,
        [
          { label: "Padrão" },
          { label: "Meu Carrefour" },
          { label: "Cartão Carrefour" },
        ]
      ),
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
    installmentJump: readInstallmentJump(
      source,
      SHARED_MECHANIC_JUMP_DEFINITION
    ),
  };
};

export const applySharedMechanicJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyInstallmentJump(product, target, SHARED_MECHANIC_JUMP_DEFINITION);
