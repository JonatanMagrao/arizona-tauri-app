import type {
  OfferEditorActionResult,
  OfferLayoutChangeRequest,
  OfferLayoutContext,
} from "../types";
import { resolveOfferLayouts } from "../offers/offerLayouts";

const sameContext = (expected: OfferLayoutContext, actual: OfferLayoutContext): boolean =>
  expected.projectKey === actual.projectKey &&
  expected.compItemId === actual.compItemId &&
  expected.offerLayerIndex === actual.offerLayerIndex &&
  expected.offerLayerId === actual.offerLayerId &&
  expected.layerComment === actual.layerComment &&
  expected.sourceItemId === actual.sourceItemId &&
  expected.folderItemId === actual.folderItemId &&
  expected.folderComment === actual.folderComment;

export const replaceOfferLayout = (request: OfferLayoutChangeRequest): OfferEditorActionResult => {
  const result: OfferEditorActionResult = {
    ok: false, message: "", selectedOfferLayerIndex: 0, errors: [],
  };
  if (
    !request || !request.context || typeof request.targetItemId !== "number" ||
    !isFinite(request.targetItemId) || request.targetItemId < 1 ||
    Math.floor(request.targetItemId) !== request.targetItemId
  ) {
    result.message = "Selecione novamente a oferta e a régua desejada.";
    return result;
  }
  const resolution = resolveOfferLayouts(request.context.offerLayerIndex);
  const menu = resolution.menu;
  if (!menu.ok || menu.context === null || resolution.offer === null) {
    result.message = menu.disabledReason || menu.message;
    result.errors = menu.errors.slice(0);
    return result;
  }
  if (!sameContext(request.context, menu.context)) {
    result.message = "A oferta ou sua pasta mudou. Abra novamente a lista de réguas.";
    return result;
  }
  if (resolution.offer.locked) {
    result.message = "A camada da oferta está bloqueada. Desbloqueie-a no After Effects para trocar a régua.";
    return result;
  }
  let target: CompItem | null = null;
  for (let index = 0; index < resolution.targets.length; index += 1) {
    if (resolution.targets[index].id === request.targetItemId) {
      target = resolution.targets[index];
      break;
    }
  }
  if (target === null || target.id === menu.context.compItemId) {
    result.message = "Esta régua não está disponível na pasta da oferta. Atualize a lista e confira os comentários.";
    return result;
  }
  const offer = resolution.offer;
  const previousSource = offer.source as CompItem;
  if (previousSource.id === target.id) {
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Esta régua já está aplicada à oferta.";
    return result;
  }
  const previousName = offer.name;
  let undoStarted = false;
  try {
    app.beginUndoGroup("Trocar régua da oferta");
    undoStarted = true;
    // Preserve expression text and every layer property. Only restore the name
    // if After Effects automatically derives a new one from the source.
    offer.replaceSource(target, false);
    if (offer.name !== previousName) offer.name = previousName;
    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Régua da oferta atualizada.";
  } catch (error) {
    if (undoStarted) {
      try {
        if (offer.source !== previousSource) offer.replaceSource(previousSource, false);
      } catch (rollbackError) {
        result.errors.push("Não foi possível restaurar a régua anterior. Use Desfazer no After Effects.");
      }
      try {
        if (offer.name !== previousName) offer.name = previousName;
      } catch (rollbackError) {
        result.errors.push("Não foi possível restaurar o nome da oferta. Use Desfazer no After Effects.");
      }
    }
    result.message = "Não foi possível trocar a régua da oferta.";
    result.errors.push(String(error));
  } finally {
    if (undoStarted) app.endUndoGroup();
  }
  return result;
};
