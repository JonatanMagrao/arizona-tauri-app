import { supabaseConfig } from "../config/supabase";
import { commandNames, invokeCommand } from "./tauriCommands";

const installStorageKey = `arizona-install-id:${supabaseConfig.projectRef}`;
const clockStorageKey = `arizona-clock:${supabaseConfig.projectRef}`;

export async function authenticateUser({ mode, email, password, appVersion }) {
  const cleanEmail = normalizeEmail(email);

  if (mode === "setup") {
    await functionRequest("app-set-password", {
      email: cleanEmail,
      password,
    });
  }

  const session = await passwordToken(cleanEmail, password);
  const license = await validateLicense(session.accessToken, appVersion, {
    authMethod: "password",
  });

  return authFromSession(session, license, cleanEmail);
}

export async function inspectLoginEmail(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !cleanEmail.includes("@")) return null;

  return functionRequest("app-set-password", {
    email: cleanEmail,
    checkOnly: true,
  });
}

export async function changePassword({ email, currentPassword, newPassword, appVersion }) {
  const cleanEmail = normalizeEmail(email);
  const session = await passwordToken(cleanEmail, currentPassword);
  await updatePassword(session.accessToken, newPassword);

  const nextSession = await passwordToken(cleanEmail, newPassword);
  const license = await validateLicense(nextSession.accessToken, appVersion, {
    authMethod: "password",
  });

  return authFromSession(nextSession, license, cleanEmail);
}

export async function resumeSecureSession({ appVersion }) {
  const stored = await invokeCommand(commandNames.loadSecureAuth);
  if (!stored?.refreshToken) return null;

  try {
    const session = await refreshToken(stored.refreshToken);
    const license = await validateLicense(session.accessToken, appVersion, {
      authMethod: "resume",
      lastServerTimeSeen: stored.serverTime,
      lastLocalTimeSeen: stored.localTime,
    });
    const auth = authFromSession(session, license, stored.email);
    await saveSecureSession(auth, {
      passwordLoginAt: stored.passwordLoginAt || stored.serverTime || "",
    }).catch(() => {});
    return auth;
  } catch (error) {
    if (shouldForgetStoredSession(error)) {
      await clearSecureSession();
      const nextError = new Error("Stored session is no longer valid.");
      nextError.code = error?.code === "daily_login_required"
        ? "daily_login_required"
        : "stored_session_invalid";
      nextError.email = stored.email || "";
      throw nextError;
    }

    throw error;
  }
}

export async function validateActiveSession(auth, { appVersion } = {}) {
  if (!auth?.accessToken) return null;

  try {
    const license = await validateLicense(auth.accessToken, appVersion, {
      authMethod: "resume",
    });
    const nextAuth = authFromSession(
      {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        email: auth.email,
      },
      license,
      auth.email,
    );
    await saveSecureSession(nextAuth).catch(() => {});
    return nextAuth;
  } catch (error) {
    if (shouldForgetStoredSession(error)) {
      return resumeSecureSession({ appVersion });
    }

    throw error;
  }
}

export async function saveSecureSession(auth, options = {}) {
  if (!auth?.refreshToken) return;

  const serverTime = auth.license?.serverTime || new Date().toISOString();
  const passwordLoginAt = options.passwordLoginAt || auth.license?.passwordLoginAt || serverTime;

  const response = await invokeCommand(commandNames.saveSecureAuth, {
    record: {
      refreshToken: auth.refreshToken,
      cepLicenseReceipt: auth.cepLicenseReceipt,
      email: auth.email,
      passwordLoginAt,
      serverTime,
      localTime: new Date().toISOString(),
      expiresAt: auth.expiresAt,
      memberId: auth.memberId,
      role: auth.role,
      organizationId: auth.organizationId,
      organizationName: auth.organizationName,
      seatsAllowed: auth.seatsAllowed,
    },
  });

  if (response?.ok === false) {
    const error = new Error(response.message || "Não foi possível salvar a sessão segura.");
    error.code = "secure_auth_save_failed";
    throw error;
  }
}

export async function clearSecureSession() {
  await invokeCommand(commandNames.clearSecureAuth);
}

export function authToSession(auth) {
  return {
    accessToken: auth?.accessToken || "",
    refreshToken: auth?.refreshToken || "",
    cepLicenseReceipt: auth?.cepLicenseReceipt || "",
    email: auth?.email || "",
    memberId: auth?.memberId || "",
    role: auth?.role || "",
    organizationId: auth?.organizationId || "",
    organizationName: auth?.organizationName || "",
    seatsAllowed: Number(auth?.seatsAllowed || 0),
    expiresAt: auth?.expiresAt || "",
  };
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function authErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");

  if (code === "invalid_credentials" || message.toLowerCase().includes("invalid login")) {
    return "E-mail ou senha inválidos.";
  }
  if (code === "daily_login_required") return "Por segurança, entre novamente para liberar o acesso de hoje.";
  if (code === "stored_session_invalid") return "Sua sessão salva expirou. Entre novamente.";
  if (code === "secure_auth_save_failed" || message.toLowerCase().includes("sessão segura")) return message;
  if (code === "member_not_authorized") return "Este e-mail não está liberado para o Arizona App.";
  if (code === "member_already_disabled") return "Este usuário não está ativo.";
  if (code === "password_already_set" || code === "auth_user_already_exists") {
    return "Este e-mail já tem senha. Entre pela tela de login.";
  }
  if (code === "weak_password") return "Use uma senha com pelo menos 6 caracteres.";
  if (message.toLowerCase().includes("different from the old password")) {
    return "Use uma senha diferente da atual.";
  }
  if (code === "organization_not_active") return "A licença não está ativa.";
  if (code === "license_expired") return "A licença expirou.";
  if (code === "device_limit_reached") {
    return "Este usuário já está ativo em outra máquina. Libere o acesso pela Gestão.";
  }
  if (code === "clock_suspicious") return "Confira o relógio do computador e tente novamente.";
  if (code === "invalid_publishable_key") return "Chave pública do Supabase inválida.";
  if (code === "missing_install_id") return "Não foi possível identificar esta instalação.";
  if (code === "email_not_confirmed") return "E-mail ainda não confirmado.";
  if (code === "network_error") return "Não foi possível conectar ao Supabase.";

  return message || "Não foi possível entrar.";
}

