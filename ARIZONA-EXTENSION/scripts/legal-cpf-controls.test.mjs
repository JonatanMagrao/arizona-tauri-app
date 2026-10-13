import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const domainDirectory = fileURLToPath(new URL(
  "../src/jsx/aeft/domains/ofertas/", import.meta.url
));
const serialize = (value) => JSON.parse(JSON.stringify(value));

// Simulate only the native AE objects. Readers, actions and DTO conversion use
// the production modules so the tests cover the complete legal-control path.
class Property {
  constructor(name, value, matchName = name) {
    this.name = name;
    this.matchName = matchName;
    this.value = value;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.writes = [];
  }
  setValue(value) {
    if (this.writeFailure) throw new Error("Native property write failed");
    this.value = value;
    this.writes.push(value);
  }
}

class PropertyGroup {
  constructor(name, properties = []) {
    this.name = name;
    this.properties = properties;
  }
  get numProperties() { return this.properties.length; }
  property(indexOrName) {
    return typeof indexOrName === "number"
      ? this.properties[indexOrName - 1] || null
      : this.properties.find((item) =>
        item.name === indexOrName || item.matchName === indexOrName
      ) || null;
  }
}

class AVLayer extends PropertyGroup {
  constructor(name, properties = [], source = null) {
    super(name, properties);
    this.source = source;
    this.enabled = true;
    this.selected = false;
    this.label = 1;
    this.startTime = 0;
  }
}

class TextLayer extends AVLayer {
  constructor(name, text, effects = []) {
    const sourceText = new Property("ADBE Text Document", { text });
    super(name, [
      new PropertyGroup("ADBE Text Properties", [sourceText]),
      new PropertyGroup("ADBE Effect Parade", effects),
    ]);
    this.text = { sourceText };
  }
}

class CompItem {
  constructor(name, layers) {
    this.name = name;
    this.layers = layers;
    layers.forEach((layer, index) => { layer.index = index + 1; });
  }
  get numLayers() { return this.layers.length; }
  layer(index) { return this.layers[index - 1] || null; }
}

const compiled = new Map();
function loadModule(filename, app, modules = new Map()) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  if (!compiled.has(filename)) {
    compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
  }
  vm.runInNewContext(compiled.get(filename), {
    module, exports: module.exports, app, AVLayer, TextLayer, CompItem,
    Property, PropertyGroup, PropertyValueType: { OneD: 1 }, Error,
    require(specifier) {
      assert.ok(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
      const base = path.resolve(path.dirname(filename), specifier);
      const target = [base, base + ".ts", base + ".js"].find(existsSync);
      assert.ok(target, `Missing dependency: ${specifier}`);
      return loadModule(target, app, modules);
    },
  }, { filename });
  return module.exports;
}

const effect = (name, value, matchName) =>
  new PropertyGroup(name, [new Property("Localized control", value, matchName)]);
const slider = (name, value) => effect(name, value, "ADBE Slider Control-0001");

