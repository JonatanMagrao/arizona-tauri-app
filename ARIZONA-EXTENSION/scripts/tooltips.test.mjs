import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = Object.fromEntries(await Promise.all(Object.entries({
  layer: "../src/js/main/components/TooltipLayer.tsx",
  props: "../src/js/main/utils/tooltips.ts",
}).map(async ([name, path]) => [name, ts.transpileModule(
  await readFile(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
    jsx: ts.JsxEmit.ReactJSX,
  } },
).outputText])));

// Run the real component's effects and delegated handlers. Time, DOM geometry
// and commits are controlled; no CEP/After process or new DOM library is needed.
function createHarness({ width = 500, height = 400, tooltipHeight = 110 } = {}) {
  const slots = [];
  const timers = new Map();
  const frames = new Map();
  const observers = new Set();
  let cursor = 0;
  let nextTimer = 0;
  let clock = 0;
  let mounted = true;
  let dirty = false;
  let output;
  let tooltipNode;
  let pendingEffects = [];
  let settersAfterUnmount = 0;
  const events = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
    dispatch(type, event) { this.listeners.get(type)?.forEach((listener) => listener(event)); },
  });

  class FakeElement {
    constructor(attributes = {}, parent = null, rect = {}) {
      this.attributes = new Map(Object.entries(attributes));
      this.parentElement = parent;
      this.style = {};
      this.isConnected = true;
      this.rect = { left: 30, top: 30, width: 80, height: 26, ...rect };
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) {
      assert.equal(selector, "[data-tooltip]");
      if (this.attributes.has("data-tooltip")) return this;
      return this.parentElement?.closest(selector) || null;
    }
    contains(target) {
      for (let node = target; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    getBoundingClientRect() {
      const rect = { ...this.rect };
      if (this === tooltipNode) {
        rect.width = Math.min(360, parseFloat(this.style.maxWidth) || 360);
        rect.height = Math.min(tooltipHeight, parseFloat(this.style.maxHeight) || tooltipHeight);
        rect.left = parseFloat(this.style.left) || 0;
        rect.top = parseFloat(this.style.top) || 0;
      }
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
    }
  }

  const document = {
    ...events(), body: new FakeElement(), activeElement: null,
    documentElement: { clientWidth: width, clientHeight: height },
  };
  const window = {
    ...events(),
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: clock + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextTimer; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const changed = (previous, next) => !previous || previous.length !== next.length ||
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
        slots[index] = { value: initial };
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
    useEffect,
    useLayoutEffect: useEffect,
  };
  const load = (name) => {
    const module = { exports: {} };
    vm.runInNewContext(compiled[name], {
      module, exports: module.exports, document, window, Element: FakeElement,
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.add(this); }
        observe() {}
        disconnect() { observers.delete(this); }
      },
      require(specifier) {
        if (specifier === "react") return react;
        if (specifier === "react/jsx-runtime") {
          const jsx = (type, props) => ({ type, props });
          return { jsx, jsxs: jsx };
        }
        if (specifier === "react-dom") return {
          createPortal: (child, container) => ({ child, container }),
        };
        if (specifier === "./TooltipLayer.scss") return {};
        throw new Error(`Unexpected import: ${specifier}`);
      },
    });
    return module.exports;
  };
  const { TooltipLayer } = load("layer");
  const render = () => {
    let iterations = 0;
    do {
      assert.ok(iterations++ < 15, "Tooltip did not settle");
      cursor = 0;
      dirty = false;
      output = TooltipLayer();
      if (output) {
        tooltipNode ||= new FakeElement({}, document.body);
        output.child.props.ref.current = tooltipNode;
      } else {
        tooltipNode = undefined;
      }
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    } while (dirty);
    return output;
  };
  render();

  return {
    load, document, window, timers, frames, observers,
    element: (attributes = {}, parent = document.body, rect) =>
      new FakeElement(attributes, parent, rect),
    get value() { return output; },
    get tooltip() { return tooltipNode; },
    get settersAfterUnmount() { return settersAfterUnmount; },
    dispatch(type, event = {}, surface = document) {
      if (type === "focusin") document.activeElement = event.target;
      if (type === "focusout") document.activeElement = event.relatedTarget;
      surface.dispatch(type, { pointerType: "mouse", clientX: 80, clientY: 60, ...event });
      return render();
    },
    advance(milliseconds) {
      const deadline = clock + milliseconds;
      while (true) {
        const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > deadline) break;
        clock = entry[1].at;
        timers.delete(entry[0]);
        entry[1].callback();
        render();
      }
      clock = deadline;
    },
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
      render();
    },
    mutate(mutations) {
      [...observers].forEach((observer) => observer.callback(mutations));
      render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
      mounted = false;
    },
  };
}

