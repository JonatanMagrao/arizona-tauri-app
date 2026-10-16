import { mechanicsSchemaLayerRoles } from "../ofertas/mechanics/schemaValidation";
import type { MechanicSchemaId } from "../ofertas/mechanics/schemaValidation";
import { matchTemplatePattern, normalizeTemplateIdentity, type TemplateIdentity } from "./templateIdentityPatterns";

export type OfferLayerIdentity = "offer" | "description" | "mechanic" | "product" | "legal" | "markers";
export interface MechanicTemplateIdentity extends TemplateIdentity {
  sourceNames: string[];
  layers: { [role: string]: string[] };
}
export interface BannerTemplateIdentity {
  layerNames: string[];
  sourceNames: string[];
  layers: { control: TemplateIdentity; background: TemplateIdentity; electro: TemplateIdentity; tire: TemplateIdentity };
}
export interface TemplateIdentities {
  version: 1;
  fallback: { offerLayers: boolean; mechanicLayers: boolean; projectItems: boolean };
  named: { offersComp: string; descriptionText: string };
  offerLayers: { [key in OfferLayerIdentity]: TemplateIdentity };
  projectItems: { offerFolder: TemplateIdentity; mechanicsFolder: TemplateIdentity };
  banners: { eletroPneu: BannerTemplateIdentity };
  layouts: { [comment: string]: TemplateIdentity };
  mechanics: { [family in MechanicSchemaId]: MechanicTemplateIdentity };
}

type PlainObject = { [key: string]: unknown };
const owns = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const fail = (path: string, reason: string): never => { throw new Error("Mapa de identidades invalido em " + path + ": " + reason); };
const objectAt = (raw: unknown, path: string): PlainObject => {
  if (raw === null || typeof raw !== "object" || Object.prototype.toString.call(raw) !== "[object Object]") {
    return fail(path, "esperado um objeto.");
  }
  return raw as PlainObject;
};
const keysOf = (object: object): string[] => {
  const keys: string[] = [];
  for (const key in object) if (owns(object, key)) keys.push(key);
  return keys;
};
const requireKeys = (object: PlainObject, keys: string[], path: string): void => {
  const expected: { [key: string]: boolean } = {};
  for (let index = 0; index < keys.length; index += 1) {
    expected["$" + keys[index]] = true;
    if (!owns(object, keys[index])) fail(path + "." + keys[index], "atributo obrigatorio ausente.");
  }
  for (const key in object) if (owns(object, key) && !owns(expected, "$" + key)) fail(path + "." + key, "atributo inesperado.");
};
const textAt = (raw: unknown, path: string, numbered: boolean): string => {
  if (typeof raw !== "string" || normalizeTemplateIdentity(raw) === "") return fail(path, "esperado um texto nao vazio.");
  if (raw !== raw.replace(/^\s+|\s+$/g, "")) fail(path, "espacos nas extremidades nao sao permitidos.");
  const placeholders = raw.match(/\{nn?\}/g) || [];
  if (/[{}]/.test(raw.replace(/\{nn?\}/g, ""))) fail(path, "placeholder desconhecido; use {n} ou {nn}.");
  if (placeholders.length !== (numbered ? 1 : 0)) fail(path, numbered ? "esperado exatamente um {n} ou {nn}." : "esta identidade nao aceita indice.");
  if (/[0-9]\{nn?\}|\{nn?\}[0-9]/.test(raw)) fail(path, "separe o indice dos demais algarismos com um espaco ou separador.");
  return raw;
};
const aliasesAt = (raw: unknown, path: string, numbered: boolean): string[] => {
  if (Object.prototype.toString.call(raw as object) !== "[object Array]" || (raw as unknown[]).length === 0) {
    return fail(path, "esperada uma lista nao vazia de nomes.");
  }
  const names = raw as unknown[];
  const seen: { [name: string]: boolean } = {};
  for (let index = 0; index < names.length; index += 1) {
    const text = textAt(names[index], path + "[" + index + "]", numbered);
    const key = "$" + normalizeTemplateIdentity(text);
    if (owns(seen, key)) fail(path, "nome duplicado: " + text + ".");
    seen[key] = true;
  }
  return names as string[];
};
const identityAt = (raw: unknown, path: string, numbered: boolean, extra: string[] = []): TemplateIdentity => {
  const object = objectAt(raw, path);
  requireKeys(object, ["comment", "names"].concat(extra), path);
  textAt(object.comment, path + ".comment", numbered);
  aliasesAt(object.names, path + ".names", numbered);
  return raw as TemplateIdentity;
};
// Compare comments separately from names: a legitimate name may equal its own
// comment. Across roles, shared names must fail even if the fallback is disabled.
const rejectCollisions = (identities: { [key: string]: TemplateIdentity }, path: string): void => {
  const comments: { role: string; pattern: string }[] = [];
  const names: { role: string; pattern: string }[] = [];
  const overlaps = (first: string, second: string): boolean => {
    const firstSlot = /\{nn?\}/.test(first);
    const secondSlot = /\{nn?\}/.test(second);
    if (firstSlot && !secondSlot) return matchTemplatePattern(second, first) !== null;
    if (secondSlot && !firstSlot) return matchTemplatePattern(first, second) !== null;
    // Adjacent digits are rejected above. Two delimited slot patterns can
    // overlap only when their literal prefix and suffix are identical.
    return normalizeTemplateIdentity(first.replace(/\{nn?\}/g, "{n}")) ===
      normalizeTemplateIdentity(second.replace(/\{nn?\}/g, "{n}"));
  };
  const add = (known: { role: string; pattern: string }[], pattern: string, role: string, kind: string): void => {
    for (let index = 0; index < known.length; index += 1) {
      if (known[index].role !== role && overlaps(known[index].pattern, pattern)) {
        fail(path + "." + role, kind + " compartilhado com " + known[index].role + ".");
      }
    }
    known.push({ role, pattern });
  };
  for (const role in identities) {
    if (!owns(identities, role)) continue;
    const identity = identities[role];
    add(comments, identity.comment, role, "comentario");
    for (let index = 0; index < identity.names.length; index += 1) {
      add(names, identity.names[index], role, "nome");
    }
  }
};