function fixture({ reorder = false } = {}) {
  const effects = {
    legal: slider("Texto Legal", 2),
    checkbox: effect("Limitado por CPF", 0, "ADBE Checkbox Control-0001"),
    quantity: slider("Quantidade por CPF", 5),
    unit: effect("Unidade", 4, "ADBE Dropdown Control-0001"),
    unrelated: slider("Outro slider", 99),
  };
  const effectOrder = reorder
    ? [effects.unrelated, effects.unit, effects.quantity, effects.legal, effects.checkbox]
    : [effects.legal, effects.checkbox, effects.quantity, effects.unit, effects.unrelated];
  const legalLayer = new TextLayer("Texto Legal", "Texto existente", effectOrder);
  const validity = slider("Texto Validade", 3);
  const optionLayers = Array.from({ length: 9 }, (_, index) => new AVLayer(`Opcao ${index + 1}`));
  const legalSource = new CompItem("Texto Legal", [
    new AVLayer("Validade", [new PropertyGroup("ADBE Effect Parade", [validity])]),
    new AVLayer("Reserva"),
    legalLayer,
    new AVLayer("Selo leite"),
    new AVLayer("Selo moderacao"),
    new AVLayer("Eletro/Pneu", [], new CompItem("Opcoes", optionLayers)),
  ]);
  const offer = new AVLayer("Oferta_1", [], new CompItem("Oferta", [
    new AVLayer("Legal", [], legalSource),
  ]));
  offer.source.layer(1).comment = "TEXTO LEGAL";
  const miolo = new CompItem("Miolo", [offer]);
  const undo = { opened: 0, closed: 0 };
  const app = {
    project: { numItems: 1, item: () => miolo },
    beginUndoGroup() { undo.opened += 1; },
    endUndoGroup() { undo.closed += 1; },
  };
  const modules = new Map();
  const load = (relative) => loadModule(path.join(domainDirectory, relative), app, modules);
  return {
    effects, validity, legalLayer, legalSource, offer, optionLayers, undo,
    layers: load("layers/legalControls.ts"),
    actions: load("actions/legalControls.ts"),
    snapshot: load("snapshot/buildOfferSnapshot.ts"),
  };
}

const controlById = (env, id) =>
  env.layers.readLegalControls(env.legalSource, []).find((control) => control.id === id);
const propertyValues = (env) => Object.fromEntries(
  Object.entries(env.effects).map(([name, item]) => [name, item.property(1).value])
);
const assertUndoClosed = (env, count) =>
  assert.deepEqual(env.undo, { opened: count, closed: count });

test("reads the CPF controls immediately after Texto legal by effect name and native property identity", () => {
  for (const reorder of [false, true]) {
    const env = fixture({ reorder });
    env.effects.checkbox.property(1).value = 1;
    const controls = env.layers.readLegalControls(env.legalSource, []);
    const legalIndex = controls.findIndex((control) => control.id === "texto-legal");
    assert.deepEqual(serialize(controls.slice(legalIndex + 1, legalIndex + 3).map(({ id, kind, layerIndex }) =>
      ({ id, kind, layerIndex })
    )), [
      { id: "limitado-por-cpf", kind: "checkbox", layerIndex: 3 },
      { id: "quantidade-por-cpf", kind: "slider", layerIndex: 3 },
    ]);
    const checkbox = controlById(env, "limitado-por-cpf");
    const quantity = controlById(env, "quantidade-por-cpf");
    assert.equal(checkbox.available, true);
    assert.equal(checkbox.enabled, true);
    assert.equal(quantity.available, true);
    assert.equal(quantity.slider.value, "5");
    assert.equal(quantity.slider.property, env.effects.quantity.property(1));
    assert.equal(Object.values(env.effects).every((item) => item.property(1).writes.length === 0), true);
  }
});

test("missing or incompatible CPF effects do not fall back to another numeric property", () => {
  for (const [id, name] of [["limitado-por-cpf", "checkbox"], ["quantidade-por-cpf", "quantity"]]) {
    for (const invalidation of ["missing", "wrong-property"]) {
      const env = fixture({ reorder: true });
      if (invalidation === "missing") {
        const group = env.legalLayer.property("ADBE Effect Parade");
        group.properties = group.properties.filter((item) => item !== env.effects[name]);
      } else {
        env.effects[name].property(1).matchName = "ADBE Dropdown Control-0001";
      }
      const values = propertyValues(env);
      const control = controlById(env, id);
      assert.equal(control.available, false);
      if (control.slider) assert.equal(control.slider.enabled, false);
      const result = id === "limitado-por-cpf"
        ? env.actions.updateOfferLegalControl(1, id, true)
        : env.actions.updateOfferLegalControlValue(1, id, "8");
      assert.equal(result.ok, false);
      assert.deepEqual(propertyValues(env), values);
      assertUndoClosed(env, 1);
      const otherId = id === "limitado-por-cpf" ? "quantidade-por-cpf" : "limitado-por-cpf";
      assert.equal(controlById(env, otherId).available, true);
    }
  }
});

