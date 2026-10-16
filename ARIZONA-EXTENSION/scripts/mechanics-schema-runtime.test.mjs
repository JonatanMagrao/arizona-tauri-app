import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTemplateTestAssets } from "./template-test-assets.mjs";

const domainDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const approved = () => JSON.parse(readFileSync(new URL("../src/js/assets/schema.json", import.meta.url), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const schemaFilePath = "C:/extension/js/assets/schema.json";

// Native AE objects and its File API are the only mocks. In particular, the
// runtime loader, UTF-8 decoder, JSON parser, validator and mutations are real.
class Property {
  constructor(name, value, matchName = name) {
    this.name = name;
    this.matchName = matchName;
    this.currentValue = value;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.isDropdownEffect = matchName === "ADBE Dropdown Control-0001";
    this.writes = [];
  }
  get value() { return plain(this.currentValue); }
  setValue(value) { this.currentValue = plain(value); this.writes.push(plain(value)); this.onWrite?.(); }
}
class PropertyGroup {
  constructor(name, properties = []) { this.name = name; this.properties = properties; }
  get numProperties() { return this.properties.length; }
  property(indexOrName) {
    return typeof indexOrName === "number" ? this.properties[indexOrName - 1] || null
      : this.properties.find((item) => item.name === indexOrName || item.matchName === indexOrName) || null;
  }
}
class MarkerProperty {
  constructor(times = []) { this.times = times; }
  get numKeys() { return this.times.length; }
  keyTime(index) { assert.ok(index >= 1 && index <= this.numKeys); return this.times[index - 1]; }
}
class AVLayer extends PropertyGroup {
  constructor(name, properties = [], source = null) {
    super(name, properties);
    this.source = source;
    this.comment = "";
    this.enabled = true;
    this.selected = false;
    this.label = 1;
    this.currentStartTime = 0;
    this.inPointOffset = 0;
    this.marker = new MarkerProperty();
  }
  get index() { return this.containingComp?.layers.indexOf(this) + 1 || 0; }
  get startTime() { return this.currentStartTime; }
  set startTime(value) { this.currentStartTime = value; this.onTimingWrite?.(); }
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
    this.duration = 12;
    this.frameDuration = 1 / 30;
    layers.forEach((layer) => { layer.containingComp = this; });
  }
  get numLayers() { return this.layers.length; }
  get selectedLayers() { return this.layers.filter((layer) => layer.selected); }
  layer(indexOrName) {
    const found = typeof indexOrName === "number" ? this.layers[indexOrName - 1] || null
      : this.layers.find((layer) => layer.name === indexOrName) || null;
    if (found) found.containingComp = this;
    return found;
  }
}
class FootageItem {
  constructor(name = "Produto.png") { this.name = name; this.mainSource = null; this.replacements = []; }
  replace(file) { this.replacements.push(file.fsName); }
}
class FileSource {}
const identified = (layer, comment) => Object.assign(layer, { comment });
const effect = (name, value, matchName = "ADBE Dropdown Control-0001") => new PropertyGroup(name, [new Property("Valor", value, matchName)]);

function simpleProduct(slot = 1) {
  const price = identified(new TextLayer("Valor livre", "15,90"), "PRECO");
  const alternativePrice = identified(new TextLayer("Valor alternativo", "29,90"), "PRECO EDITADO");
  const unit = effect("Unidade", 2);
  const alternateUnit = effect("Unidade editada", 20);
  const control = identified(new AVLayer("Controle livre", [new PropertyGroup("ADBE Effect Parade", [unit, alternateUnit])]), "CONTROLADOR DE MECANICA");
  const descriptionText = new TextLayer("DESCRITIVO", "Descricao " + slot);
  const description = identified(new AVLayer("Descricao externa", [], new CompItem([descriptionText])), "DESCRITIVO " + slot);
  const mechanic = identified(new AVLayer("Mecanica externa", [], new CompItem([price, control, alternativePrice], "Livre", "SIMPLES")), "MECANICA " + slot);
  const footage = new FootageItem();
  const image = identified(new AVLayer("Imagem externa", [], footage), "PRODUTO " + slot);
  return { price, alternativePrice, unit, alternateUnit, control, descriptionText, description, mechanic, image, footage,
    layers: [description, mechanic, image] };
}

function installmentProduct(slot = 1) {
  const env = simpleProduct(slot);
  const marker = identified(new AVLayer("Marcador interno"), "MARCADORES");
  marker.marker = new MarkerProperty([1, 5]);
  const primary = identified(new AVLayer("Salto cheio"), "PULO PRECO CHEIO");
  const alternate = identified(new AVLayer("Salto parcela"), "PULO PARCELA");
  primary.startTime = 1;
  primary.inPoint = 1.5;
  alternate.startTime = 4;
  alternate.inPoint = 5;
  const condition = effect("Condição", 2);
  const control = identified(new AVLayer("Controladora", [new PropertyGroup("ADBE Effect Parade", [condition])]), "CONTROLADOR DE MECANICA");
  env.mechanic.source = new CompItem([marker, primary, alternate, control,
    identified(new TextLayer("De", "99,90"), "PRECO DE"), env.price,
    identified(new TextLayer("Parcela", "9,90"), "PRECO PARCELA"),
    identified(new TextLayer("Parcelas", "3"), "NUMERO DE PARCELAS")], "Livre", "DE X POR Y PARCELAMENTO");
  return { ...env, marker, primary, alternate, condition };
}

function harness({ configured = true, products = [simpleProduct()] } = {}) {
  const templateAssets = createTemplateTestAssets({ mechanicLayers: false, offerLayers: false });
  const file = { bytes: Buffer.from(JSON.stringify(approved()), "utf8"), exists: true, readable: true, seekable: true,
    reads: 0, opens: 0, closes: 0, seeks: [], paths: [], encodingChanges: [], readError: "", readException: null,
    truncate: false, closeResult: true };
  class File {
    constructor(filePath) { this.fsName = filePath; file.paths.push(filePath); this.currentEncoding = ""; this.opened = false; this.currentError = ""; }
    get length() { return file.bytes.length; }
    get exists() { return this.fsName === schemaFilePath ? file.exists : true; }
    get error() { return this.currentError; }
    set error(value) { this.currentError = value; }
    get encoding() { return this.currentEncoding; }
    set encoding(value) { assert.equal(this.opened, true); this.currentEncoding = value; file.encodingChanges.push(value); }
    open(mode) { assert.equal(mode, "r"); file.opens += 1; this.opened = this.exists && file.readable; return this.opened; }
    seek(offset) { file.seeks.push(offset); return file.seekable && offset === 0; }
    read() {
      assert.equal(this.opened, true);
      assert.equal(this.encoding, "BINARY");
      file.reads += 1;
      if (file.readException) throw file.readException;
      this.currentError = file.readError;
      const bytes = file.bytes.toString("latin1");
      return file.truncate ? bytes.slice(0, -1) : bytes;
    }
    close() { file.closes += 1; this.opened = false; return file.closeResult; }
  }
  const legalText = new TextLayer("Texto Legal", "Legal existente");
  const cpf = effect("Limitado por CPF", 0, "ADBE Checkbox Control-0001");
  legalText.properties.push(new PropertyGroup("ADBE Effect Parade", [effect("Texto Legal", 2, "ADBE Slider Control-0001"), cpf]));
  const legal = identified(new AVLayer("Legal externo", [], new CompItem([
    new AVLayer("Validade"), new AVLayer("Reserva"), legalText, new AVLayer("Leite"), new AVLayer("Moderacao"), new AVLayer("Eletro"),
  ])), "TEXTO LEGAL");
  const source = new CompItem([...products.flatMap((product) => product.layers), legal], "Oferta");
  const offer = identified(new AVLayer("Oferta_01", [], source), "CAMADA OFERTA 01");
  const miolo = new CompItem([offer], "Miolo");
  const app = { project: { numItems: 1, item: () => miolo }, undoEvents: [],
    beginUndoGroup(name) { this.undoEvents.push(["begin", name]); }, endUndoGroup() { this.undoEvents.push(["end"]); } };
  const modules = new Map();
  function load(relativeOrAbsolute) {
    const filename = path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(domainDirectory, relativeOrAbsolute);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText, { module, exports: module.exports, app, AVLayer, TextLayer, CompItem, FootageItem, FileSource, Property, PropertyGroup, File: templateAssets.wrapFile(File),
      PropertyValueType: { OneD: 1 }, JSON: undefined,
      require(specifier) {
        assert.ok(specifier.startsWith("."), "Unexpected dependency: " + specifier);
        const base = path.resolve(path.dirname(filename), specifier);
        const target = [base, base + ".ts", base + ".js"].find(existsSync);
        assert.ok(target, "Missing dependency: " + specifier);
        return load(target);
      },
    }, { filename });
    if (filename === path.resolve(domainDirectory, "../template/templateIdentities.ts")) {
      module.exports.configureTemplateIdentitiesPath(templateAssets.filePath);
    }
    return module.exports;
  }
  const runtime = load("mechanics/schemaRuntime.ts");
  if (configured) runtime.configureMechanicsSchemaPath(schemaFilePath);
  return { app, file, templateAssets, products, source, offer, legalText, cpf, load, ...runtime,
    ...load("mechanics/schemaJson.ts"), ...load("mechanics/registry.ts"),
    ...load("actions/updateField.ts"), ...load("actions/updateOption.ts"),
    ...load("actions/updateDescription.ts"), ...load("actions/replaceProductImage.ts"), ...load("actions/legalControls.ts"),
    ...load("snapshot/buildOfferSnapshot.ts"), ...load("snapshot/offerDiscovery.ts") };
}

