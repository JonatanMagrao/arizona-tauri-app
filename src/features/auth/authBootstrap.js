import { resumeSecureSession } from "../../services/auth";
import { commandNames, invokeCommand } from "../../services/tauriCommands";

let bootstrap = null;

// This module-level cache starts authentication once per WebView, including
// under React StrictMode. The two operations stay independent so a cosmetic
// app-info failure never prevents the access check from completing.
export function startAuthBootstrap() {
  if (bootstrap) return bootstrap;

  const appInfo = invokeCommand(commandNames.appInfo)
    .then((info) => ({ version: String(info?.version || "").trim() }))
    .catch(() => ({ version: "" }));

  const auth = resumeSecureSession({ appVersion: "" }).then(
    (flow) => ({ flow, error: null }),
    (error) => ({ flow: null, error }),
  );

  bootstrap = Object.freeze({ appInfo, auth });
  return bootstrap;
}
