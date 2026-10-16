import { isTemplateOfferLayerComment, isTemplateProjectItemComment, resolveTemplateIdentity } from "../../project/resolveTemplateIdentity";
import { getTemplateIdentities, matchTemplatePattern, normalizeTemplateIdentity } from "../../template/templateIdentities";
import type { MechanicSchemaId } from "../mechanics/schemaValidation";
import { collectMechanicComps } from "./offerMechanics";
import { assertMechanicCanDuplicate, findProductMechanicLayers, mechanicWouldCreateCycle, readReferencedCompIds, resolveMechanicPool } from "./mechanicInstances";
import { readProjectReferenceIndex, type ProjectReferenceIndex } from "./projectReferenceIndex";

export interface LayoutMechanicAssignment {
  layer: AVLayer;
  source: CompItem;
  family: MechanicSchemaId | null;
  duplicate: boolean;
  carried: boolean;
  slot: number;
}

const readMechanicSlots = (layout: CompItem): number[] => {
  const config = getTemplateIdentities();
  const definition = config.offerLayers.mechanic;
  const slots: number[] = [];
  const seen: { [key: string]: boolean } = {};
  for (let index = 1; index <= layout.numLayers; index += 1) {
    const layer = layout.layer(index);
    const comment = normalizeTemplateIdentity(layer.comment);
    let slot = matchTemplatePattern(comment, definition.comment);
    if (slot === null && config.fallback.offerLayers && !isTemplateOfferLayerComment(comment)) {
      for (let ni = 0; ni < definition.names.length; ni += 1) {
        const found = matchTemplatePattern(layer.name, definition.names[ni]);
        if (found !== null) slot = found;
      }
    }
    if (slot !== null && !seen["$" + slot]) { seen["$" + slot] = true; slots.push(slot); }
  }
  slots.sort((left, right) => left - right);
  return slots;
};

const findPool = (folder: FolderItem, source: CompItem, slot: number): { family: MechanicSchemaId; instances: CompItem[] } => {
  const config = getTemplateIdentities();
  const candidates: FolderItem[] = [];
  for (let index = 1; index <= folder.numItems; index += 1) {
    const item = folder.item(index);
    if (item instanceof FolderItem && item.parentFolder === folder) candidates.push(item);
  }
  const folders = resolveTemplateIdentity(candidates, config.projectItems.mechanicsFolder,
    config.fallback.projectItems, isTemplateProjectItemComment).matches;
  if (folders.length !== 1) throw new Error("A pasta de mecanicas da oferta nao foi identificada sem ambiguidades.");
  const comps = collectMechanicComps(folders[0]);
  const simpleCandidates: CompItem[] = [];
  for (let index = 0; index < comps.length; index += 1) {
    const comment = normalizeTemplateIdentity(comps[index].comment);
    let simpleSlot = matchTemplatePattern(comment, config.mechanics.SIMPLES.comment);
    if (simpleSlot === null && config.fallback.projectItems && !isTemplateProjectItemComment(comment)) {
      for (let ni = 0; ni < config.mechanics.SIMPLES.names.length; ni += 1) {
        const found = matchTemplatePattern(comps[index].name, config.mechanics.SIMPLES.names[ni]);
        if (found !== null) simpleSlot = found;
      }
    }
    if (simpleSlot !== null) {
      const simple = resolveMechanicPool(comps, "SIMPLES", simpleSlot - 1);
      if (simple.ambiguous) throw new Error("As mecanicas Simples possuem indices duplicados.");
      if (simple.matches.length === 1 && simple.matches[0] === comps[index]) simpleCandidates.push(comps[index]);
    }
  }
  for (let index = 0; index < simpleCandidates.length; index += 1) {
    if (simpleCandidates[index] === source) {
      const nominal = resolveMechanicPool(comps, "SIMPLES", slot - 1).matches;
      const ordered = nominal.slice(0);
      for (let si = 0; si < simpleCandidates.length; si += 1) {
        if (nominal.length !== 1 || simpleCandidates[si] !== nominal[0]) ordered.push(simpleCandidates[si]);
      }
      return { family: "SIMPLES", instances: ordered };
    }
  }
  for (const key in config.mechanics) {
    if (!Object.prototype.hasOwnProperty.call(config.mechanics, key)) continue;
    const family = key as MechanicSchemaId;
    const pool = resolveMechanicPool(comps, family, slot - 1);
    for (let index = 0; index < pool.matches.length; index += 1) {
      if (pool.matches[index] !== source) continue;
      if (pool.ambiguous) throw new Error("As instancias desta mecanica possuem identidades duplicadas. Confira os comentarios e nomes das precomps.");
      return { family, instances: pool.matches };
    }
  }
  throw new Error("A mecanica compartilhada nao foi identificada na pasta desta oferta. Confira sua origem antes de trocar a regua.");
};

