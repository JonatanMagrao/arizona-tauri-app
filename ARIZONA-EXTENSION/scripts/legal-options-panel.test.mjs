import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const panel = compile(readFileSync(new URL("../src/js/main/domains/ofertas/components/OffersPanel.tsx", import.meta.url), "utf8") +
  "\nexport { OfferLegalControlToggle as ToggleForTest };");
const tooltips = compile(readFileSync(new URL("../src/js/main/utils/tooltips.ts", import.meta.url), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const nodes = (element) => Array.isArray(element) ? element.flatMap(nodes)
  : element && typeof element === "object" ? [element, ...nodes(element.props?.children)] : [];

const context = (offerLayerIndex = 1, revision = "revision-1") => ({
  projectKey: "C:/job/current.aep", offersCompId: 10, offerLayerId: 100 + offerLayerIndex,
  offerLayerIndex, offerSourceId: 200 + offerLayerIndex, legalLayerId: 300 + offerLayerIndex,
  legalSourceId: 400 + offerLayerIndex, bannerLayerId: 500 + offerLayerIndex,
  bannerSourceId: 600 + offerLayerIndex, revision,
});
const banner = (patch = {}) => ({
  id: "tarja-eletro-pneu", label: "Eletro/Pneu", layerIndex: 6,
  enabled: false, available: true, locked: false, slider: null,
  optionGroup: { id: "eletro-pneu-menu", label: "Menu", type: "layers", enabled: true,
    selectedIndex: 1, context: context(), options: [
      { id: "71", label: "Eletro da oferta" }, { id: "72", label: "Pneu especial" }, { id: "73", label: "Texto adicional" },
    ] },
  ...patch,
});

// Keep React state/effect dependencies between renders so a rejected optimistic
// checkbox update cannot be hidden by a stateless component mock.
function harness(control = banner()) {
  const slots = [];
  const changes = [];
  let cursor = 0;
  let dirty = false;
  let pendingEffects = [];
  let output;
  let props = { control, offerLayerIndex: 1,
    onControlChange: (...args) => changes.push(["checkbox", ...args]),
    onControlOptionChange: (...args) => changes.push(["option", ...args]),
    onControlValueChange: (...args) => changes.push(["value", ...args]) };
  const changed = (previous, next) => !previous || !next || previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        dirty ||= !Object.is(next, slots[index].value);
        slots[index].value = next;
      }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (slots[index] && !changed(slots[index].dependencies, dependencies)) return;
      slots[index] = { dependencies, cleanup: slots[index]?.cleanup };
      pendingEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const tooltipModule = { exports: {} };
  vm.runInNewContext(tooltips, { module: tooltipModule, exports: tooltipModule.exports });
  const module = { exports: {} };
  vm.runInNewContext(panel, { module, exports: module.exports, require(specifier) {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") {
      const element = (type, elementProps, key) => ({ type, props: elementProps, key });
      return { jsx: element, jsxs: element };
    }
    if (specifier.endsWith("/utils/tooltips")) return tooltipModule.exports;
    return {};
  } });
  const render = (patch = {}) => {
    props = { ...props, ...patch };
    let attempts = 0;
    do {
      assert.ok(attempts++ < 20, "Component render did not settle");
      cursor = 0;
      dirty = false;
      output = module.exports.ToggleForTest(props);
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    } while (dirty);
    return output;
  };
  render();
  return { changes, render, get control() { return props.control; },
    get select() { return nodes(output).find((node) => node.type === "select"); },
    get checkbox() { return nodes(output).find((node) => node.type === "input" && node.props.type === "checkbox"); },
    get options() { return nodes(output).filter((node) => node.type === "option"); } };
}

test("legal dropdown displays the snapshot's layer names and order, sending the captured list context", () => {
  const h = harness();
  assert.deepEqual(h.options.map((option) => option.props.children), ["Eletro da oferta", "Pneu especial", "Texto adicional"]);
  assert.deepEqual(h.options.map((option) => option.key), ["71", "72", "73"]);
  assert.equal(h.select.props.value, 1);
  h.select.props.onChange({ currentTarget: { value: "2" } });
  assert.deepEqual(h.changes, [["option", 1, "tarja-eletro-pneu", 2, h.control.optionGroup.context]]);
});

