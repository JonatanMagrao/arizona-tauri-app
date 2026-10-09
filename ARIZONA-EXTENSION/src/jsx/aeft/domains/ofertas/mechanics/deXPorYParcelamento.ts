import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  applyConfiguredMechanicJump,
  readConfiguredMechanic,
} from "./schemaBindings";

export const DE_X_POR_Y_INSTALLMENT_MECHANIC_TYPE =
  "De X Por Y Parcelamento";

export const readDeXPorYInstallmentMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic =>
  readConfiguredMechanic(
    valueLayer,
    "DE X POR Y PARCELAMENTO",
    errors
  );

export const applyDeXPorYInstallmentJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyConfiguredMechanicJump(
    product,
    target,
    "DE X POR Y PARCELAMENTO"
  );
