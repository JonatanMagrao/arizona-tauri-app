import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ID = "com.arizona-carrefour.cep";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function withoutWindowsNamespace(value) {
  if (process.platform !== "win32") return value;

  if (value.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${value.slice(8)}`;
  }

  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

function comparablePath(value) {
  const resolved = path.resolve(withoutWindowsNamespace(String(value)));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function entryStats(value) {
  try {
    return lstatSync(value);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function resolvedLinkTarget(linkPath) {
  try {
    return realpathSync(linkPath);
  } catch {
    try {
      const target = readlinkSync(linkPath);
      return path.resolve(path.dirname(linkPath), target);
    } catch {
      return "";
    }
  }
}

function assertCepDevPaths({ installedPath, devTargetPath, extensionId }) {
  const extensionsRoot = path.dirname(installedPath);
  const cepRoot = path.dirname(extensionsRoot);

  if (path.basename(installedPath) !== extensionId) {
    throw new Error(`Destino CEP inesperado: ${installedPath}`);
  }
  if (
    path.basename(extensionsRoot).toLowerCase() !== "extensions" ||
    path.basename(cepRoot).toLowerCase() !== "cep" ||
    path.basename(path.dirname(cepRoot)).toLowerCase() !== "adobe"
  ) {
    throw new Error(`Destino CEP fora da pasta Adobe CEP esperada: ${installedPath}`);
  }
  if (!pathInside(cepRoot, installedPath)) {
    throw new Error("O caminho da extensão precisa permanecer dentro da pasta CEP.");
  }
  if (comparablePath(installedPath) === comparablePath(devTargetPath)) {
    throw new Error("A junction CEP não pode apontar para ela mesma.");
  }

  return { cepRoot, extensionsRoot };
}

function backupTimestamp(now) {
  return new Date(now)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function availableBackupPath(backupRoot, extensionId, now) {
  const baseName = `${extensionId}-${backupTimestamp(now)}`;
  let candidate = path.join(backupRoot, baseName);
  let suffix = 2;

  while (entryStats(candidate)) {
    candidate = path.join(backupRoot, `${baseName}-${suffix}`);
    suffix += 1;
  }

  return candidate;
}

export function defaultCepDevPaths(environment = process.env) {
  const appDataRoot = String(environment.APPDATA || "").trim();
  if (!appDataRoot) {
    throw new Error("APPDATA não está disponível para configurar a extensão CEP.");
  }

  const cepRoot = path.join(appDataRoot, "Adobe", "CEP");
  return {
    backupRoot: path.join(cepRoot, ".arizona-dev-backup"),
    devTargetPath: path.join(REPOSITORY_ROOT, "ARIZONA-EXTENSION", "dist", "cep"),
    installedPath: path.join(cepRoot, "extensions", EXTENSION_ID),
  };
}

export function ensureCepDevLink({
  installedPath,
  devTargetPath,
  backupRoot,
  extensionId = EXTENSION_ID,
  now = Date.now(),
  createLink = symlinkSync,
}) {
  const { cepRoot, extensionsRoot } = assertCepDevPaths({
    installedPath,
    devTargetPath,
    extensionId,
  });

  if (!pathInside(cepRoot, backupRoot)) {
    throw new Error("Os caminhos da extensão e do backup precisam permanecer dentro da pasta CEP.");
  }
  if (pathInside(installedPath, backupRoot)) {
    throw new Error("A pasta de backup não pode ficar dentro da extensão instalada.");
  }

  mkdirSync(devTargetPath, { recursive: true });
  mkdirSync(extensionsRoot, { recursive: true });

  let backupPath = null;
  const installedEntry = entryStats(installedPath);
  if (installedEntry) {
    if (installedEntry.isSymbolicLink()) {
      const currentTarget = resolvedLinkTarget(installedPath);
      if (currentTarget && comparablePath(currentTarget) === comparablePath(realpathSync(devTargetPath))) {
        return {
          status: "exists",
          installedPath,
          devTargetPath,
          backupPath,
        };
      }
    } else if (!installedEntry.isDirectory()) {
      throw new Error(`O destino CEP existe, mas não é uma pasta nem uma junction: ${installedPath}`);
    }

    mkdirSync(backupRoot, { recursive: true });
    backupPath = availableBackupPath(backupRoot, extensionId, now);
    renameSync(installedPath, backupPath);
  }

  try {
    createLink(
      path.resolve(devTargetPath),
      installedPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (createError) {
    if (backupPath && !entryStats(installedPath)) {
      try {
        renameSync(backupPath, installedPath);
      } catch (rollbackError) {
        const createMessage = createError instanceof Error ? createError.message : String(createError);
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        throw new Error(
          `A junction falhou (${createMessage}) e o backup não pôde ser restaurado (${rollbackMessage}).`,
        );
      }
    }
    throw createError;
  }

  return {
    status: "created",
    installedPath,
    devTargetPath,
    backupPath,
  };
}

export function removeCepDevLink({
  installedPath,
  devTargetPath,
  extensionId = EXTENSION_ID,
  removeLink = unlinkSync,
}) {
  assertCepDevPaths({ installedPath, devTargetPath, extensionId });

  const installedEntry = entryStats(installedPath);
  if (installedEntry === null) {
    return {
      status: "absent",
      installedPath,
      devTargetPath,
    };
  }

  if (!installedEntry.isSymbolicLink()) {
    if (installedEntry.isDirectory()) {
      return {
        status: "preserved",
        installedPath,
        devTargetPath,
      };
    }

    throw new Error(
      `O destino CEP existe, mas não é uma pasta nem uma junction: ${installedPath}`,
    );
  }

  const currentTarget = resolvedLinkTarget(installedPath);
  if (
    currentTarget === "" ||
    comparablePath(currentTarget) !== comparablePath(devTargetPath)
  ) {
    throw new Error(
      `A junction CEP aponta para um destino inesperado e foi preservada: ${currentTarget || "desconhecido"}`,
    );
  }

  removeLink(installedPath);
  if (entryStats(installedPath) !== null) {
    throw new Error(`A junction CEP ainda existe após a limpeza: ${installedPath}`);
  }

  return {
    status: "removed",
    installedPath,
    devTargetPath,
  };
}

function run() {
  const removeMode = process.argv.slice(2).includes("--remove");

  try {
    const paths = defaultCepDevPaths();
    const result = removeMode
      ? removeCepDevLink(paths)
      : ensureCepDevLink(paths);

    if (removeMode) {
      if (result.status === "removed") {
        console.log(`[cep-dev-link] Junction de desenvolvimento removida: ${result.installedPath}`);
        console.log(`[cep-dev-link] Build preservado em: ${result.devTargetPath}`);
      } else if (result.status === "preserved") {
        console.log(`[cep-dev-link] Instalação CEP normal preservada em: ${result.installedPath}`);
      } else {
        console.log("[cep-dev-link] Nenhuma junction de desenvolvimento para remover.");
      }
      return;
    }

    if (result.backupPath) {
      console.log(`[cep-dev-link] Instalação anterior preservada em: ${result.backupPath}`);
    }
    if (result.status === "exists") {
      console.log(`[cep-dev-link] Junction já configurada para: ${result.devTargetPath}`);
    } else {
      console.log(`[cep-dev-link] Junction criada: ${result.installedPath}`);
      console.log(`[cep-dev-link] Destino: ${result.devTargetPath}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const action = removeMode ? "limpar o modo dev" : "preparar a extensão";
    console.error(`[cep-dev-link] Não foi possível ${action}: ${message}`);
    console.error(
      removeMode
        ? "[cep-dev-link] Feche o After Effects e tente novamente. Nenhum alvo foi apagado."
        : "[cep-dev-link] Feche o After Effects e tente npm run dev:all novamente.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && comparablePath(process.argv[1]) === comparablePath(SCRIPT_PATH)) {
  run();
}