function writeSchema(h, schema) { h.file.bytes = Buffer.from(JSON.stringify(schema), "utf8"); }
function assertUndoClosed(h) {
  assert.equal(h.app.undoEvents.length % 2, 0);
  for (let index = 0; index < h.app.undoEvents.length; index += 2) {
    assert.equal(h.app.undoEvents[index][0], "begin");
    assert.deepEqual(h.app.undoEvents[index + 1], ["end"]);
  }
}

test("runtime JSON edits affect the next operation without recreating modules or reloading the extension", () => {
  const h = harness();
  const env = h.products[0];
  const before = h.getOffersEditorSnapshot(1).selectedOffer.products[0];
  assert.equal(before.mechanic.fields[0].value, "15,90");
  const edited = approved();
  edited.SIMPLES.layers.preco = "PRECO EDITADO";
  Object.assign(edited.SIMPLES.effects.unit, { index: 2, name: "Nome editado", options: [
    { index: 10, label: "Cada item" }, { index: 20, label: "Quilograma" }, { index: 30, label: "Por 100g" }, { index: 40, label: "Kg ou cada" },
  ] });
  writeSchema(h, edited);
  const after = h.getOffersEditorSnapshot(1).selectedOffer.products[0];
  assert.equal(after.mechanic.fields[0].id, "preco");
  assert.equal(after.mechanic.fields[0].value, "29,90");
  assert.deepEqual(plain(after.mechanic.optionGroups[0].options.map(({ label }) => label)), ["Cada item", "Quilograma", "Por 100g", "Kg ou cada"]);
  assert.equal(after.mechanic.optionGroups[0].selectedIndex, 1);
  assert.equal(h.updateOfferField(1, 0, "preco", "R$ 33,50", 0).ok, true);
  assert.equal(h.updateOfferOption(1, 0, "unit", 3).ok, true);
  assert.deepEqual(env.alternativePrice.text.sourceText.writes, [{ text: "33,50" }]);
  assert.deepEqual(env.alternateUnit.property(1).writes, [40]);
  assert.deepEqual(env.price.text.sourceText.writes, []);
  assert.deepEqual(env.unit.property(1).writes, []);
  assertUndoClosed(h);
});

