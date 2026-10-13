import { useCallback, useEffect, useState } from "react";
import { getPublicErrorMessage } from "../../../utils/errors";
import { loadOfferLayoutOptions } from "../services/ofertas";
import type { OfferLayoutMenuData } from "../types";

export const useOfferLayoutOptions = (
  offerLayerIndex: number,
  isOpen: boolean
) => {
  const [data, setData] = useState<OfferLayoutMenuData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    setLoading(false);
    if (!isOpen) return;

    if (!window.cep) {
      setError("Abra este painel dentro do After Effects.");
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const result = await loadOfferLayoutOptions(offerLayerIndex);
        if (!cancelled) setData(result);
      } catch (caught) {
        if (!cancelled) {
          setError(getPublicErrorMessage(
            caught,
            "Não foi possível carregar as réguas desta oferta."
          ));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [offerLayerIndex, isOpen, revision]);

  return { data, loading, error, reload };
};
