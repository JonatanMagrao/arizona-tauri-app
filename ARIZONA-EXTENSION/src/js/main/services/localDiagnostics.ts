import { fs, path as nodePath } from "../../lib/cep/node";
import { version as extensionVersion } from "../../../../package.json";

export type DiagnosticLevel = "debug" | "info" | "warning" | "error";

export interface LocalDiagnosticEvent {
  level?: DiagnosticLevel;
  component: string;
  action: string;
  status: string;
  code?: string;
  message: string;
  runtime?: "cep" | "extendscript";
  operationId?: string;
  details?: Record<string, unknown>;
}

interface Breadcrumb {
  timestamp: string;
  component: string;
  action: string;
  status: string;
  message: string;
}

interface DiagnosticsConfig {
  schemaVersion?: unknown;
  directory?: unknown;
}

const APP_DATA_DIRECTORY = "com.pc.arizona-app";
const CONFIG_FILE_NAME = "diagnostics-config.json";
const DEFAULT_LOG_DIRECTORY = "logs";
const LOG_PREFIX = "arizona-cep-";
const LOG_SUFFIX = ".jsonl";
const RETENTION_DAYS = 14;
const MAX_BREADCRUMBS = 30;
const ERROR_TRAIL_SIZE = 12;
const MAX_TEXT_LENGTH = 1200;
const MAX_PENDING_PAYLOADS = 512;
const DIAGNOSTIC_IO_TIMEOUT_MS = 8000;
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let sequence = 0;
let initialized = false;
let flushScheduled = false;
let flushInProgress = false;
const cleanupKeys = new Set<string>();
const cleanupInProgressKeys = new Set<string>();
const breadcrumbs: Breadcrumb[] = [];
const pendingPayloads: string[] = [];

export const createDiagnosticOperationId = (scope = "operation"): string =>
  `${safeIdentifier(scope, "operation", 24)}-${Date.now()}-${(++sequence).toString(36)}`;

