import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const paths = {
  opening: "../src/js/main/hooks/useProjectOpening.ts",
  identity: "../src/js/main/hooks/useProjectIdentity.ts",
  offers: "../src/js/main/domains/ofertas/hooks/useOffersEditor.ts",
  offersService: "../src/js/main/domains/ofertas/services/ofertas.ts",
  errors: "../src/js/main/utils/errors.ts",
};
const compiled = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, ts.transpileModule(
    await readFile(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText]),
));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

// Minimal lifecycle harness: run the real hooks, retaining state/refs and effect
// cleanup across renders. Host calls and time are controlled; no After process
// or new test dependency is required.
function createHarness({ cep = true } = {}) {
  const slots = [];
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const alerts = [];
  let cursor = 0;
  let nextTimer = 0;
  let dirty = false;
  let mounted = false;
  let settersAfterUnmount = 0;
  let factory;
  let output;
  let pendingEffects = [];
  const depsChanged = (previous, next) => !previous || !next ||
    previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: typeof initial === "function" ? initial() : initial };
        slots[index].set = (next) => {
          if (!mounted) settersAfterUnmount += 1;
          const value = typeof next === "function" ? next(slots[index].value) : next;
          if (!Object.is(value, slots[index].value)) dirty = true;
          slots[index].value = value;
        };
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ||= { ref: { current: initial } };
      return slots[index].ref;
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || depsChanged(slots[index].dependencies, dependencies)) {
        slots[index] = { callback, dependencies };
      }
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && !depsChanged(previous.dependencies, dependencies)) return;
      slots[index] = { dependencies, cleanup: previous?.cleanup };
      pendingEffects.push(() => {
        slots[index].cleanup?.();
        slots[index].cleanup = effect();
      });
    },
  };
  const eventTarget = (listeners) => ({
    addEventListener: (type, callback) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
  });
  const document = {
    ...eventTarget(documentListeners),
    visibilityState: "visible",
    hidden: false,
  };
  const window = {
    ...eventTarget(windowListeners),
    document,
    cep: cep ? {} : undefined,
    alert: (message) => alerts.push(message),
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const load = (name, mocks = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(compiled[name], {
      module,
      exports: module.exports,
      window,
      document,
      require: (specifier) => {
        if (specifier === "react") return react;
        if (specifier.endsWith("utils/errors")) return load("errors");
        assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
        return mocks[specifier];
      },
    });
    return module.exports;
  };
  const render = () => {
    let iterations = 0;
    do {
      assert.ok(iterations++ < 20, "Hook render did not settle");
      dirty = false;
      cursor = 0;
      output = factory();
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    } while (dirty);
    return output;
  };
  return {
    load,
    alerts,
    mount: (hook) => { mounted = true; factory = hook; return render(); },
    get value() { return render(); },
    get settersAfterUnmount() { return settersAfterUnmount; },
    get timerCount() { return timers.size; },
    get listenerCount() {
      return [...windowListeners.values(), ...documentListeners.values()]
        .reduce((count, listeners) => count + listeners.size, 0);
    },
    focus() { windowListeners.get("focus")?.forEach((callback) => callback()); },
    setVisible(visible) {
      document.hidden = !visible;
      document.visibilityState = visible ? "visible" : "hidden";
      documentListeners.get("visibilitychange")?.forEach((callback) => callback());
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    unmount: () => { slots.forEach((slot) => slot.cleanup?.()); mounted = false; },
  };
}

function openingFixture({ cep = true } = {}) {
  const harness = createHarness({ cep });
  const host = deferred();
  const reload = deferred();
  let hostCalls = 0;
  let reloads = 0;
  const { useProjectOpening } = harness.load("opening", {
    "../services/openProject": { openProjectFromDialog: () => { hostCalls += 1; return host.promise; } },
  });
  const reloadProject = () => { reloads += 1; return reload.promise; };
  harness.mount(() => useProjectOpening(reloadProject));
  return { harness, host, reload, get hostCalls() { return hostCalls; }, get reloads() { return reloads; } };
}

const hostResult = (patch = {}) => ({
  status: "opened", projectChanged: true, message: "Projeto aberto.", errors: [], ...patch,
});

const legalOptionsContext = () => ({
  projectKey: "C:/jobs/current.aep", offersCompId: 10, offerLayerId: 44, offerLayerIndex: 4,
  offerSourceId: 50, legalLayerId: 51, legalSourceId: 60, bannerLayerId: 61, bannerSourceId: 70,
  revision: "captured-list-before-native-edit",
});

test("legal-control services preserve captured context and keep legacy calls without extra arguments", async () => {
  const h = createHarness();
  const calls = [];
  const bridge = { evalTS: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } };
  const service = h.load("offersService", { "../../../../lib/utils/bolt": bridge });
  const context = legalOptionsContext();
  await service.updateOfferLegalControlOption(4, "tarja-eletro-pneu", 2, context);
  await service.updateOfferLegalControl(4, "tarja-eletro-pneu", true, context);
  await service.updateOfferLegalControl(4, "limitado-por-cpf", false);
  await service.updateOfferLegalControlOption(4, "legacy-menu", 0);
  assert.deepEqual(calls, [
    ["updateOfferLegalControlOption", 4, "tarja-eletro-pneu", 2, context],
    ["updateOfferLegalControl", 4, "tarja-eletro-pneu", true, context],
    ["updateOfferLegalControl", 4, "limitado-por-cpf", false],
    ["updateOfferLegalControlOption", 4, "legacy-menu", 0],
  ]);
  assert.equal(calls[0][4], context);
  const preview = createHarness({ cep: false }).load("offersService", { "../../../../lib/utils/bolt": bridge });
  assert.throws(() => preview.updateOfferLegalControlOption(4, "tarja-eletro-pneu", 0, context), /After Effects/);
  assert.throws(() => preview.updateOfferLegalControl(4, "tarja-eletro-pneu", true, context), /After Effects/);
  assert.equal(calls.length, 4);
});