test("nested scopes read the JSON once and pin one validated object until the outer operation ends", () => {
  const h = harness();
  const edited = approved();
  edited.SIMPLES.effects.unit.options[0].label = "Editado depois";
  const values = h.withMechanicsSchema(() => {
    const initial = h.getMechanicsSchema();
    writeSchema(h, edited);
    return [initial, h.withMechanicsSchema(() => h.getMechanicsSchema()), h.getMechanicsSchema()];
  });
  assert.equal(values[0], values[1]);
  assert.equal(values[0], values[2]);
  assert.equal(values[0].SIMPLES.effects.unit.options[0].label, "Cada");
  assert.equal(h.file.reads, 1);
  assert.equal(h.file.closes, 1);
  assert.deepEqual(h.file.encodingChanges, ["BINARY"]);
  assert.deepEqual(h.file.seeks, [0]);
  assert.equal(h.getMechanicsSchema().SIMPLES.effects.unit.options[0].label, "Editado depois");
  assert.equal(h.file.reads, 2);
});

test("an edited named effect is used next operation while its lookup strategy and field IDs remain stable", () => {
  const product = installmentProduct();
  const h = harness({ products: [product] });
  const controller = product.mechanic.source.layer(4);
  const editedEffect = effect("Condição editada", 4);
  controller.property("ADBE Effect Parade").properties.push(editedEffect);
  assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.optionGroups[0].selectedIndex, 1);
  const edited = approved();
  edited["DE X POR Y PARCELAMENTO"].effects.mechanicCondition.name = "Condição editada";
  writeSchema(h, edited);
  const snapshot = h.getOffersEditorSnapshot(1).selectedOffer.products[0];
  assert.equal(snapshot.mechanic.optionGroups[0].id, "mechanicCondition");
  assert.equal(snapshot.mechanic.optionGroups[0].selectedIndex, 3);
  assert.equal(h.updateOfferOption(1, 0, "mechanicCondition", 6).ok, true);
  assert.deepEqual(editedEffect.property(1).writes, [7]);
  assert.deepEqual(product.condition.property(1).writes, []);
  assert.deepEqual(plain(snapshot.mechanic.fields.map(({ id }) => id)), ["preco-de", "preco", "preco-parcela", "numero-de-parcelas"]);
  assertUndoClosed(h);
});