async function passwordToken(email, password) {
  const data = await authRequest("/auth/v1/token?grant_type=password", {
    email,
    password,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    email: data.user?.email || email,
  };
}

async function refreshToken(token) {
  const data = await authRequest("/auth/v1/token?grant_type=refresh_token", {
    refresh_token: token,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token,
    email: data.user?.email || "",
  };
}

async function updatePassword(accessToken, password) {
  return request(`${supabaseConfig.supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: supabaseConfig.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
}

async function validateLicense(accessToken, appVersion, context = {}) {
  const localTime = new Date().toISOString();
  const storedClock = loadJson(clockStorageKey) || {};
  const data = await functionRequest(
    "validate-license",
    {
      installId: getInstallId(),
      appVersion: String(appVersion || "").trim(),
      deviceLabel: deviceLabel(),
      deviceFingerprintHash: await deviceFingerprintHash(),
      clientLocalTime: localTime,
      lastServerTimeSeen: context.lastServerTimeSeen || storedClock.lastServerTimeSeen || null,
      lastLocalTimeSeen: context.lastLocalTimeSeen || storedClock.lastLocalTimeSeen || null,
      authMethod: context.authMethod || "password",
    },
    accessToken,
  );

  if (data?.serverTime) {
    localStorage.setItem(
      clockStorageKey,
      JSON.stringify({
        lastServerTimeSeen: data.serverTime,
        lastLocalTimeSeen: localTime,
      }),
    );
  }

  return data;
}

function authFromSession(session, license, fallbackEmail) {
  const member = license?.member || license?.appMember || license?.app_member || {};
  const organization = license?.organization || license?.org || {};
  const cepLicenseReceipt = String(
    license?.cepLicenseReceipt
      || license?.cep_license_receipt
      || license?.licenseReceipt
      || license?.license_receipt
      || license?.receipt
      || license?.token
      || "",
  ).trim();
  const expiresAt = firstText(
    license?.expiresAt,
    license?.expires_at,
    timestampToIso(license?.exp),
  );

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    cepLicenseReceipt,
    expiresAt,
    email: firstText(member?.email, license?.email, session.email, fallbackEmail),
    memberId: firstText(member?.id, member?.memberId, member?.member_id, license?.memberId, license?.member_id, license?.sub),
    role: firstText(member?.role, license?.role),
    organizationId: firstText(
      organization?.id,
      organization?.organizationId,
      organization?.organization_id,
      license?.organizationId,
      license?.organization_id,
      license?.orgId,
      license?.org_id,
      license?.org,
    ),
    organizationName: firstText(
      organization?.name,
      organization?.organizationName,
      organization?.organization_name,
      license?.organizationName,
      license?.organization_name,
    ),
    seatsAllowed: firstNumber(
      organization?.seatsAllowed,
      organization?.seats_allowed,
      license?.seatsAllowed,
      license?.seats_allowed,
    ),
    license,
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }

  return 0;
}

function timestampToIso(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) return "";

  const milliseconds = timestamp > 9999999999 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function shouldForgetStoredSession(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return [
    "daily_login_required",
    "invalid_grant",
    "invalid_refresh_token",
    "invalid_user_token",
    "refresh_token_not_found",
  ].includes(code) || message.includes("refresh token");
}


async function authRequest(path, body) {
  return request(`${supabaseConfig.supabaseUrl}${path}`, {
    method: "POST",
    headers: {
      apikey: supabaseConfig.publishableKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function functionRequest(functionName, body, accessToken = "") {
  const headers = {
    apikey: supabaseConfig.publishableKey,
    "content-type": "application/json",
  };

  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  return request(`${supabaseConfig.supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const nextError = new Error("Network request failed.");
    nextError.code = "network_error";
    throw nextError;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || data?.ok === false) {
    const error = new Error(
      data?.error?.message || data?.msg || data?.message || response.statusText,
    );
    error.code = data?.error?.code || data?.code || data?.error || response.status;
    throw error;
  }

  return data;
}

function getInstallId() {
  const existing = localStorage.getItem(installStorageKey);
  if (existing) return existing;

  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(installStorageKey, id);
  return id;
}

function deviceLabel() {
  const platform = navigator.platform || "Windows";
  const language = navigator.language || "pt-BR";
  return `${platform} - ${language}`;
}

async function deviceFingerprintHash() {
  const screenInfo = typeof screen !== "undefined" ? screen : {};
  const source = [
    navigator.userAgent || "",
    navigator.platform || "",
    screenInfo.width || "",
    screenInfo.height || "",
    screenInfo.colorDepth || "",
  ].join("|");

  if (typeof crypto === "undefined" || !crypto.subtle) return "";

  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
