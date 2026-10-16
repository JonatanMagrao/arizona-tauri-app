import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTemplateTestAssets } from "./template-test-assets.mjs";

const mechanicsDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/mechanics/", import.meta.url));
const schemaPath = fileURLToPath(new URL("../src/js/assets/schema.json", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const approvedSchema = () => JSON.parse(readFileSync(schemaPath, "utf8"));
const SIMPLE = "SIMPLES";
const INSTALLMENT = "DE X POR Y PARCELAMENTO";
const CARD = "DE X POR Y MEU CRF POR Z CARTAO CRF";
const COMBINED = "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y";

// Only native host objects are mocked. Configuration validation, readers,
// mutation helpers, public actions and snapshot serialization are production code.
class Property {
  constructor(name, value, dropdown = false) {
    this.name = this.matchName = name;
    this.currentValue = value;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.isDropdownEffect = dropdown;
    this.writes = [];
  }
  get value() { return plain(this.currentValue); }
  setValue(value) { this.currentValue = plain(value); this.writes.push(plain(value)); }
}

class PropertyGroup {
  constructor(name, properties = []) { this.name = name; this.properties = properties; }
  get numProperties() { return this.properties.length; }
  property(indexOrName) {
    return typeof indexOrName === "number"
      ? this.properties[indexOrName - 1] || null
      : this.properties.find((item) => item.name === indexOrName) || null;
  }
}

class MarkerProperty {
  constructor(times = []) { this.times = [...times]; }
  get numKeys() { return this.times.length; }
  keyTime(index) {
    assert.ok(index >= 1 && index <= this.times.length);
    return this.times[index - 1];
  }
}

class AVLayer extends PropertyGroup {
  constructor(name, properties = [], source = null) {
    super(name, properties);
    this.source = source;
    this.comment = "";
    this.enabled = true;
    this.selected = false;
    this.label = 1;
    this.startTime = 0;
    this.inPointOffset = 0;
    this.marker = new MarkerProperty();
  }
  get index() { return this.containingComp?.layers.indexOf(this) + 1 || 0; }
  get inPoint() { return this.startTime + this.inPointOffset; }
  set inPoint(value) { this.inPointOffset = value - this.startTime; }
}

class TextLayer extends AVLayer {
  constructor(name, value) {
    const sourceText = new Property("ADBE Text Document", { text: value });
    super(name, [new PropertyGroup("ADBE Text Properties", [sourceText])]);
    this.text = { sourceText };
  }
}

class CompItem {
  constructor(layers, name = "Nome livre", comment = "") {
    this.layers = layers;
    this.name = name;
    this.comment = comment;
    this.duration = 14;
    this.frameDuration = 1 / 30;
    layers.forEach((layer) => { layer.containingComp = this; });
  }
  get numLayers() { return this.layers.length; }
  get selectedLayers() { return this.layers.filter((layer) => layer.selected); }
  layer(indexOrName) {
    const layer = typeof indexOrName === "number"
      ? this.layers[indexOrName - 1] || null
      : this.layers.find((item) => item.name === indexOrName) || null;
    if (layer) layer.containingComp = this;
    return layer;
  }
}

class FootageItem {
  constructor() { this.name = "Produto"; this.file = null; }
}

const identified = (layer, comment) => Object.assign(layer, { comment });
const text = (comment, value = "19,90") => identified(new TextLayer("Texto livre", value), comment);
const effect = (name, value = 1, dropdown = true) => new PropertyGroup(name, [new Property("Menu", value, dropdown)]);
const effectValue = (item) => item.property(1);
const controller = (effects, comment = "CONTROLADOR DE MECANICA") => identified(
  new AVLayer("Controladora livre", [new PropertyGroup("ADBE Effect Parade", effects)]), comment
);
const envFor = (identity, layers) => {
  const source = new CompItem(layers, "Nome livre da precomp", identity);
  return { source, valueLayer: new AVLayer("Valor", [], source) };
};

function harness(schema = approvedSchema()) {
  const templateAssets = createTemplateTestAssets({ mechanicLayers: false });
  const modules = new Map();
  const app = {
    project: null,
    undoEvents: [],
    beginUndoGroup(name) { this.undoEvents.push(["begin", name]); },
    endUndoGroup() { this.undoEvents.push(["end"]); },
  };
  const schemaFilePath = "C:/extension/js/assets/schema.json";
  const schemaFile = { bytes: Buffer.from(JSON.stringify(schema), "utf8"), exists: true, readable: true, reads: 0 };
  class File {
    constructor(filePath) { this.fsName = filePath; this.encoding = ""; this.error = ""; }
    get length() { return schemaFile.bytes.length; }
    get exists() { return this.fsName === schemaFilePath && schemaFile.exists; }
    open(mode) { return this.exists && schemaFile.readable && mode === "r"; }
    seek(offset) { return offset === 0; }
    read() { assert.equal(this.encoding, "BINARY"); schemaFile.reads += 1; return schemaFile.bytes.toString("latin1"); }
    close() { return true; }
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const javaScript = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(javaScript, {
      module, exports: module.exports, app,
      AVLayer, TextLayer, CompItem, FootageItem, Property, PropertyGroup, File: templateAssets.wrapFile(File),
      PropertyValueType: { OneD: 1 },
      require(specifier) {
        assert.ok(specifier.startsWith("."), `Unexpected runtime dependency: ${specifier}`);
        const base = path.resolve(path.dirname(filename), specifier);
        const target = [base, base + ".ts", base + ".js"].find((candidate) => modules.has(candidate) || existsSync(candidate));
        assert.ok(target, `Missing dependency: ${specifier}`);
        return load(target);
      },
    }, { filename });
    if (filename === path.resolve(mechanicsDirectory, "../../template/templateIdentities.ts")) {
      module.exports.configureTemplateIdentitiesPath(templateAssets.filePath);
    }
    return module.exports;
  }
  const engine = load(path.join(mechanicsDirectory, "schemaBindings.ts"));
  const actions = load(path.resolve(mechanicsDirectory, "../actions/updateOption.ts"));
  const fields = load(path.resolve(mechanicsDirectory, "../actions/updateField.ts"));
  const snapshots = load(path.resolve(mechanicsDirectory, "../snapshot/buildOfferSnapshot.ts"));
  const validation = load(path.join(mechanicsDirectory, "schemaValidation.ts"));
  const runtime = load(path.join(mechanicsDirectory, "schemaRuntime.ts"));
  runtime.configureMechanicsSchemaPath(schemaFilePath);
  return { app, load, schemaFile, templateAssets, ...runtime, ...engine, ...actions, ...fields, ...snapshots, ...validation };
}

function mountOffer(h, env) {
  const legalText = new TextLayer("Texto legal", "Oferta válida.");
  legalText.properties.push(new PropertyGroup("ADBE Effect Parade", [effect("Ajuste", 80, false)]));
  const legal = new CompItem([
    controller([effect("Validade", 12, false)]), new AVLayer("Fundo"), legalText,
    new AVLayer("Leite"), new AVLayer("Moderação"),
    new AVLayer("Eletro", [], new CompItem(Array.from({ length: 9 }, (_, index) => new AVLayer("Opção " + index)))),
  ], "Legal");
  const source = new CompItem([
    new AVLayer("Legal", [], legal),
    new AVLayer("DESCRITIVO 1", [], new CompItem([new TextLayer("DESCRITIVO", "PRODUTO")], "Descrição")),
    env.valueLayer,
    new AVLayer("Produto", [], new FootageItem()),
  ], "Oferta");
  for (const [index, comment] of [[1, "TEXTO LEGAL"], [2, "DESCRITIVO 1"], [3, "MECANICA 1"], [4, "PRODUTO 1"]]) {
    source.layer(index).comment = comment;
  }
  const miolo = new CompItem([new AVLayer("Oferta_01", [], source)], "Miolo");
  miolo.layer(1).comment = "CAMADA OFERTA 01";
  h.app.project = { numItems: 1, item: () => miolo };
  return miolo;
}

function simpleEnv() {
  const price = text("PRECO", "15,90");
  const unit = effect("Unidade", 2);
  const control = controller([unit]);
  return { ...envFor(SIMPLE, [price, control]), price, control, unit };
}

function installmentEnv(conditionName = "Condição") {
  const condition = effect(conditionName, 4);
  const control = controller([effect("Decorativo", 91, false), effect("Outro", 92, false), condition]);
  const marker = identified(new AVLayer("Marcadores livres"), "MARCADORES");
  marker.marker = new MarkerProperty([1, 5, 10]);
  const primary = identified(new AVLayer("Salto cheio livre"), "PULO PRECO CHEIO");
  const alternate = identified(new AVLayer("Salto parcela livre"), "PULO PARCELA");
  primary.startTime = 1;
  primary.inPoint = 1.4;
  alternate.startTime = 4;
  alternate.inPoint = 4.8;
  const fields = [text("PRECO DE", "199,90"), text("PRECO", "179,90"), text("PRECO PARCELA", "59,97"), text("NUMERO DE PARCELAS", "3")];
  return { ...envFor(INSTALLMENT, [marker, primary, alternate, control, ...fields]), condition, control, marker, primary, alternate };
}

function cardEnv(unitName = "Unidade") {
  const unit = effect(unitName, 3);
  const control = controller([effect("Não é a unidade", 77), effect(unitName, 88, false), unit]);
  const marker = identified(new AVLayer("Marcadores livres"), "MARCADORES");
  marker.marker = new MarkerProperty([1, 5, 10]);
  const primary = identified(new AVLayer("Salto meu livre"), "PULO PRECO MEU CRF");
  const alternate = identified(new AVLayer("Salto cartão livre"), "PULO PRECO CARTAO CRF");
  primary.startTime = 1;
  primary.inPoint = 1.4;
  alternate.startTime = 4;
  alternate.inPoint = 4.8;
  return {
    ...envFor(CARD, [marker, primary, alternate, control, text("PRECO DE"), text("PRECO POR"), text("PRECO POR CARTAO")]),
    unit, control, marker, primary, alternate,
  };
}

function combinedEnv() {
  const quantity = effect("Quantidade X", 6, false);
  const control = controller([effect("Tipo", 3), effect("Subtipo", 3), effect("Unidade", 4), quantity]);
  const marker = identified(new AVLayer("Marcadores livres"), "MARCADORES");
  marker.marker = new MarkerProperty([1, 5, 10]);
  const primary = identified(new AVLayer("Salto cheio livre"), "PULO PRECO CHEIO");
  const alternate = identified(new AVLayer("Salto por livre"), "PULO");
  primary.startTime = 1;
  primary.inPoint = 1.4;
  alternate.startTime = 4;
  alternate.inPoint = 4.8;
  return {
    ...envFor(COMBINED, [marker, primary, alternate, control, text("PRECO DE"), text("PRECO POR"), text("PORCENTAGEM DESCONTO", "15")]),
    quantity, control, marker, primary, alternate,
  };
}

test("schema editing changes layer comments while field/action IDs and public DTO remain stable", () => {
  const schema = approvedSchema();
  schema[SIMPLE].layers.preco = "PREÇO PERSONALIZADO";
  schema[SIMPLE].layers.controlador = "CONTROLE PERSONALIZADO";
  const env = simpleEnv();
  env.price.comment = "PREÇO PERSONALIZADO";
  env.control.comment = "CONTROLE PERSONALIZADO";
  const decoy = text("PRECO", "999,90");
  env.source.layers.push(decoy);
  const h = harness(schema);
  const errors = [];
  const mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, errors);
  assert.deepEqual(errors, []);
  assert.equal(mechanic.fields[0].id, "preco");
  assert.equal(mechanic.fields[0].property, env.price.text.sourceText);
  mountOffer(h, env);
  assert.equal(h.updateOfferField(1, 0, "preco", "R$ 24,90", 0).ok, true);
  assert.equal(env.price.text.sourceText.value.text, "24,90");
  assert.deepEqual(decoy.text.sourceText.writes, []);
  const publicMechanic = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic;
  assert.equal(publicMechanic.fields[0].id, "preco");
  assert.equal(publicMechanic.fields[0].value, "24,90");
  assert.equal(JSON.stringify(publicMechanic).includes("controllerProperty"), false);
  assert.equal(JSON.stringify(publicMechanic).includes("controllerOptionValues"), false);
});

test("custom schema comments never become fallback names or redirect a price write to the controller", () => {
  const schema = approvedSchema();
  schema[SIMPLE].layers.preco = "CONTROLADOR DE MECANICA";
  schema[SIMPLE].layers.controlador = "FOO";
  const h = harness(schema);
  h.templateAssets.map.fallback.mechanicLayers = true;
  const unit = effect("Unidade", 2);
  const control = new TextLayer("CONTROLADOR DE MECANICA", "Texto da controladora");
  control.properties.push(new PropertyGroup("ADBE Effect Parade", [unit]));
  const env = envFor(SIMPLE, [control]);
  let mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, []);
  assert.equal(mechanic.fields[0].enabled, false);
  assert.equal(mechanic.fields[0].property, null);
  assert.equal(mechanic.optionGroups[0].controllerProperty, effectValue(unit));
  mountOffer(h, env);
  assert.equal(h.updateOfferField(1, 0, "preco", "99,90").ok, false);
  assert.deepEqual(control.text.sourceText.writes, []);

  const price = new TextLayer("PRECO", "15,90");
  env.source.layers.push(price);
  mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, []);
  assert.equal(mechanic.fields[0].property, price.text.sourceText);
  assert.equal(h.updateOfferField(1, 0, "preco", "24,90").ok, true);
  assert.equal(price.text.sourceText.value.text, "24,90");
  assert.deepEqual(control.text.sourceText.writes, []);
  assert.equal(h.updateOfferOption(1, 0, "unit", 3).ok, true);
  assert.deepEqual(effectValue(unit).writes, [4]);
});

