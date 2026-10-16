import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "@babel/core";

const domainDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const schemaFilePath = "C:/extension/js/assets/schema.json";
const schemaBinary = readFileSync(new URL("../src/js/assets/schema.json", import.meta.url)).toString("latin1");
const identitiesFilePath = "C:/extension/js/assets/template-identities.json";
const approvedIdentities = JSON.parse(readFileSync(new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"));

// Mock only native AE objects. Production discovery, association, readers,
// public actions and serialization run together in these regression tests.
class Property {
  constructor(name, value, matchName = name) {
    this.name = name;
    this.matchName = matchName;
    this.currentValue = value;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.isDropdownEffect = matchName === "ADBE Dropdown Control-0001";
    this.writes = [];
    this.expressionWrites = [];
    this.canSetExpression = true;
    this.expression = "";
    this.currentExpressionEnabled = false;
    this.valueAtTimeCalls = [];
  }
  get value() {
    return plain(this.currentExpressionEnabled && this.expressionValue !== undefined
      ? this.expressionValue : this.currentValue);
  }
  valueAtTime(time, preExpression = false) {
    this.valueAtTimeCalls.push([time, preExpression]);
    return preExpression ? plain(this.currentValue) : this.value;
  }
  setValue(value) {
    if (this.writeFailure) throw new Error("Native property write failed");
    this.currentValue = plain(value);
    this.writes.push(plain(value));
  }
  get expressionEnabled() { return this.currentExpressionEnabled; }
  set expressionEnabled(value) {
    this.currentExpressionEnabled = value;
    this.expressionWrites.push(value);
  }
}

class PropertyGroup {
  constructor(name, properties = []) { this.name = this.matchName = name; this.properties = properties; }
  get numProperties() { return this.properties.length; }
  property(indexOrName) {
    return typeof indexOrName === "number"
      ? this.properties[indexOrName - 1] || null
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
    this.locked = false;
    this.selected = false;
    this.label = 1;
    this.startTime = 0;
    this.inPointOffset = 0;
    this.marker = new MarkerProperty();
    this.scale = new Property("Scale", [100, 100]);
    this.sourceWrites = [];
  }
  get index() { return this.containingComp?.layers.indexOf(this) + 1 || 0; }
  get inPoint() { return this.startTime + this.inPointOffset; }
  set inPoint(value) { this.inPointOffset = value - this.startTime; }
  replaceSource(source, fixExpressions) {
    if (this.replaceFailure) {
      if (typeof this.replaceFailure === "number") this.replaceFailure -= 1;
      throw new Error("Native source replacement failed");
    }
    this.source = source;
    this.sourceWrites.push({ source, fixExpressions });
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
  constructor(layers, name = "Nome livre", comment = "") {
    this.layers = layers;
    this.name = name;
    this.comment = comment;
    this.duration = 12;
    this.frameDuration = 1 / 30;
    this.time = 0;
    layers.forEach((layer) => { layer.containingComp = this; });
  }
  get numLayers() { return this.layers.length; }
  get selectedLayers() { return this.layers.filter((layer) => layer.selected); }
  layer(indexOrName) {
    const found = typeof indexOrName === "number"
      ? this.layers[indexOrName - 1] || null
      : this.layers.find((layer) => layer.name === indexOrName) || null;
    if (found) found.containingComp = this;
    return found;
  }
}

class File {
  constructor(filePath) { this.fsName = filePath; this.exists = true; this.encoding = ""; this.error = ""; }
  get length() { return schemaBinary.length; }
  open(mode) { return this.exists && mode === "r"; }
  seek(offset) { return offset === 0; }
  read() { assert.equal(this.fsName, schemaFilePath); assert.equal(this.encoding, "BINARY"); return schemaBinary; }
  close() { return true; }
}
class FileSource { constructor(filePath) { this.file = new File(filePath); } }
class FootageItem {
  constructor(name) {
    this.name = name;
    this.mainSource = new FileSource("C:/produtos/" + name + ".png");
    this.replacements = [];
  }
  replace(file) { this.mainSource = new FileSource(file.fsName); this.replacements.push(file.fsName); }
}

const identified = (layer, comment) => Object.assign(layer, { comment });
const effect = (name, value, type = "ADBE Dropdown Control-0001") =>
  new PropertyGroup(name, [new Property("Native value", value, type)]);
const effectValue = (item) => item.property(1);

function product(slot, { installment = false } = {}) {
  const descriptionText = new TextLayer("DESCRITIVO", "DESCRICAO " + slot);
  descriptionText.text.sourceText.expression = "value";
  const descriptionLayer = identified(new AVLayer("Descricao livre " + slot, [],
    new CompItem([new AVLayer("Decoracao interna"), descriptionText], "Descricao " + slot)), "DESCRITIVO " + slot);
  const price = identified(new TextLayer("Valor livre", slot + "9,90"), installment ? "PRECO" : "PRECO");
  const option = effect(installment ? "Condição" : "Unidade", slot);
  const control = identified(new AVLayer("Controle livre", [new PropertyGroup("ADBE Effect Parade", [option])]), "CONTROLADOR DE MECANICA");
  const marker = identified(new AVLayer("Marcadores internos"), "MARCADORES");
  marker.marker = new MarkerProperty([1, 5, 9]);
  const primary = identified(new AVLayer("Salto cheio"), "PULO PRECO CHEIO");
  const alternate = identified(new AVLayer("Salto parcela"), "PULO PARCELA");
  primary.startTime = 1;
  primary.inPoint = 1.5;
  alternate.startTime = 4;
  alternate.inPoint = 4.5;
  const mechanicalLayers = installment
    ? [marker, alternate, identified(new TextLayer("Parcelas", "3"), "NUMERO DE PARCELAS"), control,
      identified(new TextLayer("Valor De", "99,90"), "PRECO DE"), price,
      identified(new TextLayer("Parcela", "19,90"), "PRECO PARCELA"), primary]
    : [control, new AVLayer("Fundo"), price];
  const mechanicSource = new CompItem(mechanicalLayers, "Mecanica livre " + slot, installment ? "DE X POR Y PARCELAMENTO" : "SIMPLES");
  const mechanicLayer = identified(new AVLayer("Mecanica visual " + slot, [], mechanicSource), "MECANICA " + slot);
  const footage = new FootageItem("Produto " + slot);
  const imageLayer = identified(new AVLayer("Imagem livre " + slot, [], footage), "PRODUTO " + slot);
  [descriptionLayer, mechanicLayer, imageLayer].forEach((layer, index) => { layer.scale.currentValue = [slot * 100 + index, slot * 100 + index]; });
  return { slot, descriptionLayer, descriptionText, mechanicLayer, mechanicSource, imageLayer, footage, price, option, marker, primary, alternate,
    layers: [descriptionLayer, mechanicLayer, imageLayer] };
}

function legal() {
  const legalText = new TextLayer("Texto Legal", "Texto legal existente");
  const cpf = effect("Limitado por CPF", 0, "ADBE Checkbox Control-0001");
  const quantity = effect("Quantidade por CPF", 5, "ADBE Slider Control-0001");
  const legalEffect = effect("Texto Legal", 2, "ADBE Slider Control-0001");
  legalText.properties.push(new PropertyGroup("ADBE Effect Parade", [quantity, legalEffect, cpf]));
  const validity = effect("Texto Validade", 3, "ADBE Slider Control-0001");
  const source = new CompItem([
    new AVLayer("Validade", [new PropertyGroup("ADBE Effect Parade", [validity])]), new AVLayer("Reserva"), legalText,
    new AVLayer("Selo leite"), new AVLayer("Selo moderacao"),
    new AVLayer("Eletro/Pneu", [], new CompItem(Array.from({ length: 9 }, (_, i) => new AVLayer("Opcao " + i)))),
  ], "Texto legal livre");
  return { layer: identified(new AVLayer("Legal externo livre", [], source), "TEXTO LEGAL"), source, legalText, cpf, quantity, legalEffect, validity };
}

function harness(products = [product(1), product(2), product(3)]) {
  const identities = plain(approvedIdentities);
  identities.fallback.offerLayers = false;
  identities.fallback.mechanicLayers = false;
  const identityFile = { text: null, reads: 0, afterRead: null };
  class AssetFile extends File {
    get bytes() { return Buffer.from(identityFile.text ?? JSON.stringify(identities), "utf8").toString("latin1"); }
    get length() { return this.fsName === identitiesFilePath ? this.bytes.length : super.length; }
    read() {
      if (this.fsName !== identitiesFilePath) return super.read();
      assert.equal(this.encoding, "BINARY");
      identityFile.reads += 1;
      const bytes = this.bytes;
      if (identityFile.afterRead) identityFile.afterRead();
      return bytes;
    }
  }
  const legalEnv = legal();
  const offerMarker = identified(new AVLayer("Marcador externo livre"), "MARCADORES");
  offerMarker.marker = new MarkerProperty([2, 6, 10]);
  const source = new CompItem([new AVLayer("Decoracao externa"), ...products.flatMap((item) => item.layers), legalEnv.layer, offerMarker], "Oferta");
  const offer = new AVLayer("Oferta_01", [], source);
  offer.comment = "CAMADA OFERTA 01";
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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { module, exports: module.exports, app, AVLayer, TextLayer, CompItem, FootageItem,
      File: AssetFile, FileSource, Property, PropertyGroup, PropertyValueType: { OneD: 1 },
      require(specifier) {
        assert.ok(specifier.startsWith("."), "Unexpected dependency: " + specifier);
        const base = path.resolve(path.dirname(filename), specifier);
        const target = [base, base + ".ts", base + ".js"].find(existsSync);
        assert.ok(target, "Missing dependency: " + specifier);
        return load(target);
      },
    }, { filename });
    return module.exports;
  }
  const fields = load("actions/updateField.ts");
  const descriptions = load("actions/updateDescription.ts");
  const expressions = load("actions/updateDescriptionExpression.ts");
  const options = load("actions/updateOption.ts");
  const images = load("actions/replaceProductImage.ts");
  const swaps = load("actions/swapProducts.ts");
  const legalActions = load("actions/legalControls.ts");
  const snapshot = load("snapshot/buildOfferSnapshot.ts");
  const discovery = load("snapshot/offerDiscovery.ts");
  load("mechanics/schemaRuntime.ts").configureMechanicsSchemaPath(schemaFilePath);
  load("../template/templateIdentities.ts").configureTemplateIdentitiesPath(identitiesFilePath);
  return { app, source, offer, products, legal: legalEnv, offerMarker, load, identities, identityFile, ...fields, ...descriptions, ...expressions, ...options, ...images, ...swaps, ...legalActions, ...snapshot, ...discovery };
}

function reorder(env, layers) {
  env.source.layers = layers;
  layers.forEach((layer) => { layer.containingComp = env.source; });
}

function assertUndoClosed(env) {
  assert.equal(env.app.undoEvents.length % 2, 0);
  for (let index = 0; index < env.app.undoEvents.length; index += 2) {
    assert.equal(env.app.undoEvents[index][0], "begin");
    assert.deepEqual(env.app.undoEvents[index + 1], ["end"]);
  }
}

function assertProductUntouched(item) {
  assert.deepEqual(item.price.text.sourceText.writes, []);
  assert.deepEqual(effectValue(item.option).writes, []);
  assert.deepEqual(item.descriptionText.text.sourceText.writes, []);
  assert.deepEqual(item.descriptionText.text.sourceText.expressionWrites, []);
  assert.deepEqual(item.footage.replacements, []);
  item.layers.forEach((layer) => {
    assert.deepEqual(layer.scale.writes, []);
    assert.deepEqual(layer.sourceWrites, []);
  });
  assert.equal(item.primary.inPoint, 1.5);
  assert.equal(item.alternate.inPoint, 4.5);
}

function enableStableContext(env) {
  env.app.project.file = { fsName: "C:/Projetos/Ofertas.aep", name: "Ofertas.aep" };
  env.offer.containingComp.id = 101;
  env.offer.id = 201;
  env.source.id = 301;
}

function countValueReads(property, valueReader) {
  const original = Object.getOwnPropertyDescriptor(Property.prototype, "value").get;
  let reads = 0;
  Object.defineProperty(property, "value", { configurable: true, get() {
    reads += 1;
    return valueReader ? valueReader() : original.call(this);
  } });
  return () => reads;
}

test("targeted product preflight validates all associations without reading other product fields or legal controls", () => {
  const env = harness();
  const reads = env.products.map((item) => countValueReads(item.descriptionText.text.sourceText));
  const legalReads = countValueReads(env.legal.legalText.text.sourceText);
  const errors = [];
  const selected = env.generateOfferProductData(env.offer, 1, errors);
  assert.equal(selected.index, 1);
  assert.equal(selected.description.value, "DESCRICAO 2");
  assert.deepEqual(reads.map((read) => read()), [0, 1, 0]);
  assert.equal(legalReads(), 0);
  const duplicate = identified(new AVLayer("Duplicada", [], env.products[1].mechanicSource), "MECANICA 2");
  reorder(env, env.source.layers.concat(duplicate));
  const invalid = env.generateOfferProductData(env.offer, 1, errors);
  assert.equal(invalid.associationValid, false);
  assert.ok(errors.some((error) => error.includes("MECANICA 2")));
  assert.equal(env.updateOfferDescription(1, 1, "Nao escrever").ok, false);
  env.products.forEach(assertProductUntouched);
});

test("successful field edits return a JSON-only fresh entire-offer patch including cross-product expressions", () => {
  const env = harness();
  enableStableContext(env);
  const snapshot = env.getOffersEditorSnapshot(1);
  const other = env.products[1].descriptionText.text.sourceText;
  other.currentExpressionEnabled = true;
  const reads = countValueReads(other, () => ({ text: "DEPENDENTE " + env.products[0].price.text.sourceText.currentValue.text }));
  let projectReads = 0;
  const projectItem = env.app.project.item;
  env.app.project.item = (...args) => { projectReads += 1; return projectItem(...args); };
  const result = env.updateOfferField(1, 0, "preco", "88,90", 0);
  assert.equal(result.ok, true);
  assert.equal(reads(), 1, "unrelated product is read once, after the edit, not during preflight");
  assert.equal(projectReads, 1, "the returned patch reuses the validated offer without rediscovering Miolo");
  assert.deepEqual(plain(result.offerUpdate.context), plain(snapshot.selectedOfferContext));
  assert.equal(result.offerUpdate.offer.products.length, 3);
  assert.equal(result.offerUpdate.offer.products[0].mechanic.fields[0].value, "88,90");
  assert.equal(result.offerUpdate.offer.products[1].description.value, "DEPENDENTE 88,90");
  assert.equal(result.offerUpdate.offer.products[1].description.expressionEnabled, true);
  const json = JSON.stringify(result.offerUpdate);
  assert.equal(/containingComp|descriptionProperty|controllerProperty|currentValue|sourceWrites/.test(json), false);
  assert.deepEqual(plain(snapshot.discoveryErrors), []);
  assertUndoClosed(env);
});

test("legal preflight avoids product reads and its patch reads expression-dependent products after the write", () => {
  const env = harness();
  enableStableContext(env);
  const reads = env.products.map((item) => countValueReads(item.descriptionText.text.sourceText));
  const details = env.generateOfferLegalData(env.offer, []);
  assert.ok(details.legalTextProperty);
  assert.deepEqual(reads.map((read) => read()), [0, 0, 0]);
  const result = env.updateOfferLegalControlValue(1, "quantidade-por-cpf", "8");
  assert.equal(result.ok, true);
  assert.deepEqual(reads.map((read) => read()), [1, 1, 1]);
  assert.equal(result.offerUpdate.offer.legalControls.find((control) => control.id === "quantidade-por-cpf").slider.value, "8");
  assertUndoClosed(env);
});

test("description, expression, option, image and legal actions carry authoritative selected-offer updates", () => {
  for (const edit of [
    (env) => env.updateOfferDescription(1, 0, "Atualizada"),
    (env) => env.updateOfferDescriptionExpression(1, 0, true),
    (env) => env.updateOfferOption(1, 0, "unit", 2),
    (env) => env.replaceOfferProductImage(1, 0, "C:/produtos/troca.png"),
    (env) => env.updateOfferLegalText(1, "Texto atualizado"),
    (env) => env.updateOfferLegalControl(1, "limitado-por-cpf", true),
  ]) {
    const env = harness();
    enableStableContext(env);
    const result = edit(env);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.offerUpdate.context.offerLayerId, env.offer.id);
    assert.deepEqual(plain(result.offerUpdate.offer), plain(env.getOffersEditorSnapshot(1).selectedOffer));
    assertUndoClosed(env);
  }
});

