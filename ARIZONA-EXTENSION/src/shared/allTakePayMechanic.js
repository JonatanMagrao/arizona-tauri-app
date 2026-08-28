export const ALL_TAKE_PAY_MECHANIC_TYPE = "Todos A Com Leve X Pague Y";
export const LEGACY_ALL_TAKE_PAY_MECHANIC_TYPE = "Todos A Leve X Pague Y";
export const ALL_TAKE_PAY_MECHANIC_NAME_PATTERN =
  "TODOS A (?:COM )?LEVE X PAGUE Y";

export function isAllTakePayMechanicType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === ALL_TAKE_PAY_MECHANIC_TYPE.toLowerCase()
    || normalized === LEGACY_ALL_TAKE_PAY_MECHANIC_TYPE.toLowerCase();
}
