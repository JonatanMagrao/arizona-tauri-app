import type { OfferLayoutOption, OfferMechanicMenuData } from "../types";
import type { MechanicSchemaId } from "../mechanics/schemaValidation";
import { resolveOfferLayouts } from "./offerLayouts";
import { isTemplateOfferLayerComment, isTemplateProjectItemComment, resolveTemplateIdentity } from "../../project/resolveTemplateIdentity";
import { expandTemplateIdentity, getTemplateIdentities, withTemplateIdentities } from "../../template/templateIdentities";
import { includeCurrentLayout, mechanicWouldCreateCycle, resolveMechanicPool } from "./mechanicInstances";

interface MechanicCatalogEntry {
  family: MechanicSchemaId;
  label: string;
}

// Identity patterns, including product slots, come from the validated map.
const MECHANIC_CATALOG: MechanicCatalogEntry[] = [
  { family: "SIMPLES", label: "Simples" },
  { family: "TODOS A COM X% DESCONTO", label: "Todos a com X% desconto" },
  { family: "DESCONTO R$ CARTAO CRF", label: "Desconto R$ Cartão CRF" },
  { family: "DE X POR Y PARCELAMENTO", label: "De X por Y parcelamento" },
  { family: "DE X POR Y MEU CRF POR Z CARTAO CRF", label: "De X por Y Meu CRF por Z Cartão CRF" },
  { family: "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y", label: "De X por Y | X% desconto | Leve X pague Y" },
  { family: "TODOS A COM LEVE X PAGUE Y", label: "Todos a com Leve X pague Y" },
];

export interface ResolvedOfferMechanics {
  menu: OfferMechanicMenuData;
  mechanicLayer: AVLayer | null;
  targets: CompItem[];
  pools: { family: MechanicSchemaId; representative: CompItem; instances: CompItem[] }[];
  layouts: CompItem[];
  offer: AVLayer | null;
}

const readLayerId = (layer: Layer): number => {
  try {
    const id = layer.id;
    return typeof id === "number" && isFinite(id) && id > 0 ? id : 0;
  } catch (error) {
    return 0;
  }
};

const createResolution = (): ResolvedOfferMechanics => ({
  menu: { ok: false, message: "", context: null, options: [], errors: [] },
  mechanicLayer: null,
  targets: [],
  pools: [],
  layouts: [],
  offer: null,
});

const unavailable = (resolution: ResolvedOfferMechanics, summary: string, reason: string): ResolvedOfferMechanics => {
  resolution.menu.message = summary;
  resolution.menu.disabledSummary = summary;
  resolution.menu.disabledReason = reason;
  return resolution;
};

export const collectMechanicComps = (root: FolderItem): CompItem[] => {
  const comps: CompItem[] = [];
  const pending: FolderItem[] = [root];
  const visited: { [id: string]: boolean } = {};
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const key = "$" + folder.id;
    if (visited[key]) continue;
    visited[key] = true;
    for (let index = 1; index <= folder.numItems; index += 1) {
      const item = folder.item(index);
      if (item.parentFolder !== folder) continue;
      if (item instanceof FolderItem) pending.push(item);
      else if (item instanceof CompItem) comps.push(item);
    }
  }
  return comps;
};