for (const kind of ["checkbox", "option"]) {
  test(`a stale legal ${kind} response refreshes its own offer while retaining the captured request context`, async () => {
    const h = createHarness();
    const host = deferred();
    const refresh = deferred();
    const calls = [];
    const snapshotCalls = [];
    const statuses = [];
    const method = kind === "checkbox" ? "updateLegalControl" : "updateLegalControlOption";
    const endpoint = kind === "checkbox" ? "updateOfferLegalControl" : "updateOfferLegalControlOption";
    const selectedValue = kind === "checkbox" ? true : 2;
    const context = legalOptionsContext();
    const initial = { selectedOfferLayerIndex: 4, selectedOffer: { legalControls: [{ id: "tarja-eletro-pneu", enabled: false }] } };
    const { useOffersEditor } = h.load("offers", {
      "../../../services/localDiagnostics": { createDiagnosticOperationId: () => "legal-action", recordLocalDiagnostic() {}, recordDiagnosticFailure() {} },
      "../services/ofertas": {
        loadOffersEditorSnapshot: (index) => {
          snapshotCalls.push(index);
          return snapshotCalls.length === 1 ? Promise.resolve(initial) : refresh.promise;
        },
        [endpoint]: (...args) => { calls.push(args); return host.promise; },
      },
    });
    const onStatus = (message) => statuses.push(message);
    h.mount(() => useOffersEditor({ initialOfferLayerIndex: 4, onStatus }));
    await settle();
    const action = h.value[method](4, "tarja-eletro-pneu", selectedValue, context);
    assert.deepEqual(calls, [[4, "tarja-eletro-pneu", selectedValue, context]]);
    assert.equal(calls[0][3], context);
    const message = "A lista mudou no After Effects. Atualize antes de escolher novamente.";
    host.resolve({ ok: false, message, errors: [], selectedOfferLayerIndex: 0 });
    await settle();
    assert.deepEqual(snapshotCalls, [4, 4]);
    assert.equal(h.value.busy, true);
    assert.equal(h.value.snapshot, initial);
    assert.deepEqual(statuses, [message]);
    const updated = { selectedOfferLayerIndex: 4, selectedOffer: { legalControls: [{ id: "tarja-eletro-pneu", enabled: false,
      optionGroup: { selectedIndex: 1, options: [{ label: "Texto novo" }, { label: "Pneu" }], context: { ...context, revision: "new-list" } } }] } };
    refresh.resolve(updated);
    await action;
    assert.equal(h.value.busy, false);
    assert.equal(h.value.snapshot, updated);
    h.unmount();
  });
}

test("opening ignores repeated clicks and remains busy until the new panel identity is loaded", async () => {
  const f = openingFixture();
  const operation = f.harness.value.openProject();
  await f.harness.value.openProject();
  assert.equal(f.harness.value.isOpeningProject, true);
  assert.equal(f.hostCalls, 0, "Give the panel a turn to remove its editors before the host dialog");
  assert.equal(f.harness.timerCount, 1);
  f.harness.runTimers();
  await settle();
  assert.equal(f.hostCalls, 1);
  f.host.resolve(hostResult({ projectChanged: false })); // Reopening the same path still reloads.
  await settle();
  assert.equal(f.reloads, 1);
  assert.equal(f.harness.value.isOpeningProject, true);
  await f.harness.value.openProject();
  assert.equal(f.hostCalls, 1);
  f.reload.resolve();
  await operation;
  assert.equal(f.harness.value.isOpeningProject, false);
  assert.deepEqual(f.harness.alerts, []);
});

