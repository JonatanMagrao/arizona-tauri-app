export type OfferFieldFormat = "integer" | "percent" | "price" | "text";
export type OfferOptionGroupType = "controller" | "layers";
export type OfferInstallmentJumpTarget = "preco-cheio" | "preco-parcela";

export interface OfferEditorActionResult {
  ok: boolean;
  message: string;
  selectedOfferLayerIndex: number;
  errors: string[];
}

export interface OfferEditorSnapshot {
  ok: boolean;
  message: string;
  compName: string;
  offers: OfferSummary[];
  selectedOfferLayerIndex: number;
  selectedOffer: OfferDetails | null;
  errors: string[];
}

export interface OfferSummary {
  layerIndex: number;
  name: string;
  label: number;
  markerIndex: number;
  startTime: number;
  selected: boolean;
  enabled: boolean;
}

export interface OfferDetails {
  layerIndex: number;
  name: string;
  products: OfferProduct[];
  legalText: OfferTextField | null;
  legalControls: OfferLegalControl[];
  errors: string[];
}

export interface OfferLegalControl {
  id: string;
  label: string;
  layerIndex: number;
  enabled: boolean;
  available: boolean;
  locked: boolean;
  slider: OfferTextField | null;
  optionGroup: OfferOptionGroup | null;
}

export interface OfferProduct {
  index: number;
  description: OfferTextField;
  mechanic: OfferMechanic;
  image: OfferImageInfo | null;
  unsupported: boolean;
}

export interface OfferImageInfo {
  layerIndex: number;
  layerName: string;
  sourceName: string;
  filePath: string;
  enabled: boolean;
}

export interface OfferMechanic {
  type: string;
  fields: OfferTextField[];
  optionGroups: OfferOptionGroup[];
  installmentJump?: OfferInstallmentJump | null;
  unsupported?: boolean;
}

export interface OfferTextField {
  id: string;
  label: string;
  value: string;
  format: OfferFieldFormat;
  enabled: boolean;
  multiline?: boolean;
}

export interface OfferOption {
  label: string;
}

export interface OfferOptionGroup {
  id: string;
  type: OfferOptionGroupType;
  label: string;
  options: OfferOption[];
  selectedIndex: number;
  enabled: boolean;
}

export interface OfferInstallmentJump {
  selectedTarget: OfferInstallmentJumpTarget;
  enabled: boolean;
}
