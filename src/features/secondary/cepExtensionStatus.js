const CEP_INSTALLATION_SCOPES = new Set(["perUser", "perMachine"]);
const CEP_CONSOLIDATION_STATES = new Set([
  "idle", "checking", "waitingForAfterEffects", "completed", "preservedNewerUser", "blocked",
]);

function normalizeScope(value) {
  return CEP_INSTALLATION_SCOPES.has(value) ? value : null;
}

function normalizeInstallation(value) {
  return {
    scope: normalizeScope(value?.scope),
    installed: Boolean(value?.installed),
    version: String(value?.version || "").trim(),
    path: String(value?.path || "").trim(),
    isDevLink: Boolean(value?.isDevLink),
    manifestValid: typeof value?.manifestValid === "boolean" ? value.manifestValid : null,
  };
}

export function normalizeCepExtensionStatus(status) {
  const installations = Array.isArray(status?.installations)
    ? status.installations
      .filter((installation) => installation && typeof installation === "object")
      .map(normalizeInstallation)
    : [];
  const installedCount = installations.filter((installation) => installation.installed).length;

  return {
    installed: Boolean(status?.installed),
    version: String(status?.version || "").trim(),
    path: String(status?.path || "").trim(),
    isDevLink: Boolean(status?.isDevLink),
    scope: normalizeScope(status?.scope),
    installations,
    hasMultipleInstallations: Boolean(status?.hasMultipleInstallations) || installedCount > 1,
    targetScope: normalizeScope(status?.targetScope),
    targetPath: String(status?.targetPath || "").trim(),
    requiresElevation: status?.requiresElevation === true,
    developmentMode: status?.developmentMode === true || Boolean(status?.isDevLink)
      || installations.some((installation) => installation.installed && installation.isDevLink),
    consolidationRequired: status?.consolidationRequired === true,
    automaticConsolidation: CEP_CONSOLIDATION_STATES.has(status?.automaticConsolidation)
      ? status.automaticConsolidation : "idle",
  };
}

export function cepConsolidationMessage(status) {
  if (!status?.consolidationRequired) return "";
  if (status.automaticConsolidation === "checking") {
    return "Conferindo a instalação do Full para consolidar as cópias do painel.";
  }
  if (status.automaticConsolidation === "waitingForAfterEffects") {
    return "Feche o After Effects. O Arizona consolidará as cópias do painel automaticamente.";
  }
  if (status.automaticConsolidation === "preservedNewerUser") {
    return "A cópia deste usuário é mais nova e foi preservada. Use Atualizar para escolher a versão a manter.";
  }
  if (status.automaticConsolidation === "blocked") {
    return "A consolidação automática não foi concluída. Use Atualizar para consolidar as cópias do painel.";
  }
  return "Há cópias do painel em mais de um local. Use Atualizar para consolidá-las no destino indicado na confirmação.";
}

export function cepInstallationScopeLabel(scope) {
  if (scope === "perUser") return "Este usuário";
  if (scope === "perMachine") return "Todos os usuários";
  return "";
}

function normalizeWindowsPath(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

export function cepInstallationLocationLabel(installation) {
  if (installation?.isDevLink) return "Desenvolvimento";
  const scope = normalizeScope(installation?.scope);
  const path = normalizeWindowsPath(installation?.path);

  if (scope === "perMachine" && /(?:^|\\)program files \(x86\)(?:\\|$)/i.test(path)) {
    return "Legada (32 bits)";
  }

  return cepInstallationScopeLabel(scope) || "Outro local";
}

export function cepAdditionalInstallations(status) {
  const installations = Array.isArray(status?.installations) ? status.installations : [];
  const effectivePath = status?.installed ? normalizeWindowsPath(status?.path) : "";

  return installations.filter((installation) => {
    if (!installation?.installed) return false;
    if (!effectivePath) return true;
    return normalizeWindowsPath(installation.path) !== effectivePath;
  });
}

function parseSemver(value) {
  const match = String(value || "")
    .trim()
    .match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;

  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return null;

  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }

  return { core, prerelease };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;

    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) {
      if (left[index].length !== right[index].length) {
        return left[index].length < right[index].length ? -1 : 1;
      }
      return left[index] < right[index] ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function cepVersionRelation(candidateVersion, installedVersion) {
  const candidate = parseSemver(candidateVersion);
  if (!String(installedVersion || "").trim()) return candidate ? "install" : "unknown";
  const installed = parseSemver(installedVersion);
  if (!candidate || !installed) return "unknown";

  for (let index = 0; index < candidate.core.length; index += 1) {
    if (candidate.core[index] === installed.core[index]) continue;
    return candidate.core[index] > installed.core[index] ? "upgrade" : "downgrade";
  }

  const prereleaseOrder = comparePrerelease(candidate.prerelease, installed.prerelease);
  if (prereleaseOrder > 0) return "upgrade";
  if (prereleaseOrder < 0) return "downgrade";
  return "same";
}

export function cepInstalledVersionForUpdate(status) {
  const installations = Array.isArray(status?.installations) ? status.installations : [];
  // Development builds are preserved independently and never gate a release
  // downgrade. The backend applies the same rule to its installation inventory.
  if (installations.length > 0) {
    let version = "";
    for (const installation of installations) {
      if (!installation?.installed || installation.isDevLink || installation.manifestValid !== true) continue;
      const candidateVersion = String(installation.version || "").trim();
      const relation = cepVersionRelation(candidateVersion, version);
      if (relation === "install" || relation === "upgrade") version = candidateVersion;
    }
    return version;
  }
  return status?.installed && !status.isDevLink ? String(status.version || "").trim() : "";
}

export function cepHasInstallTarget(status) {
  return normalizeScope(status?.targetScope) !== null && Boolean(String(status?.targetPath || "").trim());
}

export function cepHasPerUserDevLink(status) {
  const installations = Array.isArray(status?.installations) ? status.installations : [];
  if (installations.length > 0) {
    return installations.some((installation) => installation?.installed && installation.isDevLink && installation.scope === "perUser");
  }
  return Boolean(status?.isDevLink) && status?.scope === "perUser";
}

export function cepDevelopmentModePreserved(status, replaceDevLink = false) {
  const installations = Array.isArray(status?.installations) ? status.installations : [];
  if (installations.length > 0) {
    return installations.some((installation) => installation?.installed && installation.isDevLink
      && (installation.scope !== "perUser" || !replaceDevLink));
  }
  return Boolean(status?.developmentMode) && !(cepHasPerUserDevLink(status) && replaceDevLink);
}

export function cepDevLinkRequiresReplacement(status) {
  return cepHasPerUserDevLink(status) && status?.targetScope === "perUser";
}

export function cepInstallActionLabel(relation) {
  if (relation === "upgrade") return "Atualizar";
  if (relation === "same") return "Reinstalar";
  if (relation === "downgrade") return "Instalar versão anterior";
  return "Instalar";
}

export function cepInstallCommandArgs({
  path,
  expectedVersion = "",
  replaceDevLink = false,
  relation = "unknown",
  downgradeConfirmed = false,
  targetScope,
  targetPath,
}) {
  if (!cepHasInstallTarget({ targetScope, targetPath })) {
    throw new Error("cep_install_target_changed: Atualize o destino da instalação antes de continuar.");
  }
  return {
    path,
    expectedVersion: String(expectedVersion || "").trim(),
    replaceDevLink: Boolean(replaceDevLink),
    allowDowngrade: relation === "downgrade" && Boolean(downgradeConfirmed),
    expectedTargetScope: targetScope,
    expectedTargetPath: String(targetPath).trim(),
  };
}
