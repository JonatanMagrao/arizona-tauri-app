import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourcePaths = {
  roteiro: "../src/js/main/domains/roteiro/hooks/useRoteiro.ts",
  panel: "../src/js/main/domains/roteiro/components/RoteiroPanel.tsx",
  errors: "../src/js/main/utils/errors.ts",
};
const compiled = Object.fromEntries(await Promise.all(
  Object.entries(sourcePaths).map(async ([name, path]) => [name, ts.transpileModule(
    await readFile(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText]),
));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

// The real hook owns lifecycle, host orchestration and invalidation. Only the
// host/filesystem boundary is controlled; no After process is opened by tests.
function createHarness({ cep = true } = {}) {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let mounted = false;
  let settersAfterUnmount = 0;
  let factory;
  let output;
  let pendingEffects = [];
  let nextTimerId = 0;
  const timers = new Map();
  const changed = (previous, next) => !previous || !next ||
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
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        slots[index] = { callback, dependencies };
      }
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && !changed(previous.dependencies, dependencies)) return;
      slots[index] = { dependencies, cleanup: previous?.cleanup };
      pendingEffects.push(() => {
        slots[index].cleanup?.();
        slots[index].cleanup = effect();
      });
    },
  };
  const window = {
    cep: cep ? {} : undefined,
    setTimeout(callback) { const id = ++nextTimerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const loadModule = (name, mocks = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(compiled[name], {
      module,
      exports: module.exports,
      window,
      require(specifier) {
        if (specifier === "react") return react;
        if (specifier.endsWith("utils/errors")) return loadModule("errors");
        assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
        return mocks[specifier];
      },
    });
    return module.exports;
  };
  const render = () => {
    assert.ok(mounted, "Cannot render an unmounted hook");
    let iterations = 0;
    do {
      assert.ok(iterations++ < 20, "Hook did not settle");
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
    loadModule,
    mount(hook) { mounted = true; factory = hook; return render(); },
    get value() { return render(); },
    get settersAfterUnmount() { return settersAfterUnmount; },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); mounted = false; },
  };
}

function documentFixture() {
  let content = "SP2\n01 SIMPLES\nPRODUTO 8,59";
  let entry = null;
  let failures = false;
  let sourceReads = 0;
  let clears = 0;
  const reads = [];
  return {
    cache: {
      read(path, forceRead = false) {
        reads.push({ path, forceRead });
        if (failures) throw new Error("Documento indisponível.");
        const cacheHit = !forceRead && entry?.path === path;
        if (!cacheHit) { sourceReads += 1; entry = { path, content }; }
        return { content: entry.content, cacheHit };
      },
      clear() { clears += 1; entry = null; },
    },
    reads,
    get sourceReads() { return sourceReads; },
    get clears() { return clears; },
    set content(next) { content = next; },
    set failures(next) { failures = next; },
  };
}

