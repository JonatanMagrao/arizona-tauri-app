import type { InternalOfferMechanic } from "../types";
import { getLayerSource, nameMatches } from "../layers/findLayers";
import { getTemplateIdentities, matchTemplatePattern, normalizeTemplateIdentity } from "../../template/templateIdentities";
import { withMechanicsSchema } from "./schemaRuntime";
import type { MechanicSchemaId } from "./schemaValidation";
import {
  buildMechanicSourceIdentity,
  type MechanicSourceIdentity,
} from "./mechanicIdentity";
import { readAllPercentDiscountMechanic } from "./descontoPercentual";
import { readCrfCardValueDiscountMechanic } from "./descontoValor";
import { readDeXPorYInstallmentMechanic } from "./deXPorYParcelamento";
import { readDeXPorYDiscountTakePayMechanic } from "./deXPorYDescontoLeveXPagueY";
import { readMeuCrfCardMechanic } from "./meuCrfCartao";
import {
  readAllTakeXPayYMechanic,
  readSimpleMechanic,
} from "./simples";

const MECHANICS: { family: MechanicSchemaId; reader: (layer: Layer, errors: string[]) => InternalOfferMechanic }[] = [
  { family: "SIMPLES", reader: readSimpleMechanic },
  { family: "TODOS A COM X% DESCONTO", reader: readAllPercentDiscountMechanic },
  { family: "DESCONTO R$ CARTAO CRF", reader: readCrfCardValueDiscountMechanic },
  { family: "DE X POR Y PARCELAMENTO", reader: readDeXPorYInstallmentMechanic },
  { family: "DE X POR Y MEU CRF POR Z CARTAO CRF", reader: readMeuCrfCardMechanic },
  { family: "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y", reader: readDeXPorYDiscountTakePayMechanic },
  { family: "TODOS A COM LEVE X PAGUE Y", reader: readAllTakeXPayYMechanic },
];

const matchesFamily = (value: string, name: string): boolean => {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return nameMatches(value, new RegExp("^" + literal + "(?:\\s+\\d+)?$", "i"));
};

const readMechanicByIdentity = (
  identity: string, valueLayer: Layer, errors: string[], byComment: boolean
): InternalOfferMechanic | null => {
  const config = getTemplateIdentities();
  let found = -1;
  for (let index = 0; index < MECHANICS.length; index += 1) {
    const mapped = config.mechanics[MECHANICS[index].family];
    const names = mapped.sourceNames;
    let matches = byComment && (matchesFamily(identity, MECHANICS[index].family) ||
      normalizeTemplateIdentity(identity) === normalizeTemplateIdentity(mapped.comment) ||
      matchTemplatePattern(identity, mapped.comment) !== null);
    for (let ni = 0; ni < names.length; ni += 1) {
      if (matchesFamily(identity, names[ni])) matches = true;
    }
    if (!matches) continue;
    if (found >= 0) throw new Error("Nome de precomp ambíguo entre famílias de mecânicas: " + identity);
    found = index;
  }
  return found < 0 ? null : MECHANICS[found].reader(valueLayer, errors);
};

const describeUnmappedIdentity = (
  identity: MechanicSourceIdentity
): string => {
  const details: string[] = [];

  if (identity.comment !== "") {
    details.push('comment "' + identity.comment + '"');
  }

  if (identity.sourceName !== "") {
    details.push('source "' + identity.sourceName + '"');
  }

  return details.length > 0 ? details.join("; ") : "source sem identificacao";
};

export const readMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => withMechanicsSchema(() => {
  const source = getLayerSource(valueLayer, "identificacao da mecanica", errors);
  const identity = buildMechanicSourceIdentity(
    source === null ? "" : source.comment,
    source === null ? "" : source.name
  );

  try {
    const config = getTemplateIdentities();
    const candidates = config.fallback.projectItems ? identity.candidates : (identity.comment ? [identity.comment] : []);
    for (let index = 0; index < candidates.length; index += 1) {
      const mechanic = readMechanicByIdentity(candidates[index], valueLayer, errors,
        identity.comment !== "" && index === 0);
      if (mechanic !== null) return mechanic;
    }
  } catch (error) {
    errors.push(String(error));
    return {
      type: "Mecânica indisponível", fields: [], optionGroups: [], unsupported: true,
      disabledSummary: "Não foi possível identificar a mecânica pelo mapa do template.",
      disabledReason: String(error),
    };
  }

  return {
    type: "Mecanica nao mapeada: " + describeUnmappedIdentity(identity),
    fields: [],
    optionGroups: [],
    unsupported: true,
  };
});
