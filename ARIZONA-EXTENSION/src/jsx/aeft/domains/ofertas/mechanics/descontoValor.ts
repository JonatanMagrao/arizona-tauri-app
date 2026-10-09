import type { InternalOfferMechanic } from "../types";
import { readConfiguredMechanic } from "./schemaBindings";

export const readCrfCardValueDiscountMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic =>
  readConfiguredMechanic(
    valueLayer,
    "DESCONTO R$ CARTAO CRF",
    errors
  );
