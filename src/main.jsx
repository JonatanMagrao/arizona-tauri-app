import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { startAuthBootstrap } from "./features/auth/authBootstrap";
import { initTauriDiagnostics } from "./services/tauriCommands";
import { currentWindowLabel } from "./utils/windowRouting";

initTauriDiagnostics();
if (currentWindowLabel() === "main") {
  startAuthBootstrap();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
