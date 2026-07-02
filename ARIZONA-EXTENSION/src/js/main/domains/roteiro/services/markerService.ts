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

export const adjustTimelineMarkersToTail = () => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects.");
  }

  return evalTS(
    "adjustTimelineMarkersToTail"
  ) as Promise<TimelineMarkerActionResult>;
};