test("adding, removing and reordering legal options refreshes the same row without reusing a previous index", () => {
  const h = harness();
  const oldSelect = h.select;
  const oldContext = h.control.optionGroup.context;
  const nextContext = context(1, "revision-2");
  const refreshed = banner({ optionGroup: { ...h.control.optionGroup, context: nextContext, selectedIndex: 2,
    options: [{ id: "73", label: "Texto adicional" }, { id: "74", label: "Novo texto" }, { id: "72", label: "Pneu especial" }] } });
  h.render({ control: refreshed });
  assert.deepEqual(h.options.map((option) => option.props.children), ["Texto adicional", "Novo texto", "Pneu especial"]);
  assert.equal(h.select.props.value, 2);
  oldSelect.props.onChange({ currentTarget: { value: "0" } });
  h.select.props.onChange({ currentTarget: { value: "1" } });
  assert.deepEqual(h.changes, [
    ["option", 1, "tarja-eletro-pneu", 0, oldContext],
    ["option", 1, "tarja-eletro-pneu", 1, nextContext],
  ], "An old event retains its old context so the host can reject it");
});

test("switching offers uses each precomp's own options, selected state and context", () => {
  const h = harness();
  const oldCheckbox = h.checkbox;
  const oldContext = h.control.optionGroup.context;
  const other = banner({ enabled: true, optionGroup: { ...h.control.optionGroup, context: context(2, "other-list"), selectedIndex: 0,
    options: [{ id: "88", label: "Texto exclusivo da segunda oferta" }] } });
  h.render({ control: other, offerLayerIndex: 2 });
  assert.deepEqual(h.options.map((option) => option.props.children), ["Texto exclusivo da segunda oferta"]);
  assert.equal(h.select.props.value, 0);
  assert.equal(h.checkbox.props.checked, true);
  h.select.props.onChange({ currentTarget: { value: "0" } });
  oldCheckbox.props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(h.changes, [
    ["option", 2, "tarja-eletro-pneu", 0, other.optionGroup.context],
    ["checkbox", 1, "tarja-eletro-pneu", true, oldContext],
  ]);
});

test("a rejected checkbox action stays faithful to the unchanged snapshot and an accepted refresh updates it", () => {
  const h = harness();
  h.checkbox.props.onChange({ currentTarget: { checked: true } });
  h.render({ control: plain(h.control) });
  assert.equal(h.checkbox.props.checked, false, "A rejection returning the previous enabled value must undo the visual click");
  assert.deepEqual(h.changes, [["checkbox", 1, "tarja-eletro-pneu", true, h.control.optionGroup.context]]);
  h.render({ control: { ...h.control, enabled: true } });
  assert.equal(h.checkbox.props.checked, true);
});

test("duplicate display names keep distinct keys and no selection uses the existing placeholder", () => {
  const value = banner();
  value.optionGroup.options = [{ id: "71", label: "Mesmo nome" }, { id: "72", label: "Mesmo nome" }];
  value.optionGroup.selectedIndex = -1;
  const h = harness(value);
  assert.equal(h.select.props.value, "");
  assert.equal(h.options[0].props.disabled, true);
  assert.deepEqual(h.options.slice(1).map((option) => option.key), ["71", "72"]);
  assert.deepEqual(h.options.slice(1).map((option) => option.props.value), [0, 1]);
});

test("an unavailable option list keeps its independent banner checkbox and context", () => {
  const value = banner();
  value.optionGroup.enabled = false;
  value.optionGroup.options = [];
  value.optionGroup.selectedIndex = -1;
  const h = harness(value);
  assert.equal(h.select.props.disabled, true);
  assert.equal(h.checkbox.props.disabled, false);
  h.checkbox.props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(h.changes, [["checkbox", 1, "tarja-eletro-pneu", true, value.optionGroup.context]]);
});

test("CPF retains its three-argument callback and follows confirmed checkbox state", () => {
  const h = harness({ id: "limitado-por-cpf", label: "Limitado por CPF", kind: "checkbox", layerIndex: 3,
    enabled: false, available: true, locked: false, slider: null, optionGroup: null });
  h.checkbox.props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(h.changes, [["checkbox", 1, "limitado-por-cpf", true]]);
  h.render();
  assert.equal(h.checkbox.props.checked, false);
  h.render({ control: { ...h.control, enabled: true } });
  assert.equal(h.checkbox.props.checked, true);
});
