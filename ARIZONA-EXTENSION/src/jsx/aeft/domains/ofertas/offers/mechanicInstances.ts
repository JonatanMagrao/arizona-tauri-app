import { isTemplateOfferLayerComment, isTemplateProjectItemComment, resolveTemplateIdentity } from "../../project/resolveTemplateIdentity";
import { expandTemplateIdentity, getTemplateIdentities, normalizeTemplateIdentity } from "../../template/templateIdentities";
import type { MechanicSchemaId } from "../mechanics/schemaValidation";
import { compReferenceKey, layerReferenceKey, readProjectReferenceIndex, type ProjectReferenceIndex } from "./projectReferenceIndex";

export interface MechanicPool { matches: CompItem[]; ambiguous: boolean; }
export interface MechanicSourceChange { layer: AVLayer; source: CompItem; name: string; target: CompItem; }

const suffixOf = (value: string, bases: string[]): number | null => {
  const normalized = normalizeTemplateIdentity(value);
  for (let index = 0; index < bases.length; index += 1) {
    const literal = normalizeTemplateIdentity(bases[index]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp("^" + literal + " ([1-9][0-9]*)$").exec(normalized);
    if (match) return Number(match[1]);
  }
  return null;
};

// A numbered instance is still one family. Duplicate canonical identities stay
// ambiguous; generated copies have distinct numeric comments and names.
export const resolveMechanicPool = (comps: CompItem[], family: MechanicSchemaId, productIndex: number): MechanicPool => {
  const config = getTemplateIdentities();
  const definition = config.mechanics[family];
  const identity = expandTemplateIdentity(definition, productIndex + 1);
  const base = resolveTemplateIdentity(comps, identity, config.fallback.projectItems, isTemplateProjectItemComment).matches;
  if (family === "SIMPLES") return { matches: base, ambiguous: base.length > 1 };
  const numbered: { [key: string]: CompItem[] } = {};
  const baseNames = [identity.comment, family].concat(definition.sourceNames);
  for (let index = 0; index < comps.length; index += 1) {
    const comp = comps[index];
    let isBase = false;
    for (let bi = 0; bi < base.length; bi += 1) if (base[bi] === comp) isBase = true;
    if (isBase) continue;
    let suffix: number | null = null;
    try {
      const comment = normalizeTemplateIdentity(comp.comment);
      suffix = suffixOf(comment, baseNames);
      if (suffix === null && config.fallback.projectItems && !isTemplateProjectItemComment(comment)) {
        suffix = suffixOf(comp.name, baseNames);
      }
    } catch (error) { continue; }
    if (suffix === null) continue;
    const key = "$" + suffix;
    if (!numbered[key]) numbered[key] = [];
    numbered[key].push(comp);
  }
  const matches = base.slice(0);
  const identifiers: { [key: string]: boolean } = {};
  let ambiguous = false;
  for (let index = 0; index < base.length; index += 1) {
    // Existing templates may tag several numbered precomps with the same
    // family comment. Their recognized numeric names distinguish instances.
    const suffix = suffixOf(base[index].name, baseNames);
    const key = "$" + (suffix === null ? 0 : suffix);
    if (identifiers[key]) ambiguous = true;
    identifiers[key] = true;
  }
  for (const key in numbered) {
    if (!Object.prototype.hasOwnProperty.call(numbered, key)) continue;
    if (numbered[key].length !== 1 || identifiers[key]) ambiguous = true;
    for (let index = 0; index < numbered[key].length; index += 1) matches.push(numbered[key][index]);
  }
  matches.sort((left, right) => left.id - right.id);
  return { matches, ambiguous };
};

export const includeCurrentLayout = (layouts: CompItem[], current: CompItem): CompItem[] => {
  const result = layouts.slice(0);
  for (let index = 0; index < result.length; index += 1) if (result[index] === current) return result;
  result.push(current);
  return result;
};

export const findProductMechanicLayers = (layouts: CompItem[], productIndex: number): AVLayer[] => {
  const config = getTemplateIdentities();
  const identity = expandTemplateIdentity(config.offerLayers.mechanic, productIndex + 1);
  const result: AVLayer[] = [];
  for (let index = 0; index < layouts.length; index += 1) {
    const layout = layouts[index];
    const candidates: Layer[] = [];
    for (let li = 1; li <= layout.numLayers; li += 1) candidates.push(layout.layer(li));
    const layers = resolveTemplateIdentity(candidates, identity, config.fallback.offerLayers, isTemplateOfferLayerComment).matches;
    if (layers.length > 1) throw new Error('A identidade "' + identity.comment + '" esta duplicada na regua "' + layout.name + '".');
    if (layers.length === 0) continue;
    const layer = layers[0];
    if (!(layer instanceof AVLayer) || !(layer.source instanceof CompItem)) {
      throw new Error('A camada "' + identity.comment + '" da regua "' + layout.name + '" nao possui uma precomp valida.');
    }
    result.push(layer);
  }
  return result;
};

const containsLayer = (layers: AVLayer[], layer: AVLayer): boolean => {
  const key = layerReferenceKey(layer);
  for (let index = 0; index < layers.length; index += 1) if (layerReferenceKey(layers[index]) === key) return true;
  return false;
};

// Scan the actual AEP, including disabled layers and comps outside this offer.
// References from the same slot in its alternate layouts are one owner.
export const isMechanicInstanceAvailable = (source: CompItem, owners: AVLayer[]): boolean => {
  const project = app.project;
  if (project === null) return false;
  for (let index = 1; index <= project.numItems; index += 1) {
    const item = project.item(index);
    if (!(item instanceof CompItem)) continue;
    for (let li = 1; li <= item.numLayers; li += 1) {
      const layer = item.layer(li);
      if (!(layer instanceof AVLayer)) continue;
      const referencedSource = layer.source;
      if (referencedSource instanceof CompItem && referencedSource.id === source.id && !containsLayer(owners, layer)) return false;
    }
  }
  return true;
};

export const assertOfferLayoutsPrivate = (layouts: CompItem[], offer: AVLayer, index?: ProjectReferenceIndex): void => {
  const references = index || readProjectReferenceIndex();
  const offerKey = layerReferenceKey(offer);
  for (let layoutIndex = 0; layoutIndex < layouts.length; layoutIndex += 1) {
    const usages = references.bySource["$" + layouts[layoutIndex].id] || [];
    for (let usageIndex = 0; usageIndex < usages.length; usageIndex += 1) {
      if (compReferenceKey(usages[usageIndex]) !== offerKey) {
        throw new Error('A regua "' + layouts[layoutIndex].name + '" tambem e usada fora desta oferta. Separe essa regua antes de trocar a mecanica.');
      }
    }
  }
};

export const readReferencedCompIds = (exceptLayer?: AVLayer, index?: ProjectReferenceIndex): { [id: string]: boolean } => {
  const references: { [id: string]: boolean } = {};
  const captured = (index || readProjectReferenceIndex()).references;
  const exceptKey = exceptLayer ? layerReferenceKey(exceptLayer) : "";
  for (let ri = 0; ri < captured.length; ri += 1) {
    const reference = captured[ri];
    if (compReferenceKey(reference) !== exceptKey) {
      references["$" + reference.sourceId] = true;
    }
  }
  return references;
};

export const selectMechanicInstance = (pool: CompItem[], owners: AVLayer[], current: CompItem,
  offerLayouts: CompItem[], activeLayout: CompItem, index?: ProjectReferenceIndex): { source: CompItem; duplicate: boolean } => {
  const occupied: { [id: string]: boolean } = {};
  const captured = index || readProjectReferenceIndex();
  const references = readReferencedCompIds(undefined, captured);
  const inactive: { [id: string]: boolean } = {};
  const ownerKeys: { [key: string]: boolean } = {};
  for (let oi = 0; oi < owners.length; oi += 1) ownerKeys[layerReferenceKey(owners[oi])] = true;
  for (let li = 0; li < offerLayouts.length; li += 1) {
    const layoutId = offerLayouts[li].id;
    if (layoutId !== activeLayout.id && !references["$" + layoutId]) inactive["$" + layoutId] = true;
  }
  for (let ri = 0; ri < captured.references.length; ri += 1) {
    const reference = captured.references[ri];
    if (!inactive["$" + reference.compId] && !ownerKeys[compReferenceKey(reference)]) {
      occupied["$" + reference.sourceId] = true;
    }
  }
  for (let index = 0; index < pool.length; index += 1) {
    if (pool[index] === current && !occupied["$" + current.id]) return { source: current, duplicate: false };
  }
  for (let index = 0; index < pool.length; index += 1) {
    if (occupied["$" + pool[index].id]) continue;
    for (let oi = 0; oi < owners.length; oi += 1) {
      if (owners[oi].source === pool[index]) return { source: pool[index], duplicate: false };
    }
  }
  for (let index = 0; index < pool.length; index += 1) {
    if (!occupied["$" + pool[index].id]) return { source: pool[index], duplicate: false };
  }
  if (pool.length === 0) throw new Error("Nenhuma instancia desta mecanica esta disponivel.");
  for (let index = 0; index < pool.length; index += 1) {
    if (pool[index] === current) return { source: current, duplicate: true };
  }
  return { source: pool[0], duplicate: true };
};

export const nextMechanicInstanceIdentity = (family: MechanicSchemaId): string => {
  const config = getTemplateIdentities();
  const base = normalizeTemplateIdentity(config.mechanics[family].comment);
  const project = app.project;
  if (project === null) throw new Error("Nenhum projeto esta aberto.");
  let suffix = 2;
  let candidate = base + " " + suffix;
  while (true) {
    let exists = false;
    for (let index = 1; index <= project.numItems; index += 1) {
      const item = project.item(index);
      if (normalizeTemplateIdentity(item.name) === candidate || normalizeTemplateIdentity(item.comment) === candidate) { exists = true; break; }
    }
    if (!exists) return candidate;
    suffix += 1;
    candidate = base + " " + suffix;
  }
};

export const assertMechanicCanDuplicate = (source: CompItem): void => {
  // Native duplication keeps nested sources shared. Keep this operation scoped
  // to the mechanic itself until a template explicitly supports nested copies.
  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = source.layer(index);
    if (layer instanceof AVLayer && layer.source instanceof CompItem) {
      throw new Error("Esta mecânica possui precomps internas compartilhadas e não pode ser duplicada com segurança.");
    }
  }
};

