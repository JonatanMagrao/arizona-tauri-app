import { evalTS } from "../../../../lib/utils/bolt";
import {
  openOfferPrecompForEditor,
  updateOfferField,
} from "../../ofertas/services/ofertas";
import type { OfferValidationInfo } from "../types";

export const loadOffersFirstProductInfo = () => {
  if (!window.cep) return Promise.resolve([] as OfferValidationInfo[]);

  return evalTS("getOffersFirstProductInfo") as Promise<OfferValidationInfo[]>;
};

export const updateValidatedOfferField = (
  offerLayerIndex: number,
  productIndex: number,
  fieldId: string,
  value: string,
  fieldIndex: number
) => updateOfferField(offerLayerIndex, productIndex, fieldId, value, fieldIndex);

export const openValidatedOfferPrecomp = (offerLayerIndex: number) =>
  openOfferPrecompForEditor(offerLayerIndex);
