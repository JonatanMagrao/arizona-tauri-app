// Shared by the build generator and the AE host. Keep this module independent
// of Node, browser APIs and ExtendScript objects.
export interface SchemaOption {
  index: number;
  label: string;
}

export interface MechanicEffectSchema {
  index: number;
  name: string;
  layer: string;
  options?: SchemaOption[];
}

export interface MechanicSchema {
  layers: { [role: string]: string };
  effects: { [effectId: string]: MechanicEffectSchema };
}

export type MechanicSchemaId =
  | "SIMPLES"
  | "TODOS A COM LEVE X PAGUE Y"
  | "TODOS A COM X% DESCONTO"
  | "DESCONTO R$ CARTAO CRF"
  | "DE X POR Y PARCELAMENTO"
  | "DE X POR Y MEU CRF POR Z CARTAO CRF"
  | "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y";

export interface MechanicsSchema {
  version: 1;
  "SIMPLES": MechanicSchema;
  "TODOS A COM LEVE X PAGUE Y": MechanicSchema;
  "TODOS A COM X% DESCONTO": MechanicSchema;
  "DESCONTO R$ CARTAO CRF": MechanicSchema;
  "DE X POR Y PARCELAMENTO": MechanicSchema;
  "DE X POR Y MEU CRF POR Z CARTAO CRF": MechanicSchema;
  "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y": MechanicSchema;
}

interface MechanicContract {
  id: MechanicSchemaId;
  layers: string[];
  // Zero means a numeric control, which must not have dropdown options.
  effects: { [effectId: string]: number };
}

const CONTRACTS: MechanicContract[] = [
  { id: "SIMPLES", layers: ["preco", "controlador"], effects: { unit: 4 } },
  { id: "TODOS A COM LEVE X PAGUE Y", layers: ["controlador", "leve-x", "pague-y"], effects: { subtype: 3 } },
  { id: "TODOS A COM X% DESCONTO", layers: ["controlador", "por-centagem-desconto"], effects: { mechanicType: 3, mechanicSubtype: 3 } },
  { id: "DESCONTO R$ CARTAO CRF", layers: ["desconto-reais"], effects: {} },
  {
    id: "DE X POR Y PARCELAMENTO",
    layers: ["marcadores", "pulo-preco-cheio", "pulo-parcela", "controlador", "preco-de", "preco", "preco-parcela", "numero-de-parcelas"],
    effects: { mechanicCondition: 7 },
  },
  {
    id: "DE X POR Y MEU CRF POR Z CARTAO CRF",
    layers: ["controlador", "marcadores", "pulo-preco-meu-crf", "pulo-preco-meu-cartao-crf", "preco-de", "preco-por", "preco-por-cartao"],
    effects: { unit: 4 },
  },
  {
    id: "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y",
    layers: ["marcadores", "pulo-preco-cheio", "pulo", "controlador", "preco-de", "preco-por", "por-centagem-desconto"],
    effects: { mechanicType: 5, mechanicSubtype: 3, unit: 4, "quantidade-x": 0 },
  },
];

type SchemaObject = { [key: string]: unknown };

function owns(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, reason: string): never {
  throw new Error("Schema de mecanicas invalido em " + path + ": " + reason);
}

function isArray(value: unknown): value is unknown[] {
  if (typeof value !== "object" || value === null) return false;
  return Object.prototype.toString.call(value) === "[object Array]";
}

function objectAt(value: unknown, path: string): SchemaObject {
  if (typeof value !== "object" || value === null || Object.prototype.toString.call(value) !== "[object Object]") {
    return fail(path, "esperado um objeto.");
  }
  return value as SchemaObject;
}

function hasString(values: string[], value: string): boolean {
  for (let index = 0; index < values.length; index++) {
    if (values[index] === value) return true;
  }
  return false;
}

function ownKeys(value: SchemaObject): string[] {
  const keys: string[] = [];
  for (const key in value) {
    if (owns(value, key)) keys.push(key);
  }
  return keys;
}

function requireKeys(value: SchemaObject, expected: string[], path: string): void {
  for (const key in value) {
    if (owns(value, key) && !hasString(expected, key)) {
      fail(path + "." + key, "atributo inesperado.");
    }
  }
  for (let index = 0; index < expected.length; index++) {
    if (!owns(value, expected[index])) fail(path + "." + expected[index], "atributo obrigatorio ausente.");
  }
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.replace(/^\s+|\s+$/g, "") === "") {
    return fail(path, "esperado um texto nao vazio.");
  }
  return value;
}

function requireIndex(value: unknown, path: string): number {
  if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 9007199254740991 || Math.floor(value) !== value) {
    return fail(path, "esperado um indice inteiro positivo.");
  }
  return value;
}

