import type {
  InternalOfferDetails,
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferDetails,
  OfferEditorSnapshot,
  OfferLegalControl,
  OfferOption,
  OfferOptionGroup,
  OfferProduct,
  OfferTextField,
} from "../types";
import {
  createOfferSummaries,
  getLayerSource,
  getOfferLayers,
  getOffersComp,
  readProductImageInfo,
  resolveSelectedOffer,
} from "../layers/findLayers";
import { resolveOfferProductLayers } from "../layers/offerStructure";
import {
  getNestedTextProperty,
  hasPropertyExpression,
  isPropertyExpressionEnabled,
  readLegalText,
  readText,
} from "../layers/textFields";
import {
  getLegalTextProperty,
  getLegalTextSource,
  readLegalControls,
} from "../layers/legalControls";
import { readMechanic } from "../mechanics/registry";
import { withMechanicsSchema } from "../mechanics/schemaRuntime";

const createSnapshot = (): OfferEditorSnapshot => ({
  ok: false,
  message: "",
  compName: "",
  offers: [],
  selectedOfferLayerIndex: 0,
  selectedOffer: null,
  errors: [],
});

export const getOffersEditorSnapshot = (
  requestedOfferLayerIndex?: number
): OfferEditorSnapshot => {
  const snapshot = createSnapshot();
  const comp = getOffersComp();

  if (comp === null) {
    snapshot.message = 'Precomp "Miolo" nao encontrada.';
    return snapshot;
  }

  const offers = getOfferLayers(comp);
  const selectedOffer = resolveSelectedOffer(
    comp,
    offers,
    requestedOfferLayerIndex
  );

  snapshot.ok = true;
  snapshot.compName = comp.name;
  snapshot.offers = createOfferSummaries(offers);

  if (offers.length < 1) {
    snapshot.message = 'Nenhuma layer "Oferta_" encontrada na precomp "Miolo".';
    return snapshot;
  }

  if (selectedOffer === null) {
    snapshot.message = "Selecione uma oferta acima ou na timeline.";
    return snapshot;
  }

  const details = generateOfferData(selectedOffer);
  snapshot.selectedOfferLayerIndex = selectedOffer.index;
  snapshot.selectedOffer = toPublicOfferDetails(selectedOffer, details);
  snapshot.errors = details.errors.slice(0);
  snapshot.message =
    snapshot.selectedOffer.products.length > 0
      ? "Oferta carregada."
      : "Nenhum produto ativo encontrado nesta oferta.";

  return snapshot;
};

export const generateOfferData = (offer: Layer): InternalOfferDetails => withMechanicsSchema(() => {
  const errors: string[] = [];
  const products: InternalOfferProduct[] = [];
  const offerSource = getLayerSource(offer, "oferta", errors);
  const legalDisabledReasons: string[] = [];
  const legalDisabledSummaries: string[] = [];
  const legalSource = getLegalTextSource(offerSource, errors, legalDisabledReasons, legalDisabledSummaries);
  const legalTextProperty = getLegalTextProperty(legalSource, errors);
  const legalControls = readLegalControls(legalSource, errors);
  if (legalSource === null && legalDisabledReasons.length > 0) {
    for (let index = 0; index < legalControls.length; index += 1) {
      legalControls[index].disabledReason = legalDisabledReasons.join(" ");
      legalControls[index].disabledSummary = legalDisabledSummaries.join(" ");
    }
  }

  const productLayers = resolveOfferProductLayers(offerSource, errors);
  for (let index = 0; index < productLayers.length; index += 1) {
    const layers = productLayers[index];
    const descriptionPrecomp = layers.descriptionLayer;
    const descriptionProperty = getNestedTextProperty(
      descriptionPrecomp,
      "DESCRITIVO",
      "descricao do produto " + layers.slot,
      errors
    );
    const valueLayer = layers.mechanicLayer;
    const mechanic: InternalOfferMechanic = valueLayer === null
      ? {
          type: layers.mechanicUnavailableLabel || "Mecânica do produto " + layers.slot + " indisponível",
          fields: [],
          optionGroups: [],
          unsupported: true,
        }
      : readMechanic(valueLayer, errors);
    const imageLayer = layers.imageLayer;
    const image = readProductImageInfo(
      imageLayer,
      "imagem do produto " + layers.slot,
      errors
    );

    products.push({
      index: layers.slot - 1,
      associationValid: layers.valid,
      disabledReason: layers.disabledReason,
      disabledSummary: layers.disabledSummary,
      description: {
        id: "description",
        label: "Descricao",
        value: readText(descriptionProperty),
        format: "text",
        enabled: layers.valid && descriptionProperty !== null,
        disabledReason: layers.disabledReason || (descriptionProperty === null
          ? 'Texto não encontrado. Confira a camada de texto "DESCRITIVO" dentro da precomp do descritivo.'
          : undefined),
        disabledSummary: layers.disabledSummary || (descriptionProperty === null
          ? "O texto do descritivo não foi encontrado."
          : undefined),
        multiline: true,
        hasExpression: hasPropertyExpression(descriptionProperty),
        expressionEnabled: isPropertyExpressionEnabled(descriptionProperty),
      },
      descriptionLayer: descriptionPrecomp,
      descriptionProperty,
      mechanic,
      mechanicLayer: valueLayer,
      imageLayer,
      image,
      unsupported: !layers.valid || mechanic.unsupported === true,
    });
  }

  return {
    layerIndex: offer.index,
    name: offer.name,
    products,
    legalText:
      legalTextProperty === null
        ? null
        : {
            id: "legalText",
            label: "Texto legal",
            value: readLegalText(legalTextProperty),
            format: "text",
            enabled: true,
          },
    legalControls,
    legalTextProperty,
    errors,
  };
});

