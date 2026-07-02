export const getProjectIdentity = (): {
  projectKey: string;
  projectName: string;
} => {
  if (app.project === null || app.project.file === null) {
    return { projectKey: "", projectName: "" };
  }

  return {
    projectKey: app.project.file.fsName,
    projectName: app.project.file.name,
  };
};
