import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as statusHelpers from "./cepExtensionStatus.js";

import {
  cepAdditionalInstallations,
  cepCanRetryConsolidation,
  cepConsolidationMessage,
  cepDevelopmentModePreserved,
  cepDevLinkRequiresReplacement,
  cepHasInstallTarget,
  cepHasPerUserDevLink,
  cepInstallationLocationLabel,
  cepInstallationScopeLabel,
  cepInstalledVersionForUpdate,
  cepInstallActionLabel,
  cepInstallCommandArgs,
  cepVersionRelation,
  normalizeCepExtensionStatus,
} from "./cepExtensionStatus.js";

test("normalizes the legacy CEP status without requiring the new installation fields", () => {
  assert.deepEqual(
    normalizeCepExtensionStatus({
      installed: true,
      version: " 2.2.0 ",
      path: " C:\\Adobe\\CEP ",
      isDevLink: false,
    }),
    {
      installed: true,
      version: "2.2.0",
      path: "C:\\Adobe\\CEP",
      isDevLink: false,
      scope: null,
      installations: [],
      hasMultipleInstallations: false,
      targetScope: null,
      targetPath: "",
      requiresElevation: false,
      developmentMode: false,
      consolidationRequired: false,
      automaticConsolidation: "idle",
      automaticConsolidationFailureCode: "",
    },
  );
});

test("keeps the effective CEP candidate and sanitizes installation details", () => {
  const status = normalizeCepExtensionStatus({
    installed: true,
    version: "2.2.0",
    path: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
    isDevLink: false,
    scope: "perMachine",
    hasMultipleInstallations: false,
    installations: [
      {
        scope: "perUser",
        installed: true,
        version: "2.1.0",
        path: "C:\\Users\\Arizona\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
        isDevLink: true,
        manifestValid: true,
      },
      {
        scope: "perMachine",
        installed: true,
        version: "2.2.0",
        path: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
        isDevLink: false,
        manifestValid: true,
      },
      null,
    ],
  });

  assert.equal(status.scope, "perMachine");
  assert.equal(status.installations.length, 2);
  assert.equal(status.installations[0].scope, "perUser");
  assert.equal(status.installations[0].isDevLink, true);
  assert.equal(status.installations[1].manifestValid, true);
  assert.equal(status.hasMultipleInstallations, true);
  assert.equal(cepInstallationScopeLabel("perUser"), "Este usuário");
  assert.equal(cepInstallationScopeLabel("perMachine"), "Todos os usuários");
  assert.equal(cepInstallationScopeLabel("unexpected"), "");
});

test("shows only real additional CEP installations with unambiguous labels", () => {
  const effectivePath = "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep";
  const legacyPath = "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep";
  const status = normalizeCepExtensionStatus({
    installed: true,
    version: "2.2.1",
    path: effectivePath,
    scope: "perMachine",
    installations: [
      {
        scope: "perUser",
        installed: false,
        path: "C:\\Users\\Arizona\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
      },
      {
        scope: "perMachine",
        installed: true,
        version: "2.2.1",
        path: effectivePath.toUpperCase().replaceAll("\\", "/"),
        manifestValid: true,
      },
      {
        scope: "perMachine",
        installed: false,
        path: legacyPath,
      },
    ],
  });

  assert.equal(cepInstallationLocationLabel(status), "Todos os usuários");
  assert.deepEqual(cepAdditionalInstallations(status), []);

  status.installations[2].installed = true;
  status.installations[2].version = "2.1.0";
  status.installations[2].manifestValid = true;

  const additional = cepAdditionalInstallations(status);
  assert.equal(additional.length, 1);
  assert.equal(cepInstallationLocationLabel(additional[0]), "Legada (32 bits)");
});

test("keeps an invalid occupied CEP location visible when there is no effective install", () => {
  const status = normalizeCepExtensionStatus({
    installed: false,
    installations: [
      {
        scope: "perMachine",
        installed: true,
        path: "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
        manifestValid: false,
      },
    ],
  });

  const additional = cepAdditionalInstallations(status);
  assert.equal(additional.length, 1);
  assert.equal(additional[0].manifestValid, false);
  assert.equal(cepInstallationLocationLabel(additional[0]), "Legada (32 bits)");
});

