import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const mechanicsDirectory = fileURLToPath(new URL(
  "../src/jsx/aeft/domains/ofertas/mechanics/",
  import.meta.url
));
const identity = "DE X POR Y MEU CRF POR Z CARTAO CRF";
const serialize = (value) => JSON.parse(JSON.stringify(value));
const schemaFilePath = "C:/extension/js/assets/schema.json";
const schemaBinary = readFileSync(new URL("../src/js/assets/schema.json", import.meta.url)).toString("latin1");
class File {
  constructor(filePath) { this.fsName = filePath; this.exists = filePath === schemaFilePath; this.error = ""; this.encoding = ""; }
  get length() { return schemaBinary.length; }
  open(mode) { return this.exists && mode === "r"; }
  seek(offset) { return offset === 0; }
  read() { assert.equal(this.encoding, "BINARY"); return schemaBinary; }
  close() { return true; }
}

// Only the After Effects host objects are simulated; readers and field/option
// helpers below are loaded from the production modules.
class Property {
  constructor(name, value, isDropdownEffect = false) {
    this.name = name;
    this.currentValue = value;
    this.isDropdownEffect = isDropdownEffect;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.writes = [];
  }
  get value() { return serialize(this.currentValue); }
  setValue(value) {
    this.currentValue = serialize(value);
    this.writes.push(serialize(value));
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
      : this.properties.find((item) => item.name === indexOrName) || null;
  }
}

class AVLayer extends PropertyGroup {
  constructor(name, properties = [], source = null) {
    super(name, properties);
    this.source = source;
    this.comment = "";
    this.containingComp = null;
    this.currentStartTime = 0;
    this.inPointOffset = 0;
    this.marker = new MarkerProperty([]);
  }
  get index() { return this.containingComp?.layers.indexOf(this) + 1 || 0; }
  get startTime() { return this.currentStartTime; }
  set startTime(value) { this.currentStartTime = value; }
  get inPoint() { return this.currentStartTime + this.inPointOffset; }
  set inPoint(value) { this.inPointOffset = value - this.currentStartTime; }
}

class MarkerProperty {
  constructor(times) { this.times = [...times]; }
  get numKeys() { return this.times.length; }
  keyTime(index) {
    assert.ok(index >= 1 && index <= this.numKeys, "Invalid marker index");
    return this.times[index - 1];
  }
}

class TextLayer extends AVLayer {
  constructor(name, value) {
    const sourceText = new Property("ADBE Text Document", { text: value });
    super(name, [new PropertyGroup("ADBE Text Properties", [sourceText])]);
    this.text = { sourceText };
  }
}

class CompItem {
  constructor(layers, name = "Precomp personalizada", comment = identity) {
    this.layers = layers;
    for (const layer of layers) layer.containingComp = this;
    this.name = name;
    this.comment = comment;
    this.duration = 12;
  }
  get numLayers() { return this.layers.length; }
  layer(indexOrName) {
    const layer = typeof indexOrName === "number"
      ? this.layers[indexOrName - 1] || null
      : this.layers.find((item) => item.name === indexOrName) || null;
    if (layer) layer.containingComp = this;
    return layer;
  }
}

const modules = new Map();
function loadModule(filename, moduleCache = modules, nameFallback = false) {
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const javaScript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(javaScript, {
    module,
    exports: module.exports,
    AVLayer,
    TextLayer,
    CompItem,
    Property,
    PropertyGroup,
    File,
    PropertyValueType: { OneD: 1 },
    require(specifier) {
      assert.ok(specifier.startsWith("."), `Unexpected external dependency: ${specifier}`);
      const base = path.resolve(path.dirname(filename), specifier);
      const target = [base, base + ".ts", base + ".js"].find(existsSync);
      assert.ok(target, `Missing dependency: ${specifier}`);
      return loadModule(target, moduleCache, nameFallback);
    },
  }, { filename });
  if (filename === path.join(mechanicsDirectory, "config.ts") && typeof nameFallback === "boolean") {
    module.exports.MECHANIC_LAYER_NAME_FALLBACK_ENABLED = nameFallback;
  }
  if (filename === path.join(mechanicsDirectory, "schemaRuntime.ts")) {
    module.exports.configureMechanicsSchemaPath(schemaFilePath);
  }
  return module.exports;
}

const { readMeuCrfCardMechanic, applyMeuCrfCardJump, MEU_CRF_CARD_MECHANIC_TYPE } =
  loadModule(path.join(mechanicsDirectory, "meuCrfCartao.ts"));
