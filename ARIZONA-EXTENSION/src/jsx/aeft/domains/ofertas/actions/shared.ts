import type {
  InternalOfferProduct,
  InternalOptionGroup,
  InternalTextField,
  OfferEditorActionResult,
} from "../types";
import { getOfferByLayerIndex } from "../layers/findLayers";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";

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
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup(undoName);

  try {
    const details = generateOfferData(offer);
    const product = details.products[productIndex];
    result.errors = details.errors.slice(0);

    if (!product) {
      throw new Error("Produto nao encontrado.");
    }

    result.message = updater(product);
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao atualizar oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
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
