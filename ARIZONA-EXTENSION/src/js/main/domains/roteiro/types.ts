export interface RoteiroFile {
  name: string;
  fullPath: string;
  regions: string[];
  matched: boolean;
}

export type OfferValidationFieldKey = "price" | "de" | "por" | "leve" | "pague";

export interface OfferValidationFieldRef {
  fieldId: string;
  fieldIndex: number;
  value: string;
}

export interface OfferValidationInfo {
  offerLayerIndex: number;
  productIndex: number;
  mechanicType: string;
  priceValue: string;
  priceAcceptedValues?: string[];
  priceField?: OfferValidationFieldRef;
  deValue?: string;
  porValue?: string;
  deField?: OfferValidationFieldRef;
  porField?: OfferValidationFieldRef;
  leveValue?: string;
  pagueValue?: string;
  leveField?: OfferValidationFieldRef;
  pagueField?: OfferValidationFieldRef;
}
