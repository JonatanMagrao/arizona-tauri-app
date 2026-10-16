import { useCallback, useEffect, useRef, useState } from "react";
import { loadProjectIdentity } from "../services/projectIdentity";

const PROJECT_IDENTITY_POLL_MS = 1500;

interface ProjectIdentityOptions {
  canObserve?: () => boolean;
}

const isPanelVisible = () =>
  typeof document === "undefined" ||
  (!document.hidden && document.visibilityState !== "hidden");

export const useProjectIdentity = ({ canObserve }: ProjectIdentityOptions = {}) => {
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const forcedRefreshPromiseRef = useRef<Promise<string> | null>(null);
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(false);
  const canObserveRef = useRef(canObserve);
  canObserveRef.current = canObserve;

  const readProjectIdentity = useCallback((background: boolean): Promise<string> => {
    if (!window.cep || !mountedRef.current) return Promise.resolve("");
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const lifecycle = lifecycleRef.current;

    const refreshPromise = (async () => {
      try {
        const identity = await loadProjectIdentity();
        if (!mountedRef.current || lifecycle !== lifecycleRef.current) return "";
        // An observation started before a modal or edit must not replace its
        // project state while the foreground operation is still in progress.
        if (background && (!isPanelVisible() || canObserveRef.current?.() === false)) {
          return "";
        }
        const nextProjectKey = identity.projectKey || "";
        const nextProjectName = identity.projectName || "";
        setProjectKey((current) =>
          current === nextProjectKey ? current : nextProjectKey
        );
        setProjectName((current) =>
          current === nextProjectName ? current : nextProjectName
        );
        return nextProjectKey;
      } catch {
        // A busy/unavailable host is not evidence that the document closed.
        // Keep its cache and retry on the next observation; explicit actions
        // receive an empty key so their existing identity guard fails closed.
        return "";
      }
    })().finally(() => {
      if (refreshPromiseRef.current === refreshPromise) refreshPromiseRef.current = null;
    });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  const refreshProjectIdentity = useCallback((forceRefresh = false): Promise<string> => {
    if (!window.cep || !mountedRef.current) return Promise.resolve("");
    if (forcedRefreshPromiseRef.current) return forcedRefreshPromiseRef.current;
    if (!forceRefresh) return readProjectIdentity(false);

    // The post-open read must start after any request for the previous project.
    // Concurrent forced refreshes share this single queued read.
    const lifecycle = lifecycleRef.current;
    const previousRefresh = refreshPromiseRef.current;
    const freshRead = previousRefresh
      ? previousRefresh.then(() => {
          if (!mountedRef.current || lifecycle !== lifecycleRef.current) return "";
          return readProjectIdentity(false);
        })
      : readProjectIdentity(false);
    const forcedRefresh = freshRead.finally(() => {
      if (forcedRefreshPromiseRef.current === forcedRefresh) forcedRefreshPromiseRef.current = null;
    });
    forcedRefreshPromiseRef.current = forcedRefresh;
    return forcedRefresh;
  }, [readProjectIdentity]);

  useEffect(() => {
    if (!window.cep) return;
    mountedRef.current = true;
    lifecycleRef.current += 1;
    let disposed = false;
    let timer = 0;

    const schedule = () => {
      if (disposed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(observe, PROJECT_IDENTITY_POLL_MS);
    };
    const observe = async () => {
      window.clearTimeout(timer);
      if (disposed) return;
      if (isPanelVisible() && canObserveRef.current?.() !== false) {
        if (forcedRefreshPromiseRef.current) await forcedRefreshPromiseRef.current;
        else await readProjectIdentity(true);
      }
      schedule();
    };
    const observeWhenVisible = () => {
      if (isPanelVisible()) void observe();
    };

    void observe();
    window.addEventListener("focus", observeWhenVisible);
    document.addEventListener("visibilitychange", observeWhenVisible);

    return () => {
      disposed = true;
      mountedRef.current = false;
      lifecycleRef.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener("focus", observeWhenVisible);
      document.removeEventListener("visibilitychange", observeWhenVisible);
    };
  }, [readProjectIdentity]);

  return {
    projectKey,
    projectName,
    refreshProjectIdentity,
  };
};
