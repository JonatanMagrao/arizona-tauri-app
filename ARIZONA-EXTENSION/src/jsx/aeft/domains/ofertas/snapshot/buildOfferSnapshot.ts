import type {
  InternalOfferDetails,
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
  getLayerByIndex,
  getLayerSource,
  getOfferLayers,
  getOffersComp,
  nameMatches,
  readProductImageInfo,
  resolveSelectedOffer,
} from "../layers/findLayers";
import {
  getNestedTextProperty,
  readLegalText,
  readText,
} from "../layers/textFields";
import {
  getLegalTextProperty,
  getLegalTextSource,
  readLegalControls,
} from "../layers/legalControls";
import { readMechanic } from "../mechanics/registry";

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

export const generateOfferData = (offer: Layer): InternalOfferDetails => {
  const errors: string[] = [];
  const products: InternalOfferProduct[] = [];
  const offerSource = getLayerSource(offer, "oferta", errors);
  const legalSource = getLegalTextSource(offerSource, errors);
  const legalTextProperty = getLegalTextProperty(legalSource, errors);
  const legalControls = readLegalControls(legalSource, errors);

  if (offerSource !== null) {
    for (let index = 1; index <= offerSource.numLayers; index += 1) {
      const descriptionPrecomp = offerSource.layer(index);

      if (
        !descriptionPrecomp.enabled ||
        !nameMatches(descriptionPrecomp.name, /DESCRITIVO/)
      ) {
        continue;
      }

      const descriptionProperty = getNestedTextProperty(
        descriptionPrecomp,
        "DESCRITIVO",
        "descricao da oferta " + products.length,
        errors
      );
      const valueLayer = getLayerByIndex(offerSource, descriptionPrecomp.index + 1);

      if (valueLayer === null) {
        errors.push(
          "Nao encontrei a mecanica depois de " + descriptionPrecomp.name + "."
        );
        continue;
      }

      const mechanic = readMechanic(valueLayer, errors);
      const imageLayer = getLayerByIndex(offerSource, valueLayer.index + 1);
      const image = readProductImageInfo(
        imageLayer,
        "imagem da oferta " + products.length,
        errors
      );

      products.push({
        index: products.length,
        description: {
          id: "description",
          label: "Descricao",
          value: readText(descriptionProperty),
          format: "text",
          enabled: descriptionProperty !== null,
          multiline: true,
        },
        descriptionLayer: descriptionPrecomp,
        descriptionProperty,
        mechanic,
        mechanicLayer: valueLayer,
        imageLayer,
        image,
        unsupported: mechanic.unsupported === true,
      });
    }
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
};

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
        enabled: field.enabled,
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
        label: optionGroup.label,
        options,
        selectedIndex: optionGroup.selectedIndex,
        enabled: optionGroup.enabled,
      });
    }

    products.push({
      index: product.index,
      description: {
        id: product.description.id,
        label: product.description.label,
        value: product.description.value,
        format: product.description.format,
        enabled: product.description.enabled,
        multiline: product.description.multiline,
      },
      mechanic: {
        type: product.mechanic.type,
        unsupported: product.mechanic.unsupported,
        fields,
        optionGroups,
        installmentJump:
          product.mechanic.installmentJump === null ||
          typeof product.mechanic.installmentJump === "undefined"
            ? null
            : {
                selectedTarget: product.mechanic.installmentJump.selectedTarget,
                enabled: product.mechanic.installmentJump.enabled,
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
        label: control.optionGroup.label,
        options,
        selectedIndex: control.optionGroup.selectedIndex,
        enabled: control.optionGroup.enabled,
      };
    }

    legalControls.push({
      id: control.id,
      label: control.label,
      layerIndex: control.layerIndex,
      enabled: control.enabled,
      available: control.available,
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