test("tooltipProps keeps structured content safe and omits empty tooltips", () => {
  const h = createHarness();
  const { tooltipProps } = h.load("props");
  assert.equal(tooltipProps("Ajuda")["data-tooltip"], "Ajuda");
  assert.equal(tooltipProps("  ")["data-tooltip"], undefined);
  assert.equal(tooltipProps(null)["data-tooltip"], undefined);
  const props = tooltipProps({ title: "Campo", text: '<img src="x">', resolution: 'Adicione "MECANICA".' });
  assert.equal(props["data-tooltip-title"], "Campo");
  assert.equal(props["data-tooltip"], '<img src="x">');
  assert.equal(props["data-tooltip-resolution"], 'Adicione "MECANICA".');
  h.unmount();
});

test("hover waits 350ms, uses the nearest nonempty target and portals outside overflow", () => {
  const h = createHarness();
  const wrapper = h.element({ "data-tooltip": "Unidade indisponível" });
  const emptyChild = h.element({ "data-tooltip": " " }, wrapper);
  h.dispatch("pointerover", { target: emptyChild });
  h.advance(349);
  assert.equal(h.value, null);
  h.advance(1);
  assert.equal(h.value.container, h.document.body);
  assert.equal(h.value.child.props.role, "tooltip");
  assert.equal(h.value.child.props.children[1].props.children.join(""), "Unidade indisponível");
  assert.equal(wrapper.getAttribute("aria-describedby"), h.value.child.props.id);
  h.unmount();
});

test("changing or leaving a target cancels its pending hover", () => {
  const h = createHarness();
  const first = h.element({ "data-tooltip": "Primeiro" });
  const second = h.element({ "data-tooltip": "Segundo" });
  h.dispatch("pointerover", { target: first });
  h.advance(200);
  h.dispatch("pointerout", { target: first, relatedTarget: second });
  h.dispatch("pointerover", { target: second });
  h.advance(150);
  assert.equal(h.value, null, "The first target's timer must be cancelled");
  h.advance(200);
  assert.equal(h.value.child.props.children[1].props.children.join(""), "Segundo");
  assert.equal(first.getAttribute("aria-describedby"), null);
  h.dispatch("pointerout", { target: second, relatedTarget: null });
  assert.equal(h.value, null);
  h.unmount();
});

test("keyboard focus describes the focused control and preserves existing ARIA ids", () => {
  const h = createHarness();
  const wrapper = h.element({ "data-tooltip": "Explicação" });
  const input = h.element({ "aria-describedby": "validation existing-hint" }, wrapper);
  h.dispatch("keydown", { key: "Tab" });
  h.dispatch("focusin", { target: input });
  const id = h.value.child.props.id;
  assert.equal(input.getAttribute("aria-describedby"), `validation existing-hint ${id}`);
  assert.equal(wrapper.getAttribute("aria-describedby"), null);
  input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby")} new-hint`);
  h.dispatch("keydown", { key: "Escape" });
  assert.equal(h.value, null);
  assert.equal(input.getAttribute("aria-describedby"), "validation existing-hint new-hint");
  h.unmount();
});

for (const event of ["Escape", "pointerdown", "scroll", "resize", "blur"]) {
  test(`${event} clears the visible tooltip and pending work`, () => {
    const h = createHarness();
    const target = h.element({ "data-tooltip": "Ajuda" });
    h.dispatch("pointerover", { target });
    h.advance(350);
    h.dispatch("pointermove", { target });
    assert.equal(h.frames.size, 0);
    if (event === "Escape") h.dispatch("keydown", { key: "Escape" });
    else h.dispatch(event, {}, ["resize", "blur"].includes(event) ? h.window : h.document);
    assert.equal(h.value, null);
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(target.getAttribute("aria-describedby"), null);
    h.unmount();
  });
}

