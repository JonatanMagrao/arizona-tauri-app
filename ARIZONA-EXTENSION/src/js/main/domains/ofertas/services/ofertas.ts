import { evalTS } from "../../../../lib/utils/bolt";
import type {
  OfferEditorActionResult,
  OfferEditorSnapshot,
  OfferInstallmentJumpTarget,
} from "../types";

const assertCep = () => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects.");
  }
};

export const loadOffersEditorSnapshot = (offerLayerIndex?: number) => {
  assertCep();

  return evalTS(
    "getOffersEditorSnapshot",
    offerLayerIndex
  ) as Promise<OfferEditorSnapshot>;
};

export const selectOfferForEditor = (offerLayerIndex: number) => {
  assertCep();

  return evalTS(
    "selectOfferForEditor",
    offerLayerIndex
  ) as Promise<OfferEditorActionResult>;
};

export const openOfferPrecompForEditor = (offerLayerIndex: number) => {
  assertCep();

  return evalTS(
    "openOfferPrecompForEditor",
    offerLayerIndex
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferDescription = (
  offerLayerIndex: number,
  productIndex: number,
  value: string
) => {
  assertCep();

  return evalTS(
    "updateOfferDescription",
    offerLayerIndex,
    productIndex,
    value
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferDescriptionExpression = (
  offerLayerIndex: number,
  productIndex: number,
  enabled: boolean
) => {
  assertCep();

  return evalTS(
    "updateOfferDescriptionExpression",
    offerLayerIndex,
    productIndex,
    enabled
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferField = (
  offerLayerIndex: number,
  productIndex: number,
  fieldId: string,
  value: string,
  fieldIndex?: number
) => {
  assertCep();

  return evalTS(
    "updateOfferField",
    offerLayerIndex,
    productIndex,
    fieldId,
    value,
    fieldIndex
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferOption = (
  offerLayerIndex: number,
  productIndex: number,
  optionGroupId: string,
  selectedIndex: number
) => {
  assertCep();

  return evalTS(
    "updateOfferOption",
    offerLayerIndex,
    productIndex,
    optionGroupId,
    selectedIndex
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferInstallmentJump = (
  offerLayerIndex: number,
  productIndex: number,
  target: OfferInstallmentJumpTarget
) => {
  assertCep();

  return evalTS(
    "updateOfferInstallmentJump",
    offerLayerIndex,
    productIndex,
    target
  ) as Promise<OfferEditorActionResult>;
};

export const swapOfferProducts = (
  offerLayerIndex: number,
  sourceProductIndex: number,
  targetProductIndex: number,
  openOfferPrecomp: boolean
) => {
  assertCep();

  return evalTS(
    "swapOfferProducts",
    offerLayerIndex,
    sourceProductIndex,
    targetProductIndex,
    openOfferPrecomp
  ) as Promise<OfferEditorActionResult>;
};

export const swapOfferSources = (
  sourceOfferLayerIndex: number,
  targetOfferLayerIndex: number
) => {
  assertCep();

  return evalTS(
    "swapOfferSources",
    sourceOfferLayerIndex,
    targetOfferLayerIndex
  ) as Promise<OfferEditorActionResult>;
};

export const replaceOfferProductImage = (
  offerLayerIndex: number,
  productIndex: number,
  filePath: string,
  openOfferPrecomp: boolean
) => {
  assertCep();

  return evalTS(
    "replaceOfferProductImage",
    offerLayerIndex,
    productIndex,
    filePath,
    openOfferPrecomp
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferLegalText = (
  offerLayerIndex: number,
  value: string
) => {
  assertCep();

  return evalTS(
    "updateOfferLegalText",
    offerLayerIndex,
    value
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferLegalControl = (
  offerLayerIndex: number,
  controlId: string,
  enabled: boolean
) => {
  assertCep();

  return evalTS(
    "updateOfferLegalControl",
    offerLayerIndex,
    controlId,
    enabled
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferLegalControlValue = (
  offerLayerIndex: number,
  controlId: string,
  value: string
) => {
  assertCep();

  return evalTS(
    "updateOfferLegalControlValue",
    offerLayerIndex,
    controlId,
    value
  ) as Promise<OfferEditorActionResult>;
};

export const updateOfferLegalControlOption = (
  offerLayerIndex: number,
  controlId: string,
  selectedIndex: number
) => {
  assertCep();

  return evalTS(
    "updateOfferLegalControlOption",
    offerLayerIndex,
    controlId,
    selectedIndex
  ) as Promise<OfferEditorActionResult>;
};

export const undoOffersEditorAction = () => {
  assertCep();

  return evalTS("undoOffersEditorAction") as Promise<OfferEditorActionResult>;
};
