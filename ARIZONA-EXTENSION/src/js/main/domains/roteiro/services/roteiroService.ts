import { evalTS } from "../../../../lib/utils/bolt";

export const loadProjectRoteiroInfo = () => {
  if (!window.cep) {
    throw new Error(
      "Abra este painel dentro do After Effects para localizar o roteiro."
    );
  }

  return evalTS("getProjectRoteiroInfo") as Promise<{
    roteiroDirectory: string;
    projectName: string;
  }>;
};
