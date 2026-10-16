import type {
  InternalOfferProduct,
  InternalOptionGroup,
  InternalTextField,
  OfferEditorActionResult,
} from "../types";
import { getOfferByLayerIndex } from "../layers/findLayers";
import { generateOfferData, generateOfferProductData, readOfferSelectionContext, toPublicOfferDetails } from "../snapshot/buildOfferSnapshot";
import { withMechanicsSchema } from "../mechanics/schemaRuntime";

export const createActionResult = (
  message: string = ""
): OfferEditorActionResult => ({
  ok: false,
  message,
  selectedOfferLayerIndex: 0,
  errors: [],
});

export const updateOfferProduct = (
  offerLayerIndex: number,
  productIndex: number,
  undoName: string,
  updater: (product: InternalOfferProduct) => string
): OfferEditorActionResult => withMechanicsSchema(() => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup(undoName);

  try {
    const product = generateOfferProductData(offer, productIndex, result.errors);

    if (!product) {
      throw new Error("Produto nao encontrado.");
    }
    assertOfferProductAssociation(product);

    result.message = updater(product);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    attachOfferUpdate(result, offer);
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao atualizar oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
});

// A successful edit remains successful if the subsequent read fails. Omitting
// the patch asks the panel to use its existing full-refresh recovery path.
// Call while the action's undo group is still open: the legacy legal reader
// also enforces visibility of fixed legal controls.
export const attachOfferUpdate = (result: OfferEditorActionResult, offer: Layer): void => {
  if (!result.ok) return;
  try {
    const before = readOfferSelectionContext(offer);
    if (before === null || before.offerLayerIndex !== result.selectedOfferLayerIndex) return;
    const details = generateOfferData(offer);
    const after = readOfferSelectionContext(offer);
    if (after === null || before.projectKey !== after.projectKey || before.compItemId !== after.compItemId ||
      before.offerLayerIndex !== after.offerLayerIndex || before.offerLayerId !== after.offerLayerId ||
      before.sourceItemId !== after.sourceItemId) return;
    result.offerUpdate = { context: after, offer: toPublicOfferDetails(offer, details) };
  } catch (error) {
    // The write has already succeeded; a later full snapshot may recover.
  }
};

// Product indices identify numbered comment slots, not positions in the active array.
export const findOfferProductByIndex = (
  products: InternalOfferProduct[],
  productIndex: number
): InternalOfferProduct | null => {
  for (let index = 0; index < products.length; index += 1) {
    if (products[index].index === productIndex) return products[index];
  }
  return null;
};

export const assertOfferProductAssociation = (
  product: InternalOfferProduct
): void => {
  if (product.associationValid === false) {
    throw new Error(
      "Associação de camadas inválida para o produto " +
        (product.index + 1) +
        ". Verifique os comentários."
    );
  }
};

export const findTextField = (
  fields: InternalTextField[],
  fieldId: string,
  fieldIndex?: number
): InternalTextField | null => {
  if (
    typeof fieldIndex === "number" &&
    fieldIndex >= 0 &&
    fieldIndex < fields.length
  ) {
    const indexedField = fields[fieldIndex];

    if (indexedField.id === fieldId || indexedField.property !== null) {
      return indexedField;
    }
  }

  for (let index = 0; index < fields.length; index += 1) {
    if (fields[index].id === fieldId) return fields[index];
  }

  return null;
};

export const findOptionGroup = (
  optionGroups: InternalOptionGroup[],
  optionGroupId: string
): InternalOptionGroup | null => {
  for (let index = 0; index < optionGroups.length; index += 1) {
    if (optionGroups[index].id === optionGroupId) return optionGroups[index];
  }

  return null;
};