test("cancelling file selection or the save prompt does not reset the current project", async () => {
  const f = openingFixture();
  const operation = f.harness.value.openProject();
  f.harness.runTimers();
  f.host.resolve(hostResult({ status: "cancelled", projectChanged: false, message: "" }));
  await operation;
  assert.equal(f.reloads, 0);
  assert.equal(f.harness.value.isOpeningProject, false);
  assert.deepEqual(f.harness.alerts, []);
});

test("a rejected file that leaves the old project open reports the error without resetting it", async () => {
  const f = openingFixture();
  const operation = f.harness.value.openProject();
  f.harness.runTimers();
  f.host.resolve(hostResult({ status: "error", projectChanged: false, message: "O arquivo não está disponível." }));
  await operation;
  assert.equal(f.reloads, 0);
  assert.deepEqual(f.harness.alerts, ["O arquivo não está disponível."]);
  assert.equal(f.harness.value.isOpeningProject, false);
});

for (const scenario of ["closed-before-error", "bridge-rejection"]) {
  test(`${scenario} reloads the actual host state before releasing the panel`, async () => {
    const f = openingFixture();
    const operation = f.harness.value.openProject();
    f.harness.runTimers();
    await settle();
    if (scenario === "bridge-rejection") f.host.reject(new Error("evalScript transport failed"));
    else f.host.resolve(hostResult({ status: "error", projectChanged: true, message: "Não foi possível abrir o arquivo." }));
    await settle();
    assert.equal(f.reloads, 1);
    assert.equal(f.harness.value.isOpeningProject, true);
    assert.deepEqual(f.harness.alerts, [], "Show the outcome only after refreshing state");
    f.reload.resolve();
    await operation;
    assert.equal(f.harness.value.isOpeningProject, false);
    assert.equal(f.harness.alerts.length, 1);
    assert.doesNotMatch(f.harness.alerts[0], /evalScript|transport/);
  });
}

test("an opened project with a purge warning reloads successfully and shows its warning", async () => {
  const f = openingFixture();
  const operation = f.harness.value.openProject();
  f.harness.runTimers();
  const message = "Projeto aberto, mas não foi possível limpar os caches.";
  f.host.resolve(hostResult({ message, errors: ["purge failed"] }));
  f.reload.resolve();
  await operation;
  assert.equal(f.reloads, 1);
  assert.deepEqual(f.harness.alerts, [message]);
  assert.equal(f.harness.value.isOpeningProject, false);
});

test("a failed panel refresh releases the button and asks the user to reload the extension", async () => {
  const f = openingFixture();
  const operation = f.harness.value.openProject();
  f.harness.runTimers();
  f.host.resolve(hostResult());
  await settle();
  f.reload.reject(new Error("refresh failed"));
  await operation;
  assert.equal(f.harness.value.isOpeningProject, false);
  assert.deepEqual(f.harness.alerts, ["Não foi possível atualizar o painel. Recarregue a extensão."]);
});

test("browser-only opening is inert and does not schedule host calls", async () => {
  const f = openingFixture({ cep: false });
  await f.harness.value.openProject();
  assert.equal(f.harness.value.isOpeningProject, false);
  assert.equal(f.hostCalls, 0);
  assert.equal(f.reloads, 0);
  assert.equal(f.harness.timerCount, 0);
  assert.deepEqual(f.harness.alerts, []);
});

for (const oldRequestFails of [false, true]) {
  test(`forced identity refresh waits for a previous ${oldRequestFails ? "failed" : "successful"} request and then reads the new project`, async () => {
    const harness = createHarness();
    const old = deferred();
    const fresh = deferred();
    let calls = 0;
    const { useProjectIdentity } = harness.load("identity", {
      "../services/projectIdentity": { loadProjectIdentity: () => (++calls === 1 ? old.promise : fresh.promise) },
    });
    harness.mount(() => useProjectIdentity());
    const ordinaryRefresh = harness.value.refreshProjectIdentity();
    const forcedRefresh = harness.value.refreshProjectIdentity(true);
    assert.equal(calls, 1);
    if (oldRequestFails) old.reject(new Error("old request failed"));
    else old.resolve({ projectKey: "old.aep", projectName: "Old" });
    await ordinaryRefresh;
    await settle();
    assert.equal(calls, 2, "The old in-flight response must not satisfy the post-open refresh");
    fresh.resolve({ projectKey: "new.aep", projectName: "New" });
    assert.equal(await forcedRefresh, "new.aep");
    assert.equal(harness.value.projectKey, "new.aep");
    assert.equal(harness.value.projectName, "New");
    harness.unmount();
  });
}

test("identity stays empty without CEP and never calls the host", async () => {
  const harness = createHarness({ cep: false });
  const { useProjectIdentity } = harness.load("identity", {
    "../services/projectIdentity": { loadProjectIdentity: () => assert.fail("Unexpected host call") },
  });
  harness.mount(() => useProjectIdentity());
  assert.equal(await harness.value.refreshProjectIdentity(true), "");
  assert.equal(harness.value.projectKey, "");
  assert.equal(harness.value.projectName, "");
  assert.equal(harness.timerCount, 0);
  assert.equal(harness.listenerCount, 0);
});

