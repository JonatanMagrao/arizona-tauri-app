import { useCallback, useRef, useState } from "react";
import { openProjectFromDialog } from "../services/openProject";
import { getPublicErrorMessage } from "../utils/errors";

export const useProjectOpening = (reloadProject: () => Promise<void>) => {
  const openingRef = useRef(false);
  const [isOpeningProject, setIsOpeningProject] = useState(false);

  const openProject = useCallback(async () => {
    if (!window.cep || openingRef.current) return;

    openingRef.current = true;
    setIsOpeningProject(true);
    let message = "";
    let shouldReload = false;

    try {
      // Let React remove the editors and their pending timers/shortcuts before
      // opening a modal host dialog (evalScript can block the CEP thread).
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const result = await openProjectFromDialog();
      shouldReload = result.status === "opened" || result.projectChanged;
      if (result.status === "error" || result.errors.length > 0) {
        message = getPublicErrorMessage(
          result.message,
          "Não foi possível concluir a abertura do projeto.",
        );
      }
    } catch (caught) {
      // The bridge may fail after closing/opening. Read the actual host state
      // instead of leaving the previous project's data on screen.
      shouldReload = true;
      message = getPublicErrorMessage(
        caught,
        "Não foi possível confirmar a abertura do projeto. Confira o After Effects.",
      );
    }

    try {
      if (shouldReload) await reloadProject();
    } catch {
      message = "Não foi possível atualizar o painel. Recarregue a extensão.";
    } finally {
      openingRef.current = false;
      setIsOpeningProject(false);
    }

    if (message) window.alert(message);
  }, [reloadProject]);

  return { isOpeningProject, openProject };
};
