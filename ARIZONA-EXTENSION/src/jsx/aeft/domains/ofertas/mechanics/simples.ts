import type { InternalOfferMechanic } from "../types";
import { readConfiguredMechanic } from "./schemaBindings";

export function readSimpleMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  return readConfiguredMechanic(
    valueLayer,
    "SIMPLES",
    errors
  );
}

export function readAllTakeXPayYMechanic(
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic {
  return readConfiguredMechanic(
    valueLayer,
    "TODOS A COM LEVE X PAGUE Y",
    errors
  );
}
