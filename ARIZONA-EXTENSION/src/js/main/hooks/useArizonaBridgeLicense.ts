import { useEffect, useRef, useState } from "react";
import {
  getArizonaBridgeLicenseState,
  retryArizonaBridgeLicense,
  subscribeArizonaBridgeLicense,
  type ArizonaBridgeLicenseState,
} from "../services/arizonaLicenseReceipt";
import { recordLocalDiagnostic } from "../services/localDiagnostics";

export const useArizonaBridgeLicense = (): ArizonaBridgeLicenseState & {
  retry: () => void;
} => {
  const [state, setState] = useState<ArizonaBridgeLicenseState>(() =>
    getArizonaBridgeLicenseState()
  );
  const previousStateRef = useRef("");

  useEffect(() => subscribeArizonaBridgeLicense(setState), []);

  useEffect(() => {
    const signature = `${state.licensed}:${state.reason || ""}`;
    if (signature === previousStateRef.current) return;
    previousStateRef.current = signature;

    recordLocalDiagnostic({
      level: state.licensed ? "info" : "warning",
      component: "licenca",
      action: "alterar_estado",
      status: state.licensed ? "licensed" : "locked",
      code: state.licensed ? undefined : state.reason || "receipt_invalid",
      message: state.licensed
        ? "A extensão confirmou a licença local."
        : "A extensão foi bloqueada pela validação do recibo local.",
      details: state.licensed
        ? undefined
        : { reason: state.reason || "receipt_invalid" },
    });
  }, [state.licensed, state.reason]);

  return {
    ...state,
    retry: retryArizonaBridgeLicense,
  };
};