test("post-edit read failure does not turn a successful native write into an action failure", () => {
  const env = harness();
  enableStableContext(env);
  const property = env.products[0].descriptionText.text.sourceText;
  const original = property.setValue.bind(property);
  property.setValue = (value) => {
    original(value);
    Object.defineProperty(env.offer, "name", { get() { throw new Error("Post-read unavailable"); } });
  };
  const result = env.updateOfferDescription(1, 0, "Atualizada");
  assert.equal(result.ok, true);
  assert.equal(result.message, "Descricao atualizada.");
  assert.equal(property.currentValue.text, "ATUALIZADA");
  assert.equal(result.offerUpdate, undefined);
  assertUndoClosed(env);
});

test("missing native context or a changed source during the post-read omits only the patch", () => {
  for (const missing of ["project", "layer", "comp", "source"]) {
    const env = harness();
    enableStableContext(env);
    if (missing === "project") env.app.project.file = null;
    if (missing === "layer") delete env.offer.id;
    if (missing === "comp") env.offer.containingComp.id = NaN;
    if (missing === "source") env.source.id = 0;
    const result = env.updateOfferDescription(1, 0, "Atualizada");
    assert.equal(result.ok, true);
    assert.equal(result.offerUpdate, undefined);
    assertUndoClosed(env);
  }
  const env = harness();
  enableStableContext(env);
  countValueReads(env.products[1].descriptionText.text.sourceText, () => {
    env.source.id = 999;
    return { text: "Alterado durante leitura" };
  });
  const result = env.updateOfferDescription(1, 0, "Atualizada");
  assert.equal(result.ok, true);
  assert.equal(result.offerUpdate, undefined);
  assertUndoClosed(env);
});