export const initLocalDiagnostics = (): void => {
  if (initialized || !hasNodeDiagnostics()) return;
  initialized = true;

  recordLocalDiagnostic({
    component: "extensao",
    action: "inicializacao",
    status: "ready",
    message: "Painel do Arizona iniciado; os diagnósticos locais estão disponíveis.",
    details: {
      extensionVersion,
      retentionDays: RETENTION_DAYS,
    },
  });

  window.addEventListener("error", (event) => {
    recordLocalDiagnostic({
      level: "error",
      component: "extensao",
      action: "erro_nao_tratado",
      status: "failed",
      code: "cep_unhandled_error",
      message: "O painel parou de funcionar como esperado durante uma ação.",
      details: {
        technicalMessage: event.message || "Erro sem mensagem.",
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordLocalDiagnostic({
      level: "error",
      component: "extensao",
      action: "promessa_nao_tratada",
      status: "failed",
      code: "cep_unhandled_rejection",
      message: "Uma ação do painel foi interrompida antes de terminar.",
      details: {
        technicalMessage: errorMessage(event.reason),
      },
    });
  });
};

export const recordLocalDiagnostic = (event: LocalDiagnosticEvent): void => {
  if (!hasNodeDiagnostics()) return;

  try {
    const normalized = normalizeEvent(event);
    const timestamp = new Date().toISOString();
    const recentActions = normalized.level === "error" || normalized.level === "warning"
      ? breadcrumbs.slice(-ERROR_TRAIL_SIZE)
      : [];
    const payload = sanitizeValue({
      schemaVersion: 1,
      timestamp,
      eventId: `${sessionId}-${++sequence}`,
      sessionId,
      sequence,
      level: normalized.level,
      source: "cep-panel",
      runtime: normalized.runtime,
      component: normalized.component,
      action: normalized.action,
      status: normalized.status,
      ...(normalized.code ? { code: normalized.code } : {}),
      ...(normalized.operationId ? { operationId: normalized.operationId } : {}),
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
      ...(recentActions.length > 0 ? { recentActions } : {}),
    }, 0);

    breadcrumbs.push({
      timestamp,
      component: normalized.component,
      action: normalized.action,
      status: normalized.status,
      message: normalized.message,
    });
    if (breadcrumbs.length > MAX_BREADCRUMBS) {
      breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
    }
    enqueuePayload(JSON.stringify(payload));
  } catch {
    // O diagnóstico é sempre melhor esforço e nunca altera a ação do operador.
  }
};

export const recordDiagnosticFailure = (
  component: string,
  action: string,
  message: string,
  caught: unknown,
  options: {
    code?: string;
    operationId?: string;
    runtime?: "cep" | "extendscript";
    details?: Record<string, unknown>;
  } = {}
): void => {
  recordLocalDiagnostic({
    level: "error",
    component,
    action,
    status: "failed",
    code: options.code || errorCode(caught) || "cep_action_failed",
    message,
    operationId: options.operationId,
    runtime: options.runtime,
    details: {
      ...(options.details || {}),
      technicalMessage: errorMessage(caught),
    },
  });
};

const normalizeEvent = (event: LocalDiagnosticEvent): Required<
  Pick<LocalDiagnosticEvent, "level" | "component" | "action" | "status" | "message" | "runtime">
> & Omit<LocalDiagnosticEvent, "level" | "component" | "action" | "status" | "message" | "runtime"> => ({
  ...event,
  level: event.level || "info",
  component: safeIdentifier(event.component, "extensao", 64),
  action: safeIdentifier(event.action, "acao_desconhecida", 96),
  status: safeIdentifier(event.status, "observed", 32),
  code: event.code ? safeIdentifier(event.code, "cep_action_failed", 96) : undefined,
  message: redactText(event.message) || "Uma atividade do painel foi registrada.",
  runtime: event.runtime || "cep",
  operationId: event.operationId
    ? safeIdentifier(event.operationId, "operation", 96)
    : undefined,
});

const hasNodeDiagnostics = (): boolean =>
  Boolean(
    window.cep
      && typeof fs.appendFile === "function"
      && typeof nodePath.join === "function"
  );

const appDataRoot = (): string => {
  const base = String(process.env.LOCALAPPDATA || process.env.APPDATA || "").trim();
  return base ? nodePath.join(base, APP_DATA_DIRECTORY) : "";
};

const defaultDirectory = (): string => {
  const root = appDataRoot();
  return root ? nodePath.join(root, DEFAULT_LOG_DIRECTORY) : "";
};

const configuredDirectory = (): string => {
  const fallback = defaultDirectory();
  const root = appDataRoot();
  if (!root) return fallback;

  try {
    const configPath = nodePath.join(root, CONFIG_FILE_NAME);
    if (!fs.existsSync(configPath)) return fallback;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as DiagnosticsConfig;
    if (config.schemaVersion !== 1) return fallback;
    const directory = typeof config.directory === "string" ? config.directory.trim() : "";
    return directory && nodePath.isAbsolute(directory) && !isUncPath(directory)
      ? directory
      : fallback;
  } catch {
    return fallback;
  }
};

const enqueuePayload = (payload: string): void => {
  if (pendingPayloads.length >= MAX_PENDING_PAYLOADS) {
    pendingPayloads.shift();
  }
  pendingPayloads.push(payload);
  if (flushScheduled || flushInProgress) return;
  flushScheduled = true;
  window.setTimeout(() => {
    flushScheduled = false;
    flushNextPayload();
  }, 0);
};

const flushNextPayload = (): void => {
  if (flushInProgress) return;
  const payload = pendingPayloads.shift();
  if (!payload) return;
  flushInProgress = true;
  appendPayload(payload, () => {
    flushInProgress = false;
    flushNextPayload();
  });
};

const appendPayload = (payload: string, completed: () => void): void => {
  const configured = configuredDirectory();
  const fallback = defaultDirectory();
  const candidates = [configured, fallback].filter(
    (candidate, index, all) => candidate
      && all.findIndex((other) => pathsEqual(other, candidate)) === index
  );
  for (const candidate of candidates) {
    cleanupExpiredLogs(candidate);
  }

  const tryCandidate = (index: number): void => {
    const candidate = candidates[index];
    if (!candidate) {
      completed();
      return;
    }

    let settled = false;
    const settle = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (succeeded) completed();
      else tryCandidate(index + 1);
    };
    const timeoutId = window.setTimeout(
      () => settle(false),
      DIAGNOSTIC_IO_TIMEOUT_MS
    );

    try {
      ensureDirectory(candidate, (directoryError) => {
        if (settled) return;
        if (directoryError) {
          settle(false);
          return;
        }
        const filePath = nodePath.join(candidate, `${LOG_PREFIX}${localDateStamp()}${LOG_SUFFIX}`);
        fs.appendFile(filePath, `${payload}\n`, "utf8", (writeError) => {
          settle(!writeError);
        });
      });
    } catch {
      settle(false);
    }
  };

  tryCandidate(0);
};

const ensureDirectory = (
  directory: string,
  completed: (error: NodeJS.ErrnoException | null) => void
): void => {
  fs.mkdir(directory, (error) => {
    if (!error || error.code === "EEXIST") {
      completed(null);
      return;
    }
    if (error.code !== "ENOENT") {
      completed(error);
      return;
    }

    const parent = nodePath.dirname(directory);
    if (!parent || pathsEqual(parent, directory)) {
      completed(error);
      return;
    }
    ensureDirectory(parent, (parentError) => {
      if (parentError) {
        completed(parentError);
        return;
      }
      ensureDirectory(directory, completed);
    });
  });
};

const cleanupExpiredLogs = (directory: string): void => {
  const today = localDateStamp();
  const cleanupKey = `${String(directory || "").toLowerCase()}|${today}`;
  if (
    !directory
    || cleanupKeys.has(cleanupKey)
    || cleanupInProgressKeys.has(cleanupKey)
  ) return;
  cleanupInProgressKeys.add(cleanupKey);

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1));
  fs.readdir(directory, (directoryError, names) => {
    if (directoryError) {
      cleanupInProgressKeys.delete(cleanupKey);
      return;
    }
    const expiredNames = names.filter((name) => {
      const match = name.match(
        /^arizona-cep-(\d{4}-\d{2}-\d{2})(?:\.part-[a-z0-9-]+)?\.jsonl$/i
      );
      if (!match) return false;
      const fileDate = new Date(`${match[1]}T00:00:00`);
      return !Number.isNaN(fileDate.getTime()) && fileDate < cutoff;
    });
    if (expiredNames.length === 0) {
      cleanupInProgressKeys.delete(cleanupKey);
      cleanupKeys.add(cleanupKey);
      return;
    }

    let pending = expiredNames.length;
    let failed = false;
    const settle = (succeeded: boolean): void => {
      failed = failed || !succeeded;
      pending -= 1;
      if (pending > 0) return;
      cleanupInProgressKeys.delete(cleanupKey);
      if (!failed) cleanupKeys.add(cleanupKey);
    };
    for (const name of expiredNames) {
      const filePath = nodePath.join(directory, name);
      fs.lstat(filePath, (statError, stat) => {
        if (statError) {
          settle(statError.code === "ENOENT");
          return;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
          settle(true);
          return;
        }
        fs.unlink(filePath, (unlinkError) => {
          settle(!unlinkError || unlinkError.code === "ENOENT");
        });
      });
    }
  });
};

