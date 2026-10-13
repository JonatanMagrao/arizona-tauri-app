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
export { configureMechanicsSchemaPath } from "./domains/ofertas/mechanics/schemaRuntime";
export { openProject } from "./domains/project/openProject";
export type { OpenProjectResult } from "./domains/project/openProject";
export { getProjectRoteiroInfo } from "./domains/roteiro/roteiroPath";
export {
  getProjectWavFootageInfo,
  replaceWavFootage,
  openAudioDialogAndReplace,
} from "./domains/audio/audioFootage";
export { queueActiveCompRenderOutputs } from "./domains/render/renderQueue";
export type {
  QueueActiveCompRenderOutputsResult,
} from "./domains/render/renderQueue";
export {
  getOffersEditorSnapshot,
  getOffersFirstProductInfo,
  getOfferLayoutOptions,
  openOfferPrecompForEditor,
  replaceOfferProductImage,
  replaceOfferLayout,
  selectOfferForEditor,
  swapOfferSources,
  swapOfferProducts,
  updateOfferDescription,
  updateOfferDescriptionExpression,
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
  OfferLayoutChangeRequest,
  OfferLayoutContext,
  OfferLayoutMenuData,
  OfferLayoutOption,
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