test("positional effect follows edited layer binding and index without making effect name mandatory", () => {
  const schema = approvedSchema();
  Object.assign(schema[SIMPLE].effects.unit, { layer: "preco", index: 2, name: "Nome documental diferente" });
  const env = simpleEnv();
  const decoy = effect("Unidade", 1);
  const target = effect("Efeito com nome antigo", 3);
  env.price.properties.push(new PropertyGroup("ADBE Effect Parade", [decoy, target]));
  const h = harness(schema);
  const errors = [];
  const mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, errors);
  assert.deepEqual(errors, []);
  assert.equal(mechanic.optionGroups[0].controllerProperty, effectValue(target));
  assert.equal(mechanic.optionGroups[0].selectedIndex, 2);
  mountOffer(h, env);
  assert.equal(h.updateOfferOption(1, 0, "unit", 3).ok, true);
  assert.deepEqual(effectValue(target).writes, [4]);
  assert.deepEqual(effectValue(decoy).writes, []);
  assert.deepEqual(effectValue(env.unit).writes, []);
});

test("edited labels and explicit AE option values round-trip without changing UI positions", () => {
  const schema = approvedSchema();
  schema[SIMPLE].effects.unit.options = [
    { index: 10, label: "Cada item" },
    { index: 20, label: "Quilograma" },
    { index: 30, label: "Por cem gramas" },
    { index: 40, label: "Quilo ou item" },
  ];
  const env = simpleEnv();
  effectValue(env.unit).currentValue = 20;
  const h = harness(schema);
  const mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, []);
  assert.equal(mechanic.optionGroups[0].selectedIndex, 1);
  assert.deepEqual(plain(mechanic.optionGroups[0].options.map(({ label }) => label)), ["Cada item", "Quilograma", "Por cem gramas", "Quilo ou item"]);
  mountOffer(h, env);
  for (const [uiIndex, aeValue] of [[0, 10], [1, 20], [2, 30], [3, 40]]) {
    assert.equal(h.updateOfferOption(1, 0, "unit", uiIndex).ok, true);
    assert.equal(effectValue(env.unit).value, aeValue);
    assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.optionGroups[0].selectedIndex, uiIndex);
  }
  assert.deepEqual(effectValue(env.unit).writes, [10, 20, 30, 40]);
  const before = effectValue(env.unit).value;
  assert.equal(h.updateOfferOption(1, 0, "unit", 4).ok, false);
  assert.equal(effectValue(env.unit).value, before);
});