test("CPF checkbox writes native 1/0 without toggling legal-layer visibility or other effects", () => {
  const env = fixture({ reorder: true });
  const original = propertyValues(env);
  for (const enabled of [true, false, true]) {
    const result = env.actions.updateOfferLegalControl(1, "limitado-por-cpf", enabled);
    assert.equal(result.ok, true);
    assert.equal(result.selectedOfferLayerIndex, 1);
    assert.deepEqual(propertyValues(env), { ...original, checkbox: enabled ? 1 : 0 });
    assert.equal(controlById(env, "limitado-por-cpf").enabled, enabled);
    assert.equal(env.legalLayer.enabled, true);
  }
  assert.deepEqual(env.effects.checkbox.property(1).writes, [1, 0, 1]);
  assert.equal(env.legalLayer.text.sourceText.value.text, "Texto existente");
  assertUndoClosed(env, 3);
});

test("CPF quantity writes only its named slider and remains editable when the checkbox is unchecked", () => {
  const env = fixture({ reorder: true });
  const original = propertyValues(env);
  for (const value of [8, 0, 12]) {
    const result = env.actions.updateOfferLegalControlValue(1, "quantidade-por-cpf", String(value));
    assert.equal(result.ok, true);
    assert.deepEqual(propertyValues(env), { ...original, quantity: value });
    assert.equal(controlById(env, "quantidade-por-cpf").slider.value, String(value));
    assert.equal(env.legalLayer.enabled, true);
  }
  assert.deepEqual(env.effects.quantity.property(1).writes, [8, 0, 12]);
  assertUndoClosed(env, 3);
});

test("existing visibility, locked legal text, sliders and Eletro/Pneu options retain their behavior", () => {
  const env = fixture();
  assert.equal(env.actions.updateOfferLegalControl(1, "selo-leite", false).ok, true);
  assert.equal(env.legalSource.layer(4).enabled, false);
  assert.equal(env.actions.updateOfferLegalControl(1, "selo-moderacao", false).ok, true);
  assert.equal(env.legalSource.layer(5).enabled, false);
  assert.equal(env.actions.updateOfferLegalControl(1, "texto-legal", false).ok, false);
  assert.equal(env.legalLayer.enabled, true);
  assert.equal(env.actions.updateOfferLegalControlValue(1, "texto-legal", "6").ok, true);
  assert.equal(env.effects.legal.property(1).value, 6);
  assert.equal(env.actions.updateOfferLegalControlValue(1, "tarja-validade", "4").ok, true);
  assert.equal(env.validity.property(1).value, 4);
  assert.equal(env.actions.updateOfferLegalControlOption(1, "tarja-eletro-pneu", 2).ok, true);
  assert.deepEqual(env.optionLayers.slice(3).map((layer) => layer.enabled), [false, false, true, false, false, false]);
  assert.deepEqual(env.effects.checkbox.property(1).writes, []);
  assert.deepEqual(env.effects.quantity.property(1).writes, []);
  assertUndoClosed(env, 6);
});

test("invalid values and native CPF write failures return errors and always close the undo group", () => {
  const env = fixture();
  const original = propertyValues(env);
  const invalid = env.actions.updateOfferLegalControlValue(1, "quantidade-por-cpf", "invalido");
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length > 0);
  env.effects.checkbox.property(1).writeFailure = true;
  const checkbox = env.actions.updateOfferLegalControl(1, "limitado-por-cpf", true);
  assert.equal(checkbox.ok, false);
  assert.ok(checkbox.errors.length > 0);
  env.effects.quantity.property(1).writeFailure = true;
  const quantity = env.actions.updateOfferLegalControlValue(1, "quantidade-por-cpf", "8");
  assert.equal(quantity.ok, false);
  assert.ok(quantity.errors.length > 0);
  assert.deepEqual(propertyValues(env), original);
  assert.equal(env.legalLayer.enabled, true);
  assertUndoClosed(env, 3);
});

