import type {
  InternalOfferMechanic,
  InternalOfferProduct,
  InternalTextField,
  OfferFieldFormat,
  OfferInstallmentJumpTarget,
  OfferOption,
  OfferOptionGroupPlacement,
} from "../types";
import { ALL_TAKE_PAY_MECHANIC_TYPE } from "../../../../../shared/allTakePayMechanic";
import {
  addError,
  findPropertyDeep,
  getLayerSource,
  isNumericValueProperty,
} from "../layers/findLayers";
import {
  findLayerByIdentity,
  type LayerIdentityDiagnostic,
} from "../layers/findLayerByIdentity";
import { getSourceTextProperty, readText } from "../layers/textFields";
import {
  applyInstallmentJump,
  type InstallmentJumpDefinition,
  readInstallmentJump,
} from "./parcelamento";
import {
  getEffectControlValueProperty,
  makeControllerOptionGroup,
  makeValueField,
} from "./shared";
import { getMechanicsSchema, withMechanicsSchema } from "./schemaRuntime";
import {
  type MechanicEffectSchema,
  type MechanicSchema,
  type MechanicSchemaId,
} from "./schemaValidation";

interface FieldDefinition {
  id: string;
  label: string;
  format: OfferFieldFormat;
  effect?: string;
}

interface EffectDefinition {
  id: string;
  label: string;
  lookup: "index" | "name" | "dropdown-name";
  placement?: OfferOptionGroupPlacement;
  field?: boolean;
}

interface MechanicDefinition {
  type: string;
  fields: FieldDefinition[];
  effects: EffectDefinition[];
  jump?: { marker: string; fullPrice: string; installmentPrice: string };
}

// IDs, labels used by Roteiro, field formats, option positions used by the UI,
// effect lookup strategies and jump behavior are code contracts. The JSON owns
// comments, effect bindings, option labels and the values written to After.
const DEFINITIONS: { [name: string]: MechanicDefinition } = {
  "SIMPLES": {
    type: "Simples",
    fields: [{ id: "preco", label: "Preco", format: "price" }],
    effects: [{ id: "unit", label: "Unidade", lookup: "index" }],
  },
  "TODOS A COM LEVE X PAGUE Y": {
    type: ALL_TAKE_PAY_MECHANIC_TYPE,
    fields: [
      { id: "leve-x", label: "Leve X", format: "integer" },
      { id: "pague-y", label: "Pague Y", format: "integer" },
    ],
    effects: [{ id: "subtype", label: "Subtipo", lookup: "index" }],
  },
  "TODOS A COM X% DESCONTO": {
    type: "Todos A Com X% Desconto",
    fields: [{ id: "por-centagem-desconto", label: "Desconto", format: "percent" }],
    effects: [
      { id: "mechanicType", label: "Tipo", lookup: "index" },
      { id: "mechanicSubtype", label: "Subtipo", lookup: "index" },
    ],
  },
  "DESCONTO R$ CARTAO CRF": {
    type: "Desconto R$ Cartao CRF",
    fields: [{ id: "desconto-reais", label: "Desconto", format: "price" }],
    effects: [],
  },
  "DE X POR Y PARCELAMENTO": {
    type: "De X Por Y Parcelamento",
    fields: [
      { id: "preco-de", label: "De", format: "price" },
      { id: "preco", label: "Preco", format: "price" },
      { id: "preco-parcela", label: "Parcela", format: "price" },
      { id: "numero-de-parcelas", label: "Parcelas", format: "integer" },
    ],
    effects: [{ id: "mechanicCondition", label: "Mecânica", lookup: "name", placement: "header" }],
    jump: { marker: "marcadores", fullPrice: "pulo-preco-cheio", installmentPrice: "pulo-parcela" },
  },
  "DE X POR Y MEU CRF POR Z CARTAO CRF": {
    type: "De X Por Y Meu CRF Por Z Cartao CRF",
    fields: [
      { id: "preco-de", label: "De", format: "price" },
      { id: "preco-por", label: "Por", format: "price" },
      { id: "preco-por-cartao", label: "Por cartão", format: "price" },
    ],
    effects: [{ id: "unit", label: "Unidade", lookup: "dropdown-name" }],
    jump: { marker: "marcadores", fullPrice: "pulo-preco-meu-crf", installmentPrice: "pulo-preco-meu-cartao-crf" },
  },
  "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y": {
    type: "De X Por Y | X% Desconto | Leve X Pague Y",
    fields: [
      { id: "preco-de", label: "Preco De", format: "price" },
      { id: "preco-por", label: "Preco Por", format: "price" },
      { id: "quantidade-x", label: "Quantidade X", format: "integer", effect: "quantidade-x" },
      { id: "por-centagem-desconto", label: "Desconto", format: "percent" },
    ],
    effects: [
      { id: "mechanicType", label: "Tipo", lookup: "index", placement: "header" },
      { id: "mechanicSubtype", label: "Subtipo", lookup: "index" },
      { id: "unit", label: "Unidade", lookup: "index" },
      { id: "quantidade-x", label: "Quantidade X", lookup: "index", field: true },
    ],
    jump: { marker: "marcadores", fullPrice: "pulo-preco-cheio", installmentPrice: "pulo" },
  },
};