test("description editing and its returned patch remain independent of a missing mechanic schema", () => {
  const env = harness();
  enableStableContext(env);
  env.load("mechanics/schemaRuntime.ts").configureMechanicsSchemaPath("");
  const result = env.updateOfferDescription(1, 0, "Ainda editavel");
  assert.equal(result.ok, true);
  assert.equal(result.offerUpdate.offer.products[0].description.value, "AINDA EDITAVEL");
  assert.equal(result.offerUpdate.offer.products[0].description.enabled, true);
  assert.equal(result.offerUpdate.offer.products[0].mechanic.unsupported, true);
  assertUndoClosed(env);
});

test("description, mechanic and product roles retain distinct configured identities for every slot", () => {
  const env = harness();
  const { getOfferRoleIdentity, resolveOfferProductLayers } = env.load("layers/offerStructure.ts");
  for (let slot = 1; slot <= 3; slot += 1) {
    for (const [role, key] of [["DESCRITIVO", "description"], ["MECANICA", "mechanic"], ["PRODUTO", "product"]]) {
      assert.deepEqual(plain(getOfferRoleIdentity(role + " " + slot)), {
        comment: env.identities.offerLayers[key].comment.replace("{n}", String(slot)),
        names: env.identities.offerLayers[key].names.map((name) => name.replace("{n}", String(slot))),
      });
    }
  }
  const errors = [];
  const resolved = resolveOfferProductLayers(env.source, errors);
  assert.deepEqual(plain(errors), []);
  assert.equal(resolved.length, 3);
  for (let index = 0; index < resolved.length; index += 1) {
    assert.equal(resolved[index].descriptionLayer, env.products[index].descriptionLayer);
    assert.equal(resolved[index].mechanicLayer, env.products[index].mechanicLayer);
    assert.equal(resolved[index].imageLayer, env.products[index].imageLayer);
    assertProductUntouched(env.products[index]);
  }
});

