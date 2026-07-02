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
const CARD_INSTALLMENT_MARKER_LAYER_INDEX = 2;
const CARD_INSTALLMENT_FULL_PRICE_LAYER_INDEX = 3;
const CARD_INSTALLMENT_PRICE_LAYER_INDEX = 4;

interface CardInstallmentJumpLayers {
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
    installmentJump: readCardInstallmentJump(source),
  };
}

const readCardInstallmentJump = (
  source: CompItem | null
): OfferInstallmentJump => {
  const layers = resolveCardInstallmentJumpLayers(source, false);

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

const resolveCardInstallmentJumpLayers = (
  source: CompItem | null,
  shouldThrow: boolean
): CardInstallmentJumpLayers | null => {
  if (source === null) {
    if (shouldThrow) throw new Error("Precomp do parcelamento nao encontrada.");
    return null;
  }

  const markerLayer = getLayerByIndex(source, CARD_INSTALLMENT_MARKER_LAYER_INDEX);
  const fullPriceLayer = getLayerByIndex(
    source,
    CARD_INSTALLMENT_FULL_PRICE_LAYER_INDEX
  );
  const installmentPriceLayer = getLayerByIndex(
    source,
    CARD_INSTALLMENT_PRICE_LAYER_INDEX
  );

  if (
    markerLayer === null ||
    fullPriceLayer === null ||
    installmentPriceLayer === null
  ) {
    if (shouldThrow) {
      throw new Error(
        "Nao encontrei as layers de jump do parcelamento CRF."
      );
    }
    return null;
  }

  if (markerLayer.marker.numKeys < CARD_INSTALLMENT_JUMP_MARKER_INDEX) {
    if (shouldThrow) {
      throw new Error("Marker de jump do parcelamento CRF nao encontrado.");
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

export const applyCardInstallmentJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void => {
  if (target !== "preco-cheio" && target !== "preco-parcela") {
    throw new Error("Jump invalido.");
  }

  const layers = resolveCardInstallmentJumpLayers(
    getProductMechanicSource(product),
    true
  );

  if (layers === null) {
    throw new Error("Jump do parcelamento CRF nao encontrado.");
  }

  if (target === "preco-cheio") {
    moveLayerInPointTo(layers.fullPriceLayer, layers.markerTime);
    moveLayerInPointTo(layers.installmentPriceLayer, layers.source.duration);
    return;
  }

  moveLayerInPointTo(layers.installmentPriceLayer, layers.markerTime);
  moveLayerInPointTo(layers.fullPriceLayer, layers.source.duration);
};