function identityFixture({ initial = { projectKey: "", projectName: "" } } = {}) {
  const harness = createHarness();
  let response = initial;
  let calls = 0;
  let observing = true;
  const { useProjectIdentity } = harness.load("identity", {
    "../services/projectIdentity": {
      loadProjectIdentity: () => {
        calls += 1;
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      },
    },
  });
  harness.mount(() => useProjectIdentity({ canObserve: () => observing }));
  return {
    harness,
    respond: (next) => { response = next; },
    observe: (enabled) => { observing = enabled; },
    get calls() { return calls; },
  };
}

test("external project opening after an empty initial read is detected without user interaction", async () => {
  const f = identityFixture();
  await settle();
  assert.equal(f.harness.value.projectKey, "");
  f.respond({ projectKey: "C:/jobs/first.aep", projectName: "First" });
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "C:/jobs/first.aep");
  assert.equal(f.harness.value.projectName, "First");

  f.respond({ projectKey: "C:/jobs/second.aep", projectName: "Second" });
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "C:/jobs/second.aep");
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "C:/jobs/second.aep", "An unchanged project keeps its panel identity");

  f.respond({ projectKey: "", projectName: "" });
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "", "Closing the project also clears the old identity");
  assert.equal(f.harness.value.projectName, "");
  f.harness.unmount();
});

test("a transient identity failure preserves the open project and the next observation recovers", async () => {
  const f = identityFixture({ initial: { projectKey: "current.aep", projectName: "Current" } });
  await settle();
  f.respond(new Error("Host temporarily unavailable while opening"));
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "current.aep");
  assert.equal(f.harness.value.projectName, "Current");
  f.respond({ projectKey: "ready.aep", projectName: "Ready" });
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "ready.aep");
  f.harness.unmount();
});

test("focus and timer observations share one pending host read and resume after it settles", async () => {
  const f = identityFixture();
  await settle();
  const pending = deferred();
  f.respond(pending.promise);
  f.harness.focus();
  f.harness.focus();
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls, 2, "Repeated triggers cannot enqueue concurrent host reads");
  pending.resolve({ projectKey: "ready.aep", projectName: "Ready" });
  await settle();
  assert.equal(f.harness.value.projectKey, "ready.aep");
  f.respond({ projectKey: "next.aep", projectName: "Next" });
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls, 3);
  assert.equal(f.harness.value.projectKey, "next.aep");
  f.harness.unmount();
});

test("hidden panels suspend observation and check the host when visible again", async () => {
  const f = identityFixture({ initial: { projectKey: "old.aep", projectName: "Old" } });
  await settle();
  f.harness.setVisible(false);
  f.respond({ projectKey: "new.aep", projectName: "New" });
  f.harness.runTimers();
  f.harness.focus();
  await settle();
  assert.equal(f.calls, 1);
  assert.equal(f.harness.value.projectKey, "old.aep");
  f.harness.setVisible(true);
  await settle();
  assert.equal(f.harness.value.projectKey, "new.aep");
  f.harness.unmount();
});

test("busy editors pause observation and discard an earlier observation before resuming", async () => {
  const f = identityFixture({ initial: { projectKey: "old.aep", projectName: "Old" } });
  await settle();
  const pending = deferred();
  f.respond(pending.promise);
  f.harness.runTimers();
  f.observe(false);
  pending.resolve({ projectKey: "intermediate.aep", projectName: "Intermediate" });
  await settle();
  assert.equal(f.harness.value.projectKey, "old.aep");
  f.harness.runTimers();
  f.harness.focus();
  await settle();
  assert.equal(f.calls, 2, "Busy editors must not queue host observations");
  f.respond({ projectKey: "ready.aep", projectName: "Ready" });
  f.observe(true);
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.projectKey, "ready.aep");
  f.harness.unmount();
});

test("explicit post-open identity refresh works while automatic observation is paused", async () => {
  const f = identityFixture({ initial: { projectKey: "old.aep", projectName: "Old" } });
  await settle();
  f.observe(false);
  f.respond({ projectKey: "new.aep", projectName: "New" });
  assert.equal(await f.harness.value.refreshProjectIdentity(true), "new.aep");
  assert.equal(f.harness.value.projectKey, "new.aep");
  f.harness.unmount();
});