test("a scope without mechanic reads stays lazy and does not open the schema file", () => {
  const h = harness();
  assert.equal(h.withMechanicsSchema(() => 42), 42);
  assert.equal(h.file.opens, 0);
  assert.equal(h.file.reads, 0);
});

test("unchanged bytes reuse the validated schema across operations after a complete fresh read", () => {
  const h = harness();
  const first = h.withMechanicsSchema(() => h.getMechanicsSchema());
  for (let index = 0; index < 4; index += 1) {
    assert.equal(h.withMechanicsSchema(() => h.getMechanicsSchema()), first);
  }
  assert.equal(h.getMechanicsSchema(), first, "unscoped reads follow the same freshness rule");
  assert.equal(h.file.reads, 6);
  assert.equal(h.file.closes, 6);
  assert.deepEqual(h.file.seeks, [0, 0, 0, 0, 0, 0]);
});

test("same-size edits and byte-only formatting changes invalidate the schema cache", () => {
  const h = harness();
  const first = h.getMechanicsSchema();
  const size = h.file.bytes.length;
  const edited = approved();
  edited.SIMPLES.effects.unit.options[0].label = "Item";
  writeSchema(h, edited);
  assert.equal(h.file.bytes.length, size);
  const second = h.withMechanicsSchema(() => h.getMechanicsSchema());
  assert.notEqual(second, first);
  assert.equal(second.SIMPLES.effects.unit.options[0].label, "Item");
  h.file.bytes = Buffer.concat([Buffer.from(" "), h.file.bytes]);
  const third = h.getMechanicsSchema();
  assert.notEqual(third, second);
  assert.deepEqual(plain(third), plain(second));
  assert.equal(h.getMechanicsSchema(), third);
});

test("reconfiguring any schema path clears the previous validated cache", () => {
  const h = harness();
  let previous = h.getMechanicsSchema();
  h.configureMechanicsSchemaPath("C:/other/schema.json");
  const other = h.getMechanicsSchema();
  assert.notEqual(other, previous);
  assert.equal(h.file.paths.at(-1), "C:/other/schema.json");
  for (const next of [schemaFilePath, "", "relative.json", null]) {
    previous = h.getMechanicsSchema();
    if (next === null || next === "relative.json") {
      assert.throws(() => h.configureMechanicsSchemaPath(next));
    } else h.configureMechanicsSchemaPath(next);
    if (next !== schemaFilePath) assert.throws(() => h.getMechanicsSchema(), /configurado/);
    h.configureMechanicsSchemaPath(schemaFilePath);
    assert.notEqual(h.getMechanicsSchema(), previous);
  }
});