const { readMechanic } = loadModule(path.join(mechanicsDirectory, "registry.ts"));
const { setFieldValue } = loadModule(path.resolve(mechanicsDirectory, "../layers/textFields.ts"));
const { applyOptionGroupSelection } = loadModule(path.join(mechanicsDirectory, "shared.ts"));

const unitEffect = (value = 1, dropdown = true, name = "Unidade") =>
  new PropertyGroup(name, [new Property("Menu", value, dropdown)]);
const identified = (layer, comment) => Object.assign(layer, { comment });
const controller = (effects) =>
  identified(
    new AVLayer("Controlador de Mecânica", [new PropertyGroup("ADBE Effect Parade", effects)]),
    "CONTROLADOR DE MECANICA"
  );

function fixture({ controllerIndex = 5, effects = [unitEffect(3)] } = {}) {
  const textLayers = [
    identified(new TextLayer("PRECO DE", "15,90"), "PRECO DE"),
    identified(new TextLayer("PRECO POR", "12,90"), "PRECO POR"),
    identified(new TextLayer("PRECO POR CARTAO", "10,90"), "PRECO POR CARTAO"),
  ];
  const markerLayer = identified(new AVLayer("Marcadores"), "MARCADORES");
  markerLayer.marker = new MarkerProperty([1.25, 5, 8]);
  const meuCrfJump = identified(new AVLayer("PULO PREÇO MEU CRF"), "PULO PRECO MEU CRF");
  const cardJump = identified(new AVLayer("PULO PREÇO CARTAO CRF"), "PULO PRECO CARTAO CRF");
  meuCrfJump.startTime = 2;
  meuCrfJump.inPoint = 2.5;
  cardJump.startTime = 4;
  cardJump.inPoint = 5;
  const layers = [markerLayer, meuCrfJump, cardJump, ...textLayers];
  while (layers.length < controllerIndex - 1) layers.push(new AVLayer("Decoracao"));
  const controllerLayer = controller(effects);
  layers.splice(controllerIndex - 1, 0, controllerLayer);
  const source = new CompItem(layers);
  return {
    source,
    textLayers,
    controllerLayer,
    markerLayer,
    meuCrfJump,
    cardJump,
    valueLayer: new AVLayer("Nome da layer independente", [], source),
  };
}

test("recognizes source comments independently of the composition and timeline names", () => {
  const { valueLayer } = fixture();
  const errors = [];
  const mechanic = readMechanic(valueLayer, errors);
  assert.equal(mechanic.type, "De X Por Y Meu CRF Por Z Cartao CRF");
  assert.equal(mechanic.unsupported, undefined);
  assert.deepEqual(errors, []);
});

test("keeps name fallback and duplicated precomps without accepting nearby identities", () => {
  const { source, valueLayer } = fixture();
  source.comment = "";
  source.name = identity + " 2";
  assert.equal(readMechanic(valueLayer, []).type, "De X Por Y Meu CRF Por Z Cartao CRF");
  source.comment = identity;
  source.name = "SIMPLES";
  assert.equal(readMechanic(valueLayer, []).type, "De X Por Y Meu CRF Por Z Cartao CRF");
  source.comment = identity + " OUTRA";
  source.name = "Nao mapeada";
  valueLayer.name = identity;
  assert.equal(readMechanic(valueLayer, []).unsupported, true);
});

test("reads and writes the three independent Source Text prices", () => {
  const { valueLayer, textLayers } = fixture();
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(valueLayer, errors);
  assert.deepEqual(serialize(mechanic.fields.map(({ id, label, value, format, enabled }) => ({ id, label, value, format, enabled }))), [
    { id: "preco-de", label: "De", value: "15,90", format: "price", enabled: true },
    { id: "preco-por", label: "Por", value: "12,90", format: "price", enabled: true },
    { id: "preco-por-cartao", label: "Por cartão", value: "10,90", format: "price", enabled: true },
  ]);
  const expected = ["15,90", "12,90", "10,90"];
  ["18,50", "14,75", "11,25"].forEach((value, index) => {
    setFieldValue(mechanic.fields[index], value);
    expected[index] = value;
    assert.deepEqual(textLayers.map((layer) => layer.text.sourceText.value.text), expected);
  });
  assert.deepEqual(errors, []);
});

