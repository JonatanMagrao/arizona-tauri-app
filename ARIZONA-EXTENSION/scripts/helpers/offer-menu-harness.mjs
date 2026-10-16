import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

export const compileOfferMenu = async (paths) => Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, ts.transpileModule(
    await readFile(path, "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText]),
));

export const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
export const settle = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

// Run the real menu and its lazy reader together. Only host responses, React
// lifecycle and the DOM boundary are controlled; selection logic stays real.
export function createOfferMenuHarness(compiled, config, { cep = true, props: initialProps = {} } = {}) {
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
  const document = { ...events(), body: new Element("body"), activeElement: null, visibilityState: "visible",
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
        if (specifier === config.optionsImport) return load("options");
        if (specifier === "../services/offerMenuCache") return load("cache");
        if (specifier.endsWith("utils/tooltips")) return load("tooltips");
        if (specifier.endsWith("utils/errors")) return load("errors");
        if (specifier === "../services/ofertas") return {
          [config.readService](index, productIndex) { const request = { index, productIndex, ...deferred() }; reads.push(request); return request.promise; },
        };
        if (specifier.endsWith(".scss")) return {};
        throw new Error("Unexpected import: " + specifier);
      },
    });
    return module.exports;
  };
  const Menu = load("menu")[config.componentName];
  const props = {
    offerLayerIndex: 4, busy: false, blocked: false, resetKey: "snapshot-1",
    onChange(request) { changes.push(request); return change.promise; },
    onStatus(message) { statuses.push(message); },
    ...config.defaultProps,
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
      assert.ok(iterations++ < 20, "Offer menu did not settle");
      cursor = 0;
      dirty = false;
      output = Menu(props);
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
    cache: load("cache"),
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
