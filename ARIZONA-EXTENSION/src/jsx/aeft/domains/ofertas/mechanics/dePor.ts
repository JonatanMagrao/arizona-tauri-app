import type { InternalOfferMechanic } from "../types";
import { addError, getLayerByIndex, getLayerSource } from "../layers/findLayers";
import {
  getEffectControlValueProperty,
  makeControllerOptionGroup,
  makeIndexedTextField,
  makeLayerOptionGroup,
  makeTextField,
  makeValueField,
} from "./shared";

export function readDePorMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "de por", errors);
  const controllerLayer = getLayerByIndex(source, 5);
  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Subtipo",
    "de por",
    errors
  );
  const unitProperty = getEffectControlValueProperty(
    controllerLayer,
    2,
    "Unidade",
    "de por",
    errors
  );
  const quantityProperty = getEffectControlValueProperty(
    controllerLayer,
    3,
    "Quantidade X",
    "de por",
    errors
  );

  if (controllerLayer === null) {
    addError(errors, "Nao encontrei o Controlador de mecanica na layer 5 em de por.");
  }

  return {
    type: "De Por",
    fields: [
      makeIndexedTextField(source, 6, "De", "price", "de por", errors),
      makeIndexedTextField(source, 12, "Por", "price", "de por", errors),
      makeValueField(
        "quantidade-x",
        "Quantidade X",
        "integer",
        quantityProperty
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("subtype", "Subtipo", subtypeProperty, [
        { label: "De Por" },
        { label: "Nesta Embalagem" },
        { label: "Levando X Unidades" },
        { label: "Com o Desconto" },
        { label: "A partir de X Unidades" },
      ]),
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
  };
}

export function readCrfCardDePorMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "de por cartao crf", errors);
  const controllerLayer = getLayerByIndex(source, 5);
  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Subtipo",
    "de por cartao crf",
    errors
  );
  const unitProperty = getEffectControlValueProperty(
    controllerLayer,
    2,
    "Unidade",
    "de por cartao crf",
    errors
  );
  const quantityProperty = getEffectControlValueProperty(
    controllerLayer,
    3,
    "Quantidade X",
    "de por cartao crf",
    errors
  );

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei o Controlador de mecanica na layer 5 em de por cartao crf."
    );
  }

  return {
    type: "De Por Cartao CRF",
    fields: [
      makeIndexedTextField(
        source,
        6,
        "De",
        "price",
        "de por cartao crf",
        errors
      ),
      makeIndexedTextField(
        source,
        12,
        "Por",
        "price",
        "de por cartao crf",
        errors
      ),
      makeValueField(
        "quantidade-x",
        "Quantidade X",
        "integer",
        quantityProperty
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("subtype", "Subtipo", subtypeProperty, [
        { label: "Cartao Carrefour De Por" },
        { label: "NAO EXISTE MAIS, NAO USAR" },
        { label: "Cartao Carrefour Levando X Unidades" },
        { label: "Cartao Carrefour Com o Desconto" },
        { label: "Cartao Carrefour A partir de X Unidades" },
      ]),
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
  };
}

export function readUnitGoesForMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "de a unidade sai por", errors);

  return {
    type: "De A Unidade Sai Por",
    fields: [
      makeTextField(source, "PRECO DE", "De", "price", "preco de", errors),
      makeTextField(source, "PRECO POR", "Por", "price", "preco por", errors),
    ],
    optionGroups: [
      makeLayerOptionGroup("unit", "Unidade", source, [
        { label: "KG/CADA", layerName: "KG/CADA", layerIndex: 6 },
        { label: "100g", layerName: "100G", layerIndex: 7 },
        { label: "KG", layerName: "KG", layerIndex: 8 },
        { label: "CADA", layerName: "CADA", layerIndex: 9 },
      ]),
      makeLayerOptionGroup("descriptionKind", "Descr.", source, [
        { layerIndex: 11 },
        { layerIndex: 12 },
        { layerIndex: 13 },
        { layerIndex: 14 },
      ]),
    ],
  };
}

export function readCrfDualMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "de por Meu CRF dual", errors);
  const controllerLayer = getLayerByIndex(source, 5);
  const subtypeProperty = getEffectControlValueProperty(
    controllerLayer,
    1,
    "Subtipo",
    "de por Meu CRF dual",
    errors
  );
  const unitProperty = getEffectControlValueProperty(
    controllerLayer,
    2,
    "Unidade",
    "de por Meu CRF dual",
    errors
  );
  const quantityProperty = getEffectControlValueProperty(
    controllerLayer,
    3,
    "Quantidade X",
    "de por Meu CRF dual",
    errors
  );

  if (controllerLayer === null) {
    addError(
      errors,
      "Nao encontrei o Controlador de mecanica na layer 5 em de por Meu CRF dual."
    );
  }

  return {
    type: "De Por Meu CRF (Dual)",
    fields: [
      makeTextField(source, "PRECO DE", "De", "price", "preco de", errors),
      makeTextField(source, "PRECO POR", "Por", "price", "preco por", errors),
      makeValueField(
        "quantidade-x",
        "Quantidade X",
        "integer",
        quantityProperty
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("subtype", "Subtipo", subtypeProperty, [
        { label: "De Por" },
        { label: "NAO EXISTE MAIS, NAO USAR!" },
        { label: "Levando X Unidades" },
        { label: "Com o Desconto" },
        { label: "A partir de X Unidades" },
      ]),
      makeControllerOptionGroup("unit", "Unidade", unitProperty, [
        { label: "Cada" },
        { label: "Kg" },
        { label: "A cada 100g" },
        { label: "Kg/cada" },
      ]),
    ],
  };
}
