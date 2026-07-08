export interface TimelineMarkerActionResult {
  ok: boolean;
  action: string;
  message: string;
  selectedLayers: number;
  movedLayers: number;
  movedJumpMarkers: number;
  movedCompMarker: boolean;
}

export interface OpenTimelineCompPreviewResult {
  ok: boolean;
  message: string;
  compName: string;
}

interface LabelMarkerMap {
  [label: number]: number;
}

const TIMELINE_COMP_NAME = "Miolo";
const LABEL_TO_MARKER_INDEX: LabelMarkerMap = {
  1: 1,
  2: 2,
  8: 3,
  9: 4,
  10: 5,
  11: 6,
};

const JUMP_MARKER_INDEX = 2;
const TAIL_MARKER_START_INDEX = 2;
const TAIL_MARKER_END_INDEX = 6;
const TAIL_MARKER_SPACING_SECONDS = 1;

const createResult = (action: string): TimelineMarkerActionResult => ({
  ok: false,
  action,
  message: "",
  selectedLayers: 0,
  movedLayers: 0,
  movedJumpMarkers: 0,
  movedCompMarker: false,
});

const findTimelineComp = (): CompItem | null => {
  if (app.project === null) return null;

  for (let index = 1; index <= app.project.numItems; index += 1) {
    const item = app.project.item(index);

    if (item instanceof CompItem && item.name === TIMELINE_COMP_NAME) {
      return item;
    }
  }

  return null;
};

const openTimelineCompInViewer = (comp: CompItem): void => {
  if (app.project !== null && app.project.activeItem === comp) {
    return;
  }

  const viewer = comp.openInViewer();

  if (viewer !== null) {
    viewer.setActive();
  }
};

const getTimelineComp = (openInViewer: boolean = false): CompItem | null => {
  const comp = findTimelineComp();

  if (comp !== null && openInViewer) {
    openTimelineCompInViewer(comp);
  }

  return comp;
};

export const openTimelineCompPreview = (): OpenTimelineCompPreviewResult => {
  const comp = getTimelineComp(true);

  if (comp === null) {
    return {
      ok: false,
      message: 'Precomp "Miolo" nao encontrada.',
      compName: "",
    };
  }

  return {
    ok: true,
    message: 'Precomp "Miolo" aberta.',
    compName: comp.name,
  };
};

const getMarkerIndexForLayer = (layer: Layer): number => {
  const markerIndex = LABEL_TO_MARKER_INDEX[layer.label];
  return markerIndex || 0;
};

const isLayerVisibleInTimeline = (layer: Layer, comp: CompItem): boolean =>
  !layer.shy || !comp.hideShyLayers;

const clearLayerSelection = (comp: CompItem): void => {
  for (let index = 1; index <= comp.numLayers; index += 1) {
    comp.layer(index).selected = false;
  }
};

const hasJumpMarker = (layer: Layer): boolean =>
  layer.marker.numKeys >= JUMP_MARKER_INDEX;

const selectOfferLayersAtTime = (
  comp: CompItem,
  markerIndex: number,
  startTime: number,
  epsilon: number
): number => {
  let selectedLayers = 0;

  clearLayerSelection(comp);

  for (let index = 1; index <= comp.numLayers; index += 1) {
    const layer = comp.layer(index);
    if (layer.locked) continue;
    if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
    if (!isLayerVisibleInTimeline(layer, comp)) continue;
    if (!hasJumpMarker(layer)) continue;
    if (Math.abs(layer.startTime - startTime) > epsilon) continue;

    layer.selected = true;
    selectedLayers += 1;
  }

  return selectedLayers;
};

const getTailMarkerTime = (comp: CompItem, markerIndex: number): number => {
  const lastTime = Math.max(0, comp.duration - comp.frameDuration);
  const secondsFromEnd =
    (TAIL_MARKER_END_INDEX - markerIndex) * TAIL_MARKER_SPACING_SECONDS;

  return Math.max(0, lastTime - secondsFromEnd);
};

