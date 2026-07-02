import { evalTS } from "../../../../../lib/utils/bolt";

export const loadProjectProductsDirectory = async () => {
  if (!window.cep) {
    throw new Error("Abra este painel dentro do After Effects para localizar os produtos.");
  }

  return evalTS("getProjectProductsDirectory");
};
