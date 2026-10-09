// Applies only to layers inside an offer precomp. Mechanic internals have their
// own independent fallback setting in mechanics/config.ts.
// false: locate the numbered product sets and offer structure by comment only.
// true: also allow the exact role name when no matching comment exists.
// Rebuild/reload the CEP after changing this setting.
export const OFFER_LAYER_NAME_FALLBACK_ENABLED = false;
