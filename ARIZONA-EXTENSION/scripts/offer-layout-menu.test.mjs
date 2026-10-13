import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = Object.fromEntries(await Promise.all(Object.entries({
  menu: "../src/js/main/domains/ofertas/components/OfferLayoutMenu.tsx",
  options: "../src/js/main/domains/ofertas/hooks/useOfferLayoutOptions.ts",
  tooltips: "../src/js/main/utils/tooltips.ts",
  errors: "../src/js/main/utils/errors.ts",
}).map(async ([name, path]) => [name, ts.transpileModule(
  await readFile(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } },
).outputText])));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

const layoutData = (offerLayerIndex = 4) => ({
  ok: true,
  message: "Réguas disponíveis.",
  errors: [],
  context: {
    projectKey: "C:/jobs/current.aep", compItemId: 10, offerLayerIndex,
    offerLayerId: 40 + offerLayerIndex, layerComment: "OFERTA " + offerLayerIndex,
    sourceItemId: 50, folderItemId: 60, folderComment: "REGUAS",
  },
  options: [
    { comment: "REGUA 1", label: "Régua atual", itemId: 50, current: true, enabled: true },
    { comment: "REGUA 2", label: "Régua disponível", itemId: 70, current: false, enabled: true },
    { comment: "REGUA 3", label: "Régua ausente", itemId: null, current: false, enabled: false,
      disabledSummary: "A régua não foi encontrada.", disabledReason: 'Adicione o comentário "REGUA 3" à composição.' },
    { comment: "REGUA 4", label: "Outra régua disponível", itemId: 90, current: false, enabled: true },
  ],
});

