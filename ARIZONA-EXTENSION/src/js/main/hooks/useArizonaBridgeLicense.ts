import { useEffect, useState } from "react";
import {
  getArizonaBridgeLicenseState,
  retryArizonaBridgeLicense,
  subscribeArizonaBridgeLicense,
  type ArizonaBridgeLicenseState,
} from "../services/arizonaLicenseReceipt";

export const useArizonaBridgeLicense = (): ArizonaBridgeLicenseState & {
  retry: () => void;
} => {
  const [state, setState] = useState<ArizonaBridgeLicenseState>(() =>
    getArizonaBridgeLicenseState()
  );

  useEffect(() => subscribeArizonaBridgeLicense(setState), []);

  return {
    ...state,
    retry: retryArizonaBridgeLicense,
  };
};
