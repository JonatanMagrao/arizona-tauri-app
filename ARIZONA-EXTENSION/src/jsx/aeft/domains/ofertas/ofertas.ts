export type {
  OfferDetails,
  OfferEditorActionResult,
  OfferEditorSnapshot,
  OfferFieldFormat,
  OfferImageInfo,
  OfferInstallmentJump,
  OfferInstallmentJumpTarget,
  OfferLegalControl,
  OfferMechanic,
  OfferOption,
  OfferOptionGroup,
  OfferProduct,
  OfferSummary,
  OfferTextField,
} from "./types";

export { getOffersEditorSnapshot } from "./snapshot/buildOfferSnapshot";
export { getOffersFirstProductInfo } from "./snapshot/offerDiscovery";

export {
  openOfferPrecompForEditor,
  selectOfferForEditor,
  undoOffersEditorAction,
} from "./actions/navigation";
export { updateOfferDescription } from "./actions/updateDescription";
export { updateOfferField } from "./actions/updateField";
export {
  updateOfferInstallmentJump,
  updateOfferOption,
} from "./actions/updateOption";
export { replaceOfferProductImage } from "./actions/replaceProductImage";
export { swapOfferSources } from "./actions/swapOfferSources";
export { swapOfferProducts } from "./actions/swapProducts";
export {
  updateOfferLegalControl,
  updateOfferLegalControlOption,
  updateOfferLegalControlValue,
  updateOfferLegalText,
} from "./actions/legalControls";