// Run the real menu and its lazy reader together. Only host responses, React
// lifecycle and the DOM boundary are controlled; selection logic stays real.
function createHarness({ cep = true, props: initialProps = {} } = {}) {
  const slots = [];
  const reads = [];
  const changes = [];
  const statuses = [];
  const change = deferred();
  const modules = new Map();
  let cursor = 0;
  let mounted = true;
  let settersAfterUnmount = 0;
  let dirty = false;
  let output;
  let pendingEffects = [];
  let nodes = new Map();
  const events = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
    dispatch(type, event) { [...(this.listeners.get(type) || [])].forEach((listener) => listener(event)); },
  });
  class Element {
    constructor(type = "div", props = {}, parent = null) {
      this.type = type;
      this.props = props;
      this.parentElement = parent;
      this.style = {};
      this.isConnected = true;
    }
    get disabled() { return Boolean(this.props.disabled); }
    getAttribute(name) { return this.props[name] === undefined ? null : String(this.props[name]); }
    contains(target) {
      for (let node = target; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    focus() {
      document.activeElement = this;
      document.dispatch("focusin", { target: this });
    }
    getBoundingClientRect() {
      return this.props.role === "menu"
        ? { left: 0, top: 0, right: 260, bottom: 220, width: 260, height: 220 }
        : { left: 390, top: 36, right: 470, bottom: 64, width: 80, height: 28 };
    }
  }
  const document = { ...events(), body: new Element("body"), activeElement: null,
    documentElement: { clientWidth: 500, clientHeight: 420 } };
  const window = { ...events(), cep: cep ? {} : undefined };
  const changed = (previous, next) => !previous || !next || previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));
  const useEffect = (effect, dependencies) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && !changed(previous.dependencies, dependencies)) return;
    slots[index] = { dependencies, cleanup: previous?.cleanup };
    pendingEffects.push(() => {
      slots[index].cleanup?.();
      slots[index].cleanup = effect();
    });
  };
  const react = {
    useId() { cursor += 1; return ":test:"; },
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
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const Fragment = Symbol("Fragment");
  const Portal = Symbol("Portal");
  const jsx = (type, props, key) => ({ type, props, key });
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const module = { exports: {} };
    modules.set(name, module.exports);
    vm.runInNewContext(compiled[name], {
      module, exports: module.exports, document, window, Node: Element,
      require(specifier) {
        if (specifier === "react") return react;
        if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment };
        if (specifier === "react-dom") return { createPortal: (children, container) => jsx(Portal, { children, container }) };
        if (specifier === "../hooks/useOfferLayoutOptions") return load("options");
        if (specifier.endsWith("utils/tooltips")) return load("tooltips");
        if (specifier.endsWith("utils/errors")) return load("errors");
        if (specifier === "../services/ofertas") return {
          loadOfferLayoutOptions(index) { const request = { index, ...deferred() }; reads.push(request); return request.promise; },
        };
        if (specifier === "./OfferLayoutMenu.scss") return {};
        throw new Error("Unexpected import: " + specifier);
      },
    });
    return module.exports;
  };
  const { OfferLayoutMenu } = load("menu");
  const props = {
    offerLayerIndex: 4, busy: false, blocked: false, resetKey: "snapshot-1",
    onChange(request) { changes.push(request); return change.promise; },
    onStatus(message) { statuses.push(message); },
    ...initialProps,
  };
  const setRef = (ref, value) => {
    if (typeof ref === "function") ref(value);
    else if (ref) ref.current = value;
  };
  const commit = (tree) => {
    const nextNodes = new Map();
    nodes.forEach((node) => setRef(node.props.ref, null));
    const visit = (item, path, parent) => {
      if (Array.isArray(item)) { item.forEach((child, index) => visit(child, path + "/" + index, parent)); return; }
      if (!item || typeof item !== "object") return;
      if (item.type === Fragment || item.type === Portal) {
        visit(item.props.children, path + "/children", item.type === Portal ? item.props.container : parent);
        return;
      }
      const key = path + "/" + item.type + ":" + (item.key || "");
      const node = nodes.get(key) || new Element(item.type);
      node.props = item.props;
      node.parentElement = parent;
      node.isConnected = true;
      nextNodes.set(key, node);
      setRef(item.props.ref, node);
      visit(item.props.children, path + "/children", node);
    };
    visit(tree, "root", document.body);
    nodes.forEach((node, key) => { if (!nextNodes.has(key)) node.isConnected = false; });
    nodes = nextNodes;
  };
  const render = () => {
    assert.equal(mounted, true, "Do not render after unmount");
    let iterations = 0;
    do {
      assert.ok(iterations++ < 20, "Layout menu did not settle");
      cursor = 0;
      dirty = false;
      output = OfferLayoutMenu(props);
      commit(output);
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    } while (dirty);
    return output;
  };
  render();
  return {
    reads, changes, statuses, change, document, window, render,
    get value() { return output; },
    get settersAfterUnmount() { return settersAfterUnmount; },
    get trigger() { return [...nodes.values()].find((node) => node.props["aria-haspopup"] === "menu"); },
    get menu() { return [...nodes.values()].find((node) => node.props.role === "menu"); },
    get options() { return [...nodes.values()].filter((node) => node.props.role === "menuitemradio"); },
    find(predicate) { return [...nodes.values()].find(predicate); },
    update(next) { Object.assign(props, next); render(); },
    click(node) { if (!node.disabled) node.props.onClick?.(); render(); },
    key(node, key) {
      const event = { key, target: node, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      document.dispatch("keydown", event);
      if (!event.stopped) node.props.onKeyDown?.(event);
      render();
      return event;
    },
    dispatch(type, target = document.body, surface = document) { surface.dispatch(type, { target }); render(); },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
      nodes.forEach((node) => { setRef(node.props.ref, null); node.isConnected = false; });
      mounted = false;
    },
  };
}

test("layout options are read lazily and reopening requests current host options", async () => {
  const h = createHarness();
  assert.equal(h.reads.length, 0);
  assert.equal(h.menu, undefined);
  h.click(h.trigger);
  assert.deepEqual(h.reads.map(({ index }) => index), [4]);
  assert.equal(h.trigger.props["aria-expanded"], true);
  assert.equal(h.menu.props["aria-busy"], true);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.options.length, 4);
  assert.equal(h.menu.parentElement, h.document.body, "The menu is outside the scrolling offer cards");
  assert.equal(h.options[0].props["aria-checked"], true);
  assert.equal(h.options[2].disabled, true);
  assert.match(h.options[2].parentElement.props["data-tooltip-resolution"], /REGUA 3/);
  h.click(h.trigger);
  assert.equal(h.menu, undefined);
  h.click(h.trigger);
  assert.equal(h.reads.length, 2, "A later open cannot reuse stale project options");
  assert.equal(h.options.length, 0);
  h.unmount();
});

