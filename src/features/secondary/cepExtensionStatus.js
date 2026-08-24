const CEP_INSTALLATION_SCOPES = new Set(["perUser", "perMachine"]);

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
  };
}

export function cepInstallationScopeLabel(scope) {
  if (scope === "perUser") return "Somente este usuário";
  if (scope === "perMachine") return "Todos os usuários (instalador Full)";
  return "";
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

export function cepDowngradeRequiresFullInstaller(selectedVersion, status) {
  const installations = Array.isArray(status?.installations) ? status.installations : [];

  if (installations.length > 0) {
    return installations.some((installation) => (
      installation?.scope === "perMachine"
      && Boolean(installation?.installed)
      && installation?.manifestValid === true
      && cepVersionRelation(selectedVersion, installation?.version) === "downgrade"
    ));
  }

  return Boolean(status?.installed)
    && status?.scope === "perMachine"
    && cepVersionRelation(selectedVersion, status?.version) === "downgrade";
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
}) {
  return {
    path,
    expectedVersion: String(expectedVersion || "").trim(),
    replaceDevLink: Boolean(replaceDevLink),
    allowDowngrade: relation === "downgrade" && Boolean(downgradeConfirmed),
  };
}