test("Parcelamento honors edited effect name at a different position even with JSON index one", () => {
  const schema = approvedSchema();
  schema[INSTALLMENT].effects.mechanicCondition.name = "Condição alternativa";
  schema[INSTALLMENT].effects.mechanicCondition.index = 1;
  const env = installmentEnv("Condição alternativa");
  const h = harness(schema);
  const errors = [];
  const mechanic = h.readConfiguredMechanic(env.valueLayer, INSTALLMENT, errors);
  assert.deepEqual(errors, []);
  assert.equal(mechanic.optionGroups[0].controllerProperty, effectValue(env.condition));
  assert.equal(mechanic.optionGroups[0].selectedIndex, 3);
  mountOffer(h, env);
  assert.equal(h.updateOfferOption(1, 0, "mechanicCondition", 6).ok, true);
  assert.deepEqual(effectValue(env.condition).writes, [7]);
  assert.deepEqual(effectValue(env.control.property("ADBE Effect Parade").property(1)).writes, []);
});

test("Meu CRF honors edited name while retaining native dropdown validation and non-positional search", () => {
  const schema = approvedSchema();
  schema[CARD].effects.unit.name = "Medida personalizada";
  schema[CARD].effects.unit.index = 1;
  const env = cardEnv("Medida personalizada");
  const h = harness(schema);
  const errors = [];
  const mechanic = h.readConfiguredMechanic(env.valueLayer, CARD, errors);
  assert.deepEqual(errors, []);
  assert.equal(mechanic.optionGroups[0].controllerProperty, effectValue(env.unit));
  mountOffer(h, env);
  assert.equal(h.updateOfferOption(1, 0, "unit", 1).ok, true);
  assert.deepEqual(effectValue(env.unit).writes, [2]);
  const effects = env.control.property("ADBE Effect Parade");
  assert.deepEqual(effectValue(effects.property(1)).writes, []);
  assert.deepEqual(effectValue(effects.property(2)).writes, []);
});