for (const cancellation of ["close", "offer", "snapshot", "busy", "blocked", "unmount"]) {
  test(`a pending layout read cannot restore the menu after ${cancellation}`, async () => {
    const h = createHarness();
    h.click(h.trigger);
    if (cancellation === "close") h.click(h.trigger);
    else if (cancellation === "offer") h.update({ offerLayerIndex: 5 });
    else if (cancellation === "snapshot") h.update({ resetKey: "snapshot-2" });
    else if (cancellation === "busy") h.update({ busy: true });
    else if (cancellation === "blocked") h.update({ blocked: true });
    else h.unmount();
    h.reads.forEach((request) => request.resolve(layoutData(request.index)));
    await settle();
    if (cancellation !== "unmount") {
      h.render();
      assert.equal(h.menu, undefined);
      assert.equal(h.options.length, 0);
      if (cancellation === "offer") {
        h.click(h.trigger);
        assert.equal(h.reads.at(-1).index, 5);
        assert.equal(h.options.length, 0, "The old response must not become the new offer's menu");
      }
      h.unmount();
    }
    assert.equal(h.settersAfterUnmount, 0);
    assert.deepEqual(h.changes, []);
    assert.deepEqual(h.statuses, []);
  });
}

test("only a valid noncurrent option sends its captured context once, and closes the menu", async () => {
  const h = createHarness();
  h.click(h.trigger);
  const data = layoutData();
  h.reads[0].resolve(data);
  await settle(); h.render();
  const options = h.options;
  options[2].props.onClick();
  assert.deepEqual(h.changes, [], "Disabled targets cannot replace the offer");
  const select = options[1].props.onClick;
  select(); select();
  h.render();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].context, data.context);
  assert.equal(h.changes[0].targetItemId, 70);
  assert.equal(h.menu, undefined);
  assert.equal(h.trigger.disabled, true);
  assert.equal(h.document.activeElement, h.trigger);
  h.change.resolve();
  await settle(); h.render();
  assert.equal(h.trigger.disabled, false);
  h.unmount();
});

test("the current layout closes the menu without mutation and retained option handlers become inert", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  const staleSelection = h.options[1].props.onClick;
  h.click(h.options[0]);
  assert.equal(h.menu, undefined);
  staleSelection();
  assert.deepEqual(h.changes, []);
  h.unmount();
  staleSelection();
  assert.deepEqual(h.changes, []);
  assert.equal(h.settersAfterUnmount, 0);
});

for (const outcome of ["allow", "cancel", "snapshot", "offer", "unmount"]) {
  test(`layout preflight ${outcome} only applies a still-current confirmed selection`, async () => {
    const before = deferred();
    let preflightCalls = 0;
    const h = createHarness({ props: {
      onBeforeChange: () => { preflightCalls += 1; return before.promise; },
    } });
    h.click(h.trigger);
    const data = layoutData();
    h.reads[0].resolve(data);
    await settle(); h.render();
    const select = h.options[1].props.onClick;
    select(); select();
    h.render();
    assert.equal(preflightCalls, 1);
    assert.equal(h.menu, undefined);
    assert.equal(h.trigger.disabled, true);
    assert.deepEqual(h.changes, [], "Do not mutate the host before the project check completes");

    if (outcome === "snapshot") h.update({ resetKey: "snapshot-2" });
    if (outcome === "offer") h.update({ offerLayerIndex: 5 });
    if (outcome === "unmount") h.unmount();
    before.resolve(outcome !== "cancel");
    await settle();
    if (outcome === "allow") {
      assert.equal(h.changes.length, 1);
      assert.equal(h.changes[0].context, data.context);
      assert.equal(h.changes[0].targetItemId, 70);
      h.change.resolve();
      await settle();
    } else {
      assert.deepEqual(h.changes, [], "Cancellation or a changed offer must discard the captured request");
    }
    if (outcome !== "unmount") {
      h.render();
      assert.equal(h.trigger.disabled, false);
      h.unmount();
    }
    assert.equal(h.settersAfterUnmount, 0);
    assert.deepEqual(h.statuses, []);
  });
}

