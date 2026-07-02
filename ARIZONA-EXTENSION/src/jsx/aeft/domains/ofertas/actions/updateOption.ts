import type {
  OfferEditorActionResult,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  applyCardInstallmentJump,
  CARD_INSTALLMENT_MECHANIC_TYPE,
} from "../mechanics/parcelamento";
import { applyOptionGroupSelection } from "../mechanics/shared";
import { findOptionGroup, updateOfferProduct } from "./shared";

export const updateOfferOption = (
  offerLayerIndex: number,
  productIndex: number,
  optionGroupId: string,
  selectedIndex: number
): OfferEditorActionResult => {
  return updateOfferProduct(
    offerLayerIndex,
    productIndex,
    "Atualizar opcao",
    (product) => {
      const optionGroup = findOptionGroup(
        product.mechanic.optionGroups,
        optionGroupId
      );

      if (optionGroup === null) {
        throw new Error("Opcao nao encontrada.");
      }

      applyOptionGroupSelection(optionGroup, selectedIndex);
      return optionGroup.label + " atualizada.";
    }
  );
};

export const updateOfferInstallmentJump = (
  offerLayerIndex: number,
  productIndex: number,
  target: OfferInstallmentJumpTarget
): OfferEditorActionResult => {
  return updateOfferProduct(
    offerLayerIndex,
    productIndex,
    "Atualizar jump do parcelamento",
    (product) => {
      if (product.mechanic.type !== CARD_INSTALLMENT_MECHANIC_TYPE) {
        throw new Error("Jump disponivel apenas para parcelamento CRF.");
      }

      applyCardInstallmentJump(product, target);
      return target === "preco-cheio"
        ? "Jump aplicado em Preco Cheio."
        : "Jump aplicado em Preco Parcela.";
    }
  );
};