test("unmount removes observation timers/listeners and late reads cannot update the old panel", async () => {
  const f = identityFixture();
  await settle();
  const stale = f.harness.value;
  const pending = deferred();
  f.respond(pending.promise);
  f.harness.focus();
  f.harness.unmount();
  pending.resolve({ projectKey: "late.aep", projectName: "Late" });
  await settle();
  assert.equal(f.harness.settersAfterUnmount, 0);
  assert.equal(f.harness.timerCount, 0);
  assert.equal(f.harness.listenerCount, 0);
  await stale.refreshProjectIdentity();
  f.harness.focus();
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls, 2);
});

test("concurrent post-open refreshes wait for the old observation and share one fresh read", async () => {
  const old = deferred();
  const f = identityFixture({ initial: old.promise });
  const fresh = deferred();
  f.respond(fresh.promise);
  const first = f.harness.value.refreshProjectIdentity(true);
  const second = f.harness.value.refreshProjectIdentity(true);
  old.resolve({ projectKey: "old.aep", projectName: "Old" });
  await settle();
  assert.equal(f.calls, 2);
  fresh.resolve({ projectKey: "new.aep", projectName: "New" });
  assert.deepEqual(await Promise.all([first, second]), ["new.aep", "new.aep"]);
  assert.equal(f.harness.value.projectKey, "new.aep");
  f.harness.unmount();
});

test("unmount cancels a queued post-open read as well as the earlier observation", async () => {
  const old = deferred();
  const f = identityFixture({ initial: old.promise });
  const forced = f.harness.value.refreshProjectIdentity(true);
  f.harness.unmount();
  old.resolve({ projectKey: "old.aep", projectName: "Old" });
  assert.equal(await forced, "");
  await settle();
  assert.equal(f.calls, 1);
  assert.equal(f.harness.settersAfterUnmount, 0);
  assert.equal(f.harness.timerCount, 0);
  assert.equal(f.harness.listenerCount, 0);
});

test("concurrent forced refreshes without a prior observation share the same host read", async () => {
  const f = identityFixture();
  await settle();
  const pending = deferred();
  f.respond(pending.promise);
  const first = f.harness.value.refreshProjectIdentity(true);
  const second = f.harness.value.refreshProjectIdentity(true);
  assert.equal(f.calls, 2);
  pending.resolve({ projectKey: "ready.aep", projectName: "Ready" });
  assert.deepEqual(await Promise.all([first, second]), ["ready.aep", "ready.aep"]);
  assert.equal(f.calls, 2);
  f.harness.unmount();
});

const startupSnapshot = (products = [], selectedOfferLayerIndex = 19) => ({
  ok: true, message: products.length ? "Oferta carregada." : "Nenhum produto ativo encontrado nesta oferta.",
  compName: "Miolo", offers: [{ layerIndex: selectedOfferLayerIndex, name: "Oferta_01" }],
  selectedOfferLayerIndex,
  selectedOffer: { layerIndex: selectedOfferLayerIndex, name: "Oferta_01", products, legalControls: [] },
  errors: [],
});

function offersStartupFixture(read, endpoints = {}, { cep = true } = {}) {
  const harness = createHarness({ cep });
  const calls = [];
  const diagnostics = [];
  const { useOffersEditor } = harness.load("offers", {
    "../../../services/localDiagnostics": {
      createDiagnosticOperationId: () => "startup", recordLocalDiagnostic() {},
      recordDiagnosticFailure: (...args) => diagnostics.push(args),
    },
    "../services/ofertas": {
      loadOffersEditorSnapshot: (index) => { calls.push(index); return read(calls.length, index); },
      ...endpoints,
    },
  });
  const onStatus = () => {};
  harness.mount(() => useOffersEditor({ onStatus }));
  return { harness, calls, diagnostics };
}

test("startup recovers an offer list whose selected offer products were initially empty, without a path change", async () => {
  const empty = startupSnapshot();
  const ready = startupSnapshot([{ index: 0 }, { index: 1 }, { index: 2 }]);
  const f = offersStartupFixture(async (call) => call === 1 ? empty : ready);
  await settle();
  assert.equal(f.harness.value.snapshot, empty);
  assert.equal(f.harness.timerCount, 1);
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.snapshot, ready);
  assert.deepEqual(f.calls, [undefined, 19], "Recovery retains the selected offer");
  assert.equal(f.harness.timerCount, 0);
  f.harness.runTimers();
  assert.equal(f.calls.length, 2, "A populated editor is never polled for products");
  f.harness.unmount();
});

for (const initialKind of ["no-project", "no-selection", "bridge-error"]) {
  test(`startup retries ${initialKind} and stops as soon as products are available`, async () => {
    const ready = startupSnapshot([{ index: 0 }]);
    const f = offersStartupFixture(async (call) => {
      if (call > 1) return ready;
      if (initialKind === "bridge-error") throw new Error("Host is opening a project");
      return { ok: initialKind !== "no-project", offers: [], selectedOffer: null, selectedOfferLayerIndex: 0, errors: [] };
    });
    await settle();
    f.harness.runTimers();
    await settle();
    assert.equal(f.harness.value.snapshot, ready);
    assert.equal(f.calls.length, 2);
    assert.equal(f.harness.timerCount, 0);
    f.harness.unmount();
  });
}

