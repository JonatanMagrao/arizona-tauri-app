import type { InternalOfferMechanic } from "../types";
import { readConfiguredMechanic } from "./schemaBindings";

export function readAllPercentDiscountMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  return readConfiguredMechanic(
    valueLayer,
    "TODOS A COM X% DESCONTO",
    errors
  );
}
