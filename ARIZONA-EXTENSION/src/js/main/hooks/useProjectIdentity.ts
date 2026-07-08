import { useCallback, useEffect, useRef, useState } from "react";
import { loadProjectIdentity } from "../services/projectIdentity";

export const useProjectIdentity = () => {
  const [projectKey, setProjectKey] = useState("");
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  const refreshProjectIdentity = useCallback(async () => {
    if (!window.cep) return "";
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const refreshPromise = loadProjectIdentity()
      .then((identity) => {
        const nextProjectKey = identity.projectKey || "";
        setProjectKey((current) =>
          current === nextProjectKey ? current : nextProjectKey
        );
        return nextProjectKey;
      })
      .catch(() => {
        setProjectKey("");
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
    refreshProjectIdentity,
  };
};
