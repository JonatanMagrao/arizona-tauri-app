import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicErrorMessage } from "../../../utils/errors";
import { loadOfferMechanicOptions } from "../services/ofertas";
import {
  getOfferMenuCacheGeneration,
  invalidateOfferMenuCache,
  loadOfferMenuCache,
  readOfferMenuCache,
  subscribeOfferMenuCache,
} from "../services/offerMenuCache";
import type { OfferMechanicMenuData } from "../types";

export const useOfferMechanicOptions = (
  offerLayerIndex: number,
  productIndex: number,
  isOpen: boolean,
  resetKey: unknown
) => {
  const key = `mechanic:${offerLayerIndex}:${productIndex}`;
  const [generation, setGeneration] = useState(getOfferMenuCacheGeneration);
  const [result, setResult] = useState<{
    key: string; context: unknown; generation: number; data: OfferMechanicMenuData;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const openContextRef = useRef<{ key: string; context: unknown } | null>(null);
  const reload = useCallback(() => invalidateOfferMenuCache(), []);

  useEffect(() => subscribeOfferMenuCache(setGeneration), []);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    setLoading(false);
    if (!isOpen) {
      openContextRef.current = null;
      return;
    }
    const opened = openContextRef.current;
    // A changed offer/snapshot closes the menu in its layout effect. Do not
    // enqueue a read for that intermediate render before it actually reopens.
    if (opened && (opened.key !== key || opened.context !== resetKey)) return;
    openContextRef.current = { key, context: resetKey };

    if (!window.cep) {
      setError("Abra este painel dentro do After Effects.");
      return;
    }

    if (readOfferMenuCache<OfferMechanicMenuData>(key, resetKey)) return;
    const requestGeneration = getOfferMenuCacheGeneration();
    const isCurrent = () => !cancelled && requestGeneration === getOfferMenuCacheGeneration();
    setLoading(true);
    void (async () => {
      try {
        const data = await loadOfferMenuCache(key, resetKey,
          () => loadOfferMechanicOptions(offerLayerIndex, productIndex));
        if (isCurrent()) setResult({ key, context: resetKey, generation: requestGeneration, data });
      } catch (caught) {
        if (isCurrent()) {
          setError(getPublicErrorMessage(caught, "Não foi possível carregar as mecânicas deste produto."));
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [key, resetKey, isOpen, generation]);

  const cached = isOpen && window.cep
    ? readOfferMenuCache<OfferMechanicMenuData>(key, resetKey)
    : null;
  const current = result && result.key === key && result.context === resetKey &&
    result.generation === getOfferMenuCacheGeneration() ? result.data : null;
  return { data: isOpen ? cached || current : null, loading: cached ? false : loading, error, reload };
};