test("production-transformed role selection avoids ExtendScript chained-conditional ambiguity", () => {
  const filename = path.join(domainDirectory, "layers/offerStructure.ts");
  const result = transformSync(readFileSync(filename, "utf8"), {
    filename, babelrc: false, configFile: false,
    caller: { name: "rollup", supportsStaticESM: true, supportsDynamicImport: true },
    presets: ["@babel/preset-env", "@babel/preset-typescript"],
    plugins: ["@babel/plugin-syntax-dynamic-import", "@babel/plugin-proposal-class-properties"],
  });
  const parsed = ts.createSourceFile("offerStructure.js", result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let selector;
  const locate = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "getOfferRoleIdentity") selector = node.initializer;
    ts.forEachChild(node, locate);
  };
  locate(parsed);
  assert.ok(selector, "the production transform retains the role selector");
  // Native After Effects interprets a ? b : c ? d : e differently from V8.
  // Guard the emitted code, since Babel removes redundant grouping parentheses.
  const check = (node) => {
    assert.ok(!(ts.isConditionalExpression(node) && ts.isConditionalExpression(node.whenFalse)),
      "a chained ternary can redirect DESCRITIVO to MECANICA in ExtendScript");
    ts.forEachChild(node, check);
  };
  check(selector);
});

test("three comment-numbered products remain associated after independent timeline permutations and renames", () => {
  for (const order of [
    [7, 2, 10, 4, 8, 0, 11, 1, 5, 9, 3, 6],
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    [3, 5, 8, 1, 9, 6, 2, 11, 4, 0, 10, 7],
  ]) {
    const env = harness();
    reorder(env, order.map((index) => env.source.layers[index]));
    env.source.layers.forEach((layer, index) => {
      layer.name = "Visual livre " + index;
      if (layer.comment) layer.comment = "  " + layer.comment.toLowerCase() + "\t";
    });
    const snapshot = env.getOffersEditorSnapshot(1);
    assert.equal(snapshot.ok, true);
    assert.deepEqual(plain(snapshot.selectedOffer.products.map((item) => [item.index, item.description.value, item.mechanic.fields[0].value, item.image.sourceName])), [
      [0, "DESCRICAO 1", "19,90", "Produto 1"], [1, "DESCRICAO 2", "29,90", "Produto 2"], [2, "DESCRICAO 3", "39,90", "Produto 3"],
    ]);
    assert.deepEqual(plain(env.getOffersFirstProductInfo()[0].priceField), { fieldId: "preco", fieldIndex: 0, value: "19,90" });
    assert.equal(env.updateOfferField(1, 1, "preco", "R$ 48,50", 0).ok, true);
    assert.equal(env.updateOfferOption(1, 1, "unit", 3).ok, true);
    assert.equal(env.updateOfferDescription(1, 1, "Nova descrição").ok, true);
    assert.equal(env.updateOfferDescriptionExpression(1, 1, true).ok, true);
    assert.equal(env.replaceOfferProductImage(1, 1, "C:/produtos/substituto.png").ok, true);
    const target = env.products[1];
    assert.deepEqual(target.price.text.sourceText.writes, [{ text: "48,50" }]);
    assert.deepEqual(effectValue(target.option).writes, [4]);
    assert.deepEqual(target.descriptionText.text.sourceText.writes, [{ text: "NOVA DESCRIÇÃO" }]);
    assert.deepEqual(target.descriptionText.text.sourceText.expressionWrites, [true]);
    assert.deepEqual(target.footage.replacements, ["C:/produtos/substituto.png"]);
    assertProductUntouched(env.products[0]);
    assertProductUntouched(env.products[2]);
    assert.equal(env.legal.legalText.text.sourceText.writes.length, 0);
    assertUndoClosed(env);
  }
});

test("inactive lower-numbered slots do not renumber action targets or Roteiro's first active product", () => {
  const env = harness();
  env.products[0].descriptionLayer.enabled = false;
  reorder(env, [...env.products[2].layers.reverse(), env.legal.layer, ...env.products[1].layers.reverse(), ...env.products[0].layers]);
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products.map(({ index }) => index)), [1, 2]);
  const [first] = env.getOffersFirstProductInfo();
  assert.equal(first.productIndex, 1);
  assert.equal(first.priceValue, "29,90");
  assert.equal(env.updateOfferField(1, first.productIndex, first.priceField.fieldId, "67,89", first.priceField.fieldIndex).ok, true);
  assert.equal(env.updateOfferDescription(1, 1, "Segundo").ok, true);
  assert.equal(env.updateOfferOption(1, 1, "unit", 0).ok, true);
  assert.equal(env.replaceOfferProductImage(1, 1, "C:/novo.png").ok, true);
  assert.equal(env.updateOfferField(1, 0, "preco", "99,99", 0).ok, false);
  assert.equal(env.products[1].price.text.sourceText.value.text, "67,89");
  assertProductUntouched(env.products[0]);
  assertProductUntouched(env.products[2]);
  assertUndoClosed(env);
});