test("classifies upgrades, reinstalls and downgrades with SemVer precedence", () => {
  assert.equal(cepVersionRelation("2.3.0", "2.2.0"), "upgrade");
  assert.equal(cepVersionRelation("2.2.0", "2.2.0+build.7"), "same");
  assert.equal(cepVersionRelation("2.2.0-rc.2", "2.2.0-rc.1"), "upgrade");
  assert.equal(cepVersionRelation("2.2.0-rc.1", "2.2.0"), "downgrade");
  assert.equal(cepVersionRelation("2.1.9", "2.2.0"), "downgrade");
  assert.equal(cepVersionRelation("2.2", "2.1.0"), "unknown");
  assert.equal(cepVersionRelation("2.2.0", ""), "install");

  assert.equal(cepInstallActionLabel("upgrade"), "Atualizar");
  assert.equal(cepInstallActionLabel("same"), "Reinstalar");
  assert.equal(cepInstallActionLabel("downgrade"), "Instalar versão anterior");
  assert.equal(cepInstallActionLabel("unknown"), "Instalar");
});

test("sends downgrade authorization only after explicit confirmation", () => {
  const base = {
    path: "C:\\Downloads\\arizona-cep-v2.1.0.zxp",
    expectedVersion: " 2.1.0 ",
    replaceDevLink: true,
    relation: "downgrade",
    targetScope: "perMachine",
    targetPath: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
  };

  assert.deepEqual(cepInstallCommandArgs(base), {
    path: base.path,
    expectedVersion: "2.1.0",
    replaceDevLink: true,
    allowDowngrade: false,
    expectedTargetScope: base.targetScope,
    expectedTargetPath: base.targetPath,
  });
  assert.deepEqual(cepInstallCommandArgs({ ...base, downgradeConfirmed: true }), {
    path: base.path,
    expectedVersion: "2.1.0",
    replaceDevLink: true,
    allowDowngrade: true,
    expectedTargetScope: base.targetScope,
    expectedTargetPath: base.targetPath,
  });
  assert.equal(
    cepInstallCommandArgs({ ...base, relation: "upgrade", downgradeConfirmed: true })
      .allowDowngrade,
    false,
  );
});

test("compares releases against the highest valid normal installation across scopes", () => {
  const status = normalizeCepExtensionStatus({
    installed: true,
    version: "2.3.0",
    scope: "perUser",
    installations: [
      {
        scope: "perUser",
        installed: true,
        version: "2.3.0",
        manifestValid: true,
      },
      {
        scope: "perMachine",
        installed: true,
        version: "2.2.0",
        manifestValid: true,
      },
    ],
  });

  assert.equal(cepInstalledVersionForUpdate(status), "2.3.0");
  assert.equal(cepVersionRelation("2.2.0", cepInstalledVersionForUpdate(status)), "downgrade");

  const invalidMachineStatus = normalizeCepExtensionStatus({
    installed: true,
    version: "2.3.0",
    scope: "perUser",
    installations: [
      {
        scope: "perMachine",
        installed: true,
        version: "9.0.0",
        manifestValid: false,
      },
    ],
  });
  assert.equal(cepInstalledVersionForUpdate(invalidMachineStatus), "");
});

test("falls back to the effective scope when the backend has no installation inventory", () => {
  assert.equal(
    cepInstalledVersionForUpdate(normalizeCepExtensionStatus({
      installed: true,
      version: "2.2.0",
      scope: "perMachine",
    })),
    "2.2.0",
  );
  assert.equal(
    cepInstalledVersionForUpdate(normalizeCepExtensionStatus({
      installed: true,
      version: "2.2.0",
      scope: "perUser",
    })),
    "2.2.0",
  );
});

test("a development junction and a machine release preserve development by default", () => {
  const status = normalizeCepExtensionStatus({
    installed: true, version: "9.0.0-dev", isDevLink: true, scope: "perUser",
    targetScope: "perMachine", targetPath: " C:\\CEP\\machine ",
    requiresElevation: true, developmentMode: true, consolidationRequired: false,
    installations: [
      { scope: "perUser", installed: true, isDevLink: true, manifestValid: true, version: "9.0.0-dev" },
      { scope: "perMachine", installed: true, isDevLink: false, manifestValid: true, version: "2.4.0" },
    ],
  });
  assert.equal(status.hasMultipleInstallations, true);
  assert.equal(status.developmentMode, true);
  assert.equal(status.consolidationRequired, false);
  assert.equal(cepInstallationLocationLabel(status), "Desenvolvimento");
  assert.equal(cepDevLinkRequiresReplacement(status), false);
  assert.equal(cepInstalledVersionForUpdate(status), "2.4.0");
  assert.equal(cepVersionRelation("2.4.1", cepInstalledVersionForUpdate(status)), "upgrade");
  const args = cepInstallCommandArgs({ ...status, path: "update.zxp" });
  assert.equal(args.expectedTargetScope, "perMachine");
  assert.equal(args.expectedTargetPath, "C:\\CEP\\machine");
  assert.equal(args.replaceDevLink, false);
  assert.equal(cepInstallCommandArgs({ ...status, path: "update.zxp", replaceDevLink: true }).expectedTargetScope, "perMachine");
});

