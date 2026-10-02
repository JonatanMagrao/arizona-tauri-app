import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  addError,
  findPropertyDeep,
  getLayerSource,
  isNumericValueProperty,
} from "../layers/findLayers";
import { makeControllerOptionGroup, makeTextField } from "./shared";
import {
  applyInstallmentJump,
  type InstallmentJumpDefinition,
  readInstallmentJump,
} from "./parcelamento";

export const MEU_CRF_CARD_MECHANIC_TYPE = "De X Por Y Meu CRF Por Z Cartao CRF";

// Reuse the two-target jump protocol: full price maps to Meu CRF (Por),
// and installment price maps to Cartao CRF (Por cartao) in this mechanic.
const MEU_CRF_CARD_JUMP_DEFINITION: InstallmentJumpDefinition = {
  markerLayerIndex: 1,
  fullPriceLayerIndex: 2,
  installmentPriceLayerIndex: 3,
  context: MEU_CRF_CARD_MECHANIC_TYPE,
  markerLayerName: "Marcadores",
  fullPriceLayerName: "PULO PREÇO MEU CRF",
  installmentPriceLayerName: "PULO PREÇO CARTAO CRF",
};

const getUnitProperty = (
  source: CompItem | null,
  errors: string[]
): Property | null => {
  if (source === null) return null;

  let unitProperty: Property | null = null;

  // This mechanic identifies its dropdown by name, independently of layer order.
  for (let layerIndex = 1; layerIndex <= source.numLayers; layerIndex += 1) {
    let effects: PropertyGroup | null = null;
    try {
      effects = source
        .layer(layerIndex)
        .property("ADBE Effect Parade") as PropertyGroup;
    } catch (error) {
      effects = null;
    }
    if (effects === null) continue;

    for (
      let effectIndex = 1;
      effectIndex <= effects.numProperties;
      effectIndex += 1
    ) {
      const effect = effects.property(effectIndex);
      if (effect === null || effect.name !== "Unidade") continue;

      const property = findPropertyDeep(
        effect,
        (candidate) =>
          isNumericValueProperty(candidate) && candidate.isDropdownEffect === true
      );
      if (property === null) continue;

      if (unitProperty !== null) {
        addError(
          errors,
          'Encontrei mais de um dropdown "Unidade" em ' + MEU_CRF_CARD_MECHANIC_TYPE + "."
        );
        return null;
      }
      unitProperty = property;
    }
  }

  if (unitProperty === null) {
    addError(
      errors,
      'Nao encontrei o dropdown "Unidade" em ' + MEU_CRF_CARD_MECHANIC_TYPE + "."
    );
  }
  return unitProperty;
};

export const readMeuCrfCardMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => {
  const source = getLayerSource(valueLayer, MEU_CRF_CARD_MECHANIC_TYPE, errors);
  const unitProperty = getUnitProperty(source, errors);

  return {
    type: MEU_CRF_CARD_MECHANIC_TYPE,
    fields: [
      makeTextField(source, "PRECO DE", "De", "price", MEU_CRF_CARD_MECHANIC_TYPE, errors),
      makeTextField(source, "PRECO POR", "Por", "price", MEU_CRF_CARD_MECHANIC_TYPE, errors),
      makeTextField(
        source,
        "PRECO POR CARTAO",
        "Por cartão",
        "price",
        MEU_CRF_CARD_MECHANIC_TYPE,
        errors
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
    installmentJump: readInstallmentJump(source, MEU_CRF_CARD_JUMP_DEFINITION),
  };
};

export const applyMeuCrfCardJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void => applyInstallmentJump(product, target, MEU_CRF_CARD_JUMP_DEFINITION);