export const validateTemplateIdentities = (raw: unknown): TemplateIdentities => {
  const map = objectAt(raw, "identities");
  requireKeys(map, ["version", "fallback", "named", "offerLayers", "projectItems", "banners", "layouts", "mechanics"], "identities");
  if (map.version !== 1) fail("version", "apenas a versao 1 e suportada.");
  const fallback = objectAt(map.fallback, "fallback");
  requireKeys(fallback, ["offerLayers", "mechanicLayers", "projectItems"], "fallback");
  for (const key in fallback) if (owns(fallback, key) && typeof fallback[key] !== "boolean") fail("fallback." + key, "esperado true ou false.");
  const named = objectAt(map.named, "named");
  requireKeys(named, ["offersComp", "descriptionText"], "named");
  textAt(named.offersComp, "named.offersComp", false);
  textAt(named.descriptionText, "named.descriptionText", false);
  const layers = objectAt(map.offerLayers, "offerLayers");
  requireKeys(layers, ["offer", "description", "mechanic", "product", "legal", "markers"], "offerLayers");
  for (const key in layers) if (owns(layers, key)) identityAt(layers[key], "offerLayers." + key, key !== "legal" && key !== "markers");
  rejectCollisions(layers as { [key: string]: TemplateIdentity }, "offerLayers");
  const items = objectAt(map.projectItems, "projectItems");
  requireKeys(items, ["offerFolder", "mechanicsFolder"], "projectItems");
  identityAt(items.offerFolder, "projectItems.offerFolder", true);
  identityAt(items.mechanicsFolder, "projectItems.mechanicsFolder", false);
  rejectCollisions(items as { [key: string]: TemplateIdentity }, "projectItems");
  const banners = objectAt(map.banners, "banners");
  requireKeys(banners, ["eletroPneu"], "banners");
  const banner = objectAt(banners.eletroPneu, "banners.eletroPneu");
  requireKeys(banner, ["layerNames", "sourceNames", "layers"], "banners.eletroPneu");
  aliasesAt(banner.layerNames, "banners.eletroPneu.layerNames", false);
  aliasesAt(banner.sourceNames, "banners.eletroPneu.sourceNames", false);
  const bannerLayers = objectAt(banner.layers, "banners.eletroPneu.layers");
  requireKeys(bannerLayers, ["control", "background", "electro", "tire"], "banners.eletroPneu.layers");
  const bannerIdentities: { [role: string]: TemplateIdentity } = {};
  for (const role in bannerLayers) {
    if (!owns(bannerLayers, role)) continue;
    const identity = identityAt(bannerLayers[role], "banners.eletroPneu.layers." + role, false);
    bannerIdentities[role] = { comment: identity.comment, names: [identity.comment].concat(identity.names) };
  }
  rejectCollisions(bannerIdentities, "banners.eletroPneu.layers");
  const layouts = objectAt(map.layouts, "layouts");
  requireKeys(layouts, ["OFERTA REGUA 2 PRODUTOS", "OFERTA REGUA 2 PRODUTOS ELETRO", "OFERTA REGUA 3 PRODUTOS", "OFERTA SIMPLES"], "layouts");
  for (const key in layouts) if (owns(layouts, key)) identityAt(layouts[key], "layouts." + key, false);
  rejectCollisions(layouts as { [key: string]: TemplateIdentity }, "layouts");
  const mechanics = objectAt(map.mechanics, "mechanics");
  const roles = mechanicsSchemaLayerRoles();
  requireKeys(mechanics, keysOf(roles), "mechanics");
  const sources: { [key: string]: TemplateIdentity } = {};
  for (const family in roles) {
    if (!owns(roles, family)) continue;
    const mechanicPath = "mechanics." + family;
    identityAt(mechanics[family], mechanicPath, family === "SIMPLES", ["sourceNames", "layers"]);
    const mechanic = mechanics[family] as unknown as MechanicTemplateIdentity;
    aliasesAt(mechanic.sourceNames, mechanicPath + ".sourceNames", false);
    // Source-family recognition accepts a duplication suffix in code. Literal
    // numbered copies belong in names (the menu), never in sourceNames.
    for (let index = 0; index < mechanic.sourceNames.length; index += 1) {
      if (/\s+[0-9]+$/.test(mechanic.sourceNames[index])) {
        fail(mechanicPath + ".sourceNames", "use o nome da familia sem sufixo numerico; copias numeradas pertencem a names.");
      }
    }
    sources[family] = { comment: family, names: [family].concat(mechanic.sourceNames) };
    const layerMap = objectAt(mechanic.layers, mechanicPath + ".layers");
    requireKeys(layerMap, roles[family], mechanicPath + ".layers");
    const layerIdentities: { [key: string]: TemplateIdentity } = {};
    for (let index = 0; index < roles[family].length; index += 1) {
      const role = roles[family][index];
      layerIdentities[role] = { comment: role, names: aliasesAt(layerMap[role], mechanicPath + ".layers." + role, false) };
    }
    rejectCollisions(layerIdentities, mechanicPath + ".layers");
  }
  rejectCollisions(mechanics as unknown as { [key: string]: TemplateIdentity }, "mechanics");
  rejectCollisions(sources, "mechanics.sourceNames");
  return raw as TemplateIdentities;
};