test("only a development junction requires its explicit replacement without a release downgrade", () => {
  const status = normalizeCepExtensionStatus({
    installed: true, version: "99.0.0", isDevLink: true,
    targetScope: "perUser", targetPath: "C:\\CEP\\user",
    installations: [{ scope: "perUser", installed: true, isDevLink: true, manifestValid: true, version: "99.0.0" }],
  });
  assert.equal(cepDevLinkRequiresReplacement(status), true);
  assert.equal(cepInstalledVersionForUpdate(status), "");
  assert.equal(cepVersionRelation("2.4.0", cepInstalledVersionForUpdate(status)), "install");
  assert.equal(cepInstalledVersionForUpdate({ installed: true, isDevLink: true, version: "99.0.0" }), "");
});

test("normal duplicate releases retain the backend target and consolidation decision", () => {
  const status = normalizeCepExtensionStatus({
    targetScope: "perMachine", targetPath: "C:\\CEP\\machine", requiresElevation: true,
    consolidationRequired: true,
    installations: [
      { installed: true, scope: "perUser", version: "2.4.1", manifestValid: true },
      { installed: true, scope: "perMachine", version: "2.4.0", manifestValid: true },
      { installed: false, scope: "perMachine", version: "9.0.0", manifestValid: true },
    ],
  });
  assert.equal(status.developmentMode, false);
  assert.equal(status.consolidationRequired, true);
  assert.equal(status.requiresElevation, true);
  assert.equal(cepInstalledVersionForUpdate(status), "2.4.1");
  assert.equal(cepDevLinkRequiresReplacement(status), false);
  assert.equal(cepHasInstallTarget(status), true);
});

test("development links outside the current profile are preserved without offering their removal", () => {
  const status = normalizeCepExtensionStatus({ developmentMode: true, targetScope: "perUser", targetPath: "C:\\CEP\\user",
    installations: [
      { installed: true, scope: "perUser", version: "2.4.0", manifestValid: true },
      { installed: true, scope: "perMachine", isDevLink: true, version: "9.0.0", manifestValid: true },
    ],
  });
  assert.equal(cepHasPerUserDevLink(status), false);
  assert.equal(cepDevLinkRequiresReplacement(status), false);
  assert.equal(cepDevelopmentModePreserved(status, true), true);
  assert.equal(cepInstalledVersionForUpdate(status), "2.4.0");
});

test("installation commands require a current explicit destination and never infer it from the effective version", () => {
  for (const invalid of [null, {}, { targetScope: "system", targetPath: "C:\\CEP" }, { targetScope: "perMachine", targetPath: "  " }]) {
    assert.equal(cepHasInstallTarget(invalid), false);
    assert.throws(() => cepInstallCommandArgs({ path: "update.zxp", ...invalid }), /cep_install_target_changed/);
  }
  const status = normalizeCepExtensionStatus({
    installed: true, scope: "perMachine", path: "C:\\Old", targetScope: "perUser", targetPath: "C:\\User",
    requiresElevation: "true", developmentMode: "true", consolidationRequired: "true",
  });
  assert.equal(status.requiresElevation, false);
  assert.equal(status.developmentMode, false);
  assert.equal(status.consolidationRequired, false);
  const args = cepInstallCommandArgs({ ...status, path: "update.zxp" });
  assert.equal(args.expectedTargetScope, "perUser");
  assert.equal(args.expectedTargetPath, "C:\\User");
});

let panelSource = "";

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
function nodeText(node) {
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object") return nodeText(node.props?.children);
  return node === undefined || node === null || typeof node === "boolean" ? "" : String(node);
}