for (const role of ["descriptionLayer", "mechanicLayer", "imageLayer"]) {
  for (const invalidation of ["missing", "duplicate", "wrong-type"]) {
    test(`${role} ${invalidation}: invalid trio rejects every target mutation before native writes`, () => {
      const first = product(1, { installment: true });
      const env = harness([first, product(2)]);
      const roleLayer = first[role];
      if (invalidation === "missing") roleLayer.comment = "Sem identidade";
      if (invalidation === "duplicate") {
        const duplicate = identified(new AVLayer("Duplicata", [], roleLayer.source), roleLayer.comment);
        duplicate.enabled = false;
        reorder(env, [...env.source.layers, duplicate]);
      }
      if (invalidation === "wrong-type") roleLayer.source = null;
      for (const action of [
        () => env.updateOfferField(1, 0, "preco", "99,99", 1),
        () => env.updateOfferOption(1, 0, "mechanicCondition", 6),
        () => env.updateOfferInstallmentJump(1, 0, "preco-cheio"),
        () => env.updateOfferDescription(1, 0, "Modificado"),
        () => env.updateOfferDescriptionExpression(1, 0, true),
        () => env.replaceOfferProductImage(1, 0, "C:/invalido.png"),
        () => env.swapOfferProducts(1, 1, 0),
      ]) {
        const result = action();
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.ok(result.errors.length > 0);
        assertProductUntouched(first);
        assertProductUntouched(env.products[1]);
      }
      const [forRoteiro] = env.getOffersFirstProductInfo();
      assert.equal(forRoteiro.priceValue, "");
      assert.equal(forRoteiro.priceField, undefined);
      assert.equal(env.updateOfferField(1, 1, "preco", "24,90", 0).ok, true);
      assert.equal(env.products[1].price.text.sourceText.value.text, "24,90");
      assertProductUntouched(first);
      assertUndoClosed(env);
    });
  }
}

test("comment-only offer lookup ignores legacy names and positions independently of mechanic fallback", () => {
  const env = harness();
  env.identities.fallback.mechanicLayers = true;
  env.products.forEach((item) => item.layers.forEach((layer) => { layer.name = layer.comment; layer.comment = ""; }));
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products), []);
  assert.equal(env.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
  env.products.forEach(assertProductUntouched);
  assertUndoClosed(env);
});

test("locked and disabled mechanic or product layers remain located through comments", () => {
  const env = harness();
  env.products[0].layers.forEach((layer) => { layer.locked = true; });
  env.products[0].mechanicLayer.enabled = false;
  env.products[0].imageLayer.enabled = false;
  const item = env.getOffersEditorSnapshot(1).selectedOffer.products[0];
  assert.equal(item.index, 0);
  assert.equal(item.description.value, "DESCRICAO 1");
  assert.equal(item.mechanic.fields[0].value, "19,90");
  assert.equal(item.image.enabled, false);
  env.products.forEach(assertProductUntouched);
});

test("moved legal precomp uses its outer comment while internal controls retain their indices and effect identities", () => {
  const env = harness();
  const decoy = new AVLayer("TEXTO LEGAL", [], new CompItem([new TextLayer("Texto Legal", "Nao alterar")], "Legal decorativo"));
  reorder(env, [decoy, ...env.products[2].layers, env.offerMarker, ...env.products[0].layers, ...env.products[1].layers, env.legal.layer]);
  const selected = env.getOffersEditorSnapshot(1).selectedOffer;
  assert.equal(selected.legalText.value, "Texto legal existente");
  const cpf = selected.legalControls.find((item) => item.id === "limitado-por-cpf");
  assert.equal(cpf.layerIndex, 3);
  assert.equal(env.updateOfferLegalControl(1, "limitado-por-cpf", true).ok, true);
  assert.equal(env.updateOfferLegalControlValue(1, "quantidade-por-cpf", "8").ok, true);
  assert.equal(env.updateOfferLegalControl(1, "selo-leite", false).ok, true);
  assert.equal(env.updateOfferLegalControlValue(1, "tarja-validade", "4").ok, true);
  assert.deepEqual(effectValue(env.legal.cpf).writes, [1]);
  assert.deepEqual(effectValue(env.legal.quantity).writes, [8]);
  assert.deepEqual(effectValue(env.legal.validity).writes, [4]);
  assert.equal(env.legal.source.layer(4).enabled, false);
  assert.equal(decoy.source.layer(1).text.sourceText.value.text, "Nao alterar");
  env.products.forEach(assertProductUntouched);
  assertUndoClosed(env);
});

test("duplicated legal comment blocks legal writes while product editing stays independent", () => {
  const env = harness();
  const duplicate = identified(new AVLayer("Outro legal", [], env.legal.source), " texto legal ");
  reorder(env, [...env.source.layers, duplicate]);
  assert.equal(env.updateOfferLegalControl(1, "limitado-por-cpf", true).ok, false);
  assert.deepEqual(effectValue(env.legal.cpf).writes, []);
  assert.equal(env.updateOfferField(1, 2, "preco", "43,21", 0).ok, true);
  assert.equal(env.products[2].price.text.sourceText.value.text, "43,21");
  assertProductUntouched(env.products[0]);
  assertProductUntouched(env.products[1]);
  assertUndoClosed(env);
});