const pathsEqual = (left: string, right: string): boolean =>
  nodePath.resolve(left).toLowerCase() === nodePath.resolve(right).toLowerCase();

const isUncPath = (value: string): boolean => /^[\\/]{2}/.test(String(value || ""));

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (depth >= 4) return "<detalhe omitido>";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>)
      .slice(0, 32)
      .forEach(([key, item]) => {
        const safeKey = safeIdentifier(key, "detail", 64);
        sanitized[safeKey] = depth > 0 && isSensitiveDetailKey(safeKey)
          ? "<dado-removido>"
          : sanitizeValue(item, depth + 1);
      });
    return sanitized;
  }
  return String(value ?? "");
};

const isSensitiveDetailKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("token")
    || normalized.includes("password")
    || normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("credential")
    || normalized.includes("authorization")
    || normalized.includes("receipt")
    || normalized.includes("activationcode")
    || normalized.includes("email")
    || normalized.includes("fingerprint")
    || normalized.includes("installid")
    || normalized.includes("deviceid")
    || normalized.includes("memberid")
    || normalized.includes("organizationid")
    || normalized.includes("organizationname")
    || normalized.includes("sessionid")
    || normalized.includes("userid")
    || normalized.includes("accountid")
    || normalized.endsWith("path")
    || normalized.endsWith("directory");
};

const redactText = (value: unknown): string => {
  let output = String(value ?? "").replace(/[\r\n]+/g, " ");
  output = output.replace(/["'](?:[a-z]:[\\/]|\\\\)[^"'\r\n]+["']/gi, "<caminho-local>");
  output = output.replace(/\b[a-z]:[\\/].*$/gi, "<caminho-local>");
  output = output.replace(/\\\\[^\s\\/]+[\\/].*$/g, "<caminho-local>");
  for (const [variable, placeholder] of [
    ["USERPROFILE", "%USERPROFILE%"],
    ["LOCALAPPDATA", "%LOCALAPPDATA%"],
    ["APPDATA", "%APPDATA%"],
    ["TEMP", "%TEMP%"],
    ["TMP", "%TMP%"],
  ]) {
    const directory = String(process.env[variable] || "").trim();
    if (directory) {
      output = output.replace(new RegExp(escapeRegExp(directory), "gi"), placeholder);
      output = output.replace(
        new RegExp(escapeRegExp(directory.replace(/\\/g, "/")), "gi"),
        placeholder
      );
    }
  }
  output = output.replace(/\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/gi, "<email>");
  output = output.replace(
    /(["']?(?:authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|credential)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')/gi,
    '$1"<segredo-removido>"'
  );
  output = output.replace(
    /\b(authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|credential)["']?\s*[:=]\s*["']?(?:bearer\s+)?[^\s,"'}]+/gi,
    "$1=<segredo-removido>"
  );
  output = output.replace(/\bbearer\s+["']?[^\s,"']+/gi, "bearer <segredo-removido>");
  output = output.replace(
    /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]{8,})?\b/g,
    "<token-removido>"
  );
  output = output.replace(/\b[A-Z0-9]{4}(?:-?[A-Z0-9]{4}){2}\b/g, "<codigo-removido>");
  output = output.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?<parametros-removidos>");
  return output.trim().slice(0, MAX_TEXT_LENGTH);
};

const safeIdentifier = (value: unknown, fallback: string, maxLength: number): string => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:\-]/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
};

const errorMessage = (caught: unknown): string => {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "string") return caught;
  if (caught && typeof caught === "object" && "message" in caught) {
    return String(caught.message || "Erro técnico sem detalhes.");
  }
  return "Erro técnico sem detalhes disponíveis.";
};

const errorCode = (caught: unknown): string => {
  if (!caught || typeof caught !== "object") return "";
  if ("code" in caught) return String(caught.code || "");
  if ("errorCode" in caught) return String(caught.errorCode || "");
  return "";
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const localDateStamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
