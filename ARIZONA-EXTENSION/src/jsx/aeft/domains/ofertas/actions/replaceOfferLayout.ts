import type {
  OfferEditorActionResult,
  OfferLayoutChangeRequest,
  OfferLayoutContext,
} from "../types";
import { resolveOfferLayouts } from "../offers/offerLayouts";
import { withTemplateIdentities } from "../../template/templateIdentities";
import { applyMechanicSourceChanges, assertOfferLayoutsPrivate, createMechanicInstance,
  includeCurrentLayout, prepareMechanicSourceChanges, removeUnusedCreatedMechanics,
  rollbackMechanicSourceChanges, type MechanicSourceChange } from "../offers/mechanicInstances";
import { planLayoutMechanicAssignments } from "../offers/layoutMechanicInstances";
import { readProjectReferenceIndex } from "../offers/projectReferenceIndex";

const sameContext = (expected: OfferLayoutContext, actual: OfferLayoutContext): boolean =>
  expected.projectKey === actual.projectKey &&
  expected.compItemId === actual.compItemId &&
  expected.offerLayerIndex === actual.offerLayerIndex &&
  expected.offerLayerId === actual.offerLayerId &&
  expected.layerComment === actual.layerComment &&
  expected.sourceItemId === actual.sourceItemId &&
  expected.folderItemId === actual.folderItemId &&
  expected.folderComment === actual.folderComment;

export const replaceOfferLayout = (request: OfferLayoutChangeRequest): OfferEditorActionResult => withTemplateIdentities(() => {
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
  if (!menu.ok || menu.context === null || resolution.offer === null || resolution.folder === null) {
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
  const created: CompItem[] = [];
  let mechanicChanges: MechanicSourceChange[] = [];
  let undoStarted = false;
  try {
    const references = readProjectReferenceIndex();
    const assignments = planLayoutMechanicAssignments(previousSource, target, resolution.folder,
      includeCurrentLayout(resolution.targets, previousSource), menu.context.compItemId, offer, references);
    let changesMechanics = false;
    for (let index = 0; index < assignments.length; index += 1) {
      if (assignments[index].duplicate || assignments[index].layer.source !== assignments[index].source) changesMechanics = true;
    }
    if (changesMechanics) assertOfferLayoutsPrivate([target], offer, references);
    app.beginUndoGroup("Trocar régua da oferta");
    undoStarted = true;
    for (let index = 0; index < assignments.length; index += 1) {
      const assignment = assignments[index];
      const source = assignment.duplicate && assignment.family !== null
        ? createMechanicInstance(assignment.source, assignment.family, created) : assignment.source;
      mechanicChanges = mechanicChanges.concat(prepareMechanicSourceChanges([assignment.layer], source));
    }
    applyMechanicSourceChanges(mechanicChanges);
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
      rollbackMechanicSourceChanges(mechanicChanges, result.errors);
      removeUnusedCreatedMechanics(created, result.errors);
    }
    result.message = "Não foi possível trocar a régua da oferta.";
    result.errors.push(String(error));
  } finally {
    if (undoStarted) app.endUndoGroup();
  }
  return result;
});