test("combined quantity uses edited effect position and remains a numeric field rather than a dropdown", () => {
  const schema = approvedSchema();
  schema[COMBINED].effects["quantidade-x"].index = 5;
  const env = combinedEnv();
  const replacement = effect("Quantidade deslocada", 9, false);
  env.control.property("ADBE Effect Parade").properties.push(replacement);
  const h = harness(schema);
  const errors = [];
  const mechanic = h.readConfiguredMechanic(env.valueLayer, COMBINED, errors);
  assert.deepEqual(errors, []);
  const field = mechanic.fields.find(({ id }) => id === "quantidade-x");
  assert.equal(field.property, effectValue(replacement));
  assert.equal(field.valueKind, "value");
  assert.equal(field.value, "9");
  assert.equal(mechanic.optionGroups.length, 3);
  mountOffer(h, env);
  assert.equal(h.updateOfferField(1, 0, "quantidade-x", "12 unidades", 2).ok, true);
  assert.deepEqual(effectValue(replacement).writes, [12]);
  assert.deepEqual(effectValue(env.quantity).writes, []);
});

for (const [identity, fixture, primaryRole, alternateRole] of [
  [INSTALLMENT, installmentEnv, "pulo-preco-cheio", "pulo-parcela"],
  [CARD, cardEnv, "pulo-preco-meu-crf", "pulo-preco-meu-cartao-crf"],
  [COMBINED, combinedEnv, "pulo-preco-cheio", "pulo"],
]) {
  test(`${identity}: edited jump comments are used by both reading and public mutation`, () => {
    const schema = approvedSchema();
    Object.assign(schema[identity].layers, {
      marcadores: "MARCADORES PERSONALIZADOS",
      [primaryRole]: "SALTO PRINCIPAL PERSONALIZADO",
      [alternateRole]: "SALTO ALTERNATIVO PERSONALIZADO",
    });
    const env = fixture();
    const marker = identified(new AVLayer("Novo marcador"), "MARCADORES PERSONALIZADOS");
    marker.marker = new MarkerProperty([1, 7, 11]);
    const primary = identified(new AVLayer("Novo salto principal"), "SALTO PRINCIPAL PERSONALIZADO");
    const alternate = identified(new AVLayer("Novo salto alternativo"), "SALTO ALTERNATIVO PERSONALIZADO");
    primary.startTime = 1;
    primary.inPoint = 1.4;
    alternate.startTime = 4;
    alternate.inPoint = 4.8;
    env.source.layers.push(marker, primary, alternate);
    const offsets = [primary.inPointOffset, alternate.inPointOffset];
    const oldTiming = [env.primary, env.alternate].map((layer) => [layer.startTime, layer.inPoint]);
    const h = harness(schema);
    const errors = [];
    const mechanic = h.readConfiguredMechanic(env.valueLayer, identity, errors);
    assert.deepEqual(errors, []);
    assert.equal(mechanic.installmentJump.enabled, true);
    assert.equal(mechanic.installmentJump.selectedTarget, "preco-parcela");
    mountOffer(h, env);
    for (const [target, expected] of [["preco-cheio", [7, 14]], ["preco-parcela", [14, 7]]]) {
      assert.equal(h.updateOfferInstallmentJump(1, 0, target).ok, true);
      for (const [index, actual] of [primary.inPoint, alternate.inPoint].entries()) {
        assert.ok(Math.abs(actual - expected[index]) < 1e-10, `Expected jump destination ${expected[index]}, received ${actual}`);
      }
      assert.deepEqual([primary.inPointOffset, alternate.inPointOffset], offsets);
      assert.equal(h.readConfiguredMechanic(env.valueLayer, identity, []).installmentJump.selectedTarget, target);
      assert.deepEqual([env.primary, env.alternate].map((layer) => [layer.startTime, layer.inPoint]), oldTiming);
      assert.deepEqual(marker.marker.times, [1, 7, 11]);
    }
  });
}