// Plan against the sources that will actually be active AFTER carrying current
// slots. Reading inactive layouts must neither reserve nor duplicate sources.
export const planLayoutMechanicAssignments = (current: CompItem, target: CompItem,
  folder: FolderItem, layouts: CompItem[], mioloId: number, offer: AVLayer, index?: ProjectReferenceIndex): LayoutMechanicAssignment[] => {
  const slots = readMechanicSlots(target);
  const assignments: LayoutMechanicAssignment[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const targetLayers = findProductMechanicLayers([target], slots[index] - 1);
    const currentLayers = findProductMechanicLayers([current], slots[index] - 1);
    if (targetLayers.length !== 1) continue;
    const carried = currentLayers.length === 1;
    assignments.push({ layer: targetLayers[0], source: (carried ? currentLayers[0] : targetLayers[0]).source as CompItem,
      family: null, duplicate: false, carried, slot: slots[index] });
  }
  assignments.sort((left, right) => {
    // ExtendScript associates chained ternaries differently from modern JS.
    if (left.carried === right.carried) return left.slot - right.slot;
    if (left.carried) return -1;
    return 1;
  });
  const occupied: { [id: string]: boolean } = {};
  const captured = index || readProjectReferenceIndex();
  const references = readReferencedCompIds(offer, captured);
  const ownLayouts: { [id: string]: boolean } = {};
  for (let li = 0; li < layouts.length; li += 1) {
    const id = layouts[li].id;
    if (!references["$" + id]) ownLayouts["$" + id] = true;
  }
  for (let ri = 0; ri < captured.references.length; ri += 1) {
    const reference = captured.references[ri];
    if (!ownLayouts["$" + reference.compId]) occupied["$" + reference.sourceId] = true;
  }
  // Preserve references from every other layer that remains in the destination
  // (including disabled or unrecognized layers) in the projected occupancy.
  for (let li = 1; li <= target.numLayers; li += 1) {
    const layer = target.layer(li);
    if (!(layer instanceof AVLayer) || !(layer.source instanceof CompItem)) continue;
    let assigned = false;
    for (let ai = 0; ai < assignments.length; ai += 1) if (assignments[ai].layer === layer) assigned = true;
    if (!assigned) occupied["$" + layer.source.id] = true;
  }
  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    if (!assignment.carried && occupied["$" + assignment.source.id]) {
      const pool = findPool(folder, assignment.source, assignment.slot);
      let free: CompItem | null = null;
      for (let pi = 0; pi < pool.instances.length; pi += 1) {
        if (!occupied["$" + pool.instances[pi].id] && !mechanicWouldCreateCycle(pool.instances[pi], target.id, mioloId)) {
          free = pool.instances[pi];
          break;
        }
      }
      assignment.family = pool.family;
      if (free !== null) assignment.source = free;
      else {
        if (pool.family === "SIMPLES") throw new Error("Nenhuma mecanica Simples independente esta disponivel. Confira as precomps Simples da oferta.");
        assignment.duplicate = true;
        assertMechanicCanDuplicate(assignment.source);
      }
    }
    if (mechanicWouldCreateCycle(assignment.source, target.id, mioloId)) {
      throw new Error("Esta mecanica referencia a regua de destino ou o Miolo e criaria uma referencia circular.");
    }
    if ((assignment.duplicate || assignment.layer.source !== assignment.source) && assignment.layer.locked) {
      throw new Error('A camada "' + assignment.layer.name + '" da regua de destino esta bloqueada. Desbloqueie-a no After Effects.');
    }
    // A planned new comp has no real ID yet and cannot collide with another
    // assignment. Leave the original reserved by its existing owner.
    if (!assignment.duplicate) occupied["$" + assignment.source.id] = true;
  }
  return assignments;
};
