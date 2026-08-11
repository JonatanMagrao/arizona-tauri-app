import { commandNames, invokeCommand } from "./tauriCommands";
import { publicErrorMessage } from "../utils/publicErrors";

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

export function pollSecureSession({ appVersion = "" } = {}) {
  return invokeCommand(commandNames.authPoll, { appVersion });
}

export async function clearSecureSession() {
  await invokeCommand(commandNames.clearSecureAuth);
}

export async function releaseCurrentDevice() {
  try {
    return await invokeCommand(commandNames.releaseCurrentDevice);
  } catch (error) {
    const text = String(error || "");
    const match = text.match(/^([a-z0-9_]+):\s*(.*)$/i);
    const nextError = new Error(match?.[2] || text || "Operação não concluída.");
    nextError.code = match?.[1] || "";
    throw nextError;
  }
}

export function releaseDeviceErrorMessage(error) {
  const code = String(error?.code || "");

  if (code === "invalid_user_token") return "Sessão expirada. Entre novamente.";
  if (code === "organization_not_active") return "Licença inativa.";
  if (code === "license_expired") return "Licença expirada.";
  if (code === "member_not_found") return "Usuário não encontrado.";
  if (code === "device_not_active") {
    return "Esta instalação não é a que detém o acesso ativo. Peça a liberação a um responsável.";
  }
  if (code === "rate_limited") return "Limite de tentativas atingido. Aguarde.";
  if (code === "device_switch_interval") {
    return publicErrorMessage(
      error,
      "Este computador ainda não completou o intervalo mínimo entre trocas.",
    );
  }
  return publicErrorMessage(error, "Não foi possível liberar este computador agora.");
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function authErrorMessage(error) {
  return publicErrorMessage(error, "Não foi possível confirmar o acesso.");
}
