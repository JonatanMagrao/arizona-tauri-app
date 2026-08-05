import { child_process, crypto, fs, os, path } from "../../lib/cep/node";
import {
  LICENSE_TRUSTED_KEYS,
  type LicenseTrustedKey,
} from "./licenseTrustedKeys.generated";

const RECEIPT_CHECK_MS = 5000;
const RECEIPT_FILE_NAME = "cep-license-receipt.json";
const DEBUG_FILE_NAME = "cep-license-debug.json";
const TAURI_IDENTIFIER = "com.pc.arizona-app";
const AE_PANEL_FEATURE = "ae_panel";
const LICENSE_TOKEN_ALGORITHM = "ES256";
const LICENSE_TOKEN_ISSUER = "arizona-app";
const LICENSE_TOKEN_AUDIENCE = "arizona-license";

// Contrato compartilhado com src-tauri/src/device_identity.rs: hex minusculo
// do SHA-256 de "arizona-device-fp:v1:{MachineGuid}".
const DEVICE_FINGERPRINT_PREFIX = "arizona-device-fp:v1";
const MACHINE_GUID_REG_QUERY =
  'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid /reg:64';

// Tolerancia para relogio local levemente atrasado em relacao ao servidor:
// sem isso, um desvio de poucos segundos bloqueia o painel logo apos a
// validacao (nbf > agora).
const CLOCK_SKEW_TOLERANCE_SECONDS = 120;
const IAT_FUTURE_TOLERANCE_SECONDS = 300;

// Habilitado apenas em builds de diagnostico (npm run build:debug).
const LICENSE_DEBUG =
  typeof import.meta.env !== "undefined" &&
  import.meta.env.VITE_ARIZONA_LICENSE_DEBUG === "true";

type ReceiptFile = {
  receipt?: string;
};

type ReceiptClaims = {
  iss?: string;
  aud?: string | string[];
  jti?: string;
  sub?: string;
  org?: string;
  device?: string;
  session?: string;
  role?: string;
  licensed?: boolean;
  reason?: string;
  allowedFeatures?: string[];
  allowed_features?: string[];
  features?: string[];
  email?: string | null;
  organizationName?: string | null;
  organization_name?: string | null;
  receiptVersion?: number;
  expiresAt?: string | null;
  expires_at?: string | null;
  iat?: number;
  exp?: number;
  nbf?: number;
  server_time_at_issue?: string;
  deviceFingerprintHash?: string;
};

export type ArizonaLicense = {
  licensed?: boolean;
  reason?: string;
  allowedFeatures?: string[];
  email?: string | null;
  organizationName?: string | null;
  expiresAt?: string | null;
};

export type ArizonaBridgeLicenseState = {
  connected: boolean;
  licensed: boolean;
  checking: boolean;
  reason: string;
  message: string;
  license: ArizonaLicense | null;
};

type LicenseListener = (state: ArizonaBridgeLicenseState) => void;

const DEFAULT_LOCKED_MESSAGE =
  "Plugin bloqueado. Valide a licença novamente no Arizona App.";

let refreshTimer: number | null = null;
let initialized = false;

let licenseState: ArizonaBridgeLicenseState = {
  connected: !window.cep,
  licensed: !window.cep,
  checking: Boolean(window.cep),
  reason: window.cep ? "receipt_pending" : "browser_dev",
  message: window.cep ? DEFAULT_LOCKED_MESSAGE : "",
  license: null,
};

const listeners = new Set<LicenseListener>();

export const initArizonaBridge = () => {
  if (initialized) return;
  initialized = true;

  if (!window.cep) {
    updateLicenseState({
      connected: true,
      licensed: true,
      checking: false,
      reason: "browser_dev",
      message: "",
      license: null,
    });
    return;
  }

  refreshArizonaLicenseReceipt();
  startReceiptRefreshTimer();
  window.addEventListener("focus", refreshArizonaLicenseReceipt);
  document.addEventListener("visibilitychange", refreshWhenVisible);
};

export const subscribeArizonaBridgeLicense = (listener: LicenseListener) => {
  listeners.add(listener);
  listener(licenseState);

  return () => {
    listeners.delete(listener);
  };
};

export const getArizonaBridgeLicenseState = () => licenseState;

