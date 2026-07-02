import type { OfferEditorActionResult } from "../types";
import {
  getWritableFieldValue,
  normalizeValue,
  readFieldValue,
  setFieldValue,
} from "../layers/textFields";
import { findTextField, updateOfferProduct } from "./shared";

export const updateOfferField = (
  offerLayerIndex: number,
  productIndex: number,
  fieldId: string,
  value: string,
  fieldIndex?: number
): OfferEditorActionResult => {
  return updateOfferProduct(
    offerLayerIndex,
    productIndex,
    "Atualizar campo",
    (product) => {
      const field = findTextField(product.mechanic.fields, fieldId, fieldIndex);

      if (field === null || field.property === null) {
        throw new Error(
          'Campo "' +
            fieldId +
            '" nao encontrado na mecanica ' +
            product.mechanic.type +
            "."
        );
      }

      const normalized = normalizeValue(value, field.format);
      setFieldValue(field, getWritableFieldValue(field, normalized));
      const currentValue = normalizeValue(readFieldValue(field), field.format);

      if (currentValue !== normalized) {
        throw new Error(
          field.label +
            ' recebeu "' +
            normalized +
            '", mas o After retornou "' +
            currentValue +
            '". A layer pode estar controlada por expressao ou outro campo.'
        );
      }

      return field.label + " atualizado.";
    }
  );
};
