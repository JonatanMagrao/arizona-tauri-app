import React from "react";
import ReactDOM from "react-dom/client";
import "../index.scss";
import { App } from "./main";
import { initArizonaBridge } from "./services/arizonaLicenseReceipt";
import { initLocalDiagnostics } from "./services/localDiagnostics";

initLocalDiagnostics();
initArizonaBridge();

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
