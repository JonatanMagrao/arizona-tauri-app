import { commandNames, invokeCommand } from "./tauriCommands";

export function resumeSecureSession({ appVersion = "" } = {}) {
  return invokeCommand(commandNames.authResume, { appVersion });
}

export function activateWithCode({ email, code, appVersion = "" }) {
  return invokeCommand(commandNames.authActivate, {
    email: normalizeEmail(email),
    code: String(code || ""),
    appVersion,
  });
}

export function verifyTotp({ code, appVersion = "" }) {
  return invokeCommand(commandNames.authVerifyTotp, {
    code: String(code || ""),
    appVersion,
  });
}

export function pollSecureSession({ appVersion = "" } = {}) {
  return invokeCommand(commandNames.authPoll, { appVersion });
}

export async function clearSecureSession() {
  await invokeCommand(commandNames.clearSecureAuth);
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function authErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (message.includes("network_error")) return "Não foi possível conectar ao Supabase.";
  if (message.includes("invalid_totp")) return "Código do autenticador inválido.";
  return message || "Não foi possível confirmar o acesso.";
}
