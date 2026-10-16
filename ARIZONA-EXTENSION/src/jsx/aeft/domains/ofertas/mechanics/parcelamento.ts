import type {
  InternalOfferProduct,
  OfferInstallmentJump,
  OfferInstallmentJumpTarget,
} from "../types";
import { getLayerByIndex } from "../layers/findLayers";
import {
  findLayerByIdentity,
  type LayerIdentityDiagnostic,
} from "../layers/findLayerByIdentity";

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
  recognizedComments?: string[];
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
  const diagnostic: LayerIdentityDiagnostic = {};
  const layers = resolveInstallmentJumpLayers(source, definition, false, errors, diagnostic);

  if (layers === null) {
    return {
      selectedTarget: "preco-cheio",
      enabled: false,
      disabledReason: diagnostic.disabledReason ||
        "Confira as camadas e o segundo marcador usados pelo jump nesta mecânica.",
      disabledSummary: diagnostic.disabledSummary ||
        "A estrutura necessária para o jump está indisponível.",
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
  errors?: string[],
  diagnostic?: LayerIdentityDiagnostic
): InstallmentJumpLayers | null => {
  if ("layerIdentities" in definition) {
    return resolveIdentityInstallmentJumpLayers(
      source,
      definition,
      shouldThrow,
      errors,
      diagnostic
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
  errors?: string[],
  diagnostic?: LayerIdentityDiagnostic
): InstallmentJumpLayers | null => {
  const resolutionErrors: string[] = [];
  const reasons: string[] = [];
  const summaries: string[] = [];
  const addSummary = (summary: string): void => {
    for (let index = 0; index < summaries.length; index += 1) {
      if (summaries[index] === summary) return;
    }
    summaries.push(summary);
  };

  const fail = (message?: string, reason?: string, summary?: string): null => {
    if (message) resolutionErrors.push(message);
    if (reason) reasons.push(reason);
    if (summary) addSummary(summary);
    if (diagnostic && reasons.length > 0) diagnostic.disabledReason = reasons.join(" ");
    if (diagnostic && summaries.length > 0) diagnostic.disabledSummary = summaries.join(" ");
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
    return fail("Precomp de " + definition.context + " nao encontrada.",
      "Precomp indisponível. Confira a origem da camada de mecânica.",
      "A precomp da mecânica não foi encontrada.");
  }

  const findLayer = (identity: JumpLayerIdentity): Layer | null => {
    const layerDiagnostic: LayerIdentityDiagnostic = {};
    const layer = findLayerByIdentity(
      source,
      {
        comment: identity.comment,
        fallbackNames: identity.fallbackNames,
        recognizedComments: identity.recognizedComments,
        context: definition.context,
      },
      resolutionErrors,
      layerDiagnostic
    );
    if (layerDiagnostic.disabledReason) reasons.push(layerDiagnostic.disabledReason);
    if (layerDiagnostic.disabledSummary) addSummary(layerDiagnostic.disabledSummary);
    return layer;
  };

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
      "As layers de jump de " + definition.context + " devem ser distintas.",
      "Use camadas diferentes para o marcador e os dois destinos do jump.",
      "Uma mesma camada corresponde a mais de uma função do jump."
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
    return fail("Marker de jump de " + definition.context + " invalido.",
      'Confira o segundo marcador da camada com o comentário "' +
        definition.layerIdentities.marker.comment + '".',
      "O marcador de jump está inválido.");
  }

  if (markerCount < INSTALLMENT_JUMP_MARKER_INDEX) {
    return fail("Marker de jump de " + definition.context + " nao encontrado.",
      'Adicione o segundo marcador na camada com o comentário "' +
        definition.layerIdentities.marker.comment + '".',
      "O segundo marcador necessário para o jump não foi encontrado.");
  }

  if (typeof markerTime !== "number" || !isFinite(markerTime)) {
    return fail("Marker de jump de " + definition.context + " invalido.",
      'Confira o segundo marcador da camada com o comentário "' +
        definition.layerIdentities.marker.comment + '".',
      "O marcador de jump está inválido.");
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
