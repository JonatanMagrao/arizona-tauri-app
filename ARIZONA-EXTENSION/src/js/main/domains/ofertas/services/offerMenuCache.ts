import type { OfferLayoutMenuData, OfferMechanicMenuData } from "../types";

type OfferMenuData = OfferLayoutMenuData | OfferMechanicMenuData;
type CacheEntry = {
  context: unknown;
  generation: number;
  data: OfferMenuData | null;
  pending: Promise<OfferMenuData> | null;
};

// DTOs only. The editor resets this generation on project/lifecycle changes and
// actions; the host still validates a captured menu context before any write.
let generation = 0;
const entries = new Map<string, CacheEntry>();
const listeners = new Set<(generation: number) => void>();

export const getOfferMenuCacheGeneration = () => generation;

export const subscribeOfferMenuCache = (listener: (generation: number) => void) => {
  listeners.add(listener);
  listener(generation);
  return () => { listeners.delete(listener); };
};

export const invalidateOfferMenuCache = () => {
  generation += 1;
  entries.clear();
  listeners.forEach((listener) => listener(generation));
};

export const readOfferMenuCache = <T extends OfferMenuData>(
  key: string,
  context: unknown
): T | null => {
  const entry = entries.get(key);
  return entry && entry.context === context && entry.generation === generation
    ? entry.data as T | null
    : null;
};

export const loadOfferMenuCache = <T extends OfferMenuData>(
  key: string,
  context: unknown,
  load: () => Promise<T>
): Promise<T> => {
  const previous = entries.get(key);
  if (previous && previous.context === context && previous.generation === generation) {
    if (previous.data) return Promise.resolve(previous.data as T);
    if (previous.pending) return previous.pending as Promise<T>;
  }

  const entry: CacheEntry = { context, generation, data: null, pending: null };
  entries.set(key, entry);
  // Invoke synchronously so the first open dispatches the host read immediately.
  // The Promise also handles services which throw before returning one.
  let request: Promise<T>;
  try { request = load(); }
  catch (error) { request = Promise.reject(error); }
  const pending = request.then((data) => {
    if (entry.generation === generation && entries.get(key) === entry) {
      if (data.ok && data.context) {
        entry.data = data;
        entry.pending = null;
      } else {
        entries.delete(key);
      }
    }
    return data;
  }, (error) => {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  });
  entry.pending = pending;
  return pending;
};

// Listen once from the editor, not from every menu. Moving focus among controls
// inside the panel must not discard its cache on every click.
export const attachOfferMenuCacheFocusInvalidation = () => {
  let leftPanel = false;
  let wasHidden = document.visibilityState === "hidden";
  const blur = () => { leftPanel = true; };
  const focus = () => {
    if (!leftPanel && !wasHidden) return;
    leftPanel = false;
    wasHidden = false;
    invalidateOfferMenuCache();
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") wasHidden = true;
    else if (wasHidden) focus();
  };
  window.addEventListener("blur", blur);
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("blur", blur);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", visibility);
  };
};