for (const [roleKey, comment, location] of [
  ["mechanicLayer", "MECANICA 2", "camada da mecânica"],
  ["imageLayer", "PRODUTO 2", "camada da imagem do produto"],
]) {
  for (const invalidation of ["missing", "duplicate", "wrong-source"]) {
    test(`offer comment hint identifies only the affected second product (${comment}, ${invalidation})`, () => {
      const env = harness([product(1), product(2)]);
      const layer = env.products[1][roleKey];
      if (invalidation === "missing") layer.comment = "";
      if (invalidation === "duplicate") {
        reorder(env, [...env.source.layers, identified(new AVLayer("Duplicata", [], layer.source), comment)]);
      }
      if (invalidation === "wrong-source") layer.source = null;

      const snapshot = env.getOffersEditorSnapshot(1);
      const [first, second] = snapshot.selectedOffer.products;
      assert.deepEqual(plain(snapshot.selectedOffer.products.map(({ index }) => index)), [0, 1]);
      assert.equal(first.disabledReason, undefined);
      assert.equal(first.disabledSummary, undefined);
      assert.equal(first.description.enabled, true);
      assert.equal(first.mechanic.fields[0].enabled, true);
      assert.equal(first.mechanic.optionGroups[0].enabled, true);
      assert.equal(first.mechanic.optionGroups[0].disabledReason, undefined);
      assert.equal(first.mechanic.type, "Simples");
      assert.equal(second.description.enabled, false);
      assert.ok(second.disabledReason.includes('"' + comment + '"'));
      assert.ok(second.disabledReason.includes('na oferta "Oferta"'));
      if (invalidation === "missing") {
        assert.ok(second.disabledReason.includes("Adicione-o à " + location));
        assert.equal(second.disabledSummary,
          'Não foi encontrada uma camada com o comentário "' + comment + '" nesta oferta.');
      } else if (invalidation === "duplicate") {
        assert.ok(second.disabledReason.includes("repetido"));
        assert.ok(second.disabledReason.includes("Mantenha-o apenas na " + location));
        assert.equal(second.disabledSummary,
          'Mais de uma camada possui o comentário "' + comment + '" nesta oferta.');
      } else {
        assert.ok(second.disabledReason.includes("válida como origem"));
        assert.match(second.disabledSummary, /origem da camada.*válida/);
      }
      assert.ok(second.disabledSummary.includes('"' + comment + '"'));
      assert.equal(second.mechanic.type, roleKey === "mechanicLayer"
        ? "Mecânica do produto 2" + (invalidation === "missing"
          ? " não identificada" : invalidation === "duplicate" ? " ambígua" : " sem precomp válida")
        : "Simples");
      assert.equal(second.description.disabledReason, second.disabledReason);
      assert.equal(second.mechanic.disabledReason, second.disabledReason);
      assert.equal(second.description.disabledSummary, second.disabledSummary);
      assert.equal(second.mechanic.disabledSummary, second.disabledSummary);
      for (const control of [...second.mechanic.fields, ...second.mechanic.optionGroups]) {
        assert.equal(control.enabled, false);
        assert.equal(control.disabledReason, second.disabledReason);
        assert.equal(control.disabledSummary, second.disabledSummary);
      }
      env.products.forEach(assertProductUntouched);
      assert.deepEqual(env.app.undoEvents, []);
    });
  }
}

test("multiple missing product comments keep the mechanic warning and each required comment specific", () => {
  const env = harness([product(1), product(2)]);
  env.products[1].mechanicLayer.comment = "";
  env.products[1].imageLayer.comment = "";

  const [first, second] = env.getOffersEditorSnapshot(1).selectedOffer.products;
  assert.equal(first.mechanic.type, "Simples");
  assert.equal(first.disabledSummary, undefined);
  assert.equal(second.mechanic.type, "Mecânica do produto 2 não identificada");
  for (const comment of ["MECANICA 2", "PRODUTO 2"]) {
    assert.ok(second.mechanic.disabledSummary.includes('"' + comment + '"'));
    assert.ok(second.mechanic.disabledReason.includes('"' + comment + '"'));
  }
  assert.equal(second.description.enabled, false);
  env.products.forEach(assertProductUntouched);
  assert.deepEqual(env.app.undoEvents, []);
});

for (const invalidation of ["missing", "duplicate", "wrong-source"]) {
  test(`legal comment hint explains the unavailable precomp without affecting products (${invalidation})`, () => {
    const env = harness([product(1), product(2)]);
    if (invalidation === "missing") env.legal.layer.comment = "";
    if (invalidation === "duplicate") {
      reorder(env, [...env.source.layers, identified(new AVLayer("Outro legal", [], env.legal.source), "TEXTO LEGAL")]);
    }
    if (invalidation === "wrong-source") env.legal.layer.source = null;

    const { getLegalTextSource } = env.load("layers/legalControls.ts");
    const oldErrors = [];
    const errors = [];
    const reasons = [];
    const summaries = [];
    assert.equal(getLegalTextSource(env.source, oldErrors), null);
    assert.equal(getLegalTextSource(env.source, errors, reasons, summaries), null);
    assert.deepEqual(errors, oldErrors);
    assert.equal(reasons.length, 1);
    assert.equal(summaries.length, 1);
    assert.match(summaries[0], invalidation === "missing" ? /Não foi encontrada uma camada.*"TEXTO LEGAL"/
      : invalidation === "duplicate" ? /Mais de uma camada.*comentário "TEXTO LEGAL"/ : /origem da camada.*precomp válida/);
    assert.ok(reasons[0].includes('"TEXTO LEGAL"'));
    assert.ok(reasons[0].includes('na oferta "Oferta"'));
    assert.ok(reasons[0].includes(invalidation === "missing" ? "Adicione-o" : invalidation === "duplicate" ? "Mantenha-o apenas" : "precomp válida como origem"));

    const selected = env.getOffersEditorSnapshot(1).selectedOffer;
    selected.legalControls.forEach((control) => {
      assert.equal(control.available, false);
      assert.equal(control.disabledReason, reasons[0]);
      assert.equal(control.disabledSummary, summaries[0]);
    });
    selected.products.forEach((item) => {
      assert.equal(item.disabledReason, undefined);
      assert.equal(item.disabledSummary, undefined);
      assert.equal(item.description.enabled, true);
      assert.equal(item.mechanic.fields[0].enabled, true);
      assert.equal(item.mechanic.optionGroups[0].enabled, true);
    });
    env.products.forEach(assertProductUntouched);
    assert.deepEqual(env.app.undoEvents, []);
  });
}

test("product swap keeps numbered role comments while exchanging all three sources, scales and names", () => {
  const env = harness();
  const first = env.products[0];
  const third = env.products[2];
  reorder(env, [third.imageLayer, first.mechanicLayer, env.legal.layer, third.descriptionLayer,
    first.imageLayer, ...env.products[1].layers, third.mechanicLayer, first.descriptionLayer]);
  const firstBefore = first.layers.map((layer) => ({ source: layer.source, name: layer.name, scale: layer.scale.value, comment: layer.comment }));
  const thirdBefore = third.layers.map((layer) => ({ source: layer.source, name: layer.name, scale: layer.scale.value, comment: layer.comment }));
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, true);
  for (let index = 0; index < 3; index += 1) {
    for (const [layers, expected, comments] of [[first.layers, thirdBefore, firstBefore], [third.layers, firstBefore, thirdBefore]]) {
      assert.equal(layers[index].source, expected[index].source);
      assert.equal(layers[index].name, expected[index].name);
      assert.deepEqual(layers[index].scale.value, expected[index].scale);
      assert.equal(layers[index].comment, comments[index].comment);
      assert.equal(layers[index].sourceWrites.length, 1);
      assert.equal(layers[index].sourceWrites[0].fixExpressions, true);
    }
  }
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products.map((item) => [item.index, item.description.value, item.mechanic.fields[0].value, item.image.sourceName])), [
    [0, "DESCRICAO 3", "39,90", "Produto 3"], [1, "DESCRICAO 2", "29,90", "Produto 2"], [2, "DESCRICAO 1", "19,90", "Produto 1"],
  ]);
  const [firstForRoteiro] = env.getOffersFirstProductInfo();
  assert.equal(firstForRoteiro.productIndex, 0);
  assert.equal(firstForRoteiro.priceValue, "39,90");
  assertProductUntouched(env.products[1]);
  assertUndoClosed(env);
});