const invalidConfigurations = [
  ["unsupported version", (schema) => { schema.version = 2; }],
  ["null layer comment", (schema) => { schema[SIMPLE].layers.preco = null; }],
  ["empty layer comment", (schema) => { schema[SIMPLE].layers.preco = "  "; }],
  ["missing required layer role", (schema) => { delete schema[SIMPLE].layers.preco; }],
  ["duplicate comments after normalization", (schema) => { schema[SIMPLE].layers.preco = " controlador de mecanica "; }],
  ["null effect index", (schema) => { schema[SIMPLE].effects.unit.index = null; }],
  ["fractional effect index", (schema) => { schema[SIMPLE].effects.unit.index = 1.5; }],
  ["zero effect index", (schema) => { schema[SIMPLE].effects.unit.index = 0; }],
  ["unknown effect layer reference", (schema) => { schema[SIMPLE].effects.unit.layer = "camada-inexistente"; }],
  ["null effect name", (schema) => { schema[SIMPLE].effects.unit.name = null; }],
  ["null option label", (schema) => { schema[SIMPLE].effects.unit.options[0].label = null; }],
  ["duplicate AE option index", (schema) => { schema[SIMPLE].effects.unit.options[1].index = 1; }],
  ["negative AE option index", (schema) => { schema[SIMPLE].effects.unit.options[0].index = -1; }],
  ["missing required mechanic", (schema) => { delete schema[CARD]; }],
];

