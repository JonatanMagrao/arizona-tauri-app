import type {
  OfferEditorActionResult,
  OfferLayoutContext,
  OfferMechanicChangeRequest,
  OfferMechanicContext,
} from "../types";
import { resolveOfferMechanics } from "../offers/offerMechanics";
import { withTemplateIdentities } from "../../template/templateIdentities";
import { applyMechanicSourceChanges, assertMechanicCanDuplicate, assertOfferLayoutsPrivate, createMechanicInstance, findProductMechanicLayers,
  prepareMechanicSourceChanges, removeUnusedCreatedMechanics,
  rollbackMechanicSourceChanges, selectMechanicInstance, type MechanicSourceChange } from "../offers/mechanicInstances";
import { readProjectReferenceIndex } from "../offers/projectReferenceIndex";
import { attachOfferUpdate } from "./shared";

const sameOffer = (expected: OfferLayoutContext, actual: OfferLayoutContext): boolean =>
  expected.projectKey === actual.projectKey && expected.compItemId === actual.compItemId &&
  expected.offerLayerIndex === actual.offerLayerIndex && expected.offerLayerId === actual.offerLayerId &&
  expected.layerComment === actual.layerComment && expected.sourceItemId === actual.sourceItemId &&
  expected.folderItemId === actual.folderItemId && expected.folderComment === actual.folderComment;

const sameContext = (expected: OfferMechanicContext, actual: OfferMechanicContext): boolean =>
  sameOffer(expected.offer, actual.offer) && expected.productIndex === actual.productIndex &&
  expected.mechanicLayerIndex === actual.mechanicLayerIndex && expected.mechanicLayerId === actual.mechanicLayerId &&
  expected.mechanicLayerComment === actual.mechanicLayerComment &&
  expected.mechanicSourceItemId === actual.mechanicSourceItemId && expected.mechanicsFolderItemId === actual.mechanicsFolderItemId;

export const replaceOfferMechanic = (request: OfferMechanicChangeRequest): OfferEditorActionResult => withTemplateIdentities(() => {
  const result: OfferEditorActionResult = { ok: false, message: "", selectedOfferLayerIndex: 0, errors: [] };
  if (!request || !request.context || !request.context.offer || typeof request.targetItemId !== "number" ||
    !isFinite(request.targetItemId) || request.targetItemId < 1 || Math.floor(request.targetItemId) !== request.targetItemId) {
    result.message = "Selecione novamente a oferta, o produto e a mecânica desejada.";
    return result;
  }
  const resolution = resolveOfferMechanics(request.context.offer.offerLayerIndex, request.context.productIndex);
  const menu = resolution.menu;
  if (!menu.ok || menu.context === null || resolution.mechanicLayer === null || resolution.offer === null) {
    result.message = "Não foi possível localizar as mecânicas deste produto. Abra o seletor novamente.";
    result.errors = menu.errors.slice(0);
    if (menu.disabledReason) result.errors.push(menu.disabledReason);
    return result;
  }
  if (!sameContext(request.context, menu.context)) {
    result.message = "A oferta ou a mecânica mudou. Abra o seletor novamente.";
    return result;
  }
  const layer = resolution.mechanicLayer;
  if (layer.locked) {
    result.message = "A camada da mecânica está bloqueada. Desbloqueie-a no After Effects para trocar a mecânica.";
    return result;
  }
  let pool: typeof resolution.pools[0] | null = null;
  for (let index = 0; index < resolution.pools.length; index += 1) {
    if (resolution.pools[index].representative.id === request.targetItemId) {
      pool = resolution.pools[index];
      break;
    }
  }
  if (pool === null) {
    result.message = "Esta mecânica não está disponível para o produto. Atualize a lista e confira os comentários.";
    return result;
  }
  const previousSource = layer.source as CompItem;
  let changes: MechanicSourceChange[] = [];
  const created: CompItem[] = [];
  let undoStarted = false;
  try {
    const owners = findProductMechanicLayers([layer.containingComp], menu.context.productIndex);
    // One live project scan serves all pre-mutation ownership checks. Simples
    // only needs it when the requested source actually changes.
    const references = pool.family === "SIMPLES" ? undefined : readProjectReferenceIndex();
    const choice = pool.family === "SIMPLES" ? { source: pool.representative, duplicate: false }
      : selectMechanicInstance(pool.instances, owners, previousSource, resolution.layouts, layer.containingComp, references);
    let target = choice.source;
    changes = prepareMechanicSourceChanges(owners, target);
    if (!choice.duplicate && changes.length === 0) {
      result.ok = true;
      result.selectedOfferLayerIndex = menu.context.offer.offerLayerIndex;
      result.message = "Esta mecânica já está aplicada ao produto.";
      return result;
    }
    assertOfferLayoutsPrivate([layer.containingComp], resolution.offer, references);
    if (choice.duplicate) {
      for (let index = 0; index < owners.length; index += 1) {
        if (owners[index].locked) throw new Error('A camada "' + owners[index].name + '" está bloqueada. Desbloqueie-a no After Effects.');
      }
      assertMechanicCanDuplicate(target);
    }
    app.beginUndoGroup("Trocar mecânica do produto");
    undoStarted = true;
    if (choice.duplicate) {
      target = createMechanicInstance(target, pool.family, created);
      changes = prepareMechanicSourceChanges(owners, target);
    }
    applyMechanicSourceChanges(changes);
    result.ok = true;
    result.selectedOfferLayerIndex = menu.context.offer.offerLayerIndex;
    result.message = "Mecânica do produto atualizada.";
    attachOfferUpdate(result, resolution.offer);
  } catch (error) {
    if (undoStarted) {
      rollbackMechanicSourceChanges(changes, result.errors);
      removeUnusedCreatedMechanics(created, result.errors);
    }
    result.message = "Não foi possível trocar a mecânica do produto.";
    result.errors.push(String(error));
  } finally {
    if (undoStarted) app.endUndoGroup();
  }
  return result;
});