function panelHarness(status, selectedVersion = "2.4.1", installError = null) {
  if (!panelSource) {
    panelSource = transformSync(
      readFileSync(new URL("./SecondaryWindow.jsx", import.meta.url), "utf8")
        + "\nexport { ExtensionSettingsPanel as TestPanel };",
      { loader: "jsx", format: "cjs", jsx: "automatic" },
    ).code;
  }
  const values = [];
  const dependencies = [];
  const effects = [];
  const cleanups = [];
  const eventListeners = new Map();
  const statusResponses = [];
  const retryResponses = [];
  const dialogResponses = [];
  const calls = [];
  const errors = [];
  const successes = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, depIndex) => !Object.is(value, dependencies[index][depIndex]))) {
        dependencies[index] = deps;
        effects.push(callback);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const commandNames = { cepExtensionStatus: "status", cepDebugModeStatus: "debug", inspectCepZxp: "inspect", installCepZxp: "install", cepRetryConsolidation: "retry" };
  const invokeCommand = async (command, args) => {
    calls.push({ command, args });
    if (command === "status") return statusResponses.length ? statusResponses.shift() : status;
    if (command === "debug") return { enabled: false };
    if (command === "retry") {
      const result = retryResponses.length ? retryResponses.shift() : true;
      if (result instanceof Error) throw result;
      return result;
    }
    if (command === "inspect") return { bundleId: "com.arizona-carrefour.cep", version: selectedVersion, trusted: true };
    if (command === "install") {
      if (installError) throw new Error(installError);
      return { version: selectedVersion };
    }
    throw new Error("Unexpected command " + command);
  };
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (specifier === "./cepExtensionStatus") return statusHelpers;
    if (specifier.endsWith("/tauriCommands")) return { commandNames, invokeCommand };
    if (specifier.endsWith("/publicErrors")) return { publicErrorMessage: (_error, fallback) => fallback };
    if (specifier === "@tauri-apps/plugin-dialog") return {
      open: async () => dialogResponses.length ? dialogResponses.shift() : "C:\\Downloads\\extension.zxp",
    };
    if (specifier === "@tauri-apps/api/event") return {
      listen: async (name, callback) => {
        eventListeners.set(name, callback);
        return () => eventListeners.delete(name);
      },
    };
    if (specifier === "@tauri-apps/api/webview") return { getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) };
    return {};
  };
  const sandbox = vm.createContext({ module, exports: module.exports, require,
    window: { addEventListener() {}, removeEventListener() {} } });
  vm.runInContext(panelSource, sandbox);
  const harness = {
    calls, errors, successes, tree: null,
    render() {
      cursor = 0;
      this.tree = module.exports.TestPanel({ showError: (value) => errors.push(value), showSuccess: (value) => successes.push(value) });
      while (effects.length > 0) {
        const cleanup = effects.shift()();
        if (cleanup) cleanups.push(cleanup);
      }
      return this.tree;
    },
    async openConfirmation() {
      this.render();
      await new Promise((resolve) => setImmediate(resolve));
      this.render();
      const choose = elements(this.tree, (node) => node.type === "button" && nodeText(node) === "Escolher arquivo…")[0];
      await choose.props.onClick();
      this.render();
      const install = elements(this.tree, (node) => node.type === "button" && node.props.className === "btn btn-primary")[0];
      assert.equal(install.props.disabled, false);
      install.props.onClick();
      this.render();
    },
    confirmButton() {
      const dialog = elements(this.tree, (node) => node.props?.role === "dialog")[0];
      return elements(dialog, (node) => node.type === "button" && node.props.className === "btn btn-primary")[0];
    },
    checks() { return elements(this.tree, (node) => node.type === "input" && node.props.type === "checkbox"); },
    button(label) { return elements(this.tree, (node) => node.type === "button" && nodeText(node) === label)[0]; },
    queueStatus(response) { statusResponses.push(response); },
    queueRetry(response) { retryResponses.push(response); },
    queueDialog(response) { dialogResponses.push(response); },
    emitConsolidation() { eventListeners.get("arizona-cep:consolidation-changed")?.({ payload: "completed" }); },
    get listenerCount() { return eventListeners.size; },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
  return harness;
}

const machineStatus = (patch = {}) => ({
  installed: true, version: "2.4.0", scope: "perMachine", path: "C:\\CEP\\machine",
  targetScope: "perMachine", targetPath: "C:\\CEP\\machine", requiresElevation: true,
  developmentMode: false, consolidationRequired: false,
  installations: [{ installed: true, scope: "perMachine", path: "C:\\CEP\\machine", version: "2.4.0", manifestValid: true }],
  ...patch,
});

