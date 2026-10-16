import type { InternalLegalControl, OfferLegalOptionsContext, OfferOption } from "../types";
import type { TemplateIdentity } from "../../template/templateIdentities";
import { getTemplateIdentities, normalizeTemplateIdentity } from "../../template/templateIdentities";
import { getProjectIdentity } from "../../project/projectIdentity";
import { getLayerByIndex, getLayerSource, getOffersComp } from "./findLayers";
import { findOfferStructureLayer } from "./offerStructure";
import { getSourceTextProperty } from "./textFields";

export const BANNER_CONTROL_ID = "tarja-eletro-pneu";

export interface ResolvedBannerOptions {
  layer: Layer;
  source: CompItem;
  candidates: Layer[];
  options: OfferOption[];
  selectedIndex: number;
  context?: OfferLegalOptionsContext;
}

const hasName = (value: string, names: string[]): boolean => {
  const normalized = normalizeTemplateIdentity(value);
  for (let index = 0; index < names.length; index += 1) {
    if (normalized === normalizeTemplateIdentity(names[index])) return true;
  }
  return false;
};

const stableId = (value: { id: number }): number => {
  const id = value.id;
  if (typeof id !== "number" || !isFinite(id) || id <= 0 || Math.floor(id) !== id) {
    throw new Error("Eletro/Pneu requer IDs estaveis das camadas e precomps (After Effects 22 ou superior).");
  }
  return id;
};

// Length prefixes keep arbitrary user text, newlines and delimiters unambiguous.
const revisionPart = (value: string | number | boolean): string => {
  const text = String(value);
  return text.length + ":" + text;
};
const layerRevision = (layer: Layer): string =>
  revisionPart(stableId(layer)) + revisionPart(layer.index) + revisionPart(layer.name) +
  revisionPart(layer.comment || "") + revisionPart(layer.enabled) + revisionPart(layer.locked === true);

const parentBannerLayer = (legalSource: CompItem): Layer => {
  const config = getTemplateIdentities();
  const identity = config.banners.eletroPneu;
  const sourceMatches: Layer[] = [];
  const nameMatches: Layer[] = [];
  for (let index = 1; index <= legalSource.numLayers; index += 1) {
    const layer = getLayerByIndex(legalSource, index);
    if (layer === null || !(layer instanceof AVLayer) || !(layer.source instanceof CompItem)) continue;
    if (hasName(layer.source.name, identity.sourceNames)) sourceMatches.push(layer);
    else if (config.fallback.offerLayers && hasName(layer.name, identity.layerNames)) nameMatches.push(layer);
  }
  const matches = sourceMatches.length > 0 ? sourceMatches : nameMatches;
  if (matches.length !== 1) {
    throw new Error(matches.length > 1 ? "Mais de uma camada Eletro/Pneu existe no texto legal."
      : "Precomp Eletro/Pneu nao encontrada no texto legal pelos nomes configurados.");
  }
  return matches[0];
};

const readFixedLayer = (layers: Layer[], identity: TemplateIdentity, fallback: boolean): Layer => {
  const comments: Layer[] = [];
  const names: Layer[] = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const comment = normalizeTemplateIdentity(layer.comment || "");
    if (comment === normalizeTemplateIdentity(identity.comment)) comments.push(layer);
    else if (comment === "" && fallback && hasName(layer.name, identity.names)) names.push(layer);
  }
  const matches = comments.length > 0 ? comments : names;
  if (matches.length !== 1) {
    throw new Error("Eletro/Pneu: " + identity.comment + (matches.length > 1 ? " esta duplicado." : " nao foi encontrado."));
  }
  if (!(matches[0] instanceof TextLayer) || getSourceTextProperty(matches[0]) === null) {
    throw new Error("Eletro/Pneu: " + identity.comment + " deve identificar uma camada de texto.");
  }
  return matches[0];
};

