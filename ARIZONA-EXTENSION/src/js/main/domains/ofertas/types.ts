export type OfferFieldFormat = "integer" | "percent" | "price" | "text";
export type OfferOptionGroupType = "controller" | "layers";
export type OfferOptionGroupPlacement = "controls" | "header";
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
  disabledSummary?: string;
  disabledReason?: string;
  id: string;
  label: string;
  kind?: "layer" | "checkbox" | "slider";
  layerIndex: number;
  enabled: boolean;
  available: boolean;
  locked: boolean;
  slider: OfferTextField | null;
  optionGroup: OfferOptionGroup | null;
}

export interface OfferProduct {
  disabledSummary?: string;
  disabledReason?: string;
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
  disabledSummary?: string;
  disabledReason?: string;
  type: string;
  fields: OfferTextField[];
  optionGroups: OfferOptionGroup[];
  installmentJump?: OfferInstallmentJump | null;
  unsupported?: boolean;
}

export interface OfferTextField {
  disabledSummary?: string;
  disabledReason?: string;
  id: string;
  label: string;
  value: string;
  format: OfferFieldFormat;
  enabled: boolean;
  multiline?: boolean;
  hasExpression?: boolean;
  expressionEnabled?: boolean;
}

export interface OfferOption {
  label: string;
}

export interface OfferOptionGroup {
  disabledSummary?: string;
  disabledReason?: string;
  id: string;
  type: OfferOptionGroupType;
  placement?: OfferOptionGroupPlacement;
  label: string;
  options: OfferOption[];
  selectedIndex: number;
  enabled: boolean;
}

export interface OfferInstallmentJump {
  disabledSummary?: string;
  disabledReason?: string;
  selectedTarget: OfferInstallmentJumpTarget;
  enabled: boolean;
}
