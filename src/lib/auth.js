import { supabaseConfig } from "../config";

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
  const license = await validateLicense(session.accessToken, appVersion);

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: license.expiresAt,
    email: license.member?.email || session.email || cleanEmail,
    memberId: license.member?.id || "",
    role: license.member?.role || "",
    organizationId: license.organization?.id || "",
    organizationName: license.organization?.name || "",
    seatsAllowed: Number(license.organization?.seatsAllowed || 0),
    license,
  };
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function authErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "invalid_credentials" || message.toLowerCase().includes("invalid login")) {
    return "Email ou senha invalidos.";
  }
  if (code === "member_not_authorized") return "Este email nao esta liberado para o Arizona App.";
  if (code === "member_already_disabled") return "Este usuario nao esta ativo.";
  if (code === "password_already_set" || code === "auth_user_already_exists") {
    return "Este email ja tem senha. Entre pela tela de login.";
  }
  if (code === "weak_password") return "Use uma senha com pelo menos 6 caracteres.";
  if (code === "organization_not_active") return "A licenca nao esta ativa.";
  if (code === "license_expired") return "A licenca expirou.";
  if (code === "device_limit_reached") {
    return "Este usuario ja esta ativo em outra maquina. Libere o device pelo admin.";
  }
  if (code === "clock_suspicious") return "Confira o relogio do computador e tente novamente.";
  if (code === "invalid_publishable_key") return "Chave publica do Supabase invalida.";
  if (code === "missing_install_id") return "Nao foi possivel identificar esta instalacao.";
  if (code === "email_not_confirmed") return "Email ainda nao confirmado.";
  if (code === "network_error") return "Nao foi possivel conectar ao Supabase.";

  return message || "Nao foi possivel entrar.";
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

async function validateLicense(accessToken, appVersion) {
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
      lastServerTimeSeen: storedClock.lastServerTimeSeen || null,
      lastLocalTimeSeen: storedClock.lastLocalTimeSeen || null,
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