export const retryArizonaBridgeLicense = () => {
  refreshArizonaLicenseReceipt();
};

const refreshWhenVisible = () => {
  if (document.visibilityState === "visible") {
    refreshArizonaLicenseReceipt();
  }
};

const startReceiptRefreshTimer = () => {
  if (refreshTimer !== null) return;

  refreshTimer = window.setInterval(
    refreshArizonaLicenseReceipt,
    RECEIPT_CHECK_MS
  );
};

const refreshArizonaLicenseReceipt = () => {
  if (!window.cep) return;

  const receipt = readReceipt();
  if (!receipt) {
    updateLocked("receipt_missing");
    writeDebugSnapshot(null, "receipt_missing");
    return;
  }

  const license = verifyReceipt(receipt);
  if (!license?.licensed) {
    const reason = license?.reason || "receipt_invalid";
    updateLocked(reason, license || null);
    writeDebugSnapshot(license || null, reason);
    return;
  }

  updateLicenseState({
    connected: true,
    licensed: true,
    checking: false,
    reason: "valid",
    message: "",
    license,
  });
  writeDebugSnapshot(license, "valid");
};

const updateLocked = (reason: string, license: ArizonaLicense | null = null) => {
  updateLicenseState({
    connected: false,
    licensed: false,
    checking: false,
    reason,
    message: DEFAULT_LOCKED_MESSAGE,
    license,
  });
};

const readReceipt = () => {
  const receiptPath = receiptFilePath();

  if (!receiptPath) {
    return "";
  }

  if (typeof fs.existsSync !== "function") {
    return "";
  }

  const receiptExists = fs.existsSync(receiptPath);
  if (!receiptExists) {
    return "";
  }

  try {
    const text = fs.readFileSync(receiptPath, "utf8").trim();
    if (!text) {
      return "";
    }

    if (isCompactJws(text)) {
      return text;
    }

    const file = JSON.parse(text) as ReceiptFile;
    const receipt = typeof file.receipt === "string" ? file.receipt.trim() : "";
    return receipt;
  } catch {
    return "";
  }
};

const isCompactJws = (value: string) =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());

const verifyReceipt = (receipt: string): ArizonaLicense | null => {
  const parts = receipt.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecodeText(parts[0])) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== LICENSE_TOKEN_ALGORITHM) {
      return lockedLicense("receipt_alg_invalid");
    }

    const trustedKey = LICENSE_TRUSTED_KEYS.find(
      (key) => key.kid === String(header.kid || "").trim()
    );
    if (!trustedKey) {
      return lockedLicense("receipt_kid_unknown");
    }

    const publicKeyPem = trustedKeyPem(trustedKey);
    if (!publicKeyPem) {
      return lockedLicense("receipt_public_key_missing");
    }

    const signedData = `${parts[0]}.${parts[1]}`;
    const signature = es256SignatureToDer(base64UrlDecodeBuffer(parts[2]));
    const verifier = crypto.createVerify("SHA256");
    verifier.update(signedData);
    verifier.end();

    if (!verifier.verify(publicKeyPem, signature)) {
      return lockedLicense("receipt_signature_invalid");
    }

    const claims = JSON.parse(base64UrlDecodeText(parts[1])) as ReceiptClaims;
    return claimsToLicense(claims);
  } catch {
    return null;
  }
};

const lockedLicense = (reason: string): ArizonaLicense => {
  return {
    licensed: false,
    reason,
    allowedFeatures: [],
  };
};

const claimsToLicense = (claims: ReceiptClaims): ArizonaLicense => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const allowedFeatures = normalizeFeatures(claims);
  const expiresAt = normalizeExpiresAt(claims);
  const reason = receiptBlockReason(claims, allowedFeatures, nowSeconds);

  return {
    licensed: reason === "valid",
    reason,
    allowedFeatures,
    email: claims.email || null,
    organizationName: claims.organizationName || claims.organization_name || null,
    expiresAt,
  };
};

