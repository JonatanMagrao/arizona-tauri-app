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
  makeTextField,
} from "./shared";

const SIMPLE_CONTROLLER_LAYER_INDEX = 4;
const SIMPLE_CONTROLLER_LAYER_NAME = "Controlador de Mecânica";

export function readSimpleMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "mecanica simples", errors);
  const candidateControllerLayer = getLayerByIndex(
    source,
    SIMPLE_CONTROLLER_LAYER_INDEX
  );
  let controllerLayer: Layer | null = candidateControllerLayer;

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 4 Controlador de Mecanica na mecanica simples."
    );
  } else if (
    String(controllerLayer.name).toLowerCase() !==
    SIMPLE_CONTROLLER_LAYER_NAME.toLowerCase()
  ) {
    addError(
      errors,
      'A layer 4 deveria se chamar "' + SIMPLE_CONTROLLER_LAYER_NAME + '".'
    );
    controllerLayer = null;
  }

  const unitProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Unidade",
    "mecanica simples",
    errors
  );

  return {
    type: "Simples",
    fields: [
      makeTextField(source, "PRECO", "Preco", "price", "preco simples", errors),
    ],
    optionGroups: [
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
  };
}

export function readLeveXPagueYMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "leve x pague y", errors);

  return {
    type: "Leve X Pague Y",
    fields: [
      makeIndexedTextField(source, 3, "Leve X", "integer", "leve x pague y", errors),
      makeIndexedTextField(source, 4, "Pague Y", "integer", "leve x pague y", errors),
    ],
    optionGroups: [],
  };
}

export function readAllTakeXPayYMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(
    valueLayer,
    "todos a leve x pague y",
    errors
  );
  const candidateControllerLayer = getLayerByIndex(source, 3);
  let controllerLayer: Layer | null = candidateControllerLayer;

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei a layer 3 Controlador de Mecanica em Todos a Leve X Pague Y."
    );
  } else if (
    String(controllerLayer.name).toLowerCase() !==
    SIMPLE_CONTROLLER_LAYER_NAME.toLowerCase()
  ) {
    addError(
      errors,
      'A layer 3 deveria se chamar "' + SIMPLE_CONTROLLER_LAYER_NAME + '".'
    );
    controllerLayer = null;
  }

  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Subtipo",
    "todos a leve x pague y",
    errors
  );

  return {
    type: "Todos A Leve X Pague Y",
    fields: [
      makeIndexedTextField(
        source,
        4,
        "Leve X",
        "integer",
        "todos a leve x pague y",
        errors
      ),
      makeIndexedTextField(
        source,
        5,
        "Pague Y",
        "integer",
        "todos a leve x pague y",
        errors
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("subtype", "Subtipo", subtypeProperty, [
        { label: "Padrão" },
        { label: "Meu Carrefour" },
        { label: "Cartão Carrefour" },
      ]),
    ],
  };
}