test("the public offer snapshot includes CPF state but never exposes native AE objects", () => {
  const env = fixture();
  env.effects.checkbox.property(1).value = 1;
  const snapshot = env.snapshot.getOffersEditorSnapshot(1);
  assert.equal(snapshot.ok, true);
  const controls = snapshot.selectedOffer.legalControls;
  const checkbox = controls.find((control) => control.id === "limitado-por-cpf");
  const quantity = controls.find((control) => control.id === "quantidade-por-cpf");
  assert.equal(checkbox.kind, "checkbox");
  assert.equal(checkbox.enabled, true);
  assert.equal(quantity.kind, "slider");
  assert.equal(quantity.slider.value, "5");
  function assertSerializable(value) {
    if (!value || typeof value !== "object") return;
    assert.equal(value instanceof Property || value instanceof PropertyGroup || value instanceof CompItem, false);
    for (const child of Object.values(value)) assertSerializable(child);
  }
  assertSerializable(snapshot);
  assert.deepEqual(serialize(snapshot.selectedOffer.legalText).value, "Texto existente");
  assertUndoClosed(env, 0);
});

test("the CPF checkbox and quantity share one settings row and keep independent update targets", () => {
  const source = readFileSync(new URL(
    "../src/js/main/domains/ofertas/components/OffersPanel.tsx", import.meta.url
  ), "utf8");
  const module = { exports: {} };
  const element = (type, props) => ({ type, props });
  const tooltipModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(
    readFileSync(new URL("../src/js/main/utils/tooltips.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText, { module: tooltipModule, exports: tooltipModule.exports });
  vm.runInNewContext(ts.transpileModule(
    source + "\nexport { OfferLegalSettingsDialog as SettingsForTest };",
    { compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    } }
  ).outputText, {
    module, exports: module.exports,
    window: { clearTimeout() {} },
    require(specifier) {
      if (specifier.endsWith("/utils/tooltips")) return tooltipModule.exports;
      if (specifier === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (specifier === "react") return {
        useState: (value) => [value, () => {}],
        useRef: (value) => ({ current: value }),
        useEffect() {},
      };
      return {};
    },
  });
  const env = fixture();
  const changes = [];
  const props = {
    controls: env.snapshot.getOffersEditorSnapshot(1).selectedOffer.legalControls,
    legalText: null,
    offerLayerIndex: 1,
    onClose() {},
    onControlChange: (...args) => changes.push(["checkbox", ...args]),
    onControlValueChange: (...args) => changes.push(["quantity", ...args]),
    onControlOptionChange() {},
  };
  const render = (node) => {
    if (Array.isArray(node)) return node.map(render);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return render(node.type(node.props));
    return { ...node, props: { ...node.props, children: render(node.props.children) } };
  };
  const flatten = (node) => {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!node || typeof node !== "object") return [];
    return [node, ...flatten(node.props.children)];
  };
  const nodes = flatten(render(module.exports.SettingsForTest(props)));
  const rows = nodes.filter((node) => node.props.className?.split(" ").includes("offer-legal-toggle"));
  assert.equal(rows.length, 6);
  const cpfRows = rows.filter((row) => flatten(row).some((node) =>
    node.props["aria-label"] === "Limitado por CPF"
  ));
  assert.equal(cpfRows.length, 1);
  const inputs = flatten(cpfRows[0]).filter((node) => node.type === "input");
  assert.deepEqual(inputs.map((node) => node.props.type), ["checkbox", "number"]);
  assert.equal(inputs[0].props.checked, false);
  assert.equal(inputs[1].props["aria-label"], "Quantidade por CPF");
  assert.equal(inputs[1].props.value, "5");
  inputs[0].props.onChange({ currentTarget: { checked: true } });
  inputs[1].props.onBlur({ currentTarget: { value: "12" } });
  assert.deepEqual(changes, [
    ["checkbox", 1, "limitado-por-cpf", true],
    ["quantity", 1, "quantidade-por-cpf", "12"],
  ]);
});
