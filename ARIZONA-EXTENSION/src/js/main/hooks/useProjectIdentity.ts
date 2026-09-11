import { useCallback, useEffect, useRef, useState } from "react";
import { loadProjectIdentity } from "../services/projectIdentity";

export const useProjectIdentity = () => {
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  const refreshProjectIdentity = useCallback(async (forceRefresh = false) => {
    if (!window.cep) return "";
    if (refreshPromiseRef.current) {
      if (!forceRefresh) return refreshPromiseRef.current;
      // A request started before opening a project must finish before the
      // explicit post-open refresh reads the new project's identity.
      await refreshPromiseRef.current;
    }

    const refreshPromise = loadProjectIdentity()
      .then((identity) => {
        const nextProjectKey = identity.projectKey || "";
        const nextProjectName = identity.projectName || "";
        setProjectKey((current) =>
          current === nextProjectKey ? current : nextProjectKey
        );
        setProjectName((current) =>
          current === nextProjectName ? current : nextProjectName
        );
        return nextProjectKey;
      })
      .catch(() => {
        setProjectKey("");
        setProjectName("");
        return "";
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    if (!window.cep) return;

    void refreshProjectIdentity();
  }, [refreshProjectIdentity]);

  return {
    projectKey,
    projectName,
    refreshProjectIdentity,
  };
};
