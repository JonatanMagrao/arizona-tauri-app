import type { OfferLayoutOption, OfferMechanicMenuData } from "../types";
import type { MechanicSchemaId } from "../mechanics/schemaValidation";
import { resolveOfferLayouts } from "./offerLayouts";

interface MechanicCatalogEntry {
  family: MechanicSchemaId;
  label: string;
  perProduct: boolean;
}

// Selection policy belongs here: only Simples currently has one copy per product.
// Changing another family to perProduct keeps discovery and mutation in sync.
const MECHANIC_CATALOG: MechanicCatalogEntry[] = [
  { family: "SIMPLES", label: "Simples", perProduct: true },
  { family: "TODOS A COM X% DESCONTO", label: "Todos a com X% desconto", perProduct: false },
  { family: "DESCONTO R$ CARTAO CRF", label: "Desconto R$ Cartão CRF", perProduct: false },
  { family: "DE X POR Y PARCELAMENTO", label: "De X por Y parcelamento", perProduct: false },
  { family: "DE X POR Y MEU CRF POR Z CARTAO CRF", label: "De X por Y Meu CRF por Z Cartão CRF", perProduct: false },
  { family: "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y", label: "De X por Y | X% desconto | Leve X pague Y", perProduct: false },
  { family: "TODOS A COM LEVE X PAGUE Y", label: "Todos a com Leve X pague Y", perProduct: false },
];

export interface ResolvedOfferMechanics {
  menu: OfferMechanicMenuData;
  mechanicLayer: AVLayer | null;
  targets: CompItem[];
}

const normalizeComment = (comment: string): string =>
  String(comment || "").replace(/^\s+|\s+$/g, "").toUpperCase();

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
});

const unavailable = (resolution: ResolvedOfferMechanics, summary: string, reason: string): ResolvedOfferMechanics => {
  resolution.menu.message = summary;
  resolution.menu.disabledSummary = summary;
  resolution.menu.disabledReason = reason;
  return resolution;
};

const collectMechanicComps = (root: FolderItem): CompItem[] => {
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

const wouldCreateCycle = (target: CompItem, layoutId: number, mioloId: number): boolean => {
  const pending: CompItem[] = [target];
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

export const resolveOfferMechanics = (offerLayerIndex: number, productIndex: number): ResolvedOfferMechanics => {
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
    const layout = offerResolution.offer.source as CompItem;
    const layerComment = "MECANICA " + (productIndex + 1);
    const layers: Layer[] = [];
    for (let index = 1; index <= layout.numLayers; index += 1) {
      const layer = layout.layer(index);
      if (normalizeComment(layer.comment) === layerComment) layers.push(layer);
    }
    if (layers.length !== 1) {
      return unavailable(resolution, layers.length === 0
        ? 'Nenhuma camada na régua "' + layout.name + '" tem o comentário "' + layerComment + '".'
        : 'Mais de uma camada na régua "' + layout.name + '" tem o comentário "' + layerComment + '".',
      layers.length === 0
        ? 'Na timeline da régua "' + layout.name + '", adicione o comentário "' + layerComment + '" à camada da mecânica deste produto.'
        : 'Na timeline da régua "' + layout.name + '", mantenha o comentário "' + layerComment + '" apenas na camada da mecânica deste produto.');
    }
    const mechanicLayer = layers[0];
    if (!(mechanicLayer instanceof AVLayer) || !(mechanicLayer.source instanceof CompItem)) {
      return unavailable(resolution, 'A camada com o comentário "' + layerComment + '" não possui uma precomp válida.',
        "Confira a origem da camada da mecânica deste produto.");
    }
    const offerFolder = offerResolution.folder;
    const mechanicsFolders: FolderItem[] = [];
    for (let index = 1; index <= offerFolder.numItems; index += 1) {
      const item = offerFolder.item(index);
      if (item instanceof FolderItem && item.parentFolder === offerFolder && normalizeComment(item.comment) === "MECANICAS") {
        mechanicsFolders.push(item);
      }
    }
    const folderLocation = 'diretamente na pasta com o comentário "' + offerMenu.context.folderComment + '"';
    if (mechanicsFolders.length !== 1) {
      return unavailable(resolution, mechanicsFolders.length === 0
        ? 'Nenhuma pasta ' + folderLocation + ' tem o comentário "MECANICAS".'
        : 'Mais de uma pasta ' + folderLocation + ' tem o comentário "MECANICAS".',
      mechanicsFolders.length === 0
        ? 'No painel Projeto, adicione o comentário "MECANICAS" à pasta de mecânicas ' + folderLocation + "."
        : 'No painel Projeto, mantenha uma única pasta com o comentário "MECANICAS" ' + folderLocation + ".");
    }
    const mechanicsFolder = mechanicsFolders[0];
    const comps = collectMechanicComps(mechanicsFolder);
    const source = mechanicLayer.source as CompItem;
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
      const comment = definition.family + (definition.perProduct ? " " + (productIndex + 1) : "");
      const matches: CompItem[] = [];
      let current = false;
      for (let index = 0; index < comps.length; index += 1) {
        if (normalizeComment(comps[index].comment) !== comment) continue;
        matches.push(comps[index]);
        if (comps[index].id === source.id) current = true;
      }
      const option: OfferLayoutOption = {
        comment, label: definition.label, itemId: null, current, enabled: false,
      };
      if (matches.length !== 1) {
        option.disabledSummary = matches.length === 0
          ? 'Esta mecânica não foi encontrada na oferta "' + offerMenu.context.folderComment + '".'
          : 'Há mais de uma precomp desta mecânica na oferta "' + offerMenu.context.folderComment + '".';
        option.disabledReason = matches.length === 0
          ? 'No painel Projeto, adicione o comentário "' + comment + '" à precomp na pasta de comentário "MECANICAS" ou em suas subpastas.'
          : 'Na pasta de comentário "MECANICAS" e suas subpastas, mantenha o comentário "' + comment + '" em apenas uma precomp.';
      } else if (wouldCreateCycle(matches[0], layout.id, offerMenu.context.compItemId)) {
        option.disabledSummary = "Esta mecânica referencia a própria oferta ou o Miolo.";
        option.disabledReason = "Use uma mecânica que não contenha a oferta ou o Miolo, inclusive em precomps internas.";
      } else {
        option.enabled = true;
        option.itemId = matches[0].id;
        resolution.targets.push(matches[0]);
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
    resolution.mechanicLayer = null;
    resolution.menu.errors.push(String(error));
    return unavailable(resolution, "Não foi possível ler as mecânicas deste produto.",
      "Atualize a lista e confira os comentários da camada e das pastas da oferta.");
  }
};

export const getOfferMechanicOptions = (offerLayerIndex: number, productIndex: number): OfferMechanicMenuData =>
  resolveOfferMechanics(offerLayerIndex, productIndex).menu;
