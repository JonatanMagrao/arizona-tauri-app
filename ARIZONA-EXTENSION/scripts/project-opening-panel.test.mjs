import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const paths = {
  opening: "../src/js/main/hooks/useProjectOpening.ts",
  identity: "../src/js/main/hooks/useProjectIdentity.ts",
  offers: "../src/js/main/domains/ofertas/hooks/useOffersEditor.ts",
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
  const alerts = [];
  let cursor = 0;
  let nextTimer = 0;
  let dirty = false;
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
  const window = {
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
    mount: (hook) => { factory = hook; return render(); },
    get value() { return render(); },
    get timerCount() { return timers.size; },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
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