const getMechanicSchema = (name: MechanicSchemaId): MechanicSchema =>
  getMechanicsSchema()[name];

const fallbackNames = (role: string, comment: string): string[] => {
  const names = [comment];
  // Keep the previously supported template spellings as explicit aliases.
  if (role === "controlador") {
    names.push("Controlador de Mecânica", "CONTROLADOR DE MECANICA");
  } else if (role === "pulo-preco-cheio") {
    names.push("PULO PREÇO CHEIO", "PULO PRECO CHEIO");
  } else if (role === "pulo-preco-meu-crf") {
    names.push("PULO PREÇO MEU CRF", "PULO PRECO MEU CRF");
  } else if (role === "pulo-preco-meu-cartao-crf") {
    names.push("PULO PREÇO CARTAO CRF", "PULO PRECO MEU CARTAO CRF");
  }
  return names;
};

const getJumpDefinition = (
  definition: MechanicDefinition,
  config: MechanicSchema
): InstallmentJumpDefinition => {
  if (!definition.jump) throw new Error("Mecânica sem jump.");
  const identity = (role: string) => ({
    comment: config.layers[role],
    fallbackNames: fallbackNames(role, config.layers[role]),
  });
  return {
    context: definition.type,
    layerIdentities: {
      marker: identity(definition.jump.marker),
      fullPrice: identity(definition.jump.fullPrice),
      installmentPrice: identity(definition.jump.installmentPrice),
    },
  };
};

const getNamedEffectProperty = (
  controller: Layer | null,
  config: MechanicEffectSchema,
  dropdownRequired: boolean,
  context: string,
  errors: string[],
  diagnostic: LayerIdentityDiagnostic
): Property | null => {
  if (controller === null) return null;
  let effects: PropertyGroup | null = null;
  try {
    effects = controller.property("ADBE Effect Parade") as PropertyGroup;
  } catch (error) {
  }
  if (effects === null) {
    diagnostic.disabledSummary = "A camada de controle não possui efeitos disponíveis.";
    diagnostic.disabledReason = 'Confira o efeito "' + config.name +
      '" na camada "' + controller.name + '": ela não possui efeitos.';
    addError(errors, "A controladora de " + context + " não possui efeitos.");
    return null;
  }
  if (!dropdownRequired) {
    // Parcelamento retains the exact-name API and its existing property rule.
    let effect: PropertyBase | null = null;
    try {
      effect = effects.property(config.name) as PropertyBase;
    } catch (error) {
    }
    const property = effect === null ? null : findPropertyDeep(effect, isNumericValueProperty);
    if (property === null) {
      diagnostic.disabledSummary = effect === null
        ? "O efeito obrigatório não foi encontrado."
        : "O valor numérico do efeito está indisponível.";
      diagnostic.disabledReason = 'Confira o efeito "' + config.name +
        '" e seu valor numérico na camada "' + controller.name + '".';
      addError(errors, 'Não encontrei o valor do controle "' + config.name + '" em ' + context + ".");
    }
    return property;
  }
  let found: Property | null = null;
  for (let index = 1; index <= effects.numProperties; index += 1) {
    const effect = effects.property(index);
    if (effect === null || effect.name !== config.name) continue;
    const property = findPropertyDeep(
      effect,
      (candidate) => isNumericValueProperty(candidate) && candidate.isDropdownEffect === true
    );
    if (property === null) continue;
    if (found !== null) {
      diagnostic.disabledSummary = "Mais de um dropdown corresponde ao controle esperado.";
      diagnostic.disabledReason = 'Controle duplicado. Deixe apenas um dropdown "' +
        config.name + '" na camada "' + controller.name + '".';
      addError(errors, 'Encontrei mais de um dropdown "' + config.name + '" na controladora de ' + context + ".");
      return null;
    }
    found = property;
  }
  if (found === null) {
    diagnostic.disabledSummary = "O dropdown esperado está ausente ou inválido.";
    diagnostic.disabledReason = 'Adicione ou corrija o dropdown "' + config.name +
      '" na camada "' + controller.name + '".';
    addError(errors, 'Não encontrei o dropdown "' + config.name + '" na controladora de ' + context + ".");
  }
  return found;
};

