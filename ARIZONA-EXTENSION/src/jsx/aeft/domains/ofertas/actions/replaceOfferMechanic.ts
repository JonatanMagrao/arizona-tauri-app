import type {
  OfferEditorActionResult,
  OfferLayoutContext,
  OfferMechanicChangeRequest,
  OfferMechanicContext,
} from "../types";
import { resolveOfferMechanics } from "../offers/offerMechanics";

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

export const replaceOfferMechanic = (request: OfferMechanicChangeRequest): OfferEditorActionResult => {
  const result: OfferEditorActionResult = { ok: false, message: "", selectedOfferLayerIndex: 0, errors: [] };
  if (!request || !request.context || !request.context.offer || typeof request.targetItemId !== "number" ||
    !isFinite(request.targetItemId) || request.targetItemId < 1 || Math.floor(request.targetItemId) !== request.targetItemId) {
    result.message = "Selecione novamente a oferta, o produto e a mecânica desejada.";
    return result;
  }
  const resolution = resolveOfferMechanics(request.context.offer.offerLayerIndex, request.context.productIndex);
  const menu = resolution.menu;
  if (!menu.ok || menu.context === null || resolution.mechanicLayer === null) {
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
  let target: CompItem | null = null;
  for (let index = 0; index < resolution.targets.length; index += 1) {
    if (resolution.targets[index].id === request.targetItemId) {
      target = resolution.targets[index];
      break;
    }
  }
  if (target === null) {
    result.message = "Esta mecânica não está disponível para o produto. Atualize a lista e confira os comentários.";
    return result;
  }
  const previousSource = layer.source as CompItem;
  if (previousSource.id === target.id) {
    result.ok = true;
    result.selectedOfferLayerIndex = menu.context.offer.offerLayerIndex;
    result.message = "Esta mecânica já está aplicada ao produto.";
    return result;
  }
  const previousName = layer.name;
  let undoStarted = false;
  try {
    app.beginUndoGroup("Trocar mecânica do produto");
    undoStarted = true;
    layer.replaceSource(target, false);
    if (layer.name !== previousName) layer.name = previousName;
    result.ok = true;
    result.selectedOfferLayerIndex = menu.context.offer.offerLayerIndex;
    result.message = "Mecânica do produto atualizada.";
  } catch (error) {
    if (undoStarted) {
      try {
        if (layer.source !== previousSource) layer.replaceSource(previousSource, false);
      } catch (rollbackError) {
        result.errors.push("Não foi possível restaurar a mecânica anterior. Use Desfazer no After Effects.");
      }
      try {
        if (layer.name !== previousName) layer.name = previousName;
      } catch (rollbackError) {
        result.errors.push("Não foi possível restaurar o nome da camada. Use Desfazer no After Effects.");
      }
    }
    result.message = "Não foi possível trocar a mecânica do produto.";
    result.errors.push(String(error));
  } finally {
    if (undoStarted) app.endUndoGroup();
  }
  return result;
};
