import {
  helloArrayStr,
  helloError,
  helloNum,
  helloObj,
  helloStr,
  helloVoid,
} from "../utils/samples";

export { helloArrayStr, helloError, helloNum, helloObj, helloStr, helloVoid };
export { getProjectProductsDirectory } from "./domains/ofertas/projectProductPaths";
export { getProjectIdentity } from "./domains/project/projectIdentity";
export { getProjectRoteiroInfo } from "./domains/roteiro/roteiroPath";
export {
  getProjectWavFootageInfo,
  replaceWavFootage,
  openAudioDialogAndReplace,
} from "./domains/audio/audioFootage";
export { queueActiveCompRenderOutputs } from "./domains/render/renderQueue";
export { prepareAerenderRenderPlan } from "./domains/render/renderQueue";
export type {
  AerenderOutputPlan,
  PrepareAerenderRenderPlanResult,
  QueueActiveCompRenderOutputsResult,
} from "./domains/render/renderQueue";
export {
  getOffersEditorSnapshot,
  getOffersFirstProductInfo,
  openOfferPrecompForEditor,
  replaceOfferProductImage,
  selectOfferForEditor,
  swapOfferProducts,
  updateOfferDescription,
  updateOfferField,
  updateOfferInstallmentJump,
  updateOfferLegalControl,
  updateOfferLegalControlOption,
  updateOfferLegalControlValue,
  updateOfferLegalText,
  updateOfferOption,
  undoOffersEditorAction,
} from "./domains/ofertas/ofertas";
export type {
  OfferDetails,
  OfferEditorActionResult,
  OfferEditorSnapshot,
  OfferFieldFormat,
  OfferMechanic,
  OfferOption,
  OfferOptionGroup,
  OfferOptionGroupType,
  OfferProduct,
  OfferSummary,
  OfferTextField,
} from "./domains/ofertas/ofertas";
export {
  adjustTimelineMarkersToTail,
  openTimelineCompPreview,
} from "./domains/roteiro/markerAdjustment";
export type {
  OpenTimelineCompPreviewResult,
  TimelineMarkerActionResult,
} from "./domains/roteiro/markerAdjustment";

export const helloWorld = () => {
  alert("Hello from After Effects!");
  app.project.activeItem;
};