export const toPublicOfferDetails = (
  offer: Layer,
  details: InternalOfferDetails
): OfferDetails => {
  const products: OfferProduct[] = [];

  for (let pi = 0; pi < details.products.length; pi += 1) {
    const product = details.products[pi];
    const fields: OfferTextField[] = [];
    const optionGroups: OfferOptionGroup[] = [];

    for (let fi = 0; fi < product.mechanic.fields.length; fi += 1) {
      const field = product.mechanic.fields[fi];
      fields.push({
        id: field.id,
        label: field.label,
        value: field.value,
        format: field.format,
        enabled: product.associationValid !== false && field.enabled,
        disabledReason: product.disabledReason || field.disabledReason,
        disabledSummary: product.disabledSummary || field.disabledSummary,
      });
    }

    for (let ogi = 0; ogi < product.mechanic.optionGroups.length; ogi += 1) {
      const optionGroup = product.mechanic.optionGroups[ogi];
      const options: OfferOption[] = [];

      for (let oi = 0; oi < optionGroup.options.length; oi += 1) {
        options.push({ label: optionGroup.options[oi].label });
      }

      optionGroups.push({
        id: optionGroup.id,
        type: optionGroup.type,
        placement: optionGroup.placement,
        label: optionGroup.label,
        options,
        selectedIndex: optionGroup.selectedIndex,
        enabled: product.associationValid !== false && optionGroup.enabled,
        disabledReason: product.disabledReason || optionGroup.disabledReason,
        disabledSummary: product.disabledSummary || optionGroup.disabledSummary,
      });
    }

    products.push({
      index: product.index,
      disabledReason: product.disabledReason,
      disabledSummary: product.disabledSummary,
      description: {
        id: product.description.id,
        label: product.description.label,
        value: product.description.value,
        format: product.description.format,
        enabled: product.description.enabled,
        disabledReason: product.description.disabledReason,
        disabledSummary: product.description.disabledSummary,
        multiline: product.description.multiline,
        hasExpression: product.description.hasExpression,
        expressionEnabled: product.description.expressionEnabled,
      },
      mechanic: {
        type: product.mechanic.type,
        unsupported: product.associationValid === false || product.mechanic.unsupported,
        disabledReason: product.disabledReason || product.mechanic.disabledReason,
        disabledSummary: product.disabledSummary || product.mechanic.disabledSummary,
        fields,
        optionGroups,
        installmentJump:
          product.mechanic.installmentJump === null ||
          typeof product.mechanic.installmentJump === "undefined"
            ? null
            : {
                selectedTarget: product.mechanic.installmentJump.selectedTarget,
                enabled: product.associationValid !== false && product.mechanic.installmentJump.enabled,
                disabledReason: product.disabledReason || product.mechanic.installmentJump.disabledReason,
                disabledSummary: product.disabledSummary || product.mechanic.installmentJump.disabledSummary,
              },
      },
      image: product.image,
      unsupported: product.unsupported,
    });
  }

  const legalControls: OfferLegalControl[] = [];

  for (let ci = 0; ci < details.legalControls.length; ci += 1) {
    const control = details.legalControls[ci];
    let optionGroup: OfferOptionGroup | null = null;

    if (control.optionGroup !== null && typeof control.optionGroup !== "undefined") {
      const options: OfferOption[] = [];

      for (let oi = 0; oi < control.optionGroup.options.length; oi += 1) {
        options.push({ label: control.optionGroup.options[oi].label });
      }

      optionGroup = {
        id: control.optionGroup.id,
        type: control.optionGroup.type,
        placement: control.optionGroup.placement,
        label: control.optionGroup.label,
        options,
        selectedIndex: control.optionGroup.selectedIndex,
        enabled: control.optionGroup.enabled,
        disabledReason: control.optionGroup.disabledReason,
        disabledSummary: control.optionGroup.disabledSummary,
      };
    }

    legalControls.push({
      id: control.id,
      label: control.label,
      kind: control.kind,
      layerIndex: control.layerIndex,
      enabled: control.enabled,
      available: control.available,
      disabledReason: control.disabledReason,
      disabledSummary: control.disabledSummary,
      locked: control.locked,
      slider:
        control.slider === null || typeof control.slider === "undefined"
          ? null
          : {
              id: control.slider.id,
              label: control.slider.label,
              value: control.slider.value,
              format: control.slider.format,
              enabled: control.slider.enabled,
              disabledReason: control.slider.disabledReason,
              disabledSummary: control.slider.disabledSummary,
              multiline: control.slider.multiline,
            },
      optionGroup,
    });
  }

  return {
    layerIndex: offer.index,
    name: offer.name,
    products,
    legalText: details.legalText,
    legalControls,
    errors: details.errors.slice(0),
  };
};
