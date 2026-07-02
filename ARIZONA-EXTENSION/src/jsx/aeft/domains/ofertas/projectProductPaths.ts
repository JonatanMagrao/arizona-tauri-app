const PRODUCTS_DIRECTORY_NAME = "PRODUTOS";
const PROJECT_PRODUCTS_PARENT_LEVELS = 2;

export const getProjectProductsDirectory = () => {
  if (app.project === null || app.project.file === null) {
    throw new Error("Salve o projeto do After Effects antes de carregar os produtos.");
  }

  let baseFolder = app.project.file.parent;

  for (let level = 0; level < PROJECT_PRODUCTS_PARENT_LEVELS; level += 1) {
    baseFolder = baseFolder.parent;
  }

  return new Folder(baseFolder.fsName + "/" + PRODUCTS_DIRECTORY_NAME).fsName;
};