test("missing controller comment explains disabled unit, mechanic selectors and quantity in the public snapshot", () => {
  for (const [identity, fixture] of [[SIMPLE, simpleEnv], [INSTALLMENT, installmentEnv], [CARD, cardEnv], [COMBINED, combinedEnv]]) {
    const env = fixture();
    env.control.comment = "";
    const h = harness();
    mountOffer(h, env);
    const mechanic = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic;
    const controls = [...mechanic.optionGroups, ...mechanic.fields.filter(({ id }) => id === "quantidade-x")];
    assert.ok(controls.length > 0, identity);
    for (const control of controls) {
      assert.equal(control.enabled, false);
      assert.match(control.disabledReason, /Adicione o comentário "CONTROLADOR DE MECANICA"/);
      assert.match(control.disabledReason, /Controlador de Mecânica/);
      assert.match(control.disabledReason, /Nome livre da precomp/);
      assert.equal(control.disabledSummary, "O comentário obrigatório não foi encontrado.");
    }
    assert.ok(mechanic.fields.filter(({ id }) => id !== "quantidade-x").every((field) => field.enabled && !field.disabledReason && !field.disabledSummary));
    assert.deepEqual(env.control.property("ADBE Effect Parade").properties.flatMap((item) => effectValue(item).writes), []);
  }
});