test("finds Unidade only on the identified controller after reordering and maps choices to AE values 1 through 4", () => {
  for (const controllerIndex of [1, 5, 9]) {
    const effect = unitEffect(3);
    const property = effect.property(1);
    const unrelated = unitEffect(4, true, "Outro menu");
    const { source, valueLayer, controllerLayer } = fixture({ controllerIndex, effects: [unrelated, effect] });
    controllerLayer.name = "Controladora renomeada";
    const decoy = unitEffect(4);
    source.layers.unshift(new AVLayer("Outra camada", [new PropertyGroup("ADBE Effect Parade", [decoy])]));
    const errors = [];
    const mechanic = readMeuCrfCardMechanic(valueLayer, errors);
    const group = mechanic.optionGroups[0];
    assert.equal(group.enabled, true);
    assert.equal(group.selectedIndex, 2);
    assert.deepEqual(serialize(group.options), [
      { label: "Cada" }, { label: "Kg" }, { label: "A cada 100g" }, { label: "Kg/cada" },
    ]);
    for (let selectedIndex = 0; selectedIndex < 4; selectedIndex += 1) {
      applyOptionGroupSelection(group, selectedIndex);
      assert.equal(property.value, selectedIndex + 1);
      assert.equal(readMeuCrfCardMechanic(valueLayer, []).optionGroups[0].selectedIndex, selectedIndex);
    }
    assert.deepEqual(property.writes, [1, 2, 3, 4]);
    assert.deepEqual(unrelated.property(1).writes, []);
    assert.deepEqual(decoy.property(1).writes, []);
    assert.deepEqual(errors, []);
  }
});

test("missing Unidade or a slider with the same name disables only the unit control", () => {
  for (const effects of [[], [unitEffect(2, false)], [unitEffect(2, true, "Outro menu")]]) {
    const { valueLayer } = fixture({ effects });
    const errors = [];
    const mechanic = readMeuCrfCardMechanic(valueLayer, errors);
    assert.equal(mechanic.optionGroups[0].enabled, false);
    assert.equal(mechanic.optionGroups[0].controllerProperty, null);
    assert.equal(mechanic.fields.every((field) => field.enabled), true);
    assert.ok(errors.length > 0);
    for (const effect of effects) assert.deepEqual(effect.property(1).writes, []);
  }
});

test("ambiguous Unidade dropdowns on the identified controller are not selected arbitrarily", () => {
  const first = unitEffect(1);
  const second = unitEffect(4);
  const { valueLayer } = fixture({ effects: [first, second] });
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(valueLayer, errors);
  assert.equal(mechanic.optionGroups[0].enabled, false);
  assert.equal(mechanic.optionGroups[0].controllerProperty, null);
  assert.ok(errors.length > 0);
  assert.deepEqual(first.property(1).writes, []);
  assert.deepEqual(second.property(1).writes, []);
});

test("missing or ambiguous controller comments disable the unit without searching other layers", () => {
  for (const invalidate of [
    (env) => { env.controllerLayer.comment = ""; },
    (env) => { env.source.layers = env.source.layers.filter((layer) => layer !== env.controllerLayer); },
    (env) => { env.source.layers.push(controller([unitEffect(4)])); },
  ]) {
    const env = fixture();
    const originalUnit = env.controllerLayer.property("ADBE Effect Parade").property(1).property(1);
    const decoy = unitEffect(4);
    env.source.layers.push(new AVLayer("Outra camada", [new PropertyGroup("ADBE Effect Parade", [decoy])]));
    invalidate(env);
    const errors = [];
    const mechanic = readMeuCrfCardMechanic(env.valueLayer, errors);
    assert.equal(mechanic.optionGroups[0].enabled, false);
    assert.equal(mechanic.fields.every((field) => field.enabled), true);
    assert.equal(mechanic.installmentJump.enabled, true);
    assert.ok(errors.some((error) => error.includes("CONTROLADOR DE MECANICA")));
    assert.deepEqual(originalUnit.writes, []);
    assert.deepEqual(decoy.property(1).writes, []);
  }
});

test("duplicate price comments disable the affected price without choosing a valid name instead", () => {
  const env = fixture();
  const duplicate = identified(new TextLayer("Outro preço", "99,90"), "PRECO POR");
  env.source.layers.push(duplicate);
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(env.valueLayer, errors);
  assert.deepEqual(serialize(mechanic.fields.map((field) => field.enabled)), [true, false, true]);
  assert.ok(errors.some((error) => error.includes("PRECO POR")));
  assert.deepEqual(duplicate.text.sourceText.writes, []);
  assert.deepEqual(env.textLayers[1].text.sourceText.writes, []);
});