test("startup recovery is bounded for genuinely empty offers and is absent without CEP", async () => {
  const f = offersStartupFixture(async () => startupSnapshot());
  await settle();
  for (let attempt = 0; attempt < 20; attempt += 1) { f.harness.runTimers(); await settle(); }
  assert.equal(f.calls.length, 6, "One initial read and at most five recovery reads");
  assert.equal(f.harness.timerCount, 0);
  f.harness.unmount();
  const browser = offersStartupFixture(() => assert.fail("No host in browser"), {}, { cep: false });
  await settle();
  assert.equal(browser.harness.timerCount, 0);
  assert.deepEqual(browser.calls, []);
  browser.harness.unmount();
});

test("startup recovery defers to a pending edit and accepts that edit's selected offer", async () => {
  const action = deferred();
  const ready = startupSnapshot([{ index: 0 }], 17);
  const f = offersStartupFixture(async (call) => call === 1 ? startupSnapshot() : ready,
    { selectOfferForEditor: () => action.promise });
  await settle();
  const editing = f.harness.value.selectOffer(17);
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls.length, 1, "The retry does not race the selection action");
  action.resolve({ ok: true, message: "Selecionada.", errors: [], selectedOfferLayerIndex: 17 });
  await editing;
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.snapshot, ready);
  assert.deepEqual(f.calls, [undefined, 17]);
  assert.equal(f.harness.timerCount, 0);
  f.harness.unmount();
});

test("startup recovery avoids overlapping reads and ignores delayed completion after unmount", async () => {
  const delayed = deferred();
  const f = offersStartupFixture((call) => call === 1 ? Promise.resolve(startupSnapshot()) : delayed.promise);
  await settle();
  f.harness.runTimers();
  assert.equal(f.calls.length, 2);
  f.harness.runTimers();
  assert.equal(f.calls.length, 2);
  f.harness.unmount();
  delayed.resolve(startupSnapshot([{ index: 0 }]));
  await settle();
  assert.equal(f.harness.timerCount, 0);
  assert.equal(f.harness.settersAfterUnmount, 0);
});

test("a successful editor does not restart recovery after an ordinary edit removes its last product", async () => {
  const f = offersStartupFixture(async (call) => startupSnapshot(call === 1 ? [{ index: 0 }] : []));
  await settle();
  assert.equal(f.harness.timerCount, 0);
  await f.harness.value.refreshOffers();
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.harness.timerCount, 0);
  f.harness.unmount();
});

test("an older empty read cannot overwrite a newer populated selection", async () => {
  const old = deferred();
  const ready = startupSnapshot([{ index: 0 }], 17);
  const f = offersStartupFixture((call) => call === 1 ? old.promise : Promise.resolve(ready));
  await f.harness.value.refreshOffers(17);
  assert.equal(f.harness.value.snapshot, ready);
  assert.equal(f.harness.value.busy, true, "The older read is still in flight");
  old.resolve(startupSnapshot());
  await settle();
  assert.equal(f.harness.value.snapshot, ready);
  assert.equal(f.harness.value.busy, false);
  assert.equal(f.harness.timerCount, 0);
  assert.deepEqual(f.calls, [undefined, 17]);
  f.harness.unmount();
});

test("hidden panels defer startup recovery without consuming its attempts", async () => {
  const ready = startupSnapshot([{ index: 0 }]);
  const f = offersStartupFixture(async (call) => call === 1 ? startupSnapshot() : ready);
  await settle();
  f.harness.setVisible(false);
  for (let attempt = 0; attempt < 8; attempt += 1) { f.harness.runTimers(); await settle(); }
  assert.equal(f.calls.length, 1);
  f.harness.setVisible(true);
  f.harness.runTimers();
  await settle();
  assert.equal(f.harness.value.snapshot, ready);
  assert.equal(f.calls.length, 2);
  assert.equal(f.harness.timerCount, 0);
  f.harness.unmount();
});

test("returning focus recovers a slow project's initial empty snapshot after the bounded retry window", async () => {
  const ready = startupSnapshot([{ index: 0 }]);
  let hostReady = false;
  const f = offersStartupFixture(async () => hostReady ? ready : startupSnapshot());
  await settle();
  for (let attempt = 0; attempt < 5; attempt += 1) { f.harness.runTimers(); await settle(); }
  assert.equal(f.calls.length, 6);
  assert.equal(f.harness.timerCount, 0);
  hostReady = true;
  f.harness.focus();
  await settle();
  assert.equal(f.calls.length, 7);
  assert.equal(f.harness.value.snapshot, ready);
  f.harness.focus();
  f.harness.setVisible(true);
  f.harness.runTimers();
  await settle();
  assert.equal(f.calls.length, 7, "A loaded editor is not refreshed again on focus");
  f.harness.unmount();
  assert.equal(f.harness.listenerCount, 0);
});