export const createMechanicInstance = (source: CompItem, family: MechanicSchemaId, created: CompItem[]): CompItem => {
  const identity = nextMechanicInstanceIdentity(family);
  const copy = source.duplicate();
  created.push(copy);
  copy.parentFolder = source.parentFolder;
  copy.name = identity;
  copy.comment = identity;
  return copy;
};

export const removeUnusedCreatedMechanics = (created: CompItem[], errors: string[]): void => {
  for (let index = created.length - 1; index >= 0; index -= 1) {
    try {
      if (!isMechanicInstanceAvailable(created[index], [])) throw new Error("A cópia ainda está em uso.");
      created[index].remove();
    } catch (error) {
      errors.push("Não foi possível remover a cópia incompleta da mecânica. Use Desfazer no After Effects.");
    }
  }
};

export const prepareMechanicSourceChanges = (layers: AVLayer[], target: CompItem): MechanicSourceChange[] => {
  const changes: MechanicSourceChange[] = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer.source === target) continue;
    if (layer.locked) throw new Error('A camada "' + layer.name + '" esta bloqueada. Desbloqueie-a no After Effects.');
    changes.push({ layer, source: layer.source as CompItem, name: layer.name, target });
  }
  return changes;
};

export const applyMechanicSourceChanges = (changes: MechanicSourceChange[]): void => {
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    change.layer.replaceSource(change.target, false);
    if (change.layer.name !== change.name) change.layer.name = change.name;
  }
};

export const rollbackMechanicSourceChanges = (changes: MechanicSourceChange[], errors: string[]): void => {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    try { if (change.layer.source !== change.source) change.layer.replaceSource(change.source, false); }
    catch (error) { errors.push("Nao foi possivel restaurar a mecanica anterior. Use Desfazer no After Effects."); }
    try { if (change.layer.name !== change.name) change.layer.name = change.name; }
    catch (error) { errors.push("Nao foi possivel restaurar o nome da camada. Use Desfazer no After Effects."); }
  }
};

export const mechanicWouldCreateCycle = (source: CompItem, layoutId: number, mioloId: number): boolean => {
  const pending: CompItem[] = [source];
  const visited: { [id: string]: boolean } = {};
  while (pending.length > 0) {
    const comp = pending.pop()!;
    if (comp.id === layoutId || comp.id === mioloId) return true;
    const key = "$" + comp.id;
    if (visited[key]) continue;
    visited[key] = true;
    for (let index = 1; index <= comp.numLayers; index += 1) {
      const layer = comp.layer(index);
      if (layer instanceof AVLayer && layer.source instanceof CompItem) pending.push(layer.source);
    }
  }
  return false;
};
