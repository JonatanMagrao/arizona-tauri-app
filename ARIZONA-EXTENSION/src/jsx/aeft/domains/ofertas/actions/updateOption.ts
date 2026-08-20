import type {
  OfferEditorActionResult,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  applyCardInstallmentJump,
  CARD_INSTALLMENT_MECHANIC_TYPE,
} from "../mechanics/parcelamento";
import {
  applyDeXPorYInstallmentJump,
  DE_X_POR_Y_INSTALLMENT_MECHANIC_TYPE,
} from "../mechanics/deXPorYParcelamento";
import {
  applySharedMechanicJump,
  DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE,
} from "../mechanics/deXPorYDescontoLeveXPagueY";
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
      if (product.mechanic.type === CARD_INSTALLMENT_MECHANIC_TYPE) {
        applyCardInstallmentJump(product, target);
      } else if (
        product.mechanic.type === DE_X_POR_Y_INSTALLMENT_MECHANIC_TYPE
      ) {
        applyDeXPorYInstallmentJump(product, target);
      } else if (
        product.mechanic.type ===
        DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE
      ) {
        applySharedMechanicJump(product, target);
      } else {
        throw new Error("Jump disponivel apenas para parcelamento.");
      }

      return target === "preco-cheio"
        ? "Jump aplicado em Preco Cheio."
        : product.mechanic.type ===
            DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE
          ? "Jump aplicado em Preco."
          : "Jump aplicado em Preco Parcela.";
    }
  );
};
