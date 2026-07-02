import type { InternalOfferMechanic } from "../types";
import { getLayerSource } from "../layers/findLayers";
import {
  makeIndexedTextField,
  makeLayerOptionGroup,
  makeTextField,
} from "./shared";

export function readSimpleMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "mecanica simples", errors);

  return {
    type: "Simples",
    fields: [
      makeTextField(source, "PRECO", "Preco", "price", "preco simples", errors),
    ],
    optionGroups: [
      makeLayerOptionGroup("unit", "Unidade", source, [
        { label: "KG/CADA", layerName: "KG/CADA", layerIndex: 5 },
        { label: "100g", layerName: "100g", layerIndex: 6 },
        { label: "KG", layerName: "KG", layerIndex: 7 },
        { label: "CADA", layerName: "CADA", layerIndex: 8 },
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