test("offers stay busy while concurrent edits finish, and stale callbacks cannot reach the host after unmount", async () => {
  const harness = createHarness();
  const first = deferred();
  const second = deferred();
  let actions = 0;
  let snapshots = 0;
  const { useOffersEditor } = harness.load("offers", {
    "../../../services/localDiagnostics": {
      createDiagnosticOperationId: () => "test-operation",
      recordLocalDiagnostic() {},
      recordDiagnosticFailure() {},
    },
    "../services/ofertas": {
      loadOffersEditorSnapshot: async () => { snapshots += 1; return { selectedOfferLayerIndex: 1 }; },
      selectOfferForEditor: () => (++actions === 1 ? first.promise : second.promise),
    },
  });
  const onStatus = () => {};
  harness.mount(() => useOffersEditor({ onStatus }));
  await settle();
  assert.equal(harness.value.busy, false);
  const firstAction = harness.value.selectOffer(1);
  const secondAction = harness.value.selectOffer(2);
  assert.equal(harness.value.busy, true);
  first.resolve({ ok: true, message: "Oferta selecionada.", errors: [], selectedOfferLayerIndex: 1 });
  await firstAction;
  assert.equal(harness.value.busy, true, "One completed edit must not release a second pending edit");
  second.reject(new Error("Host action failed"));
  await secondAction;
  assert.equal(harness.value.busy, false, "Failures also release the busy count");
  const stale = harness.value;
  const previousSnapshots = snapshots;
  harness.unmount();
  await stale.selectOffer(3);
  assert.equal(await stale.refreshOffers(), false);
  assert.equal(await stale.undo(), false);
  assert.equal(actions, 2);
  assert.equal(snapshots, previousSnapshots);
});

function sourceChangeFixture(kind = "layout") {
  const harness = createHarness();
  const host = deferred();
  const refresh = deferred();
  const requests = [];
  const snapshotRequests = [];
  const statuses = [];
  const diagnostics = [];
  const offerContext = {
    projectKey: "C:/jobs/current.aep", compItemId: 10, offerLayerIndex: 4,
    offerLayerId: 40, layerComment: "CAMADA OFERTA 04", sourceItemId: 50,
    folderItemId: 60, folderComment: "OFERTA 04",
  };
  const request = {
    context: kind === "mechanic" ? {
      offer: offerContext, productIndex: 1, mechanicLayerIndex: 3,
      mechanicLayerId: 43, mechanicLayerComment: "MECANICA 2",
      mechanicSourceItemId: 80, mechanicsFolderItemId: 90,
    } : offerContext,
    targetItemId: 70,
  };
  const initialSnapshot = { selectedOfferLayerIndex: 4, selectedOffer: { layerIndex: 4, name: "Oferta_04" } };
  const { useOffersEditor } = harness.load("offers", {
    "../../../services/localDiagnostics": {
      createDiagnosticOperationId: () => "layout-operation",
      recordLocalDiagnostic: (event) => diagnostics.push(event),
      recordDiagnosticFailure: (...args) => diagnostics.push(args),
    },
    "../services/ofertas": {
      loadOffersEditorSnapshot: (index) => {
        snapshotRequests.push(index);
        return snapshotRequests.length === 1 ? Promise.resolve(initialSnapshot) : refresh.promise;
      },
      replaceOfferLayout: (nextRequest) => { requests.push(nextRequest); return host.promise; },
      replaceOfferMechanic: (nextRequest) => { requests.push(nextRequest); return host.promise; },
    },
  });
  const onStatus = (message) => statuses.push(message);
  harness.mount(() => useOffersEditor({ initialOfferLayerIndex: 4, onStatus }));
  return { harness, host, refresh, requests, snapshotRequests, statuses, diagnostics, request, initialSnapshot };
}