test("swap preflight rejects unavailable scale before replacing any component", () => {
  const env = harness();
  env.products[2].imageLayer.scale = null;
  const before = env.products.flatMap((item) => item.layers.map((layer) => [layer.source, layer.name, layer.comment]));
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, false);
  assert.deepEqual(env.products.flatMap((item) => item.layers.map((layer) => [layer.source, layer.name, layer.comment])), before);
  env.products.forEach((item) => item.layers.forEach((layer) => {
    assert.deepEqual(layer.sourceWrites, []);
    if (layer.scale) assert.deepEqual(layer.scale.writes, []);
  }));
  assertUndoClosed(env);
});

for (const invalidation of ["missing", "duplicate"]) {
  test(`Roteiro does not redirect an unresolved first description (${invalidation}) to slot two`, () => {
    const env = harness();
    if (invalidation === "missing") env.products[0].descriptionLayer.comment = "Comentario desconhecido";
    else reorder(env, [...env.source.layers,
      identified(new AVLayer("Outra descricao", [], env.products[0].descriptionLayer.source), "DESCRITIVO 1")]);
    const [first] = env.getOffersFirstProductInfo();
    assert.equal(first.priceValue, "");
    assert.equal(first.priceField, undefined);
    env.products.forEach(assertProductUntouched);
  });
}

test("an invalid later slot does not block Roteiro from reading and correcting the valid first slot", () => {
  const env = harness();
  env.products[2].imageLayer.comment = "Sem imagem identificada";
  const [first] = env.getOffersFirstProductInfo();
  assert.equal(first.productIndex, 0);
  assert.equal(first.priceValue, "19,90");
  assert.equal(env.updateOfferField(1, first.productIndex, first.priceField.fieldId, "28,90", first.priceField.fieldIndex).ok, true);
  assert.equal(env.products[0].price.text.sourceText.value.text, "28,90");
  assertProductUntouched(env.products[1]);
  assertProductUntouched(env.products[2]);
  assertUndoClosed(env);
});

test("offer marker lookup stays in the outer composition and cannot consume internal mechanic markers", () => {
  const env = harness([product(1, { installment: true })]);
  const { getOfferMarkerLayer } = env.load("layers/offerStructure.ts");
  const errors = [];
  assert.equal(getOfferMarkerLayer(env.source, errors), env.offerMarker);
  assert.deepEqual(errors, []);
  assert.equal(env.updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
  assert.equal(env.products[0].primary.inPoint, 5);
  assert.equal(env.products[0].alternate.inPoint, 12);
  assert.deepEqual(env.offerMarker.marker.times, [2, 6, 10]);
  assert.deepEqual(env.products[0].marker.marker.times, [1, 5, 9]);
  assertUndoClosed(env);
});

test("name fallback resolves exact roles independently and product swaps preserve names that identify the slots", () => {
  const env = harness();
  env.identities.fallback.offerLayers = true;
  env.products.forEach((item) => item.layers.forEach((layer) => { layer.name = layer.comment; layer.comment = ""; }));
  const beforeNames = env.products.flatMap((item) => item.layers.map((layer) => layer.name));
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products.map(({ index }) => index)), [0, 1, 2]);
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, true);
  assert.deepEqual(env.products.flatMap((item) => item.layers.map((layer) => layer.name)), beforeNames);
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products.map((item) => [item.index, item.description.value, item.mechanic.fields[0].value])), [
    [0, "DESCRICAO 3", "39,90"], [1, "DESCRICAO 2", "29,90"], [2, "DESCRICAO 1", "19,90"],
  ]);
  assert.equal(env.updateOfferField(1, 0, "preco", "41,90", 0).ok, true);
  assert.equal(env.products[2].price.text.sourceText.value.text, "41,90");
  assert.equal(env.products[0].price.text.sourceText.value.text, "19,90");
  assertUndoClosed(env);
});

test("recognized comments always win over conflicting fallback names across numbered roles", () => {
  const env = harness();
  env.identities.fallback.offerLayers = true;
  env.products[0].mechanicLayer.name = "MECANICA 2";
  env.products[1].mechanicLayer.comment = "";
  env.products[1].mechanicLayer.name = "Mecanica visual sem identidade";
  assert.equal(env.updateOfferField(1, 1, "preco", "99,90", 0).ok, false);
  env.products.forEach(assertProductUntouched);
  assert.equal(env.updateOfferField(1, 0, "preco", "21,90", 0).ok, true);
  assert.equal(env.products[0].price.text.sourceText.value.text, "21,90");
  assertProductUntouched(env.products[1]);
  assertUndoClosed(env);
});

test("the distributed map controls external aliases and legal CPF lookup on the next operation", () => {
  const env = harness([product(1)]);
  env.identities.offerLayers.description.names.push("DESCRIPTION {n}");
  env.products[0].descriptionLayer.comment = "";
  env.products[0].descriptionLayer.name = "DESCRIPTION 1";
  env.legal.layer.comment = "";
  env.legal.layer.name = "TEXTO LEGAL_03";
  assert.equal(env.updateOfferDescription(1, 0, "NEW").ok, false);
  assert.equal(env.updateOfferLegalControl(1, "cpf", true).ok, false);
  env.identities.fallback.offerLayers = true;
  assert.equal(env.updateOfferDescription(1, 0, "NEW").ok, true);
  assert.equal(env.products[0].descriptionText.text.sourceText.value.text, "NEW");
  const snapshot = env.getOffersEditorSnapshot(1);
  const cpf = snapshot.selectedOffer.legalControls.find((item) => item.id.includes("cpf"));
  assert.ok(cpf, "the legal controls include CPF");
  assert.equal(env.updateOfferLegalControl(1, cpf.id, true).ok, true);
  assert.equal(effectValue(env.legal.cpf).value, 1);
  assertUndoClosed(env);
});