test("missing text and controller comments use the active schema without disabling healthy sibling fields", () => {
  const schema = approvedSchema();
  schema[SIMPLE].layers.preco = "PREÇO PERSONALIZADO";
  schema[SIMPLE].layers.controlador = "CONTROLE PERSONALIZADO";
  const env = simpleEnv();
  const h = harness(schema);
  mountOffer(h, env);
  let mechanic = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic;
  assert.match(mechanic.fields[0].disabledReason, /Adicione o comentário "PREÇO PERSONALIZADO"/);
  assert.match(mechanic.optionGroups[0].disabledReason, /Adicione o comentário "CONTROLE PERSONALIZADO"/);
  assert.equal(mechanic.fields[0].disabledSummary, "O comentário obrigatório não foi encontrado.");
  assert.equal(mechanic.optionGroups[0].disabledSummary, "O comentário obrigatório não foi encontrado.");
  env.price.comment = "PREÇO PERSONALIZADO";
  env.control.comment = "CONTROLE PERSONALIZADO";
  mechanic = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic;
  assert.equal(mechanic.fields[0].enabled, true);
  assert.equal(mechanic.fields[0].disabledReason, undefined);
  assert.equal(mechanic.fields[0].disabledSummary, undefined);
  assert.equal(mechanic.optionGroups[0].enabled, true);
  assert.equal(mechanic.optionGroups[0].disabledReason, undefined);
  assert.equal(mechanic.optionGroups[0].disabledSummary, undefined);
});

test("duplicate comments, missing effects and non-text layers do not claim that a comment is missing", () => {
  const duplicateEnv = simpleEnv();
  duplicateEnv.source.layers.push(controller([effect("Unidade")]));
  const duplicate = harness().readConfiguredMechanic(duplicateEnv.valueLayer, SIMPLE, []);
  assert.match(duplicate.optionGroups[0].disabledReason, /Comentário duplicado.*CONTROLADOR DE MECANICA/);
  assert.match(duplicate.optionGroups[0].disabledSummary, /Mais de uma camada.*mesmo comentário/);
  assert.doesNotMatch(duplicate.optionGroups[0].disabledReason, /Adicione/);
  assert.equal(duplicate.fields[0].enabled, true);

  const effectEnv = simpleEnv();
  effectEnv.control.property("ADBE Effect Parade").properties = [];
  const missingEffect = harness().readConfiguredMechanic(effectEnv.valueLayer, SIMPLE, []);
  assert.match(missingEffect.optionGroups[0].disabledReason, /controle "Unidade".*posição 1/);
  assert.match(missingEffect.optionGroups[0].disabledSummary, /controle esperado.*ausente.*numérico/);
  assert.doesNotMatch(missingEffect.optionGroups[0].disabledReason, /comentário/);

  const textEnv = simpleEnv();
  textEnv.source.layers[0] = identified(new AVLayer("Não é texto"), "PRECO");
  const missingText = harness().readConfiguredMechanic(textEnv.valueLayer, SIMPLE, []);
  assert.match(missingText.fields[0].disabledReason, /comentário "PRECO".*Source Text/);
  assert.match(missingText.fields[0].disabledSummary, /texto da camada está indisponível/);
  assert.doesNotMatch(missingText.fields[0].disabledReason, /Adicione/);

  const dropdownEnv = cardEnv();
  dropdownEnv.control.property("ADBE Effect Parade").properties.push(effect("Unidade", 1));
  const duplicateDropdown = harness().readConfiguredMechanic(dropdownEnv.valueLayer, CARD, []);
  assert.match(duplicateDropdown.optionGroups[0].disabledReason, /Controle duplicado.*dropdown "Unidade"/);
  assert.match(duplicateDropdown.optionGroups[0].disabledSummary, /Mais de um dropdown/);
});

