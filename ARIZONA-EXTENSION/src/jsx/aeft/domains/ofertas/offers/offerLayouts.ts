import type { OfferLayoutMenuData, OfferLayoutOption } from "../types";
import { findProjectItemsByComment } from "../../project/findProjectItemsByComment";
import { getProjectIdentity } from "../../project/projectIdentity";

const LAYOUTS = [
  { comment: "OFERTA REGUA 2 PRODUTOS", label: "2 produtos" },
  { comment: "OFERTA REGUA 2 PRODUTOS ELETRO", label: "2 produtos eletro" },
  { comment: "OFERTA REGUA 3 PRODUTOS", label: "3 produtos" },
  { comment: "OFERTA SIMPLES", label: "Simples" },
];

export interface ResolvedOfferLayouts {
  menu: OfferLayoutMenuData;
  offer: AVLayer | null;
  targets: CompItem[];
}

const normalizeComment = (comment: string): string =>
  String(comment || "").replace(/^\s+|\s+$/g, "").toUpperCase();

const readLayerComment = (layer: Layer): string => {
  try {
    return normalizeComment(layer.comment);
  } catch (error) {
    return "";
  }
};

const readLayerId = (layer: Layer): number => {
  try {
    const id = layer.id;
    return typeof id === "number" && isFinite(id) && id > 0 ? id : 0;
  } catch (error) {
    // Layer IDs are unavailable before After Effects 22.
    return 0;
  }
};

const createResolution = (): ResolvedOfferLayouts => ({
  menu: { ok: false, message: "", context: null, options: [], errors: [] },
  offer: null,
  targets: [],
});

const unavailable = (
  resolution: ResolvedOfferLayouts,
  summary: string,
  reason: string
): ResolvedOfferLayouts => {
  resolution.menu.message = summary;
  resolution.menu.disabledSummary = summary;
  resolution.menu.disabledReason = reason;
  return resolution;
};

