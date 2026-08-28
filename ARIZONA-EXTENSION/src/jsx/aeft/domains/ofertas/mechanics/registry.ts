import type { InternalOfferMechanic, MechanicReaderMap } from "../types";
import { nameMatches } from "../layers/findLayers";
import { ALL_TAKE_PAY_MECHANIC_NAME_PATTERN } from "../../../../../shared/allTakePayMechanic";
import {
  readCrfCardDePorMechanic,
  readCrfDualMechanic,
  readDePorMechanic,
  readUnitGoesForMechanic,
} from "./dePor";
import {
  readCrfCardDiscountMechanic,
  readCrfPercentDiscountMechanic,
  readCrfSecondUnitDiscountMechanic,
  readAllPercentDiscountMechanic,
  readDiscountXPercentMechanic,
  readPercentDiscountMechanic,
} from "./descontoPercentual";
import { readCrfCardValueDiscountMechanic } from "./descontoValor";
import { readDeXPorYInstallmentMechanic } from "./deXPorYParcelamento";
import { readDeXPorYDiscountTakePayMechanic } from "./deXPorYDescontoLeveXPagueY";
import { readCardInstallmentMechanic } from "./parcelamento";
import {
  readAllTakeXPayYMechanic,
  readLeveXPagueYMechanic,
  readSimpleMechanic,
} from "./simples";

const mechanicNamePattern = (namePattern: string): RegExp =>
  new RegExp("^" + namePattern + "(?:\\s+\\d+)?$", "i");

const MECHANICS: MechanicReaderMap[] = [
  { pattern: mechanicNamePattern("SIMPLES"), reader: readSimpleMechanic },
  { pattern: mechanicNamePattern("DE POR"), reader: readDePorMechanic },
  {
    pattern: mechanicNamePattern("DESCONTO X% CARTAO CRF SEGUNDA UNIDADE"),
    reader: readCrfSecondUnitDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("DESCONTO X% CARTAO CRF"),
    reader: readCrfCardDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("TODOS A COM X% DESCONTO"),
    reader: readAllPercentDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("DESCONTO R\\$ CARTAO CRF"),
    reader: readCrfCardValueDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("DESCONTO X%"),
    reader: readDiscountXPercentMechanic,
  },
  {
    pattern: mechanicNamePattern("DESCONTO X% SEGUNDA UNIDADE"),
    reader: readPercentDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("DE A UNIDADE SAI POR"),
    reader: readUnitGoesForMechanic,
  },
  {
    pattern: mechanicNamePattern("DE POR CARTAO CRF"),
    reader: readCrfCardDePorMechanic,
  },
  {
    pattern: mechanicNamePattern("DE POR PARCELAMENTO CARTAO CRF"),
    reader: readCardInstallmentMechanic,
  },
  {
    pattern: mechanicNamePattern("DE X POR Y PARCELAMENTO"),
    reader: readDeXPorYInstallmentMechanic,
  },
  {
    pattern: mechanicNamePattern(
      "DE X POR Y \\| X% DESCONTO \\| LEVE X PAGUE Y"
    ),
    reader: readDeXPorYDiscountTakePayMechanic,
  },
  {
    pattern: mechanicNamePattern("DESCONTO X% MEU CRF"),
    reader: readCrfPercentDiscountMechanic,
  },
  {
    pattern: mechanicNamePattern("DE POR MEU CRF \\(DUAL\\)"),
    reader: readCrfDualMechanic,
  },
  {
    pattern: mechanicNamePattern("LEVE X PAGUE Y"),
    reader: readLeveXPagueYMechanic,
  },
  {
    pattern: mechanicNamePattern(ALL_TAKE_PAY_MECHANIC_NAME_PATTERN),
    reader: readAllTakeXPayYMechanic,
  },
];

export const readMechanic = (
  valueLayer: Layer,
  errors: string[]
): InternalOfferMechanic => {
  for (let index = 0; index < MECHANICS.length; index += 1) {
    if (nameMatches(valueLayer.name, MECHANICS[index].pattern)) {
      return MECHANICS[index].reader(valueLayer, errors);
    }
  }

  return {
    type: "Mecanica nao mapeada: " + valueLayer.name,
    fields: [],
    optionGroups: [],
    unsupported: true,
  };
};