test("a pointer click does not reopen the tooltip through focus", () => {
  const h = createHarness();
  const target = h.element({ "data-tooltip": "Ajuda" });
  h.dispatch("pointerover", { target });
  h.dispatch("pointerdown", { target });
  h.dispatch("focusin", { target });
  h.advance(1000);
  assert.equal(h.value, null);
  h.unmount();
});

test("tooltip stays anchored to its field while the pointer moves inside it", () => {
  const h = createHarness();
  const target = h.element({ "data-tooltip": "Ajuda" }, undefined, {
    left: 40, top: 50, width: 150, height: 30,
  });
  h.dispatch("pointerover", { target, clientX: 70, clientY: 60 });
  h.advance(350);
  const position = { ...h.tooltip.style };
  assert.equal(position.left, "40px");
  assert.equal(position.top, "88px");
  h.dispatch("pointermove", { target, clientX: 170, clientY: 75 });
  h.flushFrames();
  assert.deepEqual(h.tooltip.style, position);
  assert.equal(h.frames.size, 0);
  const child = h.element({}, target);
  h.dispatch("pointerout", { target, relatedTarget: child });
  h.dispatch("pointerover", { target: child, clientX: 180, clientY: 78 });
  assert.deepEqual(h.tooltip.style, position, "Moving between descendants keeps the same anchor");
  h.unmount();
});

test("leaving the field closes immediately without keeping the portal open", () => {
  const h = createHarness();
  const target = h.element({ "data-tooltip": "Ajuda" });
  h.dispatch("pointerover", { target });
  h.advance(350);
  const portal = h.tooltip;
  h.dispatch("pointerout", { target, relatedTarget: portal });
  assert.equal(h.value, null);
  assert.equal(h.timers.size, 0);
  h.advance(1000);
  assert.equal(h.value, null);
  h.unmount();
});

for (const width of [240, 900]) {
  test(`tooltip clamps within a ${width}px viewport and keeps its 320px limit`, () => {
    const h = createHarness({ width, height: 300, tooltipHeight: 200 });
    const target = h.element({ "data-tooltip": "Explicação longa" });
    h.dispatch("pointerover", { target, clientX: width - 2, clientY: 150 });
    h.advance(350);
    const bounds = h.tooltip.getBoundingClientRect();
    assert.equal(parseFloat(h.tooltip.style.maxWidth), Math.min(320, width - 16));
    assert.ok(bounds.left >= 8 && bounds.right <= width - 8);
    assert.ok(bounds.top >= 8 && bounds.bottom <= 292);
    assert.equal(bounds.height, 200, "Use available viewport height before clipping the resolution");
    h.dispatch("pointermove", { target, clientX: 3, clientY: 295 });
    h.flushFrames();
    assert.ok(h.tooltip.getBoundingClientRect().bottom <= 292);
    h.unmount();
  });
}

test("content changes refresh the tooltip, target removal closes it and unmount cleans listeners", () => {
  const h = createHarness();
  const target = h.element({ "data-tooltip": "Antes" });
  h.dispatch("pointerover", { target });
  h.advance(350);
  target.setAttribute("data-tooltip", "Depois");
  h.mutate([{ type: "attributes" }]);
  assert.equal(h.value.child.props.children[1].props.children.join(""), "Depois");
  target.isConnected = false;
  h.mutate([{ type: "childList" }]);
  assert.equal(h.value, null);
  const next = h.element({ "data-tooltip": "Próximo" });
  h.dispatch("pointerover", { target: next });
  h.dispatch("pointermove", { target: next });
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.observers.size, 0);
  for (const surface of [h.document, h.window]) {
    assert.ok([...surface.listeners.values()].every((listeners) => listeners.size === 0));
  }
  h.advance(1000);
  assert.equal(h.settersAfterUnmount, 0);
});