// This reader never calls generateOfferData/readLegalControls and never mutates
// native objects. Actions use it again before opening their undo group.
export const resolveBannerOptions = (
  legalSource: CompItem,
  offer?: Layer
): ResolvedBannerOptions => {
  const config = getTemplateIdentities();
  const definitions = config.banners.eletroPneu.layers;
  const layer = parentBannerLayer(legalSource);
  const source = (layer as AVLayer).source as CompItem;
  const layers: Layer[] = [];
  for (let index = 1; index <= source.numLayers; index += 1) {
    const candidate = getLayerByIndex(source, index);
    if (candidate !== null) layers.push(candidate);
  }
  const electro = readFixedLayer(layers, definitions.electro, config.fallback.offerLayers);
  const tire = readFixedLayer(layers, definitions.tire, config.fallback.offerLayers);
  if (electro === tire) throw new Error("Eletro/Pneu possui identidades conflitantes.");
  const candidates: Layer[] = [];
  const options: OfferOption[] = [];
  const ids: { [id: string]: boolean } = {};
  let revision = layerRevision(layer);
  let selectedIndex = -1;
  let enabledCount = 0;
  for (let index = 0; index < layers.length; index += 1) {
    const candidate = layers[index];
    const comment = normalizeTemplateIdentity(candidate.comment || "");
    // Infrastructure stays excluded even in older templates without comments.
    const infrastructure = comment === normalizeTemplateIdentity(definitions.control.comment) ||
      comment === normalizeTemplateIdentity(definitions.background.comment) ||
      hasName(candidate.name, definitions.control.names) || hasName(candidate.name, definitions.background.names);
    if (infrastructure) {
      if (candidate === electro || candidate === tire) throw new Error("Eletro/Pneu: texto fixo conflita com infraestrutura.");
      continue;
    }
    if (!(candidate instanceof TextLayer)) continue;
    if (candidate !== electro && candidate !== tire && comment !== "") continue;
    const property = getSourceTextProperty(candidate);
    if (property === null) throw new Error("Eletro/Pneu: nao foi possivel ler uma camada de texto.");
    const id = String(stableId(candidate));
    if (ids["$" + id]) throw new Error("Eletro/Pneu possui IDs de camadas duplicados.");
    ids["$" + id] = true;
    const label = candidate.name;
    revision += layerRevision(candidate);
    if (candidate.enabled) { selectedIndex = candidates.length; enabledCount += 1; }
    candidates.push(candidate);
    options.push({ id, label });
  }
  if (enabledCount !== 1) selectedIndex = -1;
  const resolved: ResolvedBannerOptions = { layer, source, candidates, options, selectedIndex };
  if (offer) {
    const errors: string[] = [];
    const miolo = getOffersComp(false, errors);
    const offerSource = getLayerSource(offer, "oferta", errors);
    const legalLayer = findOfferStructureLayer(offerSource, "legal", errors);
    if (miolo === null || offerSource === null || legalLayer === null || !(legalLayer instanceof AVLayer) || legalLayer.source !== legalSource) {
      throw new Error("A origem do texto legal mudou. Atualize a oferta.");
    }
    const projectKey = getProjectIdentity().projectKey;
    if (projectKey === "") throw new Error("Salve o projeto antes de alterar Eletro/Pneu.");
    revision += layerRevision(offer) + layerRevision(legalLayer);
    // Also reject a menu created under a different configured identity policy.
    revision += revisionPart(JSON.stringify(config.banners)) + revisionPart(config.fallback.offerLayers);
    resolved.context = {
      projectKey,
      offersCompId: stableId(miolo),
      offerLayerId: stableId(offer),
      offerLayerIndex: offer.index,
      offerSourceId: stableId(offerSource),
      legalLayerId: stableId(legalLayer),
      legalSourceId: stableId(legalSource),
      bannerLayerId: stableId(layer),
      bannerSourceId: stableId(source),
      revision,
    };
  }
  return resolved;
};

export const readBannerControl = (legalSource: CompItem | null, errors: string[], offer?: Layer): InternalLegalControl => {
  const control: InternalLegalControl = {
    id: BANNER_CONTROL_ID, label: "Eletro/Pneu", layerIndex: 0,
    enabled: false, available: false, locked: false, slider: null,
    optionGroup: { id: "eletro-pneu-menu", label: "Menu", type: "layers", options: [], selectedIndex: -1, enabled: false },
  };
  try {
    if (legalSource === null) throw new Error("Texto legal indisponivel para Eletro/Pneu.");
    const resolved = resolveBannerOptions(legalSource, offer);
    control.layerIndex = resolved.layer.index;
    control.enabled = resolved.layer.enabled;
    const parentLocked = resolved.layer.locked === true;
    const offerLocked = offer !== undefined && offer.locked === true;
    control.available = resolved.context !== undefined && !parentLocked && !offerLocked;
    const group = control.optionGroup!;
    group.options = resolved.options;
    group.selectedIndex = resolved.selectedIndex;
    group.context = resolved.context;
    group.enabled = control.available && resolved.candidates.length > 0;
    for (let index = 0; index < resolved.candidates.length; index += 1) {
      if (resolved.candidates[index].locked === true) {
        group.enabled = false;
        group.disabledSummary = "Ha texto bloqueado na tarja.";
        group.disabledReason = "Desbloqueie as camadas de texto da tarja no After Effects.";
      }
    }
    if (parentLocked || offerLocked) {
      control.disabledSummary = "A camada da oferta ou da tarja esta bloqueada.";
      control.disabledReason = "Desbloqueie a camada no After Effects.";
    }
  } catch (error) {
    const reason = String(error);
    errors.push(reason);
    control.disabledSummary = "Eletro/Pneu indisponivel.";
    control.disabledReason = reason;
    control.optionGroup!.disabledSummary = control.disabledSummary;
    control.optionGroup!.disabledReason = reason;
  }
  return control;
};

export const assertBannerContext = (current: OfferLegalOptionsContext | undefined, expected: OfferLegalOptionsContext | undefined): void => {
  if (!current || !expected || current.projectKey !== expected.projectKey ||
    current.offersCompId !== expected.offersCompId || current.offerLayerId !== expected.offerLayerId ||
    current.offerLayerIndex !== expected.offerLayerIndex || current.offerSourceId !== expected.offerSourceId ||
    current.legalLayerId !== expected.legalLayerId || current.legalSourceId !== expected.legalSourceId ||
    current.bannerLayerId !== expected.bannerLayerId || current.bannerSourceId !== expected.bannerSourceId ||
    current.revision !== expected.revision) {
    throw new Error("O menu Eletro/Pneu mudou. Atualize a oferta e selecione novamente.");
  }
};
