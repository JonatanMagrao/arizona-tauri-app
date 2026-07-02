import type { InternalOfferMechanic } from "../types";
import { getLayerSource } from "../layers/findLayers";
import {
  makeIndexedTextField,
  makeLayerOptionGroup,
  makeTextField,
} from "./shared";

export function readCrfPercentDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "desconto Meu CRF", errors);

  return {
    type: "Desconto X% Meu CRF",
    fields: [
      makeTextField(
        source,
        "POR CENTAGEM DESCONTO",
        "Desconto",
        "percent",
        "desconto Meu CRF",
        errors
      ),
    ],
    optionGroups: [
      makeLayerOptionGroup("discountKind", "Opcao", source, [
        { label: "% desc.", layerIndex: 4 },
        { label: "% bonus", layerIndex: 5 },
      ]),
    ],
  };
}

export function readCrfSecondUnitDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(
    valueLayer,
    "desconto x% cartao crf segunda unidade",
    errors
  );

  return {
    type: "Desconto X% Cartao CRF Segunda Unidade",
    fields: [
      makeIndexedTextField(
        source,
        3,
        "Desconto",
        "percent",
        "desconto x% cartao crf segunda unidade",
        errors
      ),
    ],
    optionGroups: [
      makeLayerOptionGroup("discountKind", "Opcao", source, [
        { label: "% desc.", layerIndex: 4 },
        { label: "% bonus", layerIndex: 6 },
      ]),
    ],
  };
}

export function readCrfCardDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(
    valueLayer,
    "desconto x% cartao crf",
    errors
  );

  return {
    type: "Desconto X% Cartao CRF",
    fields: [
      makeIndexedTextField(
        source,
        3,
        "Desconto",
        "percent",
        "desconto x% cartao crf",
        errors
      ),
    ],
    optionGroups: [
      makeLayerOptionGroup("discountKind", "Opcao", source, [
        { label: "% Desc", layerIndex: 4 },
        { label: "% Bonus", layerIndex: 5 },
      ]),
    ],
  };
}

export function readDiscountXPercentMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "desconto x%", errors);

  return {
    type: "Desconto X%",
    fields: [
      makeIndexedTextField(
        source,
        3,
        "Desconto",
        "percent",
        "desconto x%",
        errors
      ),
    ],
    optionGroups: [],
  };
}

export function readPercentDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "porcentagem desconto", errors);

  return {
    type: "Porcentagem Desconto",
    fields: [
      makeTextField(
        source,
        "POR CENTAGEM DESCONTO",
        "Desconto",
        "percent",
        "porcentagem desconto",
        errors
      ),
    ],
    optionGroups: [
      makeLayerOptionGroup("discountKind", "Opcao", source, [
        { label: "direto no caixa", layerIndex: 5 },
        { label: "na 2a unidade", layerIndex: 6 },
      ]),
    ],
  };
}