function roteiroFixture({ document = documentFixture(), cep = true } = {}) {
  const harness = createHarness({ cep });
  const diagnostics = [];
  let diagnosticSequence = 0;
  const calls = { project: 0, offers: 0, directory: 0, exists: 0, mutations: 0 };
  let price = "8,59";
  let projectLoader;
  let offersLoader;
  let directoryExists = true;
  let documentFound = true;
  const project = { roteiroDirectory: "C:/job/ROTEIRO", projectName: "SP2.aep" };
  const target = {
    name: "SP2.docx", fullPath: "C:/job/ROTEIRO/SP2.docx", regions: ["SP2"], matched: true,
  };
  const unexpected = () => {
    calls.mutations += 1;
    throw new Error("Unexpected mutation or unrelated operation");
  };
  const { useRoteiro } = harness.loadModule("roteiro", {
    "../../../../lib/cep/node": { fs: { existsSync() { calls.exists += 1; return directoryExists; } } },
    "../../../services/localDiagnostics": {
      createDiagnosticOperationId: () => `test-${++diagnosticSequence}`,
      recordLocalDiagnostic: (event) => diagnostics.push(event),
      recordDiagnosticFailure: (component, action, message, caught, options) => {
        diagnostics.push({ component, action, message, status: "failed", ...options });
      },
    },
    "../services/roteiroFileDialog": { chooseRoteiroFile: unexpected },
    "../services/roteiroService": {
      loadProjectRoteiroInfo() {
        calls.project += 1;
        return projectLoader ? projectLoader() : Promise.resolve(project);
      },
    },
    "../services/offersValidationService": {
      loadOffersFirstProductInfo() {
        calls.offers += 1;
        return offersLoader ? offersLoader() : Promise.resolve([{
          offerLayerIndex: 1, productIndex: 0, mechanicType: "Simples", priceValue: price,
        }]);
      },
      openValidatedOfferPrecomp: unexpected,
      updateValidatedOfferField: unexpected,
    },
    "../services/audioService": {
      loadProjectWavFootageInfo: unexpected,
      replaceProjectWavFootage: unexpected,
      openProjectAudioDialogAndReplace: unexpected,
    },
    "../services/markerService": {
      adjustTimelineMarkersToTail: unexpected,
      openTimelineCompPreview: unexpected,
    },
    "../services/renderService": { queueActiveCompRenderOutputs: unexpected },
    "../utils/roteiroFiles": {
      isNodeAvailable: () => cep,
      scanRoteiroDirectory() { calls.directory += 1; return documentFound ? [target] : []; },
      getRoteiroFile: () => documentFound ? target : null,
    },
    "../utils/audioFiles": { scanAudioDirectory: unexpected },
  });
  harness.mount(() => useRoteiro(document.cache));
  return {
    harness,
    document,
    diagnostics,
    calls,
    project,
    target,
    set price(next) { price = next; },
    set projectLoader(next) { projectLoader = next; },
    set offersLoader(next) { offersLoader = next; },
    set directoryExists(next) { directoryExists = next; },
    set documentFound(next) { documentFound = next; },
  };
}

test("returning to Roteiro reuses document content but queries current project and offers again", async () => {
  const document = documentFixture();
  const first = roteiroFixture({ document });
  await first.harness.value.load();
  assert.equal(first.harness.value.content, "SP2\n01 SIMPLES\nPRODUTO 8,59");
  assert.equal(first.harness.value.offerValidationInfos[0].priceValue, "8,59");
  const originalContent = first.harness.value.content;
  assert.equal(document.sourceReads, 1);
  first.harness.unmount();

  const next = roteiroFixture({ document });
  next.price = "7,99";
  await next.harness.value.load();
  assert.equal(next.harness.value.content, originalContent);
  assert.equal(next.harness.value.offerValidationInfos[0].priceValue, "7,99");
  assert.equal(next.calls.project, 1);
  assert.equal(next.calls.offers, 1);
  assert.equal(next.calls.directory, 1, "Rediscover the file when returning, so renamed/new DOCX files are considered");
  assert.equal(document.sourceReads, 1, "No second document parse for a normal tab return");
  assert.equal(next.diagnostics.find((event) => event.status === "completed").details.documentCacheHit, true);
});

test("manual reload clears the document cache, rereads content and refreshes offers", async () => {
  const f = roteiroFixture();
  await f.harness.value.load();
  f.document.content = "SP2\n01 SIMPLES\nTEXTO REVISTO 6,99";
  f.price = "6,99";
  await f.harness.value.load(true);
  assert.equal(f.document.clears, 1);
  assert.equal(f.document.sourceReads, 2);
  assert.equal(f.document.reads.at(-1).forceRead, true);
  assert.match(f.harness.value.content, /TEXTO REVISTO/);
  assert.equal(f.harness.value.offerValidationInfos[0].priceValue, "6,99");
  assert.equal(f.calls.project, 2);
  assert.equal(f.calls.offers, 2);
  assert.equal(f.diagnostics.filter((event) => event.status === "completed").at(-1).details.documentCacheHit, false);
});

test("refresh retains the visible filename, document and validation until the replacement has loaded", async () => {
  const f = roteiroFixture();
  await f.harness.value.load();
  const before = f.harness.value;
  const pending = deferred();
  f.projectLoader = () => pending.promise;
  f.document.content = "SP2\n01 SIMPLES\nCONTEUDO NOVO 6,99";
  f.target.name = "SP2_REVISADO.docx";
  f.price = "6,99";

  const operation = before.load(true);
  const during = f.harness.value;
  assert.equal(during.loading, true);
  assert.equal(during.fileName, before.fileName);
  assert.equal(during.content, before.content);
  assert.equal(during.offerValidationInfos, before.offerValidationInfos);
  assert.equal(f.document.sourceReads, 1, "Wait for the host context before rereading the document");

  pending.resolve(f.project);
  await operation;
  const after = f.harness.value;
  assert.equal(after.loading, false);
  assert.equal(after.fileName, "SP2_REVISADO.docx");
  assert.match(after.content, /CONTEUDO NOVO/);
  assert.equal(after.offerValidationInfos[0].priceValue, "6,99");
  assert.notEqual(after.offerValidationInfos, before.offerValidationInfos);
});