const findLayerGroupStartTimeForMarker = (
  comp: CompItem,
  markerIndex: number,
  preferredTime: number,
  epsilon: number
): number | null => {
  let firstStartTime: number | null = null;

  for (let index = 1; index <= comp.numLayers; index += 1) {
    const layer = comp.layer(index);
    if (layer.locked) continue;
    if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
    if (!hasJumpMarker(layer)) continue;

    if (firstStartTime === null) {
      firstStartTime = layer.startTime;
    }

    if (Math.abs(layer.startTime - preferredTime) <= epsilon) {
      return layer.startTime;
    }
  }

  return firstStartTime;
};

const moveLayerGroupToTime = (
  comp: CompItem,
  markerIndex: number,
  sourceTime: number,
  targetTime: number,
  epsilon: number
): number => {
  let movedLayers = 0;

  for (let index = 1; index <= comp.numLayers; index += 1) {
    const layer = comp.layer(index);
    if (layer.locked) continue;
    if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
    if (Math.abs(layer.startTime - sourceTime) > epsilon) continue;

    if (Math.abs(layer.startTime - targetTime) > epsilon) {
      layer.startTime = targetTime;
      movedLayers += 1;
    }
  }

  return movedLayers;
};

export const adjustTimelineMarkersToTail = (): TimelineMarkerActionResult => {
  const result = createResult("adjust-markers-to-tail");
  const comp = getTimelineComp(true);

  if (comp === null) {
    result.message = 'Precomp "Miolo" nao encontrada.';
    return result;
  }

  if (comp.markerProperty.numKeys < TAIL_MARKER_END_INDEX) {
    result.message = 'A precomp "Miolo" precisa ter os marcadores 1 a 6.';
    return result;
  }

  app.beginUndoGroup("Ajustar markers para o fundo");

  try {
    const epsilon = comp.frameDuration / 2;
    const markerProperty = comp.markerProperty;
    const firstMarkerTime = markerProperty.keyTime(1);
    const firstGroupStartTime = findLayerGroupStartTimeForMarker(
      comp,
      1,
      firstMarkerTime,
      epsilon
    );
    const markerValues: MarkerValue[] = [];
    const markerTimes: number[] = [];
    const groupStartTimes: Array<number | null> = [];

    for (
      let markerIndex = TAIL_MARKER_START_INDEX;
      markerIndex <= TAIL_MARKER_END_INDEX;
      markerIndex += 1
    ) {
      const markerTime = markerProperty.keyTime(markerIndex);

      markerValues[markerIndex] = markerProperty.keyValue(markerIndex);
      markerTimes[markerIndex] = markerTime;
      groupStartTimes[markerIndex] = findLayerGroupStartTimeForMarker(
        comp,
        markerIndex,
        markerTime,
        epsilon
      );
    }

    for (
      let markerIndex = TAIL_MARKER_END_INDEX;
      markerIndex >= TAIL_MARKER_START_INDEX;
      markerIndex -= 1
    ) {
      markerProperty.removeKey(markerIndex);
    }

    for (
      let markerIndex = TAIL_MARKER_START_INDEX;
      markerIndex <= TAIL_MARKER_END_INDEX;
      markerIndex += 1
    ) {
      const targetTime = getTailMarkerTime(comp, markerIndex);

      markerProperty.setValueAtTime(targetTime, markerValues[markerIndex]);

      if (Math.abs(markerTimes[markerIndex] - targetTime) > epsilon) {
        result.movedCompMarker = true;
      }

      if (groupStartTimes[markerIndex] !== null) {
        result.movedLayers += moveLayerGroupToTime(
          comp,
          markerIndex,
          groupStartTimes[markerIndex] as number,
          targetTime,
          epsilon
        );
      }
    }

    const firstTime =
      firstGroupStartTime !== null ? firstGroupStartTime : firstMarkerTime;

    comp.time = Math.max(0, Math.min(comp.duration, firstTime));
    result.selectedLayers = selectOfferLayersAtTime(
      comp,
      1,
      comp.time,
      epsilon
    );
    result.ok = true;
    result.message =
      "Markers ajustados. " +
      result.movedLayers +
      " layer(s) movida(s); oferta 1 selecionada.";
  } catch (error) {
    result.message =
      error instanceof Error ? error.message : "Erro ao ajustar markers.";
  } finally {
    app.endUndoGroup();
  }

  return result;
};