function rejectNulls(value: unknown, path: string, depth: number): void {
  if (value === null) fail(path, "null nao e permitido.");
  if (depth > 100) fail(path, "estrutura excessivamente profunda ou circular.");
  if (typeof value !== "object" || !value) return;
  if (isArray(value)) {
    for (let index = 0; index < value.length; index++) rejectNulls(value[index], path + "[" + index + "]", depth + 1);
    return;
  }
  const object = value as SchemaObject;
  for (const key in object) {
    if (owns(object, key)) rejectNulls(object[key], path + "." + key, depth + 1);
  }
}

function effectIsNamed(mechanicId: MechanicSchemaId, effectId: string): boolean {
  // These existing controls are located by exact effect name. Their configured
  // indices are recorded metadata, not a change to their lookup strategy.
  return (mechanicId === "DE X POR Y PARCELAMENTO" && effectId === "mechanicCondition") ||
    (mechanicId === "DE X POR Y MEU CRF POR Z CARTAO CRF" && effectId === "unit");
}

function validateMechanic(raw: unknown, contract: MechanicContract): void {
  const path = "schema." + contract.id;
  const mechanic = objectAt(raw, path);
  requireKeys(mechanic, ["layers", "effects"], path);
  const layers = objectAt(mechanic.layers, path + ".layers");
  requireKeys(layers, contract.layers, path + ".layers");
  const comments: { [normalized: string]: string } = {};
  for (let index = 0; index < contract.layers.length; index++) {
    const role = contract.layers[index];
    const comment = requireText(layers[role], path + ".layers." + role);
    const normalized = "$" + comment.replace(/^\s+|\s+$/g, "").toUpperCase();
    if (owns(comments, normalized)) fail(path + ".layers." + role, "comentario duplicado com a camada " + comments[normalized] + ".");
    comments[normalized] = role;
  }

  const effects = objectAt(mechanic.effects, path + ".effects");
  const effectIds = ownKeys(contract.effects);
  requireKeys(effects, effectIds, path + ".effects");
  const positions: { [position: string]: string } = {};
  for (let index = 0; index < effectIds.length; index++) {
    const effectId = effectIds[index];
    const effectPath = path + ".effects." + effectId;
    const effect = objectAt(effects[effectId], effectPath);
    const expectedOptionCount = contract.effects[effectId];
    requireKeys(effect, expectedOptionCount ? ["index", "name", "layer", "options"] : ["index", "name", "layer"], effectPath);
    const effectIndex = requireIndex(effect.index, effectPath + ".index");
    requireText(effect.name, effectPath + ".name");
    const layerRole = requireText(effect.layer, effectPath + ".layer");
    if (!owns(layers, layerRole)) fail(effectPath + ".layer", "referencia de camada inexistente.");
    if (!effectIsNamed(contract.id, effectId)) {
      const position = "$" + layerRole + ":" + effectIndex;
      if (owns(positions, position)) fail(effectPath + ".index", "indice compartilhado com o efeito " + positions[position] + " na mesma camada.");
      positions[position] = effectId;
    }
    if (!expectedOptionCount) continue;
    if (!isArray(effect.options) || effect.options.length !== expectedOptionCount) {
      fail(effectPath + ".options", "esperadas " + expectedOptionCount + " opcoes.");
    }
    const options = effect.options as unknown[];
    const optionIndices: { [index: string]: boolean } = {};
    for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
      const optionPath = effectPath + ".options[" + optionIndex + "]";
      const option = objectAt(options[optionIndex], optionPath);
      requireKeys(option, ["index", "label"], optionPath);
      const aeIndex = requireIndex(option.index, optionPath + ".index");
      requireText(option.label, optionPath + ".label");
      const key = "$" + aeIndex;
      if (owns(optionIndices, key)) fail(optionPath + ".index", "indice de opcao duplicado.");
      optionIndices[key] = true;
    }
  }
}

export function validateMechanicsSchema(raw: unknown): MechanicsSchema {
  rejectNulls(raw, "schema", 0);
  const schema = objectAt(raw, "schema");
  const keys = ["version"];
  for (let index = 0; index < CONTRACTS.length; index++) keys.push(CONTRACTS[index].id);
  requireKeys(schema, keys, "schema");
  if (schema.version !== 1) fail("schema.version", "apenas a versao 1 e suportada.");
  for (let index = 0; index < CONTRACTS.length; index++) {
    const contract = CONTRACTS[index];
    validateMechanic(schema[contract.id], contract);
  }
  return raw as MechanicsSchema;
}