test("automatic consolidation messages distinguish pending work, preserved newer copies and failures", () => {
  for (const [state, expected] of [
    ["checking", /Conferindo/],
    ["waitingForAfterEffects", /Feche o After Effects.*automaticamente/],
    ["preservedNewerUser", /mais nova.*preservada/],
    ["blocked", /ficou pendente.*Tentar novamente/],
    ["idle", /Tentar novamente.*\.zxp/],
  ]) {
    const normalized = normalizeCepExtensionStatus({ consolidationRequired: true, automaticConsolidation: state });
    assert.equal(normalized.automaticConsolidation, state);
    assert.match(cepConsolidationMessage(normalized), expected);
    assert.doesNotMatch(cepConsolidationMessage(normalized), /próxima instalação/);
  }
  assert.equal(normalizeCepExtensionStatus({ automaticConsolidation: "unexpected" }).automaticConsolidation, "idle");
  assert.equal(cepConsolidationMessage({ consolidationRequired: false, automaticConsolidation: "completed" }), "");
});

test("retry is reserved for pending normal consolidation and gives actionable guidance for permanent guards", () => {
  for (const state of ["idle", "blocked"]) {
    assert.equal(cepCanRetryConsolidation({ consolidationRequired: true, automaticConsolidation: state }), true);
  }
  for (const state of ["checking", "waitingForAfterEffects", "completed", "preservedNewerUser"]) {
    assert.equal(cepCanRetryConsolidation({ consolidationRequired: true, automaticConsolidation: state }), false);
  }
  assert.equal(cepCanRetryConsolidation({ consolidationRequired: false, automaticConsolidation: "blocked", developmentMode: true }), false);
  for (const [failureCode, message] of [
    ["cep_consolidation_user_changed", /mudou.*preservada.*\.zxp/],
    ["cep_consolidation_elevated_process", /abra-o normalmente.*administrador/],
    ["cep_consolidation_commit_unconfirmed", /confirmar a conclusão.*\.zxp.*novamente/],
  ]) {
    const status = normalizeCepExtensionStatus({ consolidationRequired: true, automaticConsolidation: "blocked", automaticConsolidationFailureCode: failureCode });
    assert.equal(status.automaticConsolidationFailureCode, failureCode);
    assert.equal(cepCanRetryConsolidation(status), false);
    assert.match(cepConsolidationMessage(status), message);
  }
});

test("retry starts only consolidation once, prevents overlapping installation and clears the warning on completion", async () => {
  const status = machineStatus({ consolidationRequired: true, automaticConsolidation: "blocked" });
  const h = panelHarness(status);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  let finishRetry;
  h.queueRetry(new Promise((resolve) => { finishRetry = resolve; }));
  const retry = h.button("Tentar novamente");
  const pending = retry.props.onClick();
  await retry.props.onClick();
  h.render();
  assert.equal(h.button("Tentando...").props.disabled, true);
  assert.equal(h.button("Escolher arquivo…").props.disabled, true);
  assert.equal(h.calls.filter(({ command }) => command === "retry").length, 1);
  assert.equal(h.calls.some(({ command }) => command === "install" || command === "inspect"), false);

  status.consolidationRequired = false;
  status.automaticConsolidation = "completed";
  h.emitConsolidation();
  finishRetry(true);
  await pending;
  h.render();
  assert.equal(h.button("Tentar novamente"), undefined);
  assert.equal(h.button("Escolher arquivo…").props.disabled, false);
  assert.doesNotMatch(nodeText(h.tree), /consolidação das cópias ficou pendente/);
  assert.deepEqual(h.errors, []);
  h.unmount();
});

test("retry failures refresh status and explain a development-app refusal without starting installation", async () => {
  const h = panelHarness(machineStatus({ consolidationRequired: true, automaticConsolidation: "blocked" }));
  h.queueRetry(new Error("cep_consolidation_development_mode: development"));
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  await h.button("Tentar novamente").props.onClick();
  h.render();
  assert.match(h.errors[0], /desativada no aplicativo de desenvolvimento.*versão instalada/);
  assert.equal(h.button("Tentar novamente").props.disabled, false);
  assert.equal(h.calls.filter(({ command }) => command === "status").length, 2);
  assert.equal(h.calls.some(({ command }) => command === "install"), false);
  assert.deepEqual(h.successes, []);
  h.unmount();
});

