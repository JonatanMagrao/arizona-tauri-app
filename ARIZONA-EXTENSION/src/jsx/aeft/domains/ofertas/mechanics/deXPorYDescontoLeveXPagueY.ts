import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  applyConfiguredMechanicJump,
  readConfiguredMechanic,
} from "./schemaBindings";

export const DE_X_POR_Y_DISCOUNT_TAKE_PAY_MECHANIC_TYPE =
  "De X Por Y | X% Desconto | Leve X Pague Y";

export const readDeXPorYDiscountTakePayMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic =>
  readConfiguredMechanic(
    valueLayer,
    "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y",
    errors
  );

export const applySharedMechanicJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyConfiguredMechanicJump(
    product,
    target,
    "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y"
  );
