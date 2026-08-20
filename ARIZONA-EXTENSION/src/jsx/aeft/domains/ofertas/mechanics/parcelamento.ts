import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJump,
  OfferInstallmentJumpTarget,
} from "../types";
import { getLayerByIndex, getLayerSource } from "../layers/findLayers";
import {
  getInstallmentControllerProperty,
  makeControllerOptionGroup,
  makeTextField,
} from "./shared";

export const CARD_INSTALLMENT_MECHANIC_TYPE =
  "De Por Parcelamento Cartao Carrefour";

const CARD_INSTALLMENT_JUMP_MARKER_INDEX = 2;

export interface InstallmentJumpDefinition {
  markerLayerIndex: number;
  fullPriceLayerIndex: number;
  installmentPriceLayerIndex: number;
  context: string;
  markerLayerName?: string;
  fullPriceLayerName?: string;
  installmentPriceLayerName?: string;
}

const CARD_INSTALLMENT_JUMP_DEFINITION: InstallmentJumpDefinition = {
  markerLayerIndex: 2,
  fullPriceLayerIndex: 3,
  installmentPriceLayerIndex: 4,
  context: "parcelamento CRF",
};

interface InstallmentJumpLayers {
  source: CompItem;
  markerLayer: Layer;
  fullPriceLayer: Layer;
  installmentPriceLayer: Layer;
  markerTime: number;
}

export function readCardInstallmentMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  const source = getLayerSource(valueLayer, "parcelamento CRF", errors);
  const controllerProperty = getInstallmentControllerProperty(source, errors);

  return {
    type: CARD_INSTALLMENT_MECHANIC_TYPE,
    fields: [
      makeTextField(source, "PRECO DE", "De", "price", "preco de", errors),
      makeTextField(source, "PRECO", "Preco", "price", "preco", errors),
      makeTextField(
        source,
        "PRECO PARCELA",
        "Parcela",
        "price",
        "preco parcela",
        errors
      ),
      makeTextField(
        source,
        "NUMERO DE PARCELAS",
        "Parcelas",
        "integer",
        "numero de parcelas",
        errors
      ),
    ],
    optionGroups: [
      makeControllerOptionGroup("cardKind", "Opcao", controllerProperty, [
        { label: "Cartao Carrefour" },
        { label: "Plano Controle" },
        { label: "Cartao/Plano" },
        { label: "De/Por Cartao" },
        { label: "De/Por Plano" },
        { label: "De/Por Cartao/Plano" },
      ]),
    ],
    installmentJump: readInstallmentJump(
      source,
      CARD_INSTALLMENT_JUMP_DEFINITION
    ),
  };
}

export const readInstallmentJump = (
  source: CompItem | null,
  definition: InstallmentJumpDefinition
): OfferInstallmentJump => {
  const layers = resolveInstallmentJumpLayers(source, definition, false);

  if (layers === null) {
    return {
      selectedTarget: "preco-cheio",
      enabled: false,
    };
  }

  const fullPriceDistance = Math.abs(
    layers.fullPriceLayer.inPoint - layers.markerTime
  );
  const installmentDistance = Math.abs(
    layers.installmentPriceLayer.inPoint - layers.markerTime
  );

  return {
    selectedTarget:
      installmentDistance < fullPriceDistance ? "preco-parcela" : "preco-cheio",
    enabled: true,
  };
};

const resolveInstallmentJumpLayers = (
  source: CompItem | null,
  definition: InstallmentJumpDefinition,
  shouldThrow: boolean
): InstallmentJumpLayers | null => {
  if (source === null) {
    if (shouldThrow) {
      throw new Error("Precomp de " + definition.context + " nao encontrada.");
    }
    return null;
  }

  const markerLayer = getLayerByIndex(source, definition.markerLayerIndex);
  const fullPriceLayer = getLayerByIndex(
    source,
    definition.fullPriceLayerIndex
  );
  const installmentPriceLayer = getLayerByIndex(
    source,
    definition.installmentPriceLayerIndex
  );

  if (
    markerLayer === null ||
    fullPriceLayer === null ||
    installmentPriceLayer === null
  ) {
    if (shouldThrow) {
      throw new Error("Nao encontrei as layers de jump de " + definition.context + ".");
    }
    return null;
  }

  if (
    !hasExpectedLayerName(markerLayer, definition.markerLayerName) ||
    !hasExpectedLayerName(fullPriceLayer, definition.fullPriceLayerName) ||
    !hasExpectedLayerName(
      installmentPriceLayer,
      definition.installmentPriceLayerName
    )
  ) {
    if (shouldThrow) {
      throw new Error("As layers de jump de " + definition.context + " mudaram.");
    }
    return null;
  }

  if (markerLayer.marker.numKeys < CARD_INSTALLMENT_JUMP_MARKER_INDEX) {
    if (shouldThrow) {
      throw new Error("Marker de jump de " + definition.context + " nao encontrado.");
    }
    return null;
  }

  return {
    source,
    markerLayer,
    fullPriceLayer,
    installmentPriceLayer,
    markerTime: markerLayer.marker.keyTime(CARD_INSTALLMENT_JUMP_MARKER_INDEX),
  };
};

const hasExpectedLayerName = (
  layer: Layer,
  expectedName?: string
): boolean =>
  typeof expectedName === "undefined" ||
  String(layer.name).toLowerCase() === expectedName.toLowerCase();

const getProductMechanicSource = (
  product: InternalOfferProduct
): CompItem | null => {
  if (product.mechanicLayer === null) return null;

  try {
    if (
      product.mechanicLayer instanceof AVLayer &&
      product.mechanicLayer.source instanceof CompItem
    ) {
      return product.mechanicLayer.source;
    }
  } catch (error) {
  }

  return null;
};

const moveLayerInPointTo = (layer: Layer, targetTime: number): void => {
  layer.startTime += targetTime - layer.inPoint;
};

export const applyInstallmentJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget,
  definition: InstallmentJumpDefinition
): void => {
  if (target !== "preco-cheio" && target !== "preco-parcela") {
    throw new Error("Jump invalido.");
  }

  const layers = resolveInstallmentJumpLayers(
    getProductMechanicSource(product),
    definition,
    true
  );

  if (layers === null) {
    throw new Error("Jump de " + definition.context + " nao encontrado.");
  }

  if (target === "preco-cheio") {
    moveLayerInPointTo(layers.fullPriceLayer, layers.markerTime);
    moveLayerInPointTo(layers.installmentPriceLayer, layers.source.duration);
    return;
  }

  moveLayerInPointTo(layers.installmentPriceLayer, layers.markerTime);
  moveLayerInPointTo(layers.fullPriceLayer, layers.source.duration);
};

export const applyCardInstallmentJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyInstallmentJump(product, target, CARD_INSTALLMENT_JUMP_DEFINITION);