// Native objects stay inside the host. Both listing and mutation use this same
// resolution so a stale menu cannot bypass folder ownership or duplicate checks.
export const resolveOfferLayouts = (offerLayerIndex: number): ResolvedOfferLayouts => {
  const resolution = createResolution();
  const project = app.project;
  if (project === null) {
    return unavailable(resolution, "Nenhum projeto está aberto.", "Abra o projeto no After Effects.");
  }

  try {
    let miolo: CompItem | null = null;
    for (let index = 1; index <= project.numItems; index += 1) {
      const item = project.item(index);
      if (!(item instanceof CompItem) || item.name !== "Miolo") continue;
      if (miolo !== null) {
        return unavailable(resolution, 'Mais de uma precomp se chama "Miolo".',
          'Mantenha o nome "Miolo" apenas na composição das ofertas.');
      }
      miolo = item;
    }
    if (miolo === null) {
      return unavailable(resolution, 'A precomp "Miolo" não foi encontrada.',
        'Confira a composição "Miolo" no projeto.');
    }
    if (
      typeof offerLayerIndex !== "number" || !isFinite(offerLayerIndex) ||
      Math.floor(offerLayerIndex) !== offerLayerIndex ||
      offerLayerIndex < 1 || offerLayerIndex > miolo.numLayers
    ) {
      return unavailable(resolution, "A camada da oferta não foi encontrada.", "Selecione novamente a oferta.");
    }
    const offer = miolo.layer(offerLayerIndex);
    if (!(offer instanceof AVLayer) || !(offer.source instanceof CompItem)) {
      return unavailable(resolution, "A oferta não possui uma precomp válida.",
        "Confira a origem da camada da oferta no Miolo.");
    }
    const layerComment = readLayerComment(offer);
    const match = /^CAMADA OFERTA ([1-9][0-9]*)$/.exec(layerComment);
    if (match === null) {
      return unavailable(resolution, "O comentário que identifica a oferta está ausente ou inválido.",
        'Adicione o comentário "CAMADA OFERTA N" à camada no Miolo, usando N para o número da oferta.');
    }
    for (let index = 1; index <= miolo.numLayers; index += 1) {
      if (index !== offerLayerIndex && readLayerComment(miolo.layer(index)) === layerComment) {
        return unavailable(resolution, "O comentário da oferta está duplicado.",
          'Mantenha o comentário "' + layerComment + '" em apenas uma camada do Miolo.');
      }
    }
    const slot = match[1];
    const folderComment = "OFERTA " + (slot.length < 2 ? "0" : "") + slot;
    const folders = findProjectItemsByComment(folderComment, "folder");
    if (folders.length !== 1) {
      return unavailable(resolution, folders.length === 0
        ? 'Nenhuma pasta do projeto tem o comentário "' + folderComment + '".'
        : 'Mais de uma pasta do projeto tem o comentário "' + folderComment + '".',
      folders.length === 0
        ? 'No painel Projeto, adicione o comentário "' + folderComment + '" à pasta desta oferta.'
        : 'No painel Projeto, mantenha o comentário "' + folderComment + '" apenas na pasta desta oferta.');
    }
    const folder = folders[0] as FolderItem;
    const source = offer.source as CompItem;
    resolution.menu.context = {
      projectKey: getProjectIdentity().projectKey,
      compItemId: miolo.id,
      offerLayerIndex: offer.index,
      offerLayerId: readLayerId(offer),
      layerComment,
      sourceItemId: source.id,
      folderItemId: folder.id,
      folderComment,
    };
    for (let layoutIndex = 0; layoutIndex < LAYOUTS.length; layoutIndex += 1) {
      const layout = LAYOUTS[layoutIndex];
      const matches: CompItem[] = [];
      let current = false;
      for (let itemIndex = 1; itemIndex <= folder.numItems; itemIndex += 1) {
        const item = folder.item(itemIndex);
        if (
          item instanceof CompItem && item.parentFolder === folder &&
          normalizeComment(item.comment) === layout.comment
        ) {
          matches.push(item);
          if (item.id === source.id) current = true;
        }
      }
      const option: OfferLayoutOption = {
        comment: layout.comment,
        label: layout.label,
        itemId: matches.length === 1 && matches[0] !== miolo ? matches[0].id : null,
        current,
        enabled: matches.length === 1 && matches[0] !== miolo,
      };
      if (matches.length === 1 && matches[0] === miolo) {
        option.disabledSummary = "Esta composição contém a própria camada da oferta.";
        option.disabledReason = "Use outra precomp como régua; o Miolo não pode ser origem de uma camada dele mesmo.";
      } else if (!option.enabled) {
        option.disabledSummary = matches.length === 0
          ? 'Nenhuma precomp diretamente na pasta com o comentário "' + folderComment + '" tem o comentário "' + layout.comment + '".'
          : 'Mais de uma precomp diretamente na pasta com o comentário "' + folderComment + '" tem o comentário "' + layout.comment + '".';
        option.disabledReason = matches.length === 0
          ? 'No painel Projeto, adicione o comentário "' + layout.comment + '" à precomp diretamente na pasta com o comentário "' + folderComment + '".'
          : 'No painel Projeto, mantenha o comentário "' + layout.comment + '" em apenas uma precomp diretamente na pasta com o comentário "' + folderComment + '".';
      } else {
        resolution.targets.push(matches[0]);
      }
      resolution.menu.options.push(option);
    }
    resolution.offer = offer;
    resolution.menu.ok = true;
    resolution.menu.message = "Réguas da oferta carregadas.";
    return resolution;
  } catch (error) {
    resolution.menu.context = null;
    resolution.menu.options = [];
    resolution.targets = [];
    resolution.offer = null;
    resolution.menu.errors.push(String(error));
    return unavailable(resolution, "Não foi possível ler as réguas desta oferta.",
      "Atualize a lista e confira a camada da oferta e sua pasta no projeto.");
  }
};

export const getOfferLayoutOptions = (offerLayerIndex: number): OfferLayoutMenuData =>
  resolveOfferLayouts(offerLayerIndex).menu;
