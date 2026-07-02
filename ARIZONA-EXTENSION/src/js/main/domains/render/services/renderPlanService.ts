import { evalTS } from "../../../../lib/utils/bolt";
import type { PrepareAerenderRenderPlanResult } from "../types";

export const prepareAerenderRenderPlan = (saveProjectBeforeRender = true) => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects.");
  }

  return evalTS(
    "prepareAerenderRenderPlan",
    saveProjectBeforeRender
  ) as Promise<PrepareAerenderRenderPlanResult>;
};
