import type { InternalOfferMechanic } from "../types";
import {
  addError,
  getLayerByIndex,
  getLayerSource,
} from "../layers/findLayers";
import {
  getEffectControlValueProperty,
  makeControllerOptionGroup,
  makeIndexedTextField,
  makeLayerOptionGroup,
  makeTextField,
} from "./shared";

const ALL_PERCENT_DISCOUNT_CONTROLLER_LAYER_NAME =
  "Controlador de Mecânica";

export function readAllPercentDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(
    valueLayer,
    "todos a com x% desconto",
    errors
  );
  const candidateControllerLayer = getLayerByIndex(source, 3);
  let controllerLayer: Layer | null = candidateControllerLayer;

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 3 Controlador de Mecanica em Todos a Com X% Desconto."
    );
  } else if (
    String(controllerLayer.name).toLowerCase() !==
    ALL_PERCENT_DISCOUNT_CONTROLLER_LAYER_NAME.toLowerCase()
  ) {
    addError(
      errors,
      'A layer 3 deveria se chamar "' +
        ALL_PERCENT_DISCOUNT_CONTROLLER_LAYER_NAME +
        '".'
    );
    controllerLayer = null;
  }

  const typeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Tipo",
    "todos a com x% desconto",
    errors
  );
  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    2,
    "Subtipo",
    "todos a com x% desconto",
    errors
  );

  return {
    type: "Todos A Com X% Desconto",
    fields: [
      makeIndexedTextField(
        source,
        4,
        "Desconto",
        "percent",
        "todos a com x% desconto",
        errors
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup(
        "mechanicType",
        "Tipo",
        typeProperty,
        [
          { label: "desconto" },
          { label: "na 2ª unidade" },
          { label: "Direto no caixa" },
        ]
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
    ],
  };
}

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
