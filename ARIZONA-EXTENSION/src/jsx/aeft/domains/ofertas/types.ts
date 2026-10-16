export type OfferFieldFormat = "integer" | "percent" | "price" | "text";
export type OfferOptionGroupType = "controller" | "layers";
export type OfferOptionGroupPlacement = "controls" | "header";
export type OfferInstallmentJumpTarget = "preco-cheio" | "preco-parcela";

export interface MechanicReaderMap {
  pattern: RegExp;
  reader: (valueLayer: Layer, errors: string[]) => InternalOfferMechanic;
}

export interface RawLayerOption {
  label?: string;
  layerName?: string;
  layerIndex?: number;
}

export interface LayerOption {
  label: string;
  layerName?: string;
  layerIndex?: number;
}

export interface InternalTextField extends OfferTextField {
  property: Property | null;
  valueKind: "text" | "value";
}

export interface InternalOptionGroup extends OfferOptionGroup {
  source?: CompItem | null;
  controllerProperty?: Property | null;
  controllerOptionValues?: number[];
  layerOptions?: LayerOption[];
}

export interface InternalLegalControl extends OfferLegalControl {
  slider?: InternalTextField | null;
  optionGroup?: InternalOptionGroup | null;
}

export interface InternalOfferMechanic extends OfferMechanic {
  fields: InternalTextField[];
  optionGroups: InternalOptionGroup[];
}

export interface InternalOfferProduct extends OfferProduct {
  associationValid?: boolean;
  descriptionLayer: Layer | null;
  descriptionProperty: Property | null;
  mechanic: InternalOfferMechanic;
  mechanicLayer: Layer | null;
  imageLayer: Layer | null;
}

export interface InternalOfferDetails extends OfferDetails {
  products: InternalOfferProduct[];
  legalControls: InternalLegalControl[];
  legalTextProperty: Property | null;
}

export interface OfferEditorActionResult {
  ok: boolean;
  message: string;
  selectedOfferLayerIndex: number;
  errors: string[];
  offerUpdate?: OfferEditorOfferUpdate;
}

export interface OfferEditorSelectionContext {
  projectKey: string;
  compItemId: number;
  offerLayerIndex: number;
  offerLayerId: number;
  sourceItemId: number;
}

export interface OfferEditorOfferUpdate {
  context: OfferEditorSelectionContext;
  offer: OfferDetails;
}

export interface OfferLayoutContext {
  projectKey: string;
  compItemId: number;
  offerLayerIndex: number;
  offerLayerId: number;
  layerComment: string;
  sourceItemId: number;
  folderItemId: number;
  folderComment: string;
}

export interface OfferLayoutOption {
  comment: string;
  label: string;
  itemId: number | null;
  current: boolean;
  enabled: boolean;
  disabledSummary?: string;
  disabledReason?: string;
}

export interface OfferLayoutMenuData {
  ok: boolean;
  message: string;
  context: OfferLayoutContext | null;
  options: OfferLayoutOption[];
  disabledSummary?: string;
  disabledReason?: string;
  errors: string[];
}

export interface OfferLayoutChangeRequest {
  context: OfferLayoutContext;
  targetItemId: number;
}

export interface OfferMechanicContext {
  offer: OfferLayoutContext;
  productIndex: number;
  mechanicLayerIndex: number;
  mechanicLayerId: number;
  mechanicLayerComment: string;
  mechanicSourceItemId: number;
  mechanicsFolderItemId: number;
}

export interface OfferMechanicMenuData {
  ok: boolean;
  message: string;
  context: OfferMechanicContext | null;
  options: OfferLayoutOption[];
  disabledSummary?: string;
  disabledReason?: string;
  errors: string[];
}

export interface OfferMechanicChangeRequest {
  context: OfferMechanicContext;
  targetItemId: number;
}

export interface OfferEditorSnapshot {
  ok: boolean;
  message: string;
  compName: string;
  offers: OfferSummary[];
  selectedOfferLayerIndex: number;
  selectedOffer: OfferDetails | null;
  selectedOfferContext?: OfferEditorSelectionContext | null;
  discoveryErrors?: string[];
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
  // Numbered offer slot minus one; inactive slots do not renumber active products.
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
  id?: string;
  label: string;
}

export interface OfferLegalOptionsContext {
  projectKey: string;
  offersCompId: number;
  offerLayerId: number;
  offerLayerIndex: number;
  offerSourceId: number;
  legalLayerId: number;
  legalSourceId: number;
  bannerLayerId: number;
  bannerSourceId: number;
  revision: string;
}

export interface OfferOptionGroup {
  context?: OfferLegalOptionsContext;
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
