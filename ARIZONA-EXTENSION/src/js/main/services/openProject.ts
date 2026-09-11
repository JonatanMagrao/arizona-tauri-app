import { evalTS } from "../../lib/utils/bolt";

export interface OpenProjectResult {
  status: "opened" | "cancelled" | "error";
  projectChanged: boolean;
  message: string;
  errors: string[];
}

export const openProjectFromDialog = (): Promise<OpenProjectResult> => {
  if (!window.cep) {
    return Promise.resolve({
      status: "error",
      projectChanged: false,
      message: "Abra este painel dentro do After Effects para escolher um projeto.",
      errors: [],
    });
  }

  return evalTS("openProject");
};