test("the disabled name fallback requires all seven comments despite legacy layer names", () => {
  const env = fixture();
  for (const layer of env.source.layers) layer.comment = "";
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(env.valueLayer, errors);
  assert.equal(mechanic.fields.every((field) => !field.enabled), true);
  assert.equal(mechanic.optionGroups[0].enabled, false);
  assert.equal(mechanic.installmentJump.enabled, false);
  for (const comment of [
    "CONTROLADOR DE MECANICA", "MARCADORES", "PULO PRECO MEU CRF",
    "PULO PRECO CARTAO CRF", "PRECO DE", "PRECO POR", "PRECO POR CARTAO",
  ]) assert.ok(errors.some((error) => error.includes('"' + comment + '"')));
});

test("enabling name fallback independently supports both legacy and new aliases", () => {
  const fallbackReader = loadModule(path.join(mechanicsDirectory, "meuCrfCartao.ts"), new Map(), true);
  for (const useNewNames of [false, true]) {
    const env = jumpFixture();
    for (const layer of env.source.layers) layer.comment = "";
    if (useNewNames) {
      env.controllerLayer.name = "CONTROLADOR DE MECANICA";
      env.meuCrfJump.name = "PULO PRECO MEU CRF";
      env.cardJump.name = "PULO PRECO CARTAO CRF";
    }
    env.source.layers.reverse();
    const errors = [];
    const mechanic = fallbackReader.readMeuCrfCardMechanic(env.valueLayer, errors);
    assert.equal(mechanic.fields.every((field) => field.enabled), true);
    assert.equal(mechanic.optionGroups[0].enabled, true);
    assert.equal(mechanic.installmentJump.enabled, true);
    fallbackReader.applyMeuCrfCardJump(env.product, "preco-cheio");
    assert.deepEqual(jumpPositions(env).map((layer) => layer.inPoint), [5, env.source.duration]);
    assert.deepEqual(errors, []);
    assert.equal(readMeuCrfCardMechanic(env.valueLayer, []).installmentJump.enabled, false);
  }
});

test("comment matches override fallback names and duplicate comments still fail with fallback enabled", () => {
  const fallbackReader = loadModule(path.join(mechanicsDirectory, "meuCrfCartao.ts"), new Map(), true);
  const env = fixture();
  env.textLayers[1].name = "Preço renomeado";
  const decoy = new TextLayer("PRECO POR", "99,90");
  env.source.layers.unshift(decoy);
  const errors = [];
  const mechanic = fallbackReader.readMeuCrfCardMechanic(env.valueLayer, errors);
  assert.equal(mechanic.fields[1].value, "12,90");
  setFieldValue(mechanic.fields[1], "14,75");
  assert.equal(env.textLayers[1].text.sourceText.value.text, "14,75");
  assert.deepEqual(decoy.text.sourceText.writes, []);
  assert.deepEqual(errors, []);
  decoy.comment = "PRECO POR";
  assert.equal(fallbackReader.readMeuCrfCardMechanic(env.valueLayer, []).fields[1].enabled, false);
});

test("missing card price does not prevent editing the other prices or the unit", () => {
  const { source, valueLayer } = fixture();
  source.layers = source.layers.filter((layer) => layer.name !== "PRECO POR CARTAO");
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(valueLayer, errors);
  assert.deepEqual(serialize(mechanic.fields.map((field) => field.enabled)), [true, true, false]);
  assert.equal(mechanic.optionGroups[0].enabled, true);
  assert.ok(errors.some((error) => error.includes("PRECO POR CARTAO")));
});

test("missing composition produces disabled fields and a recoverable error", () => {
  const errors = [];
  const mechanic = readMeuCrfCardMechanic(new AVLayer("Sem source"), errors);
  assert.equal(mechanic.fields.every((field) => !field.enabled), true);
  assert.equal(mechanic.optionGroups[0].enabled, false);
  assert.ok(errors.length > 0);
});

function jumpFixture() {
  const env = fixture();
  return {
    ...env,
    product: { mechanicLayer: env.valueLayer },
  };
}

const jumpPositions = (env) => [env.meuCrfJump, env.cardJump].map((layer) => ({
  startTime: layer.startTime,
  inPoint: layer.inPoint,
}));