test("jump tooltips identify all missing schema comments and distinguish a missing marker", () => {
  for (const [identity, fixture, primaryRole, alternateRole] of [
    [INSTALLMENT, installmentEnv, "pulo-preco-cheio", "pulo-parcela"],
    [CARD, cardEnv, "pulo-preco-meu-crf", "pulo-preco-meu-cartao-crf"],
    [COMBINED, combinedEnv, "pulo-preco-cheio", "pulo"],
  ]) {
    const schema = approvedSchema();
    Object.assign(schema[identity].layers, {
      marcadores: "MARCADOR PERSONALIZADO",
      [primaryRole]: "PRINCIPAL PERSONALIZADO",
      [alternateRole]: "ALTERNATIVO PERSONALIZADO",
    });
    const env = fixture();
    const h = harness(schema);
    mountOffer(h, env);
    let jump = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump;
    assert.equal(jump.enabled, false);
    assert.equal(jump.disabledSummary, "O comentário obrigatório não foi encontrado.");
    for (const comment of ["MARCADOR PERSONALIZADO", "PRINCIPAL PERSONALIZADO", "ALTERNATIVO PERSONALIZADO"]) {
      assert.ok(jump.disabledReason.includes('Adicione o comentário "' + comment + '"'));
    }
    env.marker.comment = "MARCADOR PERSONALIZADO";
    env.primary.comment = "PRINCIPAL PERSONALIZADO";
    env.alternate.comment = "ALTERNATIVO PERSONALIZADO";
    env.marker.marker.times = [1];
    jump = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump;
    assert.equal(jump.enabled, false);
    assert.match(jump.disabledReason, /Adicione o segundo marcador.*MARCADOR PERSONALIZADO/);
    assert.match(jump.disabledSummary, /segundo marcador.*não foi encontrado/);
    assert.doesNotMatch(jump.disabledReason, /Adicione o comentário/);
    env.marker.marker.times = [1, 5];
    jump = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump;
    assert.equal(jump.enabled, true);
    assert.equal(jump.disabledReason, undefined);
    assert.equal(jump.disabledSummary, undefined);
  }
});

for (const [name, invalidate] of invalidConfigurations) {
  test(`invalid configuration ${name} fails closed before field, option or jump writes`, () => {
    const schema = approvedSchema();
    invalidate(schema);
    const h = harness(schema);
    assert.throws(() => h.validateMechanicsSchema(schema));
    const env = simpleEnv();
    const errors = [];
    const mechanic = h.readConfiguredMechanic(env.valueLayer, SIMPLE, errors);
    assert.equal(mechanic.unsupported, true);
    assert.deepEqual(plain(mechanic.fields), []);
    assert.deepEqual(plain(mechanic.optionGroups), []);
    assert.ok(errors.length > 0);
    mountOffer(h, env);
    assert.equal(h.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
    assert.equal(h.updateOfferOption(1, 0, "unit", 0).ok, false);
    assert.deepEqual(env.price.text.sourceText.writes, []);
    assert.deepEqual(effectValue(env.unit).writes, []);
    const jumpEnv = installmentEnv();
    const timing = jumpEnv.source.layers.map((layer) => [layer.startTime, layer.inPoint]);
    assert.throws(() => h.applyConfiguredMechanicJump({ mechanicLayer: jumpEnv.valueLayer }, "preco-cheio", INSTALLMENT));
    assert.deepEqual(jumpEnv.source.layers.map((layer) => [layer.startTime, layer.inPoint]), timing);
    assert.equal(h.app.undoEvents.length % 2, 0);
  });
}