test("one map is pinned throughout product swaps and later operations reload its flags", () => {
  const env = harness();
  env.identities.fallback.offerLayers = true;
  env.products.forEach((item) => item.layers.forEach((layer) => { layer.name = layer.comment; layer.comment = ""; }));
  const beforeNames = env.products.flatMap((item) => item.layers.map((layer) => layer.name));
  env.identityFile.afterRead = () => {
    env.identities.fallback.offerLayers = false;
    env.identityFile.afterRead = null;
  };
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, true);
  assert.equal(env.identityFile.reads, 1);
  assert.deepEqual(env.products.flatMap((item) => item.layers.map((layer) => layer.name)), beforeNames);
  assert.equal(env.getOffersEditorSnapshot(1).selectedOffer.products.length, 0);
  assert.equal(env.identityFile.reads, 2);
  assertUndoClosed(env);
});

test("an invalid map blocks edits before undo or property writes and recovers on the next operation", () => {
  const env = harness();
  env.identityFile.text = '{"version": 1, "version": 1}';
  const snapshot = env.getOffersEditorSnapshot(1);
  assert.equal(snapshot.ok, false);
  assert.match(snapshot.message, /identidades|template-identities/);
  assert.equal(env.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
  assert.equal(env.swapOfferProducts(1, 0, 1).ok, false);
  assert.equal(env.updateOfferLegalText(1, "CHANGED").ok, false);
  env.products.forEach(assertProductUntouched);
  assert.deepEqual(env.legal.legalText.text.sourceText.writes, []);
  assert.deepEqual(env.app.undoEvents, []);
  env.identityFile.text = null;
  assert.equal(env.updateOfferField(1, 0, "preco", "21,90", 0).ok, true);
});

test("duplicate external aliases and duplicate comments never pick an arbitrary product", () => {
  for (const duplicateComment of [false, true]) {
    const env = harness([product(1)]);
    env.identities.fallback.offerLayers = true;
    const original = env.products[0].mechanicLayer;
    original.name = "MECANICA 1";
    if (!duplicateComment) original.comment = "";
    const decoy = new AVLayer("MECANICA 1", [], original.source);
    decoy.comment = duplicateComment ? original.comment : "";
    reorder(env, [...env.source.layers, decoy]);
    assert.equal(env.updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
    env.products.forEach(assertProductUntouched);
  }
});

test("native failure on the third source swap restores earlier components without changing comments", () => {
  const env = harness();
  const layers = [...env.products[0].layers, ...env.products[2].layers];
  const before = layers.map((layer) => ({ source: layer.source, name: layer.name, scale: layer.scale.value, comment: layer.comment }));
  env.products[2].imageLayer.replaceFailure = 1;
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, false);
  layers.forEach((layer, index) => {
    assert.equal(layer.source, before[index].source);
    assert.equal(layer.name, before[index].name);
    assert.equal(layer.comment, before[index].comment);
    assert.deepEqual(layer.scale.value, before[index].scale);
  });
  assertProductUntouched(env.products[1]);
  assert.deepEqual(plain(env.getOffersEditorSnapshot(1).selectedOffer.products.map((item) => [item.index, item.description.value, item.mechanic.fields[0].value])), [
    [0, "DESCRICAO 1", "19,90"], [1, "DESCRICAO 2", "29,90"], [2, "DESCRICAO 3", "39,90"],
  ]);
  assertUndoClosed(env);
});

test("animated scale on the final image component rejects swap before any replacement", () => {
  const env = harness();
  env.products[2].imageLayer.scale.numKeys = 1;
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, false);
  env.products.forEach(assertProductUntouched);
  assertUndoClosed(env);
});

test("failed swap restores the underlying scale value while preserving its enabled expression", () => {
  const env = harness();
  env.source.time = 2.5;
  const first = env.products[0].descriptionLayer;
  const third = env.products[2].descriptionLayer;
  const scale = first.scale;
  const originalBase = [110, 120];
  const evaluated = [440, 550];
  scale.currentValue = originalBase;
  scale.expressionValue = evaluated;
  scale.expression = "[440, 550]";
  scale.currentExpressionEnabled = true;
  const targetScale = third.scale.value;
  const layers = [...env.products[0].layers, ...env.products[2].layers];
  const states = layers.map((layer) => ({ source: layer.source, name: layer.name, comment: layer.comment, scale: layer.scale.value }));
  env.products[2].imageLayer.replaceFailure = 1;
  assert.equal(env.swapOfferProducts(1, 0, 2).ok, false);
  assert.deepEqual(scale.valueAtTimeCalls, [[2.5, true]]);
  assert.deepEqual(scale.writes[0], targetScale);
  assert.deepEqual(third.scale.writes[0], evaluated);
  assert.deepEqual(scale.currentValue, originalBase);
  assert.deepEqual(scale.writes.at(-1), originalBase);
  assert.deepEqual(scale.value, evaluated);
  assert.equal(scale.expressionEnabled, true);
  assert.equal(scale.expression, "[440, 550]");
  assert.deepEqual(scale.expressionWrites, []);
  layers.forEach((layer, index) => {
    assert.equal(layer.source, states[index].source);
    assert.equal(layer.name, states[index].name);
    assert.equal(layer.comment, states[index].comment);
    assert.deepEqual(layer.scale.value, states[index].scale);
  });
  assertProductUntouched(env.products[1]);
  assertUndoClosed(env);
});

test("image precomps preserve preview discovery and product association without changing footage-only replacement", () => {
  const env = harness();
  const original = env.products[1].footage;
  env.products[1].imageLayer.source = new CompItem([new AVLayer("Arquivo interno", [], original)], "Imagem em precomp");
  const image = env.getOffersEditorSnapshot(1).selectedOffer.products[1].image;
  assert.equal(image.sourceName, "Imagem em precomp");
  assert.equal(image.filePath, "C:/produtos/Produto 2.png");
  assert.equal(env.updateOfferField(1, 1, "preco", "45,90", 0).ok, true);
  assert.equal(env.replaceOfferProductImage(1, 1, "C:/novo.png").ok, false);
  assert.deepEqual(original.replacements, []);
  assertProductUntouched(env.products[0]);
  assertProductUntouched(env.products[2]);
  assertUndoClosed(env);
});