for (const kind of ["layout", "mechanic"]) {
  const actionName = kind === "mechanic" ? "replaceMechanic" : "replaceLayout";
  for (const ok of [true, false]) {
    test(`${kind} change ${ok ? "success" : "rejection"} refreshes the same offer and stays busy through refresh`, async () => {
      const f = sourceChangeFixture(kind);
      await settle();
      const before = f.harness.value;
      assert.equal(before.busy, false);

      const action = before[actionName](f.request);
      await before[actionName](f.request);
      assert.deepEqual(f.requests, [f.request], "A second synchronous selection cannot send a duplicate replacement");
      assert.equal(f.requests[0], f.request, "Forward the exact captured target and offer context");
      assert.equal(f.harness.value.busy, true);
      assert.deepEqual(f.snapshotRequests, [4]);

      const message = ok ? "Régua da oferta alterada." : "A oferta mudou. Atualize antes de tentar novamente.";
      f.host.resolve({ ok, message, selectedOfferLayerIndex: ok ? 4 : 0, errors: [] });
      await settle();
      assert.deepEqual(f.snapshotRequests, [4, 4]);
      assert.equal(f.harness.value.busy, true, "The host result must not unlock the editor before its snapshot");
      assert.equal(f.harness.value.snapshot, f.initialSnapshot);
      assert.deepEqual(f.statuses, [message]);
      assert.equal(f.diagnostics.at(-1).status, ok ? "completed" : "failed");
      if (!ok) assert.ok(f.harness.value.actionLog.some((entry) => entry.includes(message)));
      await f.harness.value[actionName](f.request);
      assert.equal(f.requests.length, 1, "Replacement is also blocked during the snapshot refresh");

      const refreshed = { selectedOfferLayerIndex: 4, selectedOffer: { layerIndex: 4, name: "Oferta_04", refreshed: true } };
      f.refresh.resolve(refreshed);
      await action;
      assert.equal(f.harness.value.busy, false);
      assert.equal(f.harness.value.snapshot, refreshed);
      assert.equal(f.harness.value.snapshot.selectedOfferLayerIndex, 4);
      f.harness.unmount();
  });
  }

  test(`a ${kind} replacement is blocked during the initial snapshot and stale callbacks stay inert after unmount`, async () => {
    const f = sourceChangeFixture(kind);
    await f.harness.value[actionName](f.request);
    assert.deepEqual(f.requests, []);
    await settle();
    const stale = f.harness.value;
    f.harness.unmount();
    await stale[actionName](f.request);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.snapshotRequests, [4]);
    assert.deepEqual(f.statuses, []);
    assert.equal(f.harness.settersAfterUnmount, 0);
  });

  test(`a delayed ${kind} result after unmount cannot refresh or update the old editor`, async () => {
    const f = sourceChangeFixture(kind);
    await settle();
    const action = f.harness.value[actionName](f.request);
    assert.equal(f.requests.length, 1);
    f.harness.unmount();
    f.host.resolve({ ok: true, message: "Régua da oferta alterada.", selectedOfferLayerIndex: 4, errors: [] });
    await action;
    assert.deepEqual(f.snapshotRequests, [4]);
    assert.deepEqual(f.statuses, []);
    assert.equal(f.diagnostics.length, 1, "Only the original start belongs to this mounted editor");
    assert.equal(f.harness.settersAfterUnmount, 0);
  });
}

test("layout bridge services send the captured context unchanged and refuse browser-only calls", async () => {
  for (const cep of [true, false]) {
    const harness = createHarness({ cep });
    const calls = [];
    const response = { ok: true, errors: [] };
    const services = harness.load("offersService", {
      "../../../../lib/utils/bolt": { evalTS: (...args) => { calls.push(args); return Promise.resolve(response); } },
    });
    const request = { context: { projectKey: "current.aep", offerLayerIndex: 4, sourceItemId: 50 }, targetItemId: 70 };
    if (cep) {
      assert.equal(await services.loadOfferLayoutOptions(4), response);
      assert.equal(await services.replaceOfferLayout(request), response);
      assert.deepEqual(calls, [["getOfferLayoutOptions", 4], ["replaceOfferLayout", request]]);
      assert.equal(calls[1][1], request);
    } else {
      assert.throws(() => services.loadOfferLayoutOptions(4), /After Effects/);
      assert.throws(() => services.replaceOfferLayout(request), /After Effects/);
      assert.deepEqual(calls, []);
    }
  }
});

test("mechanic bridge services preserve both product identity and captured offer context, and refuse browser-only calls", async () => {
  for (const cep of [true, false]) {
    const harness = createHarness({ cep });
    const calls = [];
    const response = { ok: true, errors: [] };
    const services = harness.load("offersService", {
      "../../../../lib/utils/bolt": { evalTS: (...args) => { calls.push(args); return Promise.resolve(response); } },
    });
    const request = {
      context: {
        offer: { projectKey: "current.aep", offerLayerIndex: 4, sourceItemId: 50 },
        productIndex: 1, mechanicLayerId: 43, mechanicLayerComment: "MECANICA 2",
      },
      targetItemId: 80,
    };
    if (cep) {
      assert.equal(await services.loadOfferMechanicOptions(4, 1), response);
      assert.equal(await services.replaceOfferMechanic(request), response);
      assert.deepEqual(calls, [["getOfferMechanicOptions", 4, 1], ["replaceOfferMechanic", request]]);
      assert.equal(calls[1][1], request);
    } else {
      assert.throws(() => services.loadOfferMechanicOptions(4, 1), /After Effects/);
      assert.throws(() => services.replaceOfferMechanic(request), /After Effects/);
      assert.deepEqual(calls, []);
    }
  }
});