test("a second refresh click starts no duplicate host request and leaves the first load busy", async () => {
  const f = roteiroFixture();
  await f.harness.value.load();
  const before = f.harness.value;
  const pending = deferred();
  f.projectLoader = () => pending.promise;
  const first = before.load(true);
  // Reuse the callback from before React can paint disabled=true, as a quick
  // second click can reach that closure during the same event turn.
  await before.load(true);
  assert.equal(f.calls.project, 2);
  assert.equal(f.calls.offers, 2);
  assert.equal(f.document.clears, 1);
  assert.equal(f.harness.value.loading, true);
  assert.equal(f.harness.value.content, before.content);
  pending.resolve(f.project);
  await first;
  assert.equal(f.harness.value.loading, false);
  assert.equal(f.document.sourceReads, 2);
});

test("refresh blocks host mutations even through callbacks retained before the loading render", async () => {
  const f = roteiroFixture();
  await f.harness.value.load();
  const before = f.harness.value;
  const pending = deferred();
  f.projectLoader = () => pending.promise;
  const operation = before.load();
  const info = {
    ...before.offerValidationInfos[0],
    priceField: { fieldId: "price", fieldIndex: 1, value: "8,59" },
  };
  const attempted = [
    before.updateAudio(),
    before.adjustMarkers(),
    before.queueRender(),
    before.openOfferPrecomp(info),
    before.fixOfferValue(info, "price", "6,99"),
  ];
  assert.equal(f.calls.project, 2, "Mutations may not trigger another read during refresh");
  assert.equal(f.calls.offers, 2);
  assert.equal(f.calls.mutations, 0);
  assert.equal(f.harness.value.toast, null);
  for (const field of ["audioUpdating", "markerAdjusting", "renderQueueLoading", "offerActionLoading"]) {
    assert.equal(f.harness.value[field], false, field);
  }
  pending.resolve(f.project);
  await Promise.all([operation, ...attempted]);
  assert.equal(f.calls.mutations, 0);
});

test("load diagnostics separate host, directory and document timings without project contents", async () => {
  const f = roteiroFixture();
  await f.harness.value.load();
  const details = f.diagnostics.find((event) => event.status === "completed").details;
  for (const field of ["durationMs", "hostDurationMs", "directoryDurationMs", "documentDurationMs"]) {
    assert.equal(typeof details[field], "number", field);
    assert.ok(Number.isFinite(details[field]) && details[field] >= 0, field);
  }
  assert.equal(details.documentCacheHit, false);
  assert.equal(details.offerCount, 1);
  assert.doesNotMatch(JSON.stringify(f.diagnostics), /SP2|C:\/job|PRODUTO|8,59/);
});

for (const failure of ["host", "directory", "document"]) {
  test(`${failure} failure removes the old document and validation instead of displaying stale data`, async () => {
    const f = roteiroFixture();
    await f.harness.value.load();
    const before = f.harness.value;
    assert.notEqual(before.content, "");
    const pending = deferred();
    f.projectLoader = () => pending.promise;
    if (failure === "directory") f.directoryExists = false;
    if (failure === "document") f.document.failures = true;
    const operation = before.load();
    assert.equal(f.harness.value.content, before.content, "Keep content until the failure is known");
    assert.equal(f.harness.value.fileName, before.fileName);
    assert.equal(f.harness.value.offerValidationInfos, before.offerValidationInfos);
    if (failure === "host") pending.reject(new Error("After indisponível."));
    else pending.resolve(f.project);
    await operation;
    assert.equal(f.harness.value.content, "");
    assert.equal(f.harness.value.fileName, "");
    assert.equal(f.harness.value.offerValidationInfos.length, 0);
    assert.notEqual(f.harness.value.error, "");
    assert.equal(f.harness.value.loading, false);
    assert.ok(f.document.clears > 0, "A failed reload must invalidate previous document content");
    assert.ok(f.diagnostics.some((event) => event.status === "failed" || event.status === "needs_user_input"));
  });
}