test("cancelling ZXP selection preserves development mode without starting consolidation", async () => {
  const h = panelHarness(machineStatus({ developmentMode: true, consolidationRequired: false, automaticConsolidation: "idle" }));
  h.queueDialog(null);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  await h.button("Escolher arquivo…").props.onClick();
  h.render();
  assert.equal(h.button("Tentar novamente"), undefined);
  assert.equal(h.calls.some(({ command }) => ["inspect", "install", "retry"].includes(command)), false);
  assert.match(nodeText(h.tree), /Desenvolvimento/);
  h.unmount();
});

test("checking and waiting for After Effects cannot enqueue another retry", async () => {
  for (const automaticConsolidation of ["checking", "waitingForAfterEffects"]) {
    const h = panelHarness(machineStatus({ consolidationRequired: true, automaticConsolidation }));
    h.render();
    await new Promise((resolve) => setImmediate(resolve));
    h.render();
    assert.equal(h.button("Tentar novamente"), undefined);
    assert.equal(h.button("Escolher arquivo…").props.disabled, automaticConsolidation === "checking");
    h.unmount();
  }
});

test("late manual refresh cannot overwrite the status delivered by consolidation completion", async () => {
  const status = machineStatus({ consolidationRequired: true, automaticConsolidation: "blocked" });
  const h = panelHarness(status);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  let resolveOld;
  h.queueStatus(new Promise((resolve) => { resolveOld = resolve; }));
  const refresh = h.button("Atualizar").props.onClick();
  status.consolidationRequired = false;
  status.automaticConsolidation = "completed";
  h.emitConsolidation();
  await new Promise((resolve) => setImmediate(resolve));
  resolveOld(machineStatus({ consolidationRequired: true, automaticConsolidation: "blocked" }));
  await refresh;
  h.render();
  assert.equal(h.button("Tentar novamente"), undefined);
  assert.equal(h.button("Atualizar").props.disabled, false);
  assert.doesNotMatch(nodeText(h.tree), /ficou pendente/);
  h.unmount();
});

test("the extension panel removes the duplicate warning when consolidation finishes", async () => {
  const status = machineStatus({ consolidationRequired: true, automaticConsolidation: "waitingForAfterEffects" });
  status.installations.push({ installed: true, scope: "perUser", path: "C:\\CEP\\user", version: "2.4.0", manifestValid: true });
  const h = panelHarness(status);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  assert.match(nodeText(h.tree), /Feche o After Effects.*automaticamente/);
  assert.match(nodeText(h.tree), /Outra instalação encontrada/);
  status.installations.pop();
  status.consolidationRequired = false;
  status.automaticConsolidation = "completed";
  h.emitConsolidation();
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  assert.doesNotMatch(nodeText(h.tree), /Outra instalação encontrada|consolidará/);
  assert.equal(h.calls.filter(({ command }) => command === "status").length, 2);
  h.unmount();
  assert.equal(h.listenerCount, 0);
});

test("a late pre-consolidation status cannot restore the duplicate warning", async () => {
  let resolveOld;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const h = panelHarness(machineStatus({ automaticConsolidation: "completed" }));
  h.queueStatus(oldResponse);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.emitConsolidation();
  await new Promise((resolve) => setImmediate(resolve));
  resolveOld(machineStatus({ consolidationRequired: true, automaticConsolidation: "waitingForAfterEffects" }));
  await new Promise((resolve) => setImmediate(resolve));
  h.render();
  assert.doesNotMatch(nodeText(h.tree), /consolidará|Feche o After Effects/);
  h.unmount();
});

test("closing the extension panel before listener setup prevents late status reads", async () => {
  const h = panelHarness(machineStatus());
  h.render();
  h.unmount();
  await new Promise((resolve) => setImmediate(resolve));
  h.emitConsolidation();
  assert.equal(h.listenerCount, 0);
  assert.equal(h.calls.filter(({ command }) => command === "status").length, 0);
});

test("the installation dialog describes the machine target and sends its confirmed destination", async () => {
  const h = panelHarness(machineStatus({ consolidationRequired: true }));
  await h.openConfirmation();
  assert.match(nodeText(h.tree), /autoriza[çc][ãa]o de administrador/);
  assert.match(nodeText(h.tree), /cópias adicionais serão removidas/);
  assert.equal(h.confirmButton().props.disabled, false);
  await h.confirmButton().props.onClick();
  const args = h.calls.find(({ command }) => command === "install").args;
  assert.equal(args.expectedTargetScope, "perMachine");
  assert.equal(args.expectedTargetPath, "C:\\CEP\\machine");
  assert.equal(args.replaceDevLink, false);
  assert.equal(args.allowDowngrade, false);
});