const receiptBlockReason = (
  claims: ReceiptClaims,
  allowedFeatures: string[],
  nowSeconds: number
) => {
  let reason = "valid";

  if (claims.iss !== LICENSE_TOKEN_ISSUER) {
    reason = "receipt_issuer_invalid";
  } else if (!normalizeAudience(claims.aud).includes(LICENSE_TOKEN_AUDIENCE)) {
    reason = "receipt_audience_invalid";
  } else if (
    !requiredClaim(claims.jti) ||
    !requiredClaim(claims.sub) ||
    !requiredClaim(claims.org) ||
    !requiredClaim(claims.device) ||
    !requiredClaim(claims.session)
  ) {
    reason = "receipt_claims_invalid";
  } else if (
    claims.nbf &&
    claims.nbf > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS
  ) {
    reason = "receipt_not_active";
  } else if (
    claims.iat &&
    claims.iat > nowSeconds + IAT_FUTURE_TOLERANCE_SECONDS
  ) {
    reason = "receipt_iat_invalid";
  } else if (!claims.exp) {
    reason = "receipt_claims_invalid";
  } else if (claims.exp && claims.exp <= nowSeconds) {
    reason = "receipt_expired";
  } else if (Number(claims.receiptVersion || 1) >= 2 && claims.licensed !== true) {
    reason = claims.reason || "not_licensed";
  } else if (!allowedFeatures.includes(AE_PANEL_FEATURE)) {
    reason = "feature_missing";
  } else if (deviceFingerprintMismatch(claims)) {
    reason = "receipt_device_mismatch";
  } else {
    const expiresAt = claims.expiresAt || claims.expires_at;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      reason = "receipt_expired";
    }
  }

  return reason;
};

// Vinculo do recibo com a maquina: quando o recibo carrega o hash do
// fingerprint (claim aditiva, receiptVersion continua 2), ele precisa bater
// com o hash calculado localmente. Falha na LEITURA local nunca bloqueia:
// uma maquina licenciada sempre tem MachineGuid legivel (o Arizona App exigiu
// isso para licenciar), entao o fail-open so pula a checagem para leitores
// quebrados, nunca para divergencias reais.
const deviceFingerprintMismatch = (claims: ReceiptClaims) => {
  const expected = String(claims.deviceFingerprintHash || "")
    .trim()
    .toLowerCase();
  if (!expected) return false;

  const local = localDeviceFingerprint();
  if (!local.hash) return false;

  return local.hash !== expected;
};

type LocalDeviceFingerprint = {
  hash: string;
  failure: string;
};

let localDeviceFingerprintCache: LocalDeviceFingerprint | null = null;

const localDeviceFingerprint = () => {
  if (!localDeviceFingerprintCache) {
    localDeviceFingerprintCache = computeLocalDeviceFingerprint();
  }
  return localDeviceFingerprintCache;
};

const computeLocalDeviceFingerprint = (): LocalDeviceFingerprint => {
  try {
    if (os.platform() !== "win32") {
      return { hash: "", failure: "platform_unsupported" };
    }
    if (typeof child_process.execSync !== "function") {
      return { hash: "", failure: "exec_unavailable" };
    }

    const output = child_process.execSync(MACHINE_GUID_REG_QUERY, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(output);
    const machineGuid = (match?.[1] || "").trim();
    if (!machineGuid) {
      return { hash: "", failure: "machine_guid_missing" };
    }

    const hash = crypto
      .createHash("sha256")
      .update(`${DEVICE_FINGERPRINT_PREFIX}:${machineGuid}`)
      .digest("hex")
      .toLowerCase();
    return { hash, failure: "" };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { hash: "", failure: `machine_guid_read_failed: ${message}` };
  }
};

const normalizeFeatures = (claims: ReceiptClaims) => {
  const values = Array.isArray(claims.allowedFeatures)
    ? claims.allowedFeatures
    : Array.isArray(claims.allowed_features)
      ? claims.allowed_features
      : Array.isArray(claims.features)
        ? claims.features
        : Number(claims.receiptVersion || 1) >= 2
          ? []
          : [AE_PANEL_FEATURE];

  return values.map((value) => String(value).trim()).filter(Boolean);
};

const normalizeAudience = (audience: ReceiptClaims["aud"]) => {
  const values = Array.isArray(audience) ? audience : [audience];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
};

const requiredClaim = (value: unknown) => String(value || "").trim().length > 0;

const normalizeExpiresAt = (claims: ReceiptClaims) => {
  if (claims.expiresAt) return claims.expiresAt;
  if (claims.expires_at) return claims.expires_at;
  if (claims.exp) return new Date(claims.exp * 1000).toISOString();
  return null;
};

const base64UrlDecodeText = (value: string) =>
  base64UrlDecodeBuffer(value).toString("utf8");

const base64UrlDecodeBuffer = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  return Buffer.from(padded, "base64");
};