test("browser preview performs no host calls or document access", async () => {
  const f = roteiroFixture({ cep: false });
  await f.harness.value.load();
  await f.harness.value.load(true);
  assert.equal(f.harness.value.loading, false);
  assert.equal(f.harness.value.error, "");
  assert.equal(f.calls.project, 0);
  assert.equal(f.calls.offers, 0);
  assert.equal(f.document.reads.length, 0);
  assert.equal(f.document.clears, 0);
  assert.equal(f.diagnostics.length, 0);
});

for (const outcome of ["success", "failure"]) {
  test(`an unmounted Roteiro ignores a delayed host ${outcome} without reading or clearing the shared cache`, async () => {
    const f = roteiroFixture();
    const pending = deferred();
    f.projectLoader = () => pending.promise;
    const operation = f.harness.value.load();
    assert.equal(f.harness.value.loading, true);
    assert.equal(f.calls.project, 1);
    assert.equal(f.calls.offers, 1);
    f.harness.unmount();
    if (outcome === "success") pending.resolve(f.project);
    else pending.reject(new Error("Old project request failed"));
    await operation;
    assert.equal(f.document.reads.length, 0);
    assert.equal(f.document.clears, 0);
    assert.equal(f.calls.exists, 0);
    assert.equal(f.calls.directory, 0);
    assert.equal(f.harness.settersAfterUnmount, 0);
    assert.equal(f.diagnostics.length, 1, "Only the initial started event belongs to this load");
    assert.equal(f.diagnostics[0].status, "started");
  });
}

test("the panel permits cached reads on mount and forces fresh reads through every manual retry button", () => {
  for (const state of ["loaded", "empty", "error"]) {
    const harness = createHarness();
    const documentCache = documentFixture().cache;
    const requests = [];
    const load = (force) => { requests.push(force); return Promise.resolve(); };
    const jsx = (type, props) => ({ type, props });
    const { RoteiroPanel } = harness.loadModule("panel", {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "../hooks/useRoteiro": {
        useRoteiro(cache) {
          assert.equal(cache, documentCache, "The panel must pass its project-owned cache to the hook");
          return {
            load,
            content: state === "loaded" ? "SP2\nPRODUTO" : "",
            fileName: "SP2.docx",
            error: state === "error" ? "Falha na leitura." : "",
            offerValidationInfos: [],
          };
        },
      },
      "../utils/textSegments": {
        buildLineSegments: () => [],
        mapLinesToOffers: (lines) => lines.map(() => -1),
      },
      "./RoteiroPanel.scss": {},
    });
    const tree = harness.mount(() => RoteiroPanel({ documentCache }));
    assert.deepEqual(requests, [undefined], `${state}: tab mount allows the cache`);
    const findRefresh = (node) => {
      if (!node || typeof node !== "object") return null;
      if (node.type === "button" && (state !== "loaded" || node.props.title === "Atualizar roteiro")) return node;
      for (const child of [node.props?.children].flat()) {
        const found = findRefresh(child);
        if (found) return found;
      }
      return null;
    };
    const button = findRefresh(tree);
    assert.ok(button, `${state}: manual reload button is available`);
    button.props.onClick();
    assert.deepEqual(requests, [undefined, true], `${state}: a user-requested reload bypasses cache`);
    harness.unmount();
  }
});

function descendants(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...descendants(node.props?.children, predicate),
  ];
}

