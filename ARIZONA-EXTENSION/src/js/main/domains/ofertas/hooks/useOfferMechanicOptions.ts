import { useCallback, useEffect, useState } from "react";
import { getPublicErrorMessage } from "../../../utils/errors";
import { loadOfferMechanicOptions } from "../services/ofertas";
import type { OfferMechanicMenuData } from "../types";

export const useOfferMechanicOptions = (
  offerLayerIndex: number,
  productIndex: number,
  isOpen: boolean
) => {
  const [data, setData] = useState<OfferMechanicMenuData | null>(null);
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
        const result = await loadOfferMechanicOptions(offerLayerIndex, productIndex);
        if (!cancelled) setData(result);
      } catch (caught) {
        if (!cancelled) {
          setError(getPublicErrorMessage(
            caught,
            "Não foi possível carregar as mecânicas deste produto."
          ));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [offerLayerIndex, productIndex, isOpen, revision]);

  return { data, loading, error, reload };
};