test("a dev link with a machine release stays optional and never changes the update scope", async () => {
  for (const endDevelopment of [false, true]) {
    const status = machineStatus({ developmentMode: true });
    status.installations.push({ installed: true, scope: "perUser", isDevLink: true, version: "99.0.0", manifestValid: true });
    const h = panelHarness(status);
    await h.openConfirmation();
    assert.equal(h.checks().length, 1);
    assert.equal(h.checks()[0].props.checked, false);
    assert.equal(h.confirmButton().props.disabled, false);
    if (endDevelopment) {
      h.checks()[0].props.onChange({ target: { checked: true } });
      h.render();
    }
    await h.confirmButton().props.onClick();
    const args = h.calls.find(({ command }) => command === "install").args;
    assert.equal(args.replaceDevLink, endDevelopment);
    assert.equal(args.expectedTargetScope, "perMachine");
    assert.equal(args.allowDowngrade, false);
    assert.equal(h.successes[0].includes("Modo de desenvolvimento preservado"), !endDevelopment);
    assert.equal(h.calls.filter(({ command }) => command === "debug").length, 2);
  }
});

test("a dev-only install requires consent and a machine downgrade requires its separate confirmation", async () => {
  const h = panelHarness({ installed: true, version: "99.0.0", isDevLink: true, developmentMode: true,
    targetScope: "perUser", targetPath: "C:\\CEP\\user", requiresElevation: false,
    installations: [{ installed: true, scope: "perUser", isDevLink: true, version: "99.0.0", manifestValid: true }] });
  await h.openConfirmation();
  assert.equal(h.confirmButton().props.disabled, true);
  h.checks()[0].props.onChange({ target: { checked: true } });
  h.render();
  assert.equal(h.confirmButton().props.disabled, false);
  await h.confirmButton().props.onClick();
  const args = h.calls.find(({ command }) => command === "install").args;
  assert.equal(args.replaceDevLink, true);
  assert.equal(args.allowDowngrade, false);
  assert.equal(args.expectedTargetScope, "perUser");

  const downgrade = panelHarness(machineStatus(), "2.3.0");
  await downgrade.openConfirmation();
  assert.doesNotMatch(nodeText(downgrade.tree), /instalador Full/);
  assert.equal(downgrade.confirmButton().props.disabled, true);
  downgrade.checks()[0].props.onChange({ target: { checked: true } });
  downgrade.render();
  await downgrade.confirmButton().props.onClick();
  assert.equal(downgrade.calls.find(({ command }) => command === "install").args.allowDowngrade, true);
});

test("cancelled elevation and incomplete consolidation refresh status with accurate feedback", async () => {
  for (const [code, expected] of [
    ["cep_elevation_cancelled", /administrador foi cancelada/],
    ["cep_consolidation_failed", /finalização da atualização ficou pendente/],
    ["cep_install_target_changed", /confira o destino/],
  ]) {
    const h = panelHarness(machineStatus(), "2.4.1", code + ": test");
    await h.openConfirmation();
    await h.confirmButton().props.onClick();
    assert.match(h.errors[0], expected);
    assert.equal(h.successes.length, 0);
    assert.equal(h.calls.filter(({ command }) => command === "status").length, 2);
  }
});

test("the dialog preserves a machine development link without offering an ineffective exit checkbox", async () => {
  const h = panelHarness({ installed: true, version: "9.0.0", isDevLink: true, scope: "perMachine", developmentMode: true,
    targetScope: "perUser", targetPath: "C:\\CEP\\user", requiresElevation: false,
    installations: [{ installed: true, scope: "perMachine", isDevLink: true, version: "9.0.0", manifestValid: true }] });
  await h.openConfirmation();
  assert.equal(h.checks().length, 0);
  assert.equal(h.confirmButton().props.disabled, false);
  await h.confirmButton().props.onClick();
  const args = h.calls.find(({ command }) => command === "install").args;
  assert.equal(args.replaceDevLink, false);
  assert.equal(args.expectedTargetScope, "perUser");
  assert.match(h.successes[0], /Modo de desenvolvimento preservado/);
});
