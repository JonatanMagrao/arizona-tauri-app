import { useCallback, useEffect, useState } from "react";
import { loadProjectIdentity } from "../services/projectIdentity";

const PROJECT_IDENTITY_POLL_MS = 1500;

export const useProjectIdentity = () => {
  const [projectKey, setProjectKey] = useState("");

  const refreshProjectIdentity = useCallback(async () => {
    if (!window.cep) return;

    try {
      const identity = await loadProjectIdentity();
      setProjectKey((current) =>
        current === identity.projectKey ? current : identity.projectKey
      );
    } catch {
      setProjectKey("");
    }
  }, []);

  useEffect(() => {
    if (!window.cep) return;

    void refreshProjectIdentity();
    const intervalId = window.setInterval(() => {
      void refreshProjectIdentity();
    }, PROJECT_IDENTITY_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshProjectIdentity]);

  return projectKey;
};
