export type OpenProjectResult = {
  status: "opened" | "cancelled" | "error";
  projectChanged: boolean;
  message: string;
  errors: string[];
};

export const openProject = (): OpenProjectResult => {
  const result: OpenProjectResult = {
    status: "cancelled",
    projectChanged: false,
    message: "",
    errors: [],
  };
  let stage = "selecionar o projeto";

  // Closing/opening projects and purging caches are not undoable edits. An
  // undo group must not span the closing of one project and opening of another.
  try {
    const projectFile = app.project === null ? null : app.project.file;
    const prompt = "Selecione o projeto do After Effects";
    const filter = "Projetos do After Effects:*.aep;*.aepx";
    // The instance dialog starts in this file's parent folder and lets the
    // user select this project again or browse to any other folder.
    const selected = (
      projectFile && projectFile.parent.exists
        ? projectFile.openDlg(prompt, filter, false)
        : File.openDialog(prompt, filter, false)
    ) as File | null;
    if (selected === null) return result;

    if (!selected.exists) {
      result.status = "error";
      result.message = "O arquivo selecionado não foi encontrado.";
      return result;
    }
    if (!/\.aepx?$/i.test(String(selected.name))) {
      result.status = "error";
      result.message = "Selecione um projeto do After Effects (.aep ou .aepx).";
      return result;
    }

    stage = "fechar o projeto atual";
    if (app.project !== null) {
      if (!app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES)) return result;
      // Even if a subsequent operation fails, the CEP must discard old data.
      result.projectChanged = true;
    }

    try {
      app.purge(PurgeTarget.ALL_CACHES);
    } catch (error) {
      // Cache cleanup is optional for opening. Continue so a purge failure
      // does not leave the user without a project after closing the old one.
      result.errors.push("Não foi possível limpar os caches: " + String(error));
    }

    stage = "abrir o projeto selecionado";
    // A failed open can still affect the host's state; refresh the CEP then too.
    result.projectChanged = true;
    const openedProject = app.open(selected);
    if (openedProject === null) {
      result.status = "error";
      result.message = "O After Effects não abriu o projeto selecionado.";
      return result;
    }

    result.status = "opened";
    result.message = result.errors.length > 0
      ? "Projeto aberto, mas não foi possível limpar os caches."
      : "Projeto aberto.";
    return result;
  } catch (error) {
    result.status = "error";
    result.message = "Não foi possível " + stage + ".";
    result.errors.push(String(error));
    return result;
  }
};
