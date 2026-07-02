import { evalTS } from "../../lib/utils/bolt";

export interface ProjectIdentity {
  projectKey: string;
  projectName: string;
}

export const loadProjectIdentity = () => {
  if (!window.cep) {
    return Promise.resolve({ projectKey: "", projectName: "" });
  }

  return evalTS("getProjectIdentity") as Promise<ProjectIdentity>;
};
