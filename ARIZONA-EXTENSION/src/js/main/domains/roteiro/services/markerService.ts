import { evalTS } from "../../../../lib/utils/bolt";

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

export const adjustTimelineMarkersToTail = () => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects.");
  }

  return evalTS(
    "adjustTimelineMarkersToTail"
  ) as Promise<TimelineMarkerActionResult>;
};

export const openTimelineCompPreview = () => {
  if (!window.cep) {
    return Promise.resolve({
      ok: false,
      message: "Abra este painel dentro do After Effects.",
      compName: "",
    });
  }

  return evalTS(
    "openTimelineCompPreview"
  ) as Promise<OpenTimelineCompPreviewResult>;
};