export const readConfiguredMechanic = (
  valueLayer: Layer,
  name: MechanicSchemaId,
  errors: string[]
): InternalOfferMechanic => withMechanicsSchema(() => {
  const definition = DEFINITIONS[name];
  let config: MechanicSchema;
  try {
    config = getMechanicSchema(name);
  } catch (error) {
    addError(errors, String(error));
    return {
      type: definition.type, fields: [], optionGroups: [], unsupported: true,
      disabledSummary: "Não foi possível ler a configuração da mecânica.",
      disabledReason: "Confira os detalhes do erro ao carregar a mecânica.",
    };
  }
  const source = getLayerSource(valueLayer, definition.type, errors);
  const layerCache: { [role: string]: Layer | null } = {};
  const layerDiagnostics: { [role: string]: LayerIdentityDiagnostic } = {};
  const findLayer = (role: string): Layer | null => {
    if (!layerCache.hasOwnProperty(role)) {
      layerDiagnostics[role] = {};
      layerCache[role] = findLayerByIdentity(source, {
        comment: config.layers[role],
        fallbackNames: fallbackNames(role, config.layers[role]),
        context: definition.type,
        layerLabel: role === "controlador" ? "Controlador de Mecânica" : config.layers[role],
      }, errors, layerDiagnostics[role]);
    }
    return layerCache[role];
  };
  const properties: { [id: string]: Property | null } = {};
  const propertyReasons: { [id: string]: string | undefined } = {};
  const propertySummaries: { [id: string]: string | undefined } = {};
  const mechanic: InternalOfferMechanic = { type: definition.type, fields: [], optionGroups: [] };
  for (let index = 0; index < definition.effects.length; index += 1) {
    const effectDefinition = definition.effects[index];
    const effectConfig = config.effects[effectDefinition.id];
    const controller = findLayer(effectConfig.layer);
    const diagnostic: LayerIdentityDiagnostic = {};
    const property = effectDefinition.lookup === "index"
      ? getEffectControlValueProperty(controller, effectConfig.index, effectDefinition.label, definition.type, errors)
      : getNamedEffectProperty(controller, effectConfig, effectDefinition.lookup === "dropdown-name", definition.type, errors, diagnostic);
    properties[effectDefinition.id] = property;
    if (property === null) {
      propertySummaries[effectDefinition.id] = controller === null
        ? layerDiagnostics[effectConfig.layer].disabledSummary
        : diagnostic.disabledSummary || "O controle esperado está ausente ou sem um valor numérico válido.";
      propertyReasons[effectDefinition.id] = controller === null
        ? layerDiagnostics[effectConfig.layer].disabledReason
        : diagnostic.disabledReason || 'Confira o controle "' + effectDefinition.label +
          '" na posição ' + effectConfig.index + ' dos efeitos da camada "' + controller.name + '".';
    }
    if (effectDefinition.field) continue;
    const options: OfferOption[] = [];
    const values: number[] = [];
    // Validation requires options on selection controls, never on Quantidade X.
    const configuredOptions = effectConfig.options!;
    for (let oi = 0; oi < configuredOptions.length; oi += 1) {
      options.push({ label: configuredOptions[oi].label });
      values.push(configuredOptions[oi].index);
    }
    const optionGroup = makeControllerOptionGroup(
      effectDefinition.id, effectDefinition.label, property, options,
      effectDefinition.placement || "controls", values
    );
    if (!optionGroup.enabled) {
      optionGroup.disabledReason = propertyReasons[effectDefinition.id];
      optionGroup.disabledSummary = propertySummaries[effectDefinition.id];
    }
    mechanic.optionGroups.push(optionGroup);
  }
  for (let index = 0; index < definition.fields.length; index += 1) {
    const field = definition.fields[index];
    let result: InternalTextField;
    if (field.effect) {
      result = makeValueField(field.id, field.label, field.format, properties[field.effect]);
      if (!result.enabled) {
        result.disabledReason = propertyReasons[field.effect];
        result.disabledSummary = propertySummaries[field.effect];
      }
    } else {
      const layer = findLayer(field.id);
      const property = getSourceTextProperty(layer);
      if (layer !== null && property === null) {
        addError(errors, 'A camada identificada por "' + config.layers[field.id] + '" em ' + definition.type + " não possui Source Text.");
      }
      result = {
        id: field.id, label: field.label, value: readText(property),
        format: field.format, enabled: property !== null, property, valueKind: "text",
      };
      if (!result.enabled) {
        result.disabledSummary = layer === null
          ? layerDiagnostics[field.id].disabledSummary
          : "O texto da camada está indisponível.";
        result.disabledReason = layer === null
          ? layerDiagnostics[field.id].disabledReason
          : 'A camada com o comentário "' + config.layers[field.id] +
            '" precisa ser uma camada de texto com Source Text.';
      }
    }
    mechanic.fields.push(result);
  }
  if (definition.jump) {
    mechanic.installmentJump = readInstallmentJump(source, getJumpDefinition(definition, config), errors);
  }
  return mechanic;
});

export const applyConfiguredMechanicJump = (
  product: InternalOfferProduct,
  target: OfferInstallmentJumpTarget,
  name: MechanicSchemaId
): void => withMechanicsSchema(() => {
  const definition = DEFINITIONS[name];
  const config = getMechanicSchema(name);
  applyInstallmentJump(product, target, getJumpDefinition(definition, config));
});