const es256SignatureToDer = (signature: Buffer) => {
  if (signature.length !== 64) return Buffer.alloc(0);

  const r = derInteger(signature.subarray(0, 32));
  const s = derInteger(signature.subarray(32));
  return Buffer.concat([
    Buffer.from([0x30, r.length + s.length]),
    r,
    s,
  ]);
};

const derInteger = (value: Buffer) => {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;

  let bytes = value.subarray(start);
  if (bytes[0] & 0x80) {
    bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  }

  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
};

const trustedKeyPemCache = new Map<string, string>();

const trustedKeyPem = (key: LicenseTrustedKey) => {
  const cached = trustedKeyPemCache.get(key.kid);
  if (cached) return cached;

  if (!/^[0-9a-f]{64}$/i.test(key.x) || !/^[0-9a-f]{64}$/i.test(key.y)) {
    return "";
  }

  const pem = p256PublicKeyPemFromCoordinates(key.x, key.y);
  trustedKeyPemCache.set(key.kid, pem);
  return pem;
};

const p256PublicKeyPemFromCoordinates = (xHex: string, yHex: string) => {
  const spkiPrefix = Buffer.from(
    "3059301306072a8648ce3d020106082a8648ce3d030107034200",
    "hex"
  );
  const publicPoint = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(xHex, "hex"),
    Buffer.from(yHex, "hex"),
  ]);
  const body = Buffer.concat([spkiPrefix, publicPoint])
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trim();

  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
};

const updateLicenseState = (patch: Partial<ArizonaBridgeLicenseState>) => {
  const nextState = {
    ...licenseState,
    ...patch,
  };

  if (
    licenseState.connected === nextState.connected &&
    licenseState.licensed === nextState.licensed &&
    licenseState.checking === nextState.checking &&
    licenseState.reason === nextState.reason &&
    licenseState.message === nextState.message &&
    JSON.stringify(licenseState.license) === JSON.stringify(nextState.license)
  ) {
    return;
  }

  licenseState = nextState;

  for (const listener of listeners) {
    listener(licenseState);
  }
};

const writeDebugSnapshot = (
  license: ArizonaLicense | null,
  reason: string
) => {
  if (!LICENSE_DEBUG || !window.cep) return;

  try {
    const receiptPath = receiptFilePath();
    if (!receiptPath) return;

    const debugPath = path.join(path.dirname(receiptPath), DEBUG_FILE_NAME);
    const snapshot = {
      state: reason === "valid" ? "unlocked" : "locked",
      reason,
      license,
      checkedAt: new Date().toISOString(),
      trustedKids: LICENSE_TRUSTED_KEYS.map((key) => key.kid),
      receiptPath,
      receiptExists:
        typeof fs.existsSync === "function" && fs.existsSync(receiptPath),
      nowSeconds: Math.floor(Date.now() / 1000),
      localFingerprint: localDeviceFingerprintCache
        ? {
            computed: Boolean(localDeviceFingerprintCache.hash),
            failure: localDeviceFingerprintCache.failure || null,
          }
        : null,
    };
    fs.writeFileSync(debugPath, JSON.stringify(snapshot, null, 2), "utf8");
  } catch {
    // Diagnostico nunca pode derrubar a validacao.
  }
};

const receiptFilePath = () => {
  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: NodeJS.Process;
  }).process;
  const env = window.cep_node?.process?.env || runtimeProcess?.env || {};

  if (os.platform() === "win32") {
    const localAppData =
      env.LOCALAPPDATA ||
      env.APPDATA ||
      (os.homedir() ? path.join(os.homedir(), "AppData", "Local") : "");
    return localAppData
      ? path.join(localAppData, TAURI_IDENTIFIER, RECEIPT_FILE_NAME)
      : "";
  }

  if (os.platform() === "darwin") {
    const home = env.HOME || os.homedir();
    return home
      ? path.join(
          home,
          "Library",
          "Application Support",
          TAURI_IDENTIFIER,
          RECEIPT_FILE_NAME
        )
      : "";
  }

  return "";
};
