import type {
  InternalOfferProduct,
  OfferInstallmentJump,
  OfferInstallmentJumpTarget,
} from "../types";
import { getLayerByIndex } from "../layers/findLayers";
import { findLayerByIdentity } from "../layers/findLayerByIdentity";

const INSTALLMENT_JUMP_MARKER_INDEX = 2;

interface LegacyInstallmentJumpDefinition {
  markerLayerIndex: number;
  fullPriceLayerIndex: number;
  installmentPriceLayerIndex: number;
  context: string;
  markerLayerName?: string;
  fullPriceLayerName?: string;
  installmentPriceLayerName?: string;
}

interface JumpLayerIdentity {
  comment: string;
  fallbackNames: string[];
}

interface IdentityInstallmentJumpDefinition {
  context: string;
  layerIdentities: {
    marker: JumpLayerIdentity;
    fullPrice: JumpLayerIdentity;
    installmentPrice: JumpLayerIdentity;
  };
}

export type InstallmentJumpDefinition =
  | LegacyInstallmentJumpDefinition
  | IdentityInstallmentJumpDefinition;

interface InstallmentJumpLayers {
  source: CompItem;
  markerLayer: Layer;
  fullPriceLayer: Layer;
  installmentPriceLayer: Layer;
  markerTime: number;
}

export const readInstallmentJump = (
  source: CompItem | null,
  definition: InstallmentJumpDefinition,
  errors?: string[]
): OfferInstallmentJump => {
  const layers = resolveInstallmentJumpLayers(source, definition, false, errors);

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
  shouldThrow: boolean,
  errors?: string[]
): InstallmentJumpLayers | null => {
  if ("layerIdentities" in definition) {
    return resolveIdentityInstallmentJumpLayers(
      source,
      definition,
      shouldThrow,
      errors
    );
  }

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

  if (markerLayer.marker.numKeys < INSTALLMENT_JUMP_MARKER_INDEX) {
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
    markerTime: markerLayer.marker.keyTime(INSTALLMENT_JUMP_MARKER_INDEX),
  };
};

const resolveIdentityInstallmentJumpLayers = (
  source: CompItem | null,
  definition: IdentityInstallmentJumpDefinition,
  shouldThrow: boolean,
  errors?: string[]
): InstallmentJumpLayers | null => {
  const resolutionErrors: string[] = [];

  const fail = (message?: string): null => {
    if (message) resolutionErrors.push(message);
    if (errors) {
      for (let index = 0; index < resolutionErrors.length; index += 1) {
        errors.push(resolutionErrors[index]);
      }
    }
    if (shouldThrow) {
      throw new Error(resolutionErrors.join(" "));
    }
    return null;
  };

  if (source === null) {
    return fail("Precomp de " + definition.context + " nao encontrada.");
  }

  const findLayer = (identity: JumpLayerIdentity): Layer | null =>
    findLayerByIdentity(
      source,
      {
        comment: identity.comment,
        fallbackNames: identity.fallbackNames,
        context: definition.context,
      },
      resolutionErrors
    );

  const markerLayer = findLayer(definition.layerIdentities.marker);
  const fullPriceLayer = findLayer(definition.layerIdentities.fullPrice);
  const installmentPriceLayer = findLayer(
    definition.layerIdentities.installmentPrice
  );

  if (
    markerLayer === null ||
    fullPriceLayer === null ||
    installmentPriceLayer === null
  ) {
    return fail();
  }

  if (
    markerLayer.index === fullPriceLayer.index ||
    markerLayer.index === installmentPriceLayer.index ||
    fullPriceLayer.index === installmentPriceLayer.index
  ) {
    return fail(
      "As layers de jump de " + definition.context + " devem ser distintas."
    );
  }

  let markerCount = 0;
  let markerTime = NaN;
  try {
    markerCount = markerLayer.marker.numKeys;
    if (markerCount >= INSTALLMENT_JUMP_MARKER_INDEX) {
      markerTime = markerLayer.marker.keyTime(INSTALLMENT_JUMP_MARKER_INDEX);
    }
  } catch (error) {
    return fail("Marker de jump de " + definition.context + " invalido.");
  }

  if (markerCount < INSTALLMENT_JUMP_MARKER_INDEX) {
    return fail("Marker de jump de " + definition.context + " nao encontrado.");
  }

  if (typeof markerTime !== "number" || !isFinite(markerTime)) {
    return fail("Marker de jump de " + definition.context + " invalido.");
  }

  return {
    source,
    markerLayer,
    fullPriceLayer,
    installmentPriceLayer,
    markerTime,
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
