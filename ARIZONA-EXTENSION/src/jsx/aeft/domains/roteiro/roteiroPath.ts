const ROTEIRO_DIRECTORY_NAME = "ROTEIRO";
const PROJECT_ROTEIRO_PARENT_LEVELS = 2;

export const getProjectRoteiroInfo = (): {
  roteiroDirectory: string;
  projectName: string;
} => {
  if (app.project === null || app.project.file === null) {
    throw new Error(
      "Salve o projeto do After Effects antes de carregar o roteiro."
    );
  }

  let baseFolder = app.project.file.parent;

  for (let level = 0; level < PROJECT_ROTEIRO_PARENT_LEVELS; level += 1) {
    baseFolder = baseFolder.parent;
  }

  return {
    roteiroDirectory: new Folder(
      baseFolder.fsName + "/" + ROTEIRO_DIRECTORY_NAME
    ).fsName,
    projectName: app.project.file.name,
  };
};