test("snapshot DTO edits and native actions cannot mutate cached schema or identity objects", () => {
  const product = installmentProduct();
  const h = harness({ products: [product] });
  const identities = h.load(path.resolve(domainDirectory, "../template/templateIdentities.ts"));
  const schema = h.getMechanicsSchema();
  const map = identities.getTemplateIdentities();
  const originalSchema = JSON.stringify(schema);
  const originalMap = JSON.stringify(map);
  const snapshot = h.getOffersEditorSnapshot(1).selectedOffer.products[0];
  snapshot.mechanic.optionGroups[0].options[0].label = "DTO only";
  assert.equal(h.updateOfferField(1, 0, "preco", "41,90", 0).ok, true);
  assert.equal(h.updateOfferOption(1, 0, "mechanicCondition", 0).ok, true);
  assert.equal(h.updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
  assert.equal(h.getMechanicsSchema(), schema);
  assert.equal(identities.getTemplateIdentities(), map);
  assert.equal(JSON.stringify(schema), originalSchema);
  assert.equal(JSON.stringify(map), originalMap);
  assert.notEqual(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.optionGroups[0].options[0].label, "DTO only");
  assertUndoClosed(h);
});

for (const failure of ["truncate", "closeResult"]) {
  test(`${failure}: even matching cached bytes cannot bypass an incomplete read or close failure`, () => {
    const h = harness();
    const previous = h.getMechanicsSchema();
    h.file[failure] = failure === "truncate";
    assert.throws(() => h.getMechanicsSchema(), /incompleta|fechar/);
    h.file[failure] = failure !== "truncate";
    assert.notEqual(h.getMechanicsSchema(), previous, "the failed read discarded the valid cache");
    assert.equal(h.file.reads, 3);
    assert.equal(h.file.closes, 3);
  });
}

test("a field action pins its schema even when a native write edits the JSON before readback", () => {
  const h = harness();
  const env = h.products[0];
  const edited = approved();
  edited.SIMPLES.layers.preco = "PRECO EDITADO";
  env.price.text.sourceText.onWrite = () => writeSchema(h, edited);
  assert.equal(h.updateOfferField(1, 0, "preco", "41,90", 0).ok, true);
  assert.equal(h.file.reads, 1);
  assert.equal(env.price.text.sourceText.value.text, "41,90");
  assert.deepEqual(env.alternativePrice.text.sourceText.writes, []);
  assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0].value, "29,90");
  assert.equal(h.file.reads, 2);
  assertUndoClosed(h);
});

test("a field action pins the identities map through nested reads and sees fallback toggles next operation", () => {
  const h = harness();
  const env = h.products[0];
  h.templateAssets.map.fallback.mechanicLayers = true;
  env.price.name = "PRECO";
  env.price.comment = "";
  let nestedField;
  env.price.text.sourceText.onWrite = () => {
    h.templateAssets.map.fallback.mechanicLayers = false;
    nestedField = h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0];
  };
  assert.equal(h.updateOfferField(1, 0, "preco", "41,90", 0).ok, true);
  assert.equal(nestedField.enabled, true);
  assert.equal(nestedField.value, "41,90");
  assert.equal(h.templateAssets.state.reads, 1);
  assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0].enabled, false);
  assert.equal(h.templateAssets.state.reads, 2);
  assert.equal(h.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
  assert.deepEqual(env.price.text.sourceText.writes, [{ text: "41,90" }]);
  assertUndoClosed(h);
});