export const resolveOfferMechanics = (offerLayerIndex: number, productIndex: number): ResolvedOfferMechanics => withTemplateIdentities(() => {
  const resolution = createResolution();
  if (typeof productIndex !== "number" || !isFinite(productIndex) || productIndex < 0 || Math.floor(productIndex) !== productIndex) {
    return unavailable(resolution, "O produto não foi identificado.", "Selecione novamente a oferta e o produto.");
  }
  const offerResolution = resolveOfferLayouts(offerLayerIndex);
  const offerMenu = offerResolution.menu;
  if (!offerMenu.ok || offerMenu.context === null || offerResolution.offer === null || offerResolution.folder === null) {
    resolution.menu.errors = offerMenu.errors.slice(0);
    return unavailable(resolution, offerMenu.disabledSummary || offerMenu.message,
      offerMenu.disabledReason || "Selecione novamente a oferta.");
  }

  try {
    const config = getTemplateIdentities();
    const layout = offerResolution.offer.source as CompItem;
    const layerIdentity = expandTemplateIdentity(config.offerLayers.mechanic, productIndex + 1);
    const layerComment = layerIdentity.comment;
    const candidates: Layer[] = [];
    for (let index = 1; index <= layout.numLayers; index += 1) {
      candidates.push(layout.layer(index));
    }
    const layers = resolveTemplateIdentity(candidates, layerIdentity, config.fallback.offerLayers, isTemplateOfferLayerComment).matches;
    if (layers.length !== 1) {
      return unavailable(resolution, config.fallback.offerLayers
        ? (layers.length === 0 ? 'Nenhuma camada' : 'Mais de uma camada') + ' na régua "' + layout.name + '" corresponde a "' + layerComment + '" por comentário ou nome.'
        : layers.length === 0
        ? 'Nenhuma camada na régua "' + layout.name + '" tem o comentário "' + layerComment + '".'
        : 'Mais de uma camada na régua "' + layout.name + '" tem o comentário "' + layerComment + '".',
      config.fallback.offerLayers
        ? 'Na timeline da régua "' + layout.name + '", confira o comentário ou nome "' + layerComment + '" e elimine identidades duplicadas.'
        : layers.length === 0
        ? 'Na timeline da régua "' + layout.name + '", adicione o comentário "' + layerComment + '" à camada da mecânica deste produto.'
        : 'Na timeline da régua "' + layout.name + '", mantenha o comentário "' + layerComment + '" apenas na camada da mecânica deste produto.');
    }
    const mechanicLayer = layers[0];
    if (!(mechanicLayer instanceof AVLayer) || !(mechanicLayer.source instanceof CompItem)) {
      return unavailable(resolution, 'A camada com o comentário "' + layerComment + '" não possui uma precomp válida.',
        "Confira a origem da camada da mecânica deste produto.");
    }
    const offerFolder = offerResolution.folder;
    const mechanicsFolderComment = config.projectItems.mechanicsFolder.comment;
    const folderCandidates: FolderItem[] = [];
    for (let index = 1; index <= offerFolder.numItems; index += 1) {
      const item = offerFolder.item(index);
      if (item instanceof FolderItem && item.parentFolder === offerFolder) folderCandidates.push(item);
    }
    const mechanicsFolders = resolveTemplateIdentity(folderCandidates, config.projectItems.mechanicsFolder,
      config.fallback.projectItems, isTemplateProjectItemComment).matches;
    const folderLocation = 'diretamente na pasta com o comentário "' + offerMenu.context.folderComment + '"';
    if (mechanicsFolders.length !== 1) {
      return unavailable(resolution, config.fallback.projectItems
        ? (mechanicsFolders.length === 0 ? 'Nenhuma pasta' : 'Mais de uma pasta') + ' de mecânicas foi identificada ' + folderLocation + ' por comentário ou nome.'
        : mechanicsFolders.length === 0
        ? 'Nenhuma pasta ' + folderLocation + ' tem o comentário "' + mechanicsFolderComment + '".'
        : 'Mais de uma pasta ' + folderLocation + ' tem o comentário "' + mechanicsFolderComment + '".',
      config.fallback.projectItems
        ? 'No painel Projeto, confira o comentário ou nome "' + mechanicsFolderComment + '" ' + folderLocation + ' e elimine identidades duplicadas.'
        : mechanicsFolders.length === 0
        ? 'No painel Projeto, adicione o comentário "' + mechanicsFolderComment + '" à pasta de mecânicas ' + folderLocation + "."
        : 'No painel Projeto, mantenha uma única pasta com o comentário "' + mechanicsFolderComment + '" ' + folderLocation + ".");
    }
    const mechanicsFolder = mechanicsFolders[0];
    const comps = collectMechanicComps(mechanicsFolder);
    const source = mechanicLayer.source as CompItem;
    resolution.layouts = includeCurrentLayout(offerResolution.targets, layout);
    resolution.offer = offerResolution.offer;
    resolution.menu.context = {
      offer: offerMenu.context,
      productIndex,
      mechanicLayerIndex: mechanicLayer.index,
      mechanicLayerId: readLayerId(mechanicLayer),
      mechanicLayerComment: layerComment,
      mechanicSourceItemId: source.id,
      mechanicsFolderItemId: mechanicsFolder.id,
    };
    for (let catalogIndex = 0; catalogIndex < MECHANIC_CATALOG.length; catalogIndex += 1) {
      const definition = MECHANIC_CATALOG[catalogIndex];
      const identity = expandTemplateIdentity(config.mechanics[definition.family], productIndex + 1);
      const comment = identity.comment;
      const pool = resolveMechanicPool(comps, definition.family, productIndex);
      const matches = pool.matches;
      let cycle = false;
      for (let index = 0; index < matches.length; index += 1) {
        if (mechanicWouldCreateCycle(matches[index], layout.id, offerMenu.context.compItemId)) cycle = true;
      }
      let current = false;
      for (let index = 0; index < matches.length; index += 1) if (matches[index].id === source.id) current = true;
      const option: OfferLayoutOption = {
        comment, label: definition.label, itemId: null, current, enabled: false,
      };
      if (matches.length === 0 || pool.ambiguous) {
        option.disabledSummary = matches.length === 0
          ? 'Esta mecânica não foi encontrada na oferta "' + offerMenu.context.folderComment + '".'
          : 'Há mais de uma precomp desta mecânica na oferta "' + offerMenu.context.folderComment + '".';
        option.disabledReason = pool.ambiguous && definition.family !== "SIMPLES"
          ? 'Na pasta "' + mechanicsFolderComment + '", diferencie as cópias de "' + comment + '" com sufixos numéricos distintos nos nomes ou comentários.'
          : config.fallback.projectItems
          ? 'No painel Projeto, confira o comentário ou nome "' + comment + '" na pasta "' + mechanicsFolderComment + '" e suas subpastas e elimine identidades duplicadas.'
          : matches.length === 0
          ? 'No painel Projeto, adicione o comentário "' + comment + '" à precomp na pasta de comentário "' + mechanicsFolderComment + '" ou em suas subpastas.'
          : 'Na pasta de comentário "' + mechanicsFolderComment + '" e suas subpastas, mantenha o comentário "' + comment + '" em apenas uma precomp.';
      } else if (cycle) {
        option.disabledSummary = "Esta mecânica referencia a própria oferta ou o Miolo.";
        option.disabledReason = "Use uma mecânica que não contenha a oferta ou o Miolo, inclusive em precomps internas.";
      } else {
        option.enabled = true;
        option.itemId = matches[0].id;
        resolution.targets.push(matches[0]);
        resolution.pools.push({ family: definition.family, representative: matches[0], instances: matches });
      }
      resolution.menu.options.push(option);
    }
    resolution.mechanicLayer = mechanicLayer;
    resolution.menu.ok = true;
    resolution.menu.message = "Mecânicas do produto carregadas.";
    return resolution;
  } catch (error) {
    resolution.menu.context = null;
    resolution.menu.options = [];
    resolution.targets = [];
    resolution.pools = [];
    resolution.layouts = [];
    resolution.offer = null;
    resolution.mechanicLayer = null;
    resolution.menu.errors.push(String(error));
    return unavailable(resolution, "Não foi possível ler as mecânicas deste produto.",
      "Atualize a lista e confira os comentários da camada e das pastas da oferta.");
  }
});

export const getOfferMechanicOptions = (offerLayerIndex: number, productIndex: number): OfferMechanicMenuData =>
  resolveOfferMechanics(offerLayerIndex, productIndex).menu;
