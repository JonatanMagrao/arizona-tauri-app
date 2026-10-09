import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  OfferInstallmentJumpTarget,
} from "../types";
import {
  applyConfiguredMechanicJump,
  readConfiguredMechanic,
} from "./schemaBindings";

export const MEU_CRF_CARD_MECHANIC_TYPE =
  "De X Por Y Meu CRF Por Z Cartao CRF";

export const readMeuCrfCardMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic =>
  readConfiguredMechanic(
    valueLayer,
    "DE X POR Y MEU CRF POR Z CARTAO CRF",
    errors
  );

export const applyMeuCrfCardJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget
): void =>
  applyConfiguredMechanicJump(
    product,
    target,
    "DE X POR Y MEU CRF POR Z CARTAO CRF"
  );