test("a jump action pins one schema across snapshot and timing changes and observes edits next time", () => {
  const product = installmentProduct();
  const h = harness({ products: [product] });
  const edited = approved();
  edited["DE X POR Y PARCELAMENTO"].layers["pulo-preco-cheio"] = "PULO EDITADO";
  product.primary.onTimingWrite = () => writeSchema(h, edited);
  assert.equal(h.updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
  assert.equal(h.file.reads, 1);
  assert.deepEqual([product.primary.inPoint, product.alternate.inPoint], [5, 12]);
  const before = [product.primary.startTime, product.alternate.startTime];
  assert.equal(h.updateOfferInstallmentJump(1, 0, "preco-parcela").ok, false);
  assert.deepEqual([product.primary.startTime, product.alternate.startTime], before);
  assert.equal(h.file.reads, 2);
  assertUndoClosed(h);
});

test("a multi-product snapshot shares one read and clears its scope after a native error", () => {
  const h = harness({ products: [simpleProduct(1), simpleProduct(2)] });
  assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products.length, 2);
  assert.equal(h.file.reads, 1);
  h.file.readException = new Error("Native File.read failure");
  try { h.getOffersEditorSnapshot(1); } catch (error) { assert.match(error.message, /File|schema|mec[aâ]nic/i); }
  assert.equal(h.file.reads, 2);
  assert.equal(h.file.closes, 2);
  h.file.readException = null;
  const edited = approved();
  edited.SIMPLES.layers.preco = "PRECO EDITADO";
  writeSchema(h, edited);
  assert.deepEqual(plain(h.getOffersEditorSnapshot(1).selectedOffer.products.map((product) => product.mechanic.fields[0].value)), ["29,90", "29,90"]);
  assert.equal(h.file.reads, 3);
});

const invalidFiles = [
  ["missing file", (h) => { h.file.exists = false; }],
  ["unreadable file", (h) => { h.file.readable = false; }],
  ["failed seek", (h) => { h.file.seekable = false; }],
  ["native read error", (h) => { h.file.readError = "Native read failure"; }],
  ["malformed JSON", (h) => { h.file.bytes = Buffer.from('{"version":1,}', "utf8"); }],
  ["invalid UTF-8", (h) => { h.file.bytes = Buffer.from([0xc3, 0x28]); }],
  ["double BOM", (h) => { h.file.bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), h.file.bytes]); }],
  ["duplicate escaped key", (h) => { h.file.bytes = Buffer.from(JSON.stringify(approved()).replace('"version":1', '"version":null,"\\u0076ersion":1'), "utf8"); }],
  ["null value", (h) => { const schema = approved(); schema.SIMPLES.layers.preco = null; writeSchema(h, schema); }],
];

