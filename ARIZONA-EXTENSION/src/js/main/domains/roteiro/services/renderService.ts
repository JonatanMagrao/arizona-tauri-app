import { evalTS } from "../../../../lib/utils/bolt";

export interface QueueActiveCompRenderOutputsResult {
  ok: boolean;
  message: string;
  activeCompName: string;
  mp4CompName: string;
  movPath: string;
  mp4Path: string;
  queuedItems: number;
}

export const queueActiveCompRenderOutputs = () => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects.");
  }

  return evalTS(
    "queueActiveCompRenderOutputs"
  ) as Promise<QueueActiveCompRenderOutputsResult>;
};
