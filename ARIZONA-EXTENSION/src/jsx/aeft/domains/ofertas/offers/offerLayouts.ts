import type { OfferLayoutMenuData, OfferLayoutOption } from "../types";
import { getProjectIdentity } from "../../project/projectIdentity";
import { isTemplateOfferLayerComment, isTemplateProjectItemComment, readTemplateOfferSlot, resolveTemplateIdentity } from "../../project/resolveTemplateIdentity";
import {
  expandTemplateIdentity,
  getTemplateIdentities,
  withTemplateIdentities,
} from "../../template/templateIdentities";

const LAYOUTS = [
  { comment: "OFERTA REGUA 2 PRODUTOS", label: "2 produtos" },
  { comment: "OFERTA REGUA 2 PRODUTOS ELETRO", label: "2 produtos eletro" },
  { comment: "OFERTA REGUA 3 PRODUTOS", label: "3 produtos" },
  { comment: "OFERTA SIMPLES", label: "Simples" },
];

export interface ResolvedOfferLayouts {
  menu: OfferLayoutMenuData;
  offer: AVLayer | null;
  folder: FolderItem | null;
  targets: CompItem[];
}

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
  folder: null,
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
export const resolveOfferLayouts = (offerLayerIndex: number): ResolvedOfferLayouts => withTemplateIdentities(() => {
  const resolution = createResolution();
  const project = app.project;
  if (project === null) {
    return unavailable(resolution, "Nenhum projeto está aberto.", "Abra o projeto no After Effects.");
  }

  try {
    const config = getTemplateIdentities();
    const offersCompName = config.named.offersComp;
    let miolo: CompItem | null = null;
    const projectFolders: FolderItem[] = [];
    for (let index = 1; index <= project.numItems; index += 1) {
      const item = project.item(index);
      if (item instanceof FolderItem) projectFolders.push(item);
      if (!(item instanceof CompItem) || item.name !== offersCompName) continue;
      if (miolo !== null) {
        return unavailable(resolution, 'Mais de uma precomp se chama "' + offersCompName + '".',
          'Mantenha o nome "' + offersCompName + '" apenas na composição das ofertas.');
      }
      miolo = item;
    }
    if (miolo === null) {
      return unavailable(resolution, 'A precomp "' + offersCompName + '" não foi encontrada.',
        'Confira a composição "' + offersCompName + '" no projeto.');
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
    const slot = readTemplateOfferSlot(offer);
    if (slot === null) {
      return unavailable(resolution, config.fallback.offerLayers
        ? "O comentário ou nome da camada não identifica uma oferta válida."
        : "O comentário que identifica a oferta está ausente ou inválido.",
        config.fallback.offerLayers
          ? 'Confira o comentário ou o nome da camada da oferta no mapa de identidades.'
          : 'Adicione o comentário "CAMADA OFERTA 01", "CAMADA OFERTA 02" etc. à camada correspondente no Miolo.');
    }
    const layerIdentity = expandTemplateIdentity(config.offerLayers.offer, slot);
    const layerComment = layerIdentity.comment;
    const offerLayers: Layer[] = [];
    for (let index = 1; index <= miolo.numLayers; index += 1) {
      offerLayers.push(miolo.layer(index));
    }
    const layerMatches = resolveTemplateIdentity(offerLayers, layerIdentity, config.fallback.offerLayers, isTemplateOfferLayerComment);
    if (layerMatches.matches.length !== 1 || layerMatches.matches[0] !== offer) {
      return unavailable(resolution, "A identidade da oferta está duplicada ou pertence a outra camada.",
        'Mantenha a identidade "' + layerComment + '" em apenas uma camada do Miolo; comentários têm prioridade sobre nomes.');
    }
    const folderIdentity = expandTemplateIdentity(config.projectItems.offerFolder, slot);
    const folderComment = folderIdentity.comment;
    const folders = resolveTemplateIdentity(projectFolders, folderIdentity, config.fallback.projectItems, isTemplateProjectItemComment).matches;
    if (folders.length !== 1) {
      return unavailable(resolution, config.fallback.projectItems
        ? (folders.length === 0 ? 'Nenhuma pasta do projeto corresponde a "' : 'Mais de uma pasta do projeto corresponde a "') + folderComment + '" por comentário ou nome.'
        : folders.length === 0
        ? 'Nenhuma pasta do projeto tem o comentário "' + folderComment + '".'
        : 'Mais de uma pasta do projeto tem o comentário "' + folderComment + '".',
      config.fallback.projectItems
        ? 'No painel Projeto, confira o comentário ou nome da pasta "' + folderComment + '" e elimine identidades duplicadas.'
        : folders.length === 0
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
      const candidates: CompItem[] = [];
      for (let itemIndex = 1; itemIndex <= folder.numItems; itemIndex += 1) {
        const item = folder.item(itemIndex);
        if (item instanceof CompItem && item.parentFolder === folder) candidates.push(item);
      }
      const matches = resolveTemplateIdentity(candidates, config.layouts[layout.comment],
        config.fallback.projectItems, isTemplateProjectItemComment).matches;
      let current = false;
      for (let index = 0; index < matches.length; index += 1) if (matches[index].id === source.id) current = true;
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
        option.disabledSummary = config.fallback.projectItems
          ? (matches.length === 0 ? 'Nenhuma precomp' : 'Mais de uma precomp') + ' diretamente na pasta "' + folderComment + '" corresponde a "' + layout.comment + '" por comentário ou nome.'
          : matches.length === 0
          ? 'Nenhuma precomp diretamente na pasta com o comentário "' + folderComment + '" tem o comentário "' + layout.comment + '".'
          : 'Mais de uma precomp diretamente na pasta com o comentário "' + folderComment + '" tem o comentário "' + layout.comment + '".';
        option.disabledReason = config.fallback.projectItems
          ? 'No painel Projeto, confira o comentário ou nome "' + layout.comment + '" diretamente na pasta "' + folderComment + '" e elimine identidades duplicadas.'
          : matches.length === 0
          ? 'No painel Projeto, adicione o comentário "' + layout.comment + '" à precomp diretamente na pasta com o comentário "' + folderComment + '".'
          : 'No painel Projeto, mantenha o comentário "' + layout.comment + '" em apenas uma precomp diretamente na pasta com o comentário "' + folderComment + '".';
      } else {
        resolution.targets.push(matches[0]);
      }
      resolution.menu.options.push(option);
    }
    resolution.offer = offer;
    resolution.folder = folder;
    resolution.menu.ok = true;
    resolution.menu.message = "Réguas da oferta carregadas.";
    return resolution;
  } catch (error) {
    resolution.menu.context = null;
    resolution.menu.options = [];
    resolution.targets = [];
    resolution.offer = null;
    resolution.folder = null;
    resolution.menu.errors.push(String(error));
    return unavailable(resolution, "Não foi possível ler as réguas desta oferta.",
      "Atualize a lista e confira a camada da oferta e sua pasta no projeto.");
  }
});

export const getOfferLayoutOptions = (offerLayerIndex: number): OfferLayoutMenuData =>
  resolveOfferLayouts(offerLayerIndex).menu;