function treeText(node) {
  if (Array.isArray(node)) return node.map(treeText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? treeText(node.props?.children) : "";
}

function panelFixture(overrides = {}) {
  const harness = createHarness();
  const documentCache = documentFixture().cache;
  const requests = [];
  const mutations = [];
  const mutation = (name) => () => { mutations.push(name); return Promise.resolve(); };
  const jsx = (type, props) => ({ type, props });
  const state = {
    loading: false,
    audioUpdating: false,
    markerAdjusting: false,
    renderQueueLoading: false,
    offerActionLoading: false,
    error: "",
    content: "SP2\nPRODUTO 8,59",
    fileName: "SP2.docx",
    offerValidationInfos: [{
      offerLayerIndex: 7,
      productIndex: 0,
      mechanicType: "Simples",
      priceValue: "7,99",
    }],
    load: (force) => { requests.push(force); return Promise.resolve(); },
    updateAudio: mutation("audio"),
    adjustMarkers: mutation("markers"),
    queueRender: mutation("render"),
    openOfferPrecomp: mutation("open"),
    fixOfferValue: mutation("fix"),
    ...overrides,
  };
  const { RoteiroPanel } = harness.loadModule("panel", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../hooks/useRoteiro": { useRoteiro: () => state },
    "../utils/textSegments": {
      buildLineSegments: () => [
        { text: "PRODUTO " },
        { text: "8,59", match: "wrong", action: "fix", fieldKey: "price", value: "8,59" },
      ],
      mapLinesToOffers: (lines) => lines.map((_, index) => index - 1),
    },
    "./RoteiroPanel.scss": {},
  });
  harness.mount(() => RoteiroPanel({
    documentCache,
    onOpenOfferInOffers: mutation("offers"),
  }));
  return { harness, state, requests, mutations };
}

test("a refresh keeps the loaded rows and filename visible with an accessible busy indicator", () => {
  const f = panelFixture();
  const before = f.harness.value;
  const beforeRows = descendants(before, (node) => typeof node.props?.onDoubleClick === "function");
  assert.equal(beforeRows.length, 1);
  assert.match(treeText(beforeRows[0]), /PRODUTO 8,59/);

  f.state.loading = true;
  const during = f.harness.value;
  const duringRows = descendants(during, (node) => typeof node.props?.onDoubleClick === "function");
  assert.equal(during.type, before.type);
  assert.equal(during.props.className, before.props.className);
  assert.equal(duringRows.length, beforeRows.length);
  assert.equal(treeText(duringRows[0]), treeText(beforeRows[0]));
  assert.equal(duringRows[0].props.className, beforeRows[0].props.className, "Keep the existing validation colors during refresh");
  assert.match(treeText(during), /SP2\.docx/);
  assert.doesNotMatch(treeText(during), /Carregando roteiro|Nenhum roteiro/);
  assert.equal(during.props["aria-busy"], true);
  const refresh = descendants(during, (node) => node.type === "button" && node.props.className === "roteiro-panel__refresh")[0];
  assert.ok(refresh);
  assert.equal(refresh.props.title, "Atualizando roteiro...");
  assert.equal(refresh.props["aria-busy"], true);
  assert.equal(refresh.props.disabled, true);

  f.state.loading = false;
  const after = f.harness.value;
  const readyRefresh = descendants(after, (node) => node.type === "button" && node.props.className === "roteiro-panel__refresh")[0];
  assert.equal(readyRefresh.props.title, "Atualizar roteiro");
  assert.equal(readyRefresh.props.disabled, false);
  assert.equal(after.props["aria-busy"], false);
});

test("the first load without document content still shows the loading placeholder", () => {
  const f = panelFixture({ loading: true, content: "", fileName: "", offerValidationInfos: [] });
  const tree = f.harness.value;
  assert.match(treeText(tree), /Carregando roteiro/);
  assert.equal(descendants(tree, (node) => typeof node.props?.onDoubleClick === "function").length, 0);
  assert.equal(descendants(tree, (node) => node.type === "button").length, 0);
});

test("all busy states disable editing controls and suppress offer-row double clicks", () => {
  for (const busyFlag of ["loading", "audioUpdating", "markerAdjusting", "renderQueueLoading", "offerActionLoading"]) {
    const f = panelFixture();
    f.state[busyFlag] = true;
    const tree = f.harness.value;
    const buttons = descendants(tree, (node) => node.type === "button");
    assert.ok(buttons.length >= 6, "Exercise audio, refresh, open, fix, markers and render controls");
    for (const button of buttons) {
      assert.equal(button.props.disabled, true, `${busyFlag}: ${button.props.title}`);
    }
    const row = descendants(tree, (node) => typeof node.props?.onDoubleClick === "function")[0];
    const event = { target: { closest: () => null } };
    row.props.onDoubleClick(event);
    assert.deepEqual(f.mutations, [], `${busyFlag}: double click must not navigate with old validation`);

    f.state[busyFlag] = false;
    const readyRow = descendants(f.harness.value, (node) => typeof node.props?.onDoubleClick === "function")[0];
    readyRow.props.onDoubleClick(event);
    assert.deepEqual(f.mutations, ["offers"], `${busyFlag}: editing resumes after the operation`);
  }
});
