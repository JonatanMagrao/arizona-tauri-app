import { getTemplateIdentities } from "../../template/templateIdentities";
import { addError, getLayerByIndex } from "./findLayers";

interface LayerIdentity {
  comment: string;
  fallbackNames: string[];
  recognizedComments?: string[];
  context: string;
  layerLabel?: string;
}

export interface LayerIdentityDiagnostic {
  disabledReason?: string;
  disabledSummary?: string;
}

const normalizeIdentity = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

export const findLayerByIdentity = (
  source: CompItem | null,
  identity: LayerIdentity,
  errors: string[],
  diagnostic?: LayerIdentityDiagnostic
): Layer | null => {
  const explain = (reason: string, summary: string): void => {
    if (diagnostic) {
      diagnostic.disabledReason = reason;
      diagnostic.disabledSummary = summary;
    }
  };
  if (source === null) {
    explain("Precomp indisponível. Confira a origem da camada de mecânica.",
      "A precomp da mecânica não foi encontrada.");
    return null;
  }
  const location = ' na precomp "' + source.name + '".';
  const missingCommentReason = 'Adicione o comentário "' + identity.comment +
    '" na camada "' + (identity.layerLabel || identity.comment) + '"' + location;

  const expectedComment = normalizeIdentity(identity.comment);
  let found: Layer | null = null;

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null) continue;

    let comment = "";
    try {
      comment = normalizeIdentity(layer.comment);
    } catch (error) {
    }

    if (comment !== expectedComment) continue;

    if (found !== null) {
      explain('Comentário duplicado. Deixe "' + identity.comment +
        '" em apenas uma camada' + location,
        "Mais de uma camada possui o mesmo comentário obrigatório.");
      addError(
        errors,
        'Mais de uma camada tem o comentário "' + identity.comment +
          '" em ' + identity.context + "."
      );
      return null;
    }
    found = layer;
  }

  if (found !== null) return found;

  if (!getTemplateIdentities().fallback.mechanicLayers) {
    explain(missingCommentReason, "O comentário obrigatório não foi encontrado.");
    addError(
      errors,
      'Não encontrei uma camada com o comentário "' + identity.comment +
        '" em ' + identity.context + ". O fallback por nome está desativado."
    );
    return null;
  }

  for (let index = 1; index <= source.numLayers; index += 1) {
    const layer = getLayerByIndex(source, index);
    if (layer === null) continue;

    const name = normalizeIdentity(layer.name);
    // A comment assigning a different role must never be overridden by a name.
    let assignedComment = "";
    try { assignedComment = normalizeIdentity(layer.comment); } catch (error) { continue; }
    let assignedElsewhere = false;
    const recognized = identity.recognizedComments || [];
    for (let ci = 0; ci < recognized.length; ci += 1) {
      if (assignedComment !== expectedComment && assignedComment === normalizeIdentity(recognized[ci])) {
        assignedElsewhere = true;
        break;
      }
    }
    if (assignedElsewhere) continue;
    let matchesName = false;
    for (let ni = 0; ni < identity.fallbackNames.length; ni += 1) {
      if (name === normalizeIdentity(identity.fallbackNames[ni])) {
        matchesName = true;
        break;
      }
    }
    if (!matchesName) continue;

    if (found !== null) {
      explain('Camada ambígua. Use o comentário "' + identity.comment +
        '" somente na camada correta' + location,
        "Mais de uma camada corresponde ao nome esperado.");
      addError(
        errors,
        'Mais de uma camada corresponde ao nome de "' + identity.comment +
          '" em ' + identity.context + "."
      );
      return null;
    }
    found = layer;
  }

  if (found === null) {
    explain(missingCommentReason, "A camada não foi encontrada pelo comentário ou nome esperado.");
    addError(
      errors,
      'Não encontrei a camada "' + identity.comment +
        '" por comentário ou nome em ' + identity.context + "."
    );
  }
  return found;
};