for (const [name, invalidate] of invalidFiles) {
  test(`${name}: no stale configuration or mechanic writes survive, and fixing the file recovers next operation`, () => {
    const product = installmentProduct();
    const h = harness({ products: [product] });
    assert.equal(h.getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump.enabled, true);
    invalidate(h);
    const timing = [product.primary.startTime, product.alternate.startTime];
    assert.equal(h.updateOfferField(1, 0, "preco", "99,90", 1).ok, false);
    assert.equal(h.updateOfferOption(1, 0, "mechanicCondition", 0).ok, false);
    assert.equal(h.updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
    assert.deepEqual(product.price.text.sourceText.writes, []);
    assert.deepEqual(product.condition.property(1).writes, []);
    assert.deepEqual([product.primary.startTime, product.alternate.startTime], timing);
    h.file.exists = h.file.readable = h.file.seekable = true;
    h.file.readError = "";
    writeSchema(h, approved());
    assert.equal(h.updateOfferField(1, 0, "preco", "27,90", 1).ok, true);
    assert.equal(product.price.text.sourceText.value.text, "27,90");
    assertUndoClosed(h);
  });
}

test("an error is pinned inside one operation and cleared after its finally block", () => {
  const h = harness();
  h.file.bytes = Buffer.from("{invalid}", "utf8");
  h.withMechanicsSchema(() => {
    assert.throws(() => h.getMechanicsSchema());
    writeSchema(h, approved());
    assert.throws(() => h.withMechanicsSchema(() => h.getMechanicsSchema()));
    assert.equal(h.file.reads, 1);
  });
  assert.equal(h.getMechanicsSchema().version, 1);
  assert.equal(h.file.reads, 2);
  assert.throws(() => h.withMechanicsSchema(() => { h.getMechanicsSchema(); throw new Error("Callback failure"); }), /Callback failure/);
  const edited = approved();
  edited.SIMPLES.effects.unit.options[0].label = "Após a falha";
  writeSchema(h, edited);
  assert.equal(h.getMechanicsSchema().SIMPLES.effects.unit.options[0].label, "Após a falha");
});

test("an unconfigured schema path fails safely and can be configured without recreating host modules", () => {
  const h = harness({ configured: false });
  assert.throws(() => h.getMechanicsSchema(), /config|caminho|schema/i);
  assert.equal(h.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
  assert.deepEqual(h.products[0].price.text.sourceText.writes, []);
  assert.equal(h.file.reads, 0);
  h.configureMechanicsSchemaPath(schemaFilePath);
  assert.equal(h.updateOfferField(1, 0, "preco", "32,90", 0).ok, true);
  assert.equal(h.products[0].price.text.sourceText.value.text, "32,90");
  assertUndoClosed(h);
});

test("invalid mechanics JSON leaves description, image and existing legal controls available", () => {
  const h = harness();
  h.file.bytes = Buffer.from("broken JSON", "utf8");
  assert.equal(h.updateOfferDescription(1, 0, "Nova descricao").ok, true);
  assert.equal(h.replaceOfferProductImage(1, 0, "C:/novo.png").ok, true);
  assert.equal(h.updateOfferLegalControl(1, "limitado-por-cpf", true).ok, true);
  assert.equal(h.products[0].descriptionText.text.sourceText.value.text, "NOVA DESCRICAO");
  assert.deepEqual(h.products[0].footage.replacements, ["C:/novo.png"]);
  assert.deepEqual(h.cpf.property(1).writes, [1]);
  assert.deepEqual(h.products[0].price.text.sourceText.writes, []);
  assertUndoClosed(h);
});

test("strict UTF-8 decoding supports accents, supplementary characters and BOM without native JSON", () => {
  const h = harness();
  const schema = approved();
  schema.SIMPLES.effects.unit.options[0].label = 'Preço, ação e emoji 😀; "aspas" e \\';
  const source = JSON.stringify(schema);
  const bytes = Buffer.from(source, "utf8");
  assert.equal(h.decodeMechanicsSchemaUtf8(bytes.toString("latin1")), source);
  const decodedBom = h.decodeMechanicsSchemaUtf8(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]).toString("latin1"));
  assert.equal(decodedBom, "\uFEFF" + source);
  assert.deepEqual(plain(h.parseMechanicsSchemaJson(decodedBom)), schema);
  assert.deepEqual(plain(h.parseMechanicsSchemaJson(source)), schema);
});

for (const bytes of [[0x80], [0xc0, 0xaf], [0xc3, 0x28], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
  test(`UTF-8 rejects malformed bytes ${bytes.map((byte) => byte.toString(16)).join(" ")}`, () => {
    const h = harness();
    assert.throws(() => h.decodeMechanicsSchemaUtf8(Buffer.from(bytes).toString("latin1")), /UTF|Unicode|codifica/i);
  });
}

for (const source of ["", '{"version":01}', '{"version":1,}', '{/*comment*/"version":1}', '{"version":NaN}', '{"version":Infinity}', "{'version':1}", '{"version":1} trailing', '{"version":1,"SIMPLES":undefined}', '{"version":1,"extra":"\\x41"}', '{"version":1,"extra":"\u0001"}']) {
  test(`strict JSON rejects ${JSON.stringify(source)}`, () => {
    const h = harness();
    assert.throws(() => h.parseMechanicsSchemaJson(source), /JSON|schema/i);
  });
}

const duplicates = [
  ['"version":1', '"version":null,"\\u0076ersion":1'],
  ['"preco":"PRECO"', '"preco":null,"preco":"PRECO"'],
  ['"index":1', '"\\u0069ndex":null,"index":1'],
  ['"label":"Cada"', '"label":null,"label":"Cada"'],
];
for (const [original, replacement] of duplicates) {
  test(`strict JSON rejects duplicate decoded key ${original}`, () => {
    const h = harness();
    const source = JSON.stringify(approved());
    assert.ok(source.includes(original));
    assert.throws(() => h.parseMechanicsSchemaJson(source.replace(original, replacement)), /duplicad/i);
  });
}