test("Jump reads both destinations and moves only their layers to the second marker", () => {
  const env = jumpFixture();
  const originalPrices = env.textLayers.map((layer) => layer.text.sourceText.value.text);
  assert.equal(MEU_CRF_CARD_MECHANIC_TYPE, "De X Por Y Meu CRF Por Z Cartao CRF");
  assert.deepEqual(serialize(readMeuCrfCardMechanic(env.valueLayer, []).installmentJump), {
    selectedTarget: "preco-parcela",
    enabled: true,
  });

  for (const target of ["preco-cheio", "preco-parcela", "preco-cheio"]) {
    const before = jumpPositions(env);
    const targetInPoints = target === "preco-cheio" ? [5, env.source.duration] : [env.source.duration, 5];
    applyMeuCrfCardJump(env.product, target);
    const after = jumpPositions(env);
    assert.deepEqual(after.map((layer) => layer.inPoint), targetInPoints);
    assert.deepEqual(after.map((layer) => layer.startTime), before.map((layer, index) =>
      layer.startTime + targetInPoints[index] - layer.inPoint
    ));
    const mechanic = readMeuCrfCardMechanic(env.valueLayer, []);
    assert.deepEqual(serialize(mechanic.installmentJump), { selectedTarget: target, enabled: true });
    assert.deepEqual(serialize(mechanic.fields.map((field) => field.value)), originalPrices);
    assert.equal(mechanic.optionGroups[0].selectedIndex, 2);
    assert.deepEqual(mechanic.optionGroups[0].controllerProperty.writes, []);
    assert.deepEqual(env.markerLayer.marker.times, [1.25, 5, 8]);
    assert.equal(env.markerLayer.startTime, 0);
    for (const layer of env.textLayers) {
      assert.equal(layer.startTime, 0);
      assert.deepEqual(layer.text.sourceText.writes, []);
    }
  }
});

test("Jump accepts renamed and reordered layers when their comments remain valid", () => {
  const env = jumpFixture();
  for (const layer of env.source.layers) layer.name = "Camada renomeada " + layer.index;
  env.source.layers.reverse();
  const errors = [];
  assert.equal(readMeuCrfCardMechanic(env.valueLayer, errors).installmentJump.enabled, true);
  applyMeuCrfCardJump(env.product, "preco-cheio");
  assert.deepEqual(jumpPositions(env).map((layer) => layer.inPoint), [5, env.source.duration]);
  assert.deepEqual(errors, []);
});

test("Jump rejects missing or duplicate comments and invalid second markers before moving anything", () => {
  const invalidStructures = [
    (env) => { env.markerLayer.comment = ""; },
    (env) => { env.meuCrfJump.comment = ""; },
    (env) => { env.cardJump.comment = ""; },
    (env) => { env.cardJump.comment = "PULO PRECO MEU CARTAO CRF"; },
    (env) => { env.source.layers.push(identified(new AVLayer("Copia"), env.cardJump.comment)); },
    (env) => { env.source.layers = env.source.layers.filter((layer) => layer !== env.cardJump); },
    (env) => { env.markerLayer.marker = new MarkerProperty([1.25]); },
    (env) => { env.markerLayer.marker = new MarkerProperty([]); },
    (env) => { env.markerLayer.marker = new MarkerProperty([1.25, NaN]); },
  ];
  for (const invalidate of invalidStructures) {
    const env = jumpFixture();
    invalidate(env);
    const positions = jumpPositions(env);
    const errors = [];
    const mechanic = readMeuCrfCardMechanic(env.valueLayer, errors);
    assert.equal(mechanic.installmentJump.enabled, false);
    assert.equal(mechanic.fields.every((field) => field.enabled), true);
    assert.equal(mechanic.optionGroups[0].enabled, true);
    assert.ok(errors.length > 0);
    assert.throws(() => applyMeuCrfCardJump(env.product, "preco-cheio"), /camada|Marker/);
    assert.deepEqual(jumpPositions(env), positions);
  }
});

test("Jump rejects invalid targets and unavailable compositions without modifying layer timing", () => {
  const env = jumpFixture();
  const positions = jumpPositions(env);
  assert.throws(() => applyMeuCrfCardJump(env.product, "outro"), /Jump invalido/);
  assert.throws(() => applyMeuCrfCardJump({ mechanicLayer: null }, "preco-cheio"), /Precomp/);
  assert.throws(() => applyMeuCrfCardJump({ mechanicLayer: new AVLayer("Sem source") }, "preco-parcela"), /Precomp/);
  assert.deepEqual(jumpPositions(env), positions);
  assert.equal(readMeuCrfCardMechanic(new AVLayer("Sem source"), []).installmentJump.enabled, false);
});