test("missing offer context prevents selection even if the host listed an enabled target", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].resolve({ ...layoutData(), context: null });
  await settle(); h.render();
  h.options.forEach((option) => {
    assert.equal(option.disabled, true);
    option.props.onClick();
  });
  assert.deepEqual(h.changes, []);
  h.unmount();
});

test("an unavailable offer folder keeps its exact comment and Project-panel fix in a focusable tooltip", async () => {
  const h = createHarness({ props: { offerLayerIndex: 1 } });
  h.click(h.trigger);
  const summary = 'Nenhuma pasta do projeto tem o comentário "OFERTA 01".';
  const resolution = 'No painel Projeto, adicione o comentário "OFERTA 01" à pasta desta oferta.';
  h.reads[0].resolve({
    ...layoutData(1),
    ok: false,
    message: summary,
    context: null,
    disabledSummary: summary,
    disabledReason: resolution,
  });
  await settle(); h.render();

  const diagnostic = h.find((node) => node.type === "p" && node.props["data-tooltip"] === summary);
  assert.ok(diagnostic);
  assert.equal(diagnostic.props["data-tooltip-title"], "Réguas indisponíveis");
  assert.equal(diagnostic.props["data-tooltip-resolution"], resolution);
  assert.equal(diagnostic.props.title, undefined);
  assert.equal(diagnostic.props.tabIndex, 0);
  assert.equal(h.document.activeElement, diagnostic, "Keyboard users reach the explanation when the read completes");
  h.options.forEach((option) => {
    assert.equal(option.disabled, true, "An unavailable folder cannot expose an actionable layout");
    option.props.onClick();
  });
  assert.deepEqual(h.changes, []);
  h.key(h.menu, "Escape");
  assert.equal(h.document.activeElement, h.trigger);
  h.unmount();
});

test("keyboard navigation skips unavailable options and Escape restores trigger focus", async () => {
  const h = createHarness();
  assert.equal(h.key(h.trigger, "ArrowDown").prevented, true);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.document.activeElement, h.options[0]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[1]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[3]);
  h.key(h.menu, "Home");
  assert.equal(h.document.activeElement, h.options[0]);
  h.key(h.menu, "End");
  assert.equal(h.document.activeElement, h.options[3]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[0]);
  assert.equal(h.key(h.menu, "Escape").prevented, true);
  assert.equal(h.menu, undefined);
  assert.equal(h.document.activeElement, h.trigger);
  assert.deepEqual(h.changes, []);
  h.unmount();
});

for (const dismissal of ["pointerdown", "focusin", "scroll", "resize"]) {
  test(`${dismissal} outside closes the layout menu without selecting an option`, () => {
    const h = createHarness();
    h.click(h.trigger);
    h.dispatch("pointerdown", h.menu);
    h.dispatch("scroll", h.menu);
    assert.ok(h.menu, "Interactions inside the menu do not dismiss it");
    h.dispatch(dismissal, h.document.body, dismissal === "resize" ? h.window : h.document);
    assert.equal(h.menu, undefined);
    assert.deepEqual(h.changes, []);
    h.unmount();
    assert.ok([...h.document.listeners.values()].every((listeners) => listeners.size === 0));
    assert.ok([...h.window.listeners.values()].every((listeners) => listeners.size === 0));
  });
}

test("a failed option read can retry, and browser preview never queries the host", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].reject(new Error("evalScript transport failed"));
  await settle(); h.render();
  const alert = h.find((node) => node.props.role === "alert");
  assert.ok(alert);
  assert.doesNotMatch(alert.props.children, /evalScript|transport/);
  const retry = h.find((node) => node.type === "button" && node.parentElement?.contains(alert));
  assert.ok(retry);
  h.click(retry);
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.options.length, 4);
  h.unmount();

  const preview = createHarness({ cep: false });
  assert.equal(preview.trigger.disabled, true);
  preview.trigger.props.onClick();
  preview.render();
  assert.equal(preview.menu, undefined);
  assert.deepEqual(preview.reads, []);
  preview.unmount();
});
