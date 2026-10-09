import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const domainDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
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

// Simulate AE objects only. Registry, snapshots, readers, actions and mutation
// helpers are the production modules, including the shared jump implementation.
class Property {
  constructor(name, value, dropdown = false) {
    this.name = this.matchName = name;
    this.currentValue = value;
    this.propertyValueType = typeof value === "number" ? 1 : 2;
    this.isDropdownEffect = dropdown;
  }
  get value() { return plain(this.currentValue); }
  setValue(value) { this.currentValue = plain(value); }
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
    assert.ok(index > 0 && index <= this.numKeys);
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
  get inPoint() { return this.startTime + this.inPointOffset; }
  set inPoint(value) { this.inPointOffset = value - this.startTime; }
}

class TextLayer extends AVLayer {
  constructor(name, value) {
    const sourceText = new Property("ADBE Text Document", { text: value, fontSize: 48 });
    super(name, [new PropertyGroup("ADBE Text Properties", [sourceText])]);
    this.text = { sourceText };
  }
}

class CompItem {
  constructor(layers, name = "Precomp personalizada", comment = "") {
    this.layers = layers;
    this.name = name;
    this.comment = comment;
    this.duration = 12;
    layers.forEach((layer, index) => { layer.index = index + 1; });
  }
  get numLayers() { return this.layers.length; }
  layer(indexOrName) {
    return typeof indexOrName === "number"
      ? this.layers[indexOrName - 1] || null
      : this.layers.find((item) => item.name === indexOrName) || null;
  }
}

class FileSource { constructor() { this.file = { fsName: "C:/produtos/123.png" }; } }
class FootageItem { constructor() { this.name = "123.png"; this.mainSource = new FileSource(); } }
const app = {
  project: null,
  undoEvents: [],
  beginUndoGroup(name) { this.undoEvents.push(["begin", name]); },
  endUndoGroup() { this.undoEvents.push(["end"]); },
};
const context = vm.createContext({
  app, AVLayer, TextLayer, CompItem, Property, PropertyGroup, FootageItem,
  FileSource, PropertyValueType: { OneD: 1 },
  File,
});
const modules = new Map();
function loadModule(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const javaScript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const require = (specifier) => {
    assert.ok(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
    const base = path.resolve(path.dirname(filename), specifier);
    const target = [base, base + ".ts", base + ".js"].find(existsSync);
    assert.ok(target, `Missing dependency: ${specifier}`);
    return loadModule(target);
  };
  vm.runInContext(`(function(exports, require, module) {\n${javaScript}\n})`, context, { filename })(module.exports, require, module);
  return module.exports;
}

const { readMechanic } = loadModule(path.join(domainDirectory, "mechanics/registry.ts"));
const { updateOfferField } = loadModule(path.join(domainDirectory, "actions/updateField.ts"));
const { updateOfferOption, updateOfferInstallmentJump } = loadModule(path.join(domainDirectory, "actions/updateOption.ts"));
const { getOffersEditorSnapshot } = loadModule(path.join(domainDirectory, "snapshot/buildOfferSnapshot.ts"));
const { getOffersFirstProductInfo } = loadModule(path.join(domainDirectory, "snapshot/offerDiscovery.ts"));
loadModule(path.join(domainDirectory, "mechanics/schemaRuntime.ts")).configureMechanicsSchemaPath(schemaFilePath);

const units = ["Cada", "Kg", "A cada 100g", "Kg/cada"];
const subtypes = ["Padrão", "Meu Carrefour", "Cartão Carrefour"];
const effect = (name, value, dropdown = true) => new PropertyGroup(name, [new Property("Menu", value, dropdown)]);
const controller = (...effects) => new AVLayer("Controlador de Mecânica", [new PropertyGroup("ADBE Effect Parade", effects)]);
const group = (id, label, selectedIndex, options, placement = "controls") => ({ id, label, selectedIndex, options, placement });

// Index/name/value inputs are explicit template contracts, not generated from
// readers. Expected field metadata and dropdown order are independent assertions.
const cases = [
  {
    identity: "SIMPLES", type: "Simples", count: 5,
    texts: [[2, "PRECO", "15,90"]], controllerIndex: 4, effects: [["Unidade", 2]],
    fields: [["preco", "Preco", "price", "15,90"]],
    groups: [group("unit", "Unidade", 1, units)],
  },
  {
    identity: "TODOS A COM LEVE X PAGUE Y", type: "Todos A Com Leve X Pague Y", count: 6,
    texts: [[4, "LEVE X", "3"], [5, "PAGUE Y", "2"]], controllerIndex: 3, effects: [["Subtipo", 3]],
    fields: [["leve-x", "Leve X", "integer", "3"], ["pague-y", "Pague Y", "integer", "2"]],
    groups: [group("subtype", "Subtipo", 2, subtypes)],
  },
  {
    identity: "TODOS A COM X% DESCONTO", type: "Todos A Com X% Desconto", count: 5,
    texts: [[4, "PORCENTAGEM DESCONTO", "25"]], controllerIndex: 3,
    effects: [["Tipo", 2], ["Subtipo", 3]],
    fields: [["por-centagem-desconto", "Desconto", "percent", "25"]],
    groups: [group("mechanicType", "Tipo", 1, ["desconto", "na 2ª unidade", "Direto no caixa"]), group("mechanicSubtype", "Subtipo", 2, subtypes)],
  },
  {
    identity: "DESCONTO R$ CARTAO CRF", type: "Desconto R$ Cartao CRF", count: 5,
    texts: [[4, "PRECO DESCONTO", "7,50"]],
    fields: [["desconto-reais", "Desconto", "price", "7,50"]], groups: [],
  },
  {
    identity: "DE X POR Y PARCELAMENTO", type: "De X Por Y Parcelamento", count: 21,
    texts: [[6, "PRECO DE", "199,90"], [11, "PRECO", "179,90"], [17, "PRECO PARCELA", "59,97"], [20, "NUMERO DE PARCELAS", "3"]],
    controllerIndex: 5, effects: [["Controle sem relação", 19, false], ["Condição", 4]],
    optionEffectIndices: [1],
    fields: [["preco-de", "De", "price", "199,90"], ["preco", "Preco", "price", "179,90"], ["preco-parcela", "Parcela", "price", "59,97"], ["numero-de-parcelas", "Parcelas", "integer", "3"]],
    groups: [group("mechanicCondition", "Mecânica", 3, ["Cartão Carrefour", "Plano Controle", "Cartão Carrefour/Plano Controle", "De/Por no Cartão Carrefour", "De/Por no Plano Controle", "De/Por no Cartão Carrefour/Plano Controle", "De/Por no Cartão Carrefour PB"], "header")],
    jumpNames: ["PULO PREÇO CHEIO", "PULO PARCELA"],
  },
  {
    identity: "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y", type: "De X Por Y | X% Desconto | Leve X Pague Y", count: 17,
    texts: [[6, "PRECO DE", "25,90"], [12, "PRECO POR", "20,90"], [16, "PORCENTAGEM DESCONTO", "15"]],
    controllerIndex: 5, effects: [["Tipo", 3], ["Subtipo", 2], ["Unidade", 4], ["Quantidade X", 6, false]],
    quantityField: true,
    fields: [["preco-de", "Preco De", "price", "25,90"], ["preco-por", "Preco Por", "price", "20,90"], ["quantidade-x", "Quantidade X", "integer", "6"], ["por-centagem-desconto", "Desconto", "percent", "15"]],
    groups: [group("mechanicType", "Tipo", 2, ["De Por", "Nesta Embalagem", "Levando X Unidades", "Com o Desconto", "A partir de X Unidades"], "header"), group("mechanicSubtype", "Subtipo", 1, subtypes), group("unit", "Unidade", 3, units)],
    jumpNames: ["PULO PREÇO CHEIO", "PULO"],
  },
  {
    identity: "DE X POR Y MEU CRF POR Z CARTAO CRF", type: "De X Por Y Meu CRF Por Z Cartao CRF", count: 10,
    texts: [[4, "PRECO DE", "18,90"], [6, "PRECO POR", "15,90"], [8, "PRECO POR CARTAO", "12,90"]],
    controllerIndex: 9, effects: [["Controle sem relação", 33], ["Unidade", 3]],
    optionEffectIndices: [1],
    fields: [["preco-de", "De", "price", "18,90"], ["preco-por", "Por", "price", "15,90"], ["preco-por-cartao", "Por cartão", "price", "12,90"]],
    groups: [group("unit", "Unidade", 2, units)],
    jumpNames: ["PULO PREÇO MEU CRF", "PULO PREÇO CARTAO CRF"],
  },
];

function fixture(spec) {
  const layers = Array.from({ length: spec.count }, (_, index) => new AVLayer("Decoracao " + (index + 1)));
  const textProperties = spec.texts.map(([index, name, value]) => {
    const layer = new TextLayer(name, value);
    layers[index - 1] = layer;
    return layer.text.sourceText;
  });
  const effects = (spec.effects || []).map((values) => effect(...values));
  if (spec.controllerIndex) layers[spec.controllerIndex - 1] = controller(...effects);
  if (spec.identity === "SIMPLES") {
    layers[spec.texts[0][0] - 1].comment = "PRECO";
    layers[spec.controllerIndex - 1].comment = "CONTROLADOR DE MECANICA";
  } else if (spec.identity === "TODOS A COM LEVE X PAGUE Y") {
    layers[3].comment = "LEVE X";
    layers[4].comment = "PAGUE Y";
    layers[spec.controllerIndex - 1].comment = "CONTROLADOR DE MECANICA";
  } else if (spec.identity === "TODOS A COM X% DESCONTO") {
    layers[3].comment = "PORCENTAGEM DESCONTO";
    layers[spec.controllerIndex - 1].comment = "CONTROLADOR DE MECANICA";
  } else if (spec.identity === "DESCONTO R$ CARTAO CRF") {
    layers[3].comment = "PRECO DESCONTO";
  }
  if (spec.jumpNames) {
    layers[0] = new AVLayer("Marcadores");
    layers[0].marker = new MarkerProperty([1.25, 5, 9]);
    spec.jumpNames.forEach((name, index) => {
      const layer = new AVLayer(name);
      layer.startTime = 2 + index;
      layer.inPoint = 2.5 + index * 2.5;
      layers[index + 1] = layer;
    });
  }
  if (spec.identity === "DE X POR Y PARCELAMENTO") {
    for (const [index, comment] of [[1, "MARCADORES"], [2, "PULO PRECO CHEIO"], [3, "PULO PARCELA"], [5, "CONTROLADOR DE MECANICA"], [6, "PRECO DE"], [11, "PRECO"], [17, "PRECO PARCELA"], [20, "NUMERO DE PARCELAS"]]) {
      layers[index - 1].comment = comment;
    }
  } else if (spec.identity === "DE X POR Y MEU CRF POR Z CARTAO CRF") {
    for (const [index, comment] of [[1, "MARCADORES"], [2, "PULO PRECO MEU CRF"], [3, "PULO PRECO CARTAO CRF"], [4, "PRECO DE"], [6, "PRECO POR"], [8, "PRECO POR CARTAO"], [9, "CONTROLADOR DE MECANICA"]]) {
      layers[index - 1].comment = comment;
    }
  } else if (spec.identity === "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y") {
    for (const [index, comment] of [[1, "MARCADORES"], [2, "PULO PRECO CHEIO"], [3, "PULO"], [5, "CONTROLADOR DE MECANICA"], [6, "PRECO DE"], [12, "PRECO POR"], [16, "PORCENTAGEM DESCONTO"]]) {
      layers[index - 1].comment = comment;
    }
  }
  const source = new CompItem(layers, "Nome personalizado", spec.identity);
  const fields = [...textProperties];
  if (spec.quantityField) fields.splice(2, 0, effects[3].property(1));
  const optionProperties = spec.groups.map((_, index) => effects[spec.optionEffectIndices?.[index] ?? index].property(1));
  return { source, valueLayer: new AVLayer("Layer sem identificação", [], source), fields, optionProperties };
}

function mountOffer(env) {
  const legalText = new TextLayer("Texto legal", "Oferta válida enquanto durarem os estoques.");
  legalText.properties.push(new PropertyGroup("ADBE Effect Parade", [effect("Ajuste", 80, false)]));
  const legalSource = new CompItem([
    controller(effect("Validade", 12, false)), new AVLayer("Fundo"), legalText,
    new AVLayer("Leite"), new AVLayer("Moderação"),
    new AVLayer("Eletro", [], new CompItem(Array.from({ length: 9 }, (_, i) => new AVLayer("Opção " + i)))),
  ], "Legal");
  const offerSource = new CompItem([
    new AVLayer("Legal", [], legalSource),
    new AVLayer("DESCRITIVO 1", [], new CompItem([new TextLayer("DESCRITIVO", "PRODUTO")], "Descrição")),
    env.valueLayer,
    new AVLayer("Produto", [], new FootageItem()),
  ], "Oferta");
  for (const [index, comment] of [[1, "TEXTO LEGAL"], [2, "DESCRITIVO 1"], [3, "MECANICA 1"], [4, "PRODUTO 1"]]) {
    offerSource.layer(index).comment = comment;
  }
  const miolo = new CompItem([new AVLayer("Oferta_01", [], offerSource)], "Miolo");
  app.project = { numItems: 1, item: () => miolo };
  app.undoEvents = [];
  return miolo;
}

function propertiesIn(source) {
  const properties = [];
  const visit = (item) => {
    if (item instanceof Property) properties.push(item);
    if (item instanceof PropertyGroup) item.properties.forEach(visit);
    if (item instanceof AVLayer && item.source instanceof CompItem) visit(item.source);
    if (item instanceof CompItem) item.layers.forEach(visit);
  };
  visit(source);
  return properties;
}

const assertUndoClosed = () => {
  assert.ok(app.undoEvents.length > 0);
  assert.equal(app.undoEvents.length % 2, 0);
  for (let index = 0; index < app.undoEvents.length; index += 2) {
    assert.equal(app.undoEvents[index][0], "begin");
    assert.deepEqual(app.undoEvents[index + 1], ["end"]);
  }
};

for (const spec of cases) {
  test(`${spec.identity}: recognizes comments and numeric-suffix name fallback`, () => {
    const env = fixture(spec);
    for (const [comment, name] of [[spec.identity, "Nome livre"], ["", spec.identity + " 12"], ["Comentário livre", spec.identity.toLowerCase() + " 2"]]) {
      env.source.comment = comment;
      env.source.name = name;
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.type, spec.type);
      assert.equal(mechanic.unsupported, undefined);
      assert.deepEqual(errors, []);
      assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), spec.fields);
      mechanic.fields.forEach((field, index) => {
        assert.equal(field.enabled, true);
        assert.equal(field.property, env.fields[index]);
      });
      assert.deepEqual(plain(mechanic.optionGroups.map(({ id, label, selectedIndex, options, placement }) => ({ id, label, selectedIndex, options: options.map(({ label }) => label), placement }))), spec.groups);
      mechanic.optionGroups.forEach((group, index) => {
        assert.equal(group.enabled, true);
        assert.equal(group.controllerProperty, env.optionProperties[index]);
      });
    }
  });

  test(`${spec.identity}: production field/option actions preserve other properties and close undo groups`, () => {
    const env = fixture(spec);
    const miolo = mountOffer(env);
    const allProperties = propertiesIn(miolo);
    const expectedValues = allProperties.map((property) => property.value);
    for (const [index, [id, , format]] of spec.fields.entries()) {
      const rawValue = format === "price" ? "R$ 27,50" : format === "percent" ? "30%" : "7 unidades";
      const expectedValue = format === "price" ? "27,50" : format === "percent" ? "30" : "7";
      const property = env.fields[index];
      const expected = typeof property.value === "number" ? Number(expectedValue) : { ...property.value, text: expectedValue };
      expectedValues[allProperties.indexOf(property)] = expected;
      const result = updateOfferField(1, 0, id, rawValue, index);
      assert.equal(result.ok, true, result.message);
      assert.deepEqual(plain(result.errors), []);
      assert.deepEqual(allProperties.map((item) => item.value), expectedValues);
      assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[index].value, expectedValue);
    }
    for (const [index, groupSpec] of spec.groups.entries()) {
      for (let option = 0; option < groupSpec.options.length; option += 1) {
        expectedValues[allProperties.indexOf(env.optionProperties[index])] = option + 1;
        const result = updateOfferOption(1, 0, groupSpec.id, option);
        assert.equal(result.ok, true, result.message);
        assert.deepEqual(allProperties.map((item) => item.value), expectedValues);
        assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.optionGroups[index].selectedIndex, option);
      }
      for (const invalid of [-1, groupSpec.options.length]) {
        assert.equal(updateOfferOption(1, 0, groupSpec.id, invalid).ok, false);
        assert.deepEqual(allProperties.map((item) => item.value), expectedValues);
      }
    }
    const publicProduct = getOffersEditorSnapshot(1).selectedOffer.products[0];
    assert.equal(publicProduct.mechanic.type, spec.type);
    assert.equal(publicProduct.unsupported, false);
    assert.equal(JSON.stringify(publicProduct).includes("controllerProperty"), false);
    assertUndoClosed();
  });

  test(`${spec.identity}: missing template layers disable controls without throwing`, () => {
    const env = fixture(spec);
    env.source.layers = [];
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.equal(mechanic.type, spec.type);
    assert.ok(errors.length > 0);
    assert.equal(mechanic.fields.every((field) => !field.enabled && field.property === null), true);
    assert.equal(mechanic.optionGroups.every((group) => !group.enabled && group.controllerProperty === null), true);
    if (spec.jumpNames) assert.equal(mechanic.installmentJump.enabled, false);
    mountOffer(env);
    assert.equal(updateOfferField(1, 0, mechanic.fields[0].id, "99,90", 0).ok, false);
    assertUndoClosed();
  });

  if (spec.jumpNames) {
    test(`${spec.identity}: production jump action selects both targets without changing values or other layers`, () => {
      const env = fixture(spec);
      const miolo = mountOffer(env);
      const allProperties = propertiesIn(miolo);
      const values = allProperties.map((property) => property.value);
      const unaffected = env.source.layers.filter((_, index) => index !== 1 && index !== 2);
      const timing = unaffected.map((layer) => [layer.startTime, layer.inPoint]);
      assert.equal(readMechanic(env.valueLayer, []).installmentJump.selectedTarget, "preco-parcela");
      for (const target of ["preco-cheio", "preco-parcela", "preco-cheio"]) {
        const result = updateOfferInstallmentJump(1, 0, target);
        assert.equal(result.ok, true, result.message);
        assert.deepEqual(env.source.layers.slice(1, 3).map((layer) => layer.inPoint), target === "preco-cheio" ? [5, 12] : [12, 5]);
        assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump.selectedTarget, target);
        assert.deepEqual(allProperties.map((property) => property.value), values);
        assert.deepEqual(unaffected.map((layer) => [layer.startTime, layer.inPoint]), timing);
        assert.deepEqual(env.source.layer(1).marker.times, [1.25, 5, 9]);
      }
      const before = env.source.layers.map((layer) => [layer.startTime, layer.inPoint]);
      assert.equal(updateOfferInstallmentJump(1, 0, "invalido").ok, false);
      assert.deepEqual(env.source.layers.map((layer) => [layer.startTime, layer.inPoint]), before);
      assertUndoClosed();
    });

    test(`${spec.identity}: broken jump structure rejects changes while preserving editable fields`, () => {
      for (const invalidate of [
        (source) => { source.layer(2).comment = ""; source.layer(2).name = "Outro salto"; },
        (source) => { source.layer(1).marker = new MarkerProperty([1.25]); },
        (source) => { source.layer(3).comment = source.layer(2).comment; },
      ]) {
        const env = fixture(spec);
        invalidate(env.source);
        mountOffer(env);
        const before = env.source.layers.map((layer) => [layer.startTime, layer.inPoint]);
        const mechanic = readMechanic(env.valueLayer, []);
        assert.equal(mechanic.installmentJump.enabled, false);
        assert.equal(mechanic.fields.every((field) => field.enabled), true);
        assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
        assert.deepEqual(env.source.layers.map((layer) => [layer.startTime, layer.inPoint]), before);
        assertUndoClosed();
      }
    });
  }
}

test("keeps the same-family TODOS A LEVE X PAGUE Y alias", () => {
  const env = fixture(cases[1]);
  for (const [comment, name] of [["TODOS A LEVE X PAGUE Y", "Livre"], ["", "TODOS A LEVE X PAGUE Y 3"]]) {
    env.source.comment = comment;
    env.source.name = name;
    assert.equal(readMechanic(env.valueLayer, []).type, cases[1].type);
  }
});

const removedFamilies = [
  "DE POR", "DE POR CARTAO CRF", "DE POR MEU CRF (DUAL)",
  "DE POR PARCELAMENTO CARTAO CRF", "LEVE X PAGUE Y", "DESCONTO X%",
  "DESCONTO X% SEGUNDA UNIDADE", "DESCONTO X% MEU CRF", "DESCONTO X% CARTAO CRF",
  "DESCONTO X% CARTAO CRF SEGUNDA UNIDADE", "DE A UNIDADE SAI POR",
];

for (const identity of removedFamilies) {
  test(`${identity}: removed family is unsupported by comment and name, with mutation actions rejected`, () => {
    const env = fixture(cases[0]);
    mountOffer(env);
    const allProperties = propertiesIn(env.source);
    const values = allProperties.map((property) => property.value);
    for (const [comment, name] of [[identity, "Composição livre"], ["", identity + " 2"]]) {
      env.source.comment = comment;
      env.source.name = name;
      const mechanic = readMechanic(env.valueLayer, []);
      assert.equal(mechanic.unsupported, true);
      assert.deepEqual(plain(mechanic.fields), []);
      assert.deepEqual(plain(mechanic.optionGroups), []);
      assert.equal(updateOfferField(1, 0, "preco", "99,90", 0).ok, false);
      assert.equal(updateOfferOption(1, 0, "unit", 1).ok, false);
      assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
      assert.deepEqual(allProperties.map((property) => property.value), values);
      assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].unsupported, true);
    }
    assertUndoClosed();
  });
}

test("current comments keep priority and unsupported comments still permit current source-name fallback", () => {
  const env = fixture(cases[0]);
  env.source.name = "DESCONTO R$ CARTAO CRF";
  assert.equal(readMechanic(env.valueLayer, []).type, "Simples");
  env.source.comment = "DE POR";
  env.source.name = "SIMPLES 4";
  assert.equal(readMechanic(env.valueLayer, []).type, "Simples");
  env.source.comment = "SIMPLES EXTRA";
  env.source.name = "Nome livre";
  env.valueLayer.name = "SIMPLES";
  assert.equal(readMechanic(env.valueLayer, []).unsupported, true);
});

function withLayerNameFallback(enabled, run) {
  const config = loadModule(path.join(domainDirectory, "mechanics/config.ts"));
  const previous = config.MECHANIC_LAYER_NAME_FALLBACK_ENABLED;
  config.MECHANIC_LAYER_NAME_FALLBACK_ENABLED = enabled;
  try {
    run();
  } finally {
    config.MECHANIC_LAYER_NAME_FALLBACK_ENABLED = previous;
  }
}

function setLayerOrder(source, layers) {
  source.layers = layers;
  layers.forEach((layer, index) => { layer.index = index + 1; });
}

function simpleLayers(env) {
  return { price: env.source.layer(2), control: env.source.layer(4) };
}

test("SIMPLES comments survive layer moves/renames and preserve field identity in editor, actions and Roteiro", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[0]);
    const { price, control } = simpleLayers(env);
    price.name = "Valor visual renomeado";
    price.comment = "  preco\t";
    control.name = "Minhas opções";
    control.comment = "\ncontrolador de mecanica ";
    const unrelated = effect("Outro controle", 41, false);
    control.property("ADBE Effect Parade").properties.push(unrelated);
    setLayerOrder(env.source, [control, new AVLayer("Fundo"), new AVLayer("Selo"), new AVLayer("Antiga posição da controladora"), price]);
    mountOffer(env);

    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.equal(mechanic.fields[0].property, env.fields[0]);
    assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), cases[0].fields);
    assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
    assert.deepEqual(plain(getOffersFirstProductInfo()[0].priceField), { fieldId: "preco", fieldIndex: 0, value: "15,90" });

    const target = getOffersFirstProductInfo()[0].priceField;
    assert.equal(updateOfferField(1, 0, target.fieldId, "R$ 23,45", target.fieldIndex).ok, true);
    assert.equal(price.text.sourceText.value.text, "23,45");
    assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0].id, "preco");
    assert.deepEqual(plain(getOffersFirstProductInfo()[0].priceField), { fieldId: "preco", fieldIndex: 0, value: "23,45" });
    assert.equal(updateOfferOption(1, 0, "unit", 3).ok, true);
    assert.equal(env.optionProperties[0].value, 4);
    assert.equal(unrelated.property(1).value, 41);
    assertUndoClosed();
  });
});

test("SIMPLES recognized comments take priority over legacy-named decoys, with either fallback setting", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[0]);
    const { price, control } = simpleLayers(env);
    price.name = "Preço atual";
    control.name = "Controle atual";
    const decoyPrice = new TextLayer("PRECO", "99,99");
    const decoyControl = controller(effect("Unidade", 1));
    setLayerOrder(env.source, [decoyPrice, new AVLayer("Fundo"), price, decoyControl, control]);
    mountOffer(env);
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields[0].property, price.text.sourceText);
    assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
    assert.equal(updateOfferField(1, 0, "preco", "32,10").ok, true);
    assert.equal(updateOfferOption(1, 0, "unit", 2).ok, true);
    assert.equal(price.text.sourceText.value.text, "32,10");
    assert.equal(env.optionProperties[0].value, 3);
    assert.equal(decoyPrice.text.sourceText.value.text, "99,99");
    assert.equal(decoyControl.property("ADBE Effect Parade").property(1).property(1).value, 1);
    assertUndoClosed();
  });
});

test("SIMPLES comments-only mode rejects names, fixed positions, accented or suffixed comment variants", () => {
  withLayerNameFallback(false, () => {
    for (const [priceComment, controlComment] of [["", ""], ["PREÇO", "CONTROLADOR DE MECÂNICA"], ["PRECO 2", "CONTROLADOR DE MECANICA 2"]]) {
      const env = fixture(cases[0]);
      const { price, control } = simpleLayers(env);
      price.comment = priceComment;
      control.comment = controlComment;
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields[0].enabled, false);
      assert.equal(mechanic.fields[0].id, "preco");
      assert.equal(mechanic.optionGroups[0].enabled, false);
      assert.ok(errors.length >= 2);
      assert.equal(updateOfferField(1, 0, "preco", "99,90").ok, false);
      updateOfferOption(1, 0, "unit", 3);
      assert.equal(price.text.sourceText.value.text, "15,90");
      assert.equal(env.optionProperties[0].value, 2);
      assertUndoClosed();
    }
  });
});

test("SIMPLES optional name fallback accepts both controller aliases at any position, with trim and case folding", () => {
  withLayerNameFallback(true, () => {
    for (const alias of ["  controlador de mecânica ", "\tCONTROLADOR DE MECANICA\n"]) {
      const env = fixture(cases[0]);
      const { price, control } = simpleLayers(env);
      price.comment = control.comment = "";
      price.name = "  preco\t";
      control.name = alias;
      setLayerOrder(env.source, [control, new AVLayer("Fundo"), new AVLayer("Imagem"), new AVLayer("Decoração"), price]);
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      assert.equal(mechanic.fields[0].property, price.text.sourceText);
      assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
      assert.equal(updateOfferField(1, 0, "preco", "9,75").ok, true);
      assert.equal(updateOfferOption(1, 0, "unit", 0).ok, true);
      assert.equal(price.text.sourceText.value.text, "9,75");
      assert.equal(env.optionProperties[0].value, 1);
      assertUndoClosed();
    }
  });
});

test("SIMPLES optional name fallback never falls back to the old layer indices", () => {
  withLayerNameFallback(true, () => {
    const env = fixture(cases[0]);
    const { price, control } = simpleLayers(env);
    price.comment = control.comment = "";
    price.name = "Valor desconhecido";
    control.name = "Controle desconhecido";
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.equal(mechanic.fields[0].enabled, false);
    assert.equal(mechanic.optionGroups[0].enabled, false);
    assert.ok(errors.length >= 2);
  });
});

test("SIMPLES duplicate comments disable the ambiguous control without name fallback or writes", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const role of ["price", "control"]) {
      const env = fixture(cases[0]);
      const duplicate = role === "price" ? new TextLayer("Outro preço", "89,90") : controller(effect("Unidade", 4));
      duplicate.name = "Outra camada";
      duplicate.comment = role === "price" ? "  preco " : " controlador de mecanica ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      mountOffer(env);
      const values = propertiesIn(env.source).map((property) => property.value);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields[0].enabled, role !== "price");
      assert.equal(mechanic.optionGroups[0].enabled, role !== "control");
      assert.ok(errors.length > 0);
      if (role === "price") assert.equal(updateOfferField(1, 0, "preco", "44,90").ok, false);
      else updateOfferOption(1, 0, "unit", 0);
      assert.deepEqual(propertiesIn(env.source).map((property) => property.value), values);
      assertUndoClosed();
    }
  });
});

test("SIMPLES duplicate fallback names, including different controller aliases, reject ambiguous matches", () => {
  withLayerNameFallback(true, () => {
    for (const role of ["price", "control"]) {
      const env = fixture(cases[0]);
      const { price, control } = simpleLayers(env);
      price.comment = control.comment = "";
      const duplicate = role === "price" ? new TextLayer(" preco ", "89,90") : controller(effect("Unidade", 4));
      if (role === "control") duplicate.name = " CONTROLADOR DE MECANICA ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      mountOffer(env);
      const values = propertiesIn(env.source).map((property) => property.value);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields[0].enabled, role !== "price");
      assert.equal(mechanic.optionGroups[0].enabled, role !== "control");
      assert.ok(errors.length > 0);
      if (role === "price") assert.equal(updateOfferField(1, 0, "preco", "44,90").ok, false);
      else updateOfferOption(1, 0, "unit", 0);
      assert.deepEqual(propertiesIn(env.source).map((property) => property.value), values);
      assertUndoClosed();
    }
  });
});

test("SIMPLES an identified non-text price cannot fall through to a valid named price", () => {
  withLayerNameFallback(true, () => {
    const env = fixture(cases[0]);
    const price = env.source.layer(2);
    price.comment = "";
    const invalidPrice = new AVLayer("Preço sem Source Text");
    invalidPrice.comment = "PRECO";
    setLayerOrder(env.source, [invalidPrice, ...env.source.layers]);
    mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.equal(mechanic.fields[0].enabled, false);
    assert.equal(mechanic.fields[0].property, null);
    assert.equal(mechanic.optionGroups[0].enabled, true);
    assert.ok(errors.length > 0);
    assert.equal(updateOfferField(1, 0, "preco", "99,90").ok, false);
    assert.equal(price.text.sourceText.value.text, "15,90");
    assert.equal(updateOfferOption(1, 0, "unit", 2).ok, true);
    assert.equal(env.optionProperties[0].value, 3);
    assertUndoClosed();
  });
});

test("SIMPLES a missing or invalid unit effect disables only the unit; it does not search later effects", () => {
  withLayerNameFallback(false, () => {
    for (const effects of [[], [new PropertyGroup("Unidade", [new Property("Menu", "texto")]), effect("Unidade alternativa", 4)]]) {
      const env = fixture(cases[0]);
      const { control } = simpleLayers(env);
      control.property("ADBE Effect Parade").properties = effects;
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields[0].enabled, true);
      assert.equal(mechanic.optionGroups[0].enabled, false);
      assert.ok(errors.length > 0);
      const before = effects.flatMap((item) => item.properties.map((property) => property.value));
      updateOfferOption(1, 0, "unit", 0);
      assert.deepEqual(effects.flatMap((item) => item.properties.map((property) => property.value)), before);
      assert.equal(updateOfferField(1, 0, "preco", "8,45").ok, true);
      assert.equal(env.fields[0].value.text, "8,45");
      assertUndoClosed();
    }
  });
});

test("all seven mechanics resolve commented roles independently of layer names and positions", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const spec of cases) {
      const env = fixture(spec);
      env.source.layers.forEach((layer, index) => { layer.name = "Camada renomeada " + index; });
      setLayerOrder(env.source, [...env.source.layers].reverse());
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      assert.equal(mechanic.type, spec.type);
      assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), spec.fields);
      mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
      mechanic.optionGroups.forEach((group, index) => assert.equal(group.controllerProperty, env.optionProperties[index]));
      if (spec.jumpNames) assert.equal(mechanic.installmentJump.enabled, true);
    }
  });
});

function takePayLayers(env) {
  return { leve: env.source.layer(4), pague: env.source.layer(5), control: env.source.layer(3) };
}

function assertTakePayAvailability(mechanic, disabledRole) {
  assert.deepEqual(plain(mechanic.fields.map(({ id, label, format }) => [id, label, format])), [
    ["leve-x", "Leve X", "integer"], ["pague-y", "Pague Y", "integer"],
  ]);
  assert.equal(mechanic.fields[0].enabled, disabledRole !== "leve");
  assert.equal(mechanic.fields[1].enabled, disabledRole !== "pague");
  assert.equal(mechanic.optionGroups[0].enabled, disabledRole !== "control");
}

function assertTakePayUnavailableActionPreservesValues(env, role) {
  mountOffer(env);
  const properties = propertiesIn(env.source);
  const before = properties.map((property) => property.value);
  if (role === "control") updateOfferOption(1, 0, "subtype", 0);
  else assert.equal(updateOfferField(1, 0, role === "leve" ? "leve-x" : "pague-y", "99 unidades").ok, false);
  assert.deepEqual(properties.map((property) => property.value), before);
  // An invalid role must not prevent the other quantity from being edited.
  const otherFieldIndex = role === "leve" ? 1 : 0;
  const otherFieldId = otherFieldIndex === 0 ? "leve-x" : "pague-y";
  assert.equal(updateOfferField(1, 0, otherFieldId, "7 unidades").ok, true);
  assert.equal(env.fields[otherFieldIndex].value.text, "7");
  assertUndoClosed();
}

test("TODOS A LEVE/PAGUE comments preserve moved/renamed fields, subtype effect and Roteiro references for both family names", () => {
  withLayerNameFallback(false, () => {
    for (const identity of ["TODOS A COM LEVE X PAGUE Y", "TODOS A LEVE X PAGUE Y"]) {
      const env = fixture(cases[1]);
      env.source.comment = identity;
      const { leve, pague, control } = takePayLayers(env);
      leve.name = "Quantidade levada";
      leve.comment = "  leve x\t";
      pague.name = "Quantidade paga";
      pague.comment = "\npague y ";
      control.name = "Opções da oferta";
      control.comment = " controlador de mecanica ";
      const unrelated = effect("Outro controle", 41, false);
      control.property("ADBE Effect Parade").properties.push(unrelated);
      setLayerOrder(env.source, [pague, control, new AVLayer("Fundo"), new AVLayer("Antiga posição Leve"), new AVLayer("Antiga posição Pague"), leve]);
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      assert.equal(mechanic.type, cases[1].type);
      assertTakePayAvailability(mechanic);
      assert.equal(mechanic.fields[0].property, leve.text.sourceText);
      assert.equal(mechanic.fields[1].property, pague.text.sourceText);
      assert.deepEqual(plain(mechanic.optionGroups[0].options.map(({ label }) => label)), subtypes);
      let info = getOffersFirstProductInfo()[0];
      assert.deepEqual(plain(info.leveField), { fieldId: "leve-x", fieldIndex: 0, value: "3" });
      assert.deepEqual(plain(info.pagueField), { fieldId: "pague-y", fieldIndex: 1, value: "2" });
      assert.equal(updateOfferField(1, 0, info.leveField.fieldId, "8 unidades", info.leveField.fieldIndex).ok, true);
      assert.equal(updateOfferField(1, 0, info.pagueField.fieldId, "6 unidades", info.pagueField.fieldIndex).ok, true);
      info = getOffersFirstProductInfo()[0];
      assert.deepEqual(plain(info.leveField), { fieldId: "leve-x", fieldIndex: 0, value: "8" });
      assert.deepEqual(plain(info.pagueField), { fieldId: "pague-y", fieldIndex: 1, value: "6" });
      assert.deepEqual(plain(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields.map(({ id, value }) => [id, value])), [["leve-x", "8"], ["pague-y", "6"]]);
      assert.equal(updateOfferOption(1, 0, "subtype", 0).ok, true);
      assert.equal(env.optionProperties[0].value, 1);
      assert.equal(unrelated.property(1).value, 41);
      assertUndoClosed();
    }
  });
});

test("TODOS A LEVE/PAGUE recognized comments take priority over named decoys with either fallback setting", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[1]);
    const { leve, pague, control } = takePayLayers(env);
    leve.name = "Levar";
    pague.name = "Pagar";
    control.name = "Seleção";
    const decoyLeve = new TextLayer("LEVE X", "20");
    const decoyPague = new TextLayer("PAGUE Y", "10");
    const decoyControl = controller(effect("Subtipo", 1));
    setLayerOrder(env.source, [pague, leve, decoyControl, decoyLeve, decoyPague, control]);
    mountOffer(env);
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields[0].property, leve.text.sourceText);
    assert.equal(mechanic.fields[1].property, pague.text.sourceText);
    assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
    assert.equal(updateOfferField(1, 0, "leve-x", "9 unidades").ok, true);
    assert.equal(updateOfferField(1, 0, "pague-y", "7 unidades").ok, true);
    assert.equal(updateOfferOption(1, 0, "subtype", 1).ok, true);
    assert.deepEqual([leve.text.sourceText.value.text, pague.text.sourceText.value.text, env.optionProperties[0].value], ["9", "7", 2]);
    assert.deepEqual([decoyLeve.text.sourceText.value.text, decoyPague.text.sourceText.value.text, decoyControl.property("ADBE Effect Parade").property(1).property(1).value], ["20", "10", 1]);
    assertUndoClosed();
  });
});

test("TODOS A LEVE/PAGUE comments-only mode rejects legacy names/indices and unrecognized comment variants", () => {
  withLayerNameFallback(false, () => {
    for (const comments of [["", "", ""], ["LEVE  X", "PAGUE Y 2", "CONTROLADOR DE MECÂNICA"]]) {
      const env = fixture(cases[1]);
      const { leve, pague, control } = takePayLayers(env);
      [leve.comment, pague.comment, control.comment] = comments;
      mountOffer(env);
      const properties = propertiesIn(env.source);
      const before = properties.map((property) => property.value);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields.every((field) => !field.enabled), true);
      assert.equal(mechanic.optionGroups[0].enabled, false);
      assert.ok(errors.length >= 3);
      assert.equal(updateOfferField(1, 0, "leve-x", "99").ok, false);
      assert.equal(updateOfferField(1, 0, "pague-y", "99").ok, false);
      updateOfferOption(1, 0, "subtype", 0);
      assert.deepEqual(properties.map((property) => property.value), before);
      assertUndoClosed();
    }
  });
});

test("TODOS A LEVE/PAGUE optional fallback accepts quantity names and both controller aliases at arbitrary indices", () => {
  withLayerNameFallback(true, () => {
    for (const alias of [" controlador de mecânica ", "\tCONTROLADOR DE MECANICA\n"]) {
      const env = fixture(cases[1]);
      const { leve, pague, control } = takePayLayers(env);
      leve.comment = pague.comment = control.comment = "";
      leve.name = "  leve x\t";
      pague.name = "\npague y ";
      control.name = alias;
      setLayerOrder(env.source, [pague, control, leve, new AVLayer("Fundo"), new AVLayer("Outra camada")]);
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      assertTakePayAvailability(mechanic);
      assert.equal(mechanic.fields[0].property, leve.text.sourceText);
      assert.equal(mechanic.fields[1].property, pague.text.sourceText);
      assert.equal(updateOfferField(1, 0, "leve-x", "6").ok, true);
      assert.equal(updateOfferField(1, 0, "pague-y", "4").ok, true);
      assert.equal(updateOfferOption(1, 0, "subtype", 1).ok, true);
      assert.deepEqual([leve.text.sourceText.value.text, pague.text.sourceText.value.text, env.optionProperties[0].value], ["6", "4", 2]);
      assertUndoClosed();
    }
    const env = fixture(cases[1]);
    for (const layer of Object.values(takePayLayers(env))) { layer.comment = ""; layer.name = "Desconhecida"; }
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields.every((field) => !field.enabled), true);
    assert.equal(mechanic.optionGroups[0].enabled, false);
  });
});

test("TODOS A LEVE/PAGUE duplicate comments disable only the ambiguous role and never fall back to names", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const role of ["leve", "pague", "control"]) {
      const env = fixture(cases[1]);
      const original = takePayLayers(env)[role];
      const duplicate = role === "control" ? controller(effect("Subtipo", 1)) : new TextLayer("Outro texto", "99");
      duplicate.name = "Camada duplicada";
      duplicate.comment = " " + original.comment.toLowerCase() + " ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assertTakePayAvailability(mechanic, role);
      assert.ok(errors.length > 0);
      assertTakePayUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A LEVE/PAGUE duplicate fallback names or controller aliases disable only the ambiguous role", () => {
  withLayerNameFallback(true, () => {
    for (const role of ["leve", "pague", "control"]) {
      const env = fixture(cases[1]);
      const layers = takePayLayers(env);
      Object.values(layers).forEach((layer) => { layer.comment = ""; });
      const duplicate = role === "control" ? controller(effect("Subtipo", 1)) : new TextLayer(" " + layers[role].name.toLowerCase() + " ", "99");
      if (role === "control") duplicate.name = " CONTROLADOR DE MECANICA ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      const errors = [];
      assertTakePayAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertTakePayUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A LEVE/PAGUE missing identity disables only that role, retaining independent quantity editing", () => {
  withLayerNameFallback(false, () => {
    for (const role of ["leve", "pague", "control"]) {
      const env = fixture(cases[1]);
      takePayLayers(env)[role].comment = "";
      const errors = [];
      assertTakePayAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertTakePayUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A LEVE/PAGUE an invalid commented layer does not fall through to a valid named layer", () => {
  withLayerNameFallback(true, () => {
    for (const role of ["leve", "pague", "control"]) {
      const env = fixture(cases[1]);
      const original = takePayLayers(env)[role];
      const invalid = new AVLayer("Camada identificada sem propriedades");
      invalid.comment = original.comment;
      original.comment = "";
      setLayerOrder(env.source, [invalid, ...env.source.layers]);
      const errors = [];
      assertTakePayAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertTakePayUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A LEVE/PAGUE subtype still needs a numeric property in the first effect and does not search later effects", () => {
  withLayerNameFallback(false, () => {
    for (const effects of [[], [new PropertyGroup("Subtipo", [new Property("Menu", "texto")]), effect("Subtipo alternativo", 2)]]) {
      const env = fixture(cases[1]);
      takePayLayers(env).control.property("ADBE Effect Parade").properties = effects;
      const errors = [];
      assertTakePayAvailability(readMechanic(env.valueLayer, errors), "control");
      assert.ok(errors.length > 0);
      assertTakePayUnavailableActionPreservesValues(env, "control");
    }
  });
});

function percentDiscountLayers(env) {
  return { percent: env.source.layer(4), control: env.source.layer(3) };
}

function assertPercentDiscountAvailability(mechanic, disabledRole) {
  assert.deepEqual(plain(mechanic.fields.map(({ id, label, format }) => [id, label, format])), [
    ["por-centagem-desconto", "Desconto", "percent"],
  ]);
  assert.equal(mechanic.fields[0].enabled, disabledRole !== "percent");
  assert.deepEqual(plain(mechanic.optionGroups.map(({ enabled }) => enabled)), [disabledRole !== "control", disabledRole !== "control"]);
}

function assertPercentDiscountUnavailableActionPreservesValues(env, role) {
  mountOffer(env);
  const properties = propertiesIn(env.source);
  const before = properties.map((property) => property.value);
  if (role === "control") {
    updateOfferOption(1, 0, "mechanicType", 0);
    updateOfferOption(1, 0, "mechanicSubtype", 0);
  } else {
    assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "99%").ok, false);
  }
  assert.deepEqual(properties.map((property) => property.value), before);
  if (role === "control") {
    assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "40%").ok, true);
    assert.equal(env.fields[0].value.text, "40");
  } else {
    assert.equal(updateOfferOption(1, 0, "mechanicType", 0).ok, true);
    assert.equal(updateOfferOption(1, 0, "mechanicSubtype", 1).ok, true);
    assert.deepEqual(env.optionProperties.map((property) => property.value), [1, 2]);
  }
  assertUndoClosed();
}

test("TODOS A X% comments preserve moved/renamed percentage, stable actions/Roteiro identity and both indexed effects", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[2]);
    const { percent, control } = percentDiscountLayers(env);
    percent.name = "Percentual visível renomeado";
    percent.comment = "  porcentagem desconto\t";
    control.name = "Controles personalizados";
    control.comment = "\ncontrolador de mecanica ";
    const effects = control.property("ADBE Effect Parade");
    effects.property(1).name = "Nome arbitrário do primeiro efeito";
    effects.property(2).name = "Nome arbitrário do segundo efeito";
    const unrelated = effect("Outro controle", 41, false);
    effects.properties.push(unrelated);
    setLayerOrder(env.source, [percent, new AVLayer("Fundo"), new AVLayer("Antiga controladora"), new AVLayer("Antigo percentual"), control]);
    mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assertPercentDiscountAvailability(mechanic);
    assert.equal(mechanic.fields[0].property, percent.text.sourceText);
    mechanic.optionGroups.forEach((group, index) => assert.equal(group.controllerProperty, env.optionProperties[index]));
    assert.deepEqual(plain(mechanic.optionGroups.map(({ id, label, selectedIndex, options, placement }) => ({ id, label, selectedIndex, options: options.map(({ label }) => label), placement }))), cases[2].groups);
    let target = getOffersFirstProductInfo()[0].priceField;
    assert.deepEqual(plain(target), { fieldId: "por-centagem-desconto", fieldIndex: 0, value: "25" });
    assert.equal(updateOfferField(1, 0, target.fieldId, "35%", target.fieldIndex).ok, true);
    target = getOffersFirstProductInfo()[0].priceField;
    assert.deepEqual(plain(target), { fieldId: "por-centagem-desconto", fieldIndex: 0, value: "35" });
    assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0].id, "por-centagem-desconto");
    assert.equal(updateOfferOption(1, 0, "mechanicType", 0).ok, true);
    assert.deepEqual(env.optionProperties.map((property) => property.value), [1, 3]);
    assert.equal(updateOfferOption(1, 0, "mechanicSubtype", 1).ok, true);
    assert.deepEqual(env.optionProperties.map((property) => property.value), [1, 2]);
    assert.equal(unrelated.property(1).value, 41);
    assertUndoClosed();
  });
});

test("TODOS A X% recognized comments take priority over named decoys with either fallback setting", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[2]);
    const { percent, control } = percentDiscountLayers(env);
    percent.name = "Desconto escolhido";
    control.name = "Controles escolhidos";
    const decoyPercent = new TextLayer("PORCENTAGEM DESCONTO", "80");
    const decoyControl = controller(effect("Tipo", 3), effect("Subtipo", 1));
    setLayerOrder(env.source, [percent, new AVLayer("Fundo"), decoyControl, decoyPercent, control]);
    mountOffer(env);
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields[0].property, percent.text.sourceText);
    mechanic.optionGroups.forEach((group, index) => assert.equal(group.controllerProperty, env.optionProperties[index]));
    assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "30%").ok, true);
    assert.equal(updateOfferOption(1, 0, "mechanicType", 0).ok, true);
    assert.equal(updateOfferOption(1, 0, "mechanicSubtype", 1).ok, true);
    assert.deepEqual([percent.text.sourceText.value.text, ...env.optionProperties.map((property) => property.value)], ["30", 1, 2]);
    assert.equal(decoyPercent.text.sourceText.value.text, "80");
    assert.deepEqual(decoyControl.property("ADBE Effect Parade").properties.map((item) => item.property(1).value), [3, 1]);
    assertUndoClosed();
  });
});

test("TODOS A X% comments-only mode rejects names/indices and unrecognized comment spellings", () => {
  withLayerNameFallback(false, () => {
    for (const comments of [["", ""], ["POR CENTAGEM DESCONTO", "CONTROLADOR DE MECÂNICA"], ["PORCENTAGEM DESCONTO 2", "CONTROLADOR DE MECANICA 2"]]) {
      const env = fixture(cases[2]);
      const { percent, control } = percentDiscountLayers(env);
      [percent.comment, control.comment] = comments;
      mountOffer(env);
      const properties = propertiesIn(env.source);
      const before = properties.map((property) => property.value);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.equal(mechanic.fields[0].enabled, false);
      assert.equal(mechanic.optionGroups.every((group) => !group.enabled), true);
      assert.ok(errors.length >= 2);
      assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "90%").ok, false);
      updateOfferOption(1, 0, "mechanicType", 0);
      updateOfferOption(1, 0, "mechanicSubtype", 0);
      assert.deepEqual(properties.map((property) => property.value), before);
      assertUndoClosed();
    }
  });
});

test("TODOS A X% optional fallback accepts the defined percentage name and both controller aliases at arbitrary indices", () => {
  withLayerNameFallback(true, () => {
    for (const alias of [" controlador de mecânica ", "\tCONTROLADOR DE MECANICA\n"]) {
      const env = fixture(cases[2]);
      const { percent, control } = percentDiscountLayers(env);
      percent.comment = control.comment = "";
      percent.name = "  porcentagem desconto\t";
      control.name = alias;
      setLayerOrder(env.source, [control, percent, new AVLayer("Fundo"), new AVLayer("Antigo percentual")]);
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      assertPercentDiscountAvailability(mechanic);
      assert.equal(mechanic.fields[0].property, percent.text.sourceText);
      assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "15%").ok, true);
      assert.equal(updateOfferOption(1, 0, "mechanicType", 2).ok, true);
      assert.equal(updateOfferOption(1, 0, "mechanicSubtype", 0).ok, true);
      assert.deepEqual([percent.text.sourceText.value.text, ...env.optionProperties.map((property) => property.value)], ["15", 3, 1]);
      assertUndoClosed();
    }
    const env = fixture(cases[2]);
    const { percent, control } = percentDiscountLayers(env);
    percent.comment = control.comment = "";
    percent.name = "POR CENTAGEM DESCONTO";
    control.name = "Nome desconhecido";
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields[0].enabled, false);
    assert.equal(mechanic.optionGroups.every((group) => !group.enabled), true);
  });
});

test("TODOS A X% duplicate comments disable only the ambiguous role without falling back or writing", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const role of ["percent", "control"]) {
      const env = fixture(cases[2]);
      const original = percentDiscountLayers(env)[role];
      const duplicate = role === "percent" ? new TextLayer("Outro percentual", "99") : controller(effect("Tipo", 1), effect("Subtipo", 1));
      duplicate.name = "Camada duplicada";
      duplicate.comment = " " + original.comment.toLowerCase() + " ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      const errors = [];
      assertPercentDiscountAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertPercentDiscountUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A X% duplicate fallback names or controller aliases disable only the ambiguous role", () => {
  withLayerNameFallback(true, () => {
    for (const role of ["percent", "control"]) {
      const env = fixture(cases[2]);
      const layers = percentDiscountLayers(env);
      Object.values(layers).forEach((layer) => { layer.comment = ""; });
      const duplicate = role === "percent" ? new TextLayer(" porcentagem desconto ", "99") : controller(effect("Tipo", 1), effect("Subtipo", 1));
      if (role === "control") duplicate.name = " CONTROLADOR DE MECANICA ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      const errors = [];
      assertPercentDiscountAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertPercentDiscountUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A X% a missing identity disables only that role, retaining independent fields and options", () => {
  withLayerNameFallback(false, () => {
    for (const role of ["percent", "control"]) {
      const env = fixture(cases[2]);
      percentDiscountLayers(env)[role].comment = "";
      const errors = [];
      assertPercentDiscountAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertPercentDiscountUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A X% an invalid commented layer does not fall through to a valid named layer", () => {
  withLayerNameFallback(true, () => {
    for (const role of ["percent", "control"]) {
      const env = fixture(cases[2]);
      const original = percentDiscountLayers(env)[role];
      const invalid = new AVLayer("Camada identificada sem propriedades");
      invalid.comment = original.comment;
      original.comment = "";
      setLayerOrder(env.source, [invalid, ...env.source.layers]);
      const errors = [];
      assertPercentDiscountAvailability(readMechanic(env.valueLayer, errors), role);
      assert.ok(errors.length > 0);
      assertPercentDiscountUnavailableActionPreservesValues(env, role);
    }
  });
});

test("TODOS A X% invalid or missing E1/E2 disables only its own option without searching later effects", () => {
  withLayerNameFallback(false, () => {
    for (const invalidIndex of [0, 1]) {
      for (const missing of [false, true]) {
        const env = fixture(cases[2]);
        const effects = percentDiscountLayers(env).control.property("ADBE Effect Parade");
        effects.properties[invalidIndex] = missing
          ? new PropertyGroup("Sem propriedades")
          : new PropertyGroup("Valor inválido", [new Property("Menu", "texto")]);
        const unrelated = effect("Controle numérico extra", 41, false);
        effects.properties.push(unrelated);
        mountOffer(env);
        const properties = propertiesIn(env.source);
        const before = properties.map((property) => property.value);
        const errors = [];
        const mechanic = readMechanic(env.valueLayer, errors);
        assert.equal(mechanic.fields[0].enabled, true);
        mechanic.optionGroups.forEach((group, index) => assert.equal(group.enabled, index !== invalidIndex));
        assert.ok(errors.length > 0);
        updateOfferOption(1, 0, cases[2].groups[invalidIndex].id, 0);
        assert.deepEqual(properties.map((property) => property.value), before);
        const validIndex = invalidIndex === 0 ? 1 : 0;
        assert.equal(updateOfferOption(1, 0, cases[2].groups[validIndex].id, 0).ok, true);
        assert.equal(env.optionProperties[validIndex].value, 1);
        assert.equal(unrelated.property(1).value, 41);
        assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "45%").ok, true);
        assert.equal(env.fields[0].value.text, "45");
        assertUndoClosed();
      }
    }
  });
});

function assertValueDiscountUnavailable(env) {
  mountOffer(env);
  const properties = propertiesIn(env.source);
  const before = properties.map((property) => property.value);
  const errors = [];
  const mechanic = readMechanic(env.valueLayer, errors);
  assert.equal(mechanic.type, cases[3].type);
  assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, enabled }) => [id, label, format, enabled])), [
    ["desconto-reais", "Desconto", "price", false],
  ]);
  assert.equal(mechanic.fields[0].property, null);
  assert.deepEqual(plain(mechanic.optionGroups), []);
  assert.ok(errors.length > 0);
  assert.equal(updateOfferField(1, 0, "desconto-reais", "R$ 99,90").ok, false);
  assert.deepEqual(properties.map((property) => property.value), before);
  assertUndoClosed();
}

test("DESCONTO R$ comments preserve a moved/renamed price and monetary edits through editor and Roteiro", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[3]);
    const price = env.source.layer(4);
    price.name = "Valor monetário renomeado";
    price.comment = "  preco desconto\t";
    setLayerOrder(env.source, [price, new AVLayer("Fundo"), new AVLayer("Outra camada"), new AVLayer("Antiga posição do desconto")]);
    mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.equal(mechanic.fields[0].property, price.text.sourceText);
    assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), cases[3].fields);
    assert.deepEqual(plain(mechanic.optionGroups), []);
    for (const [input, expected] of [["R$ 1.234,50", "1.234,50"], ["99", "0,99"], ["12.5", "12,50"]]) {
      const target = getOffersFirstProductInfo()[0].priceField;
      assert.equal(target.fieldId, "desconto-reais");
      assert.equal(target.fieldIndex, 0);
      assert.equal(updateOfferField(1, 0, target.fieldId, input, target.fieldIndex).ok, true);
      assert.deepEqual(price.text.sourceText.value, { text: expected, fontSize: 48 });
      assert.deepEqual(plain(getOffersFirstProductInfo()[0].priceField), { fieldId: "desconto-reais", fieldIndex: 0, value: expected });
      const field = getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields[0];
      assert.equal(field.id, "desconto-reais");
      assert.equal(field.value, expected);
    }
    assertUndoClosed();
  });
});

test("DESCONTO R$ recognized comment has priority over a named price decoy with either fallback setting", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[3]);
    const price = env.source.layer(4);
    price.name = "Desconto escolhido";
    const decoy = new TextLayer("PRECO DESCONTO", "80,00");
    setLayerOrder(env.source, [price, new AVLayer("Fundo"), new AVLayer("Outra camada"), decoy]);
    mountOffer(env);
    assert.equal(readMechanic(env.valueLayer, []).fields[0].property, price.text.sourceText);
    assert.equal(updateOfferField(1, 0, "desconto-reais", "R$ 30,50").ok, true);
    assert.equal(price.text.sourceText.value.text, "30,50");
    assert.equal(decoy.text.sourceText.value.text, "80,00");
    assertUndoClosed();
  });
});

test("DESCONTO R$ comments-only mode rejects name/index fallback and unrecognized comment variants", () => {
  withLayerNameFallback(false, () => {
    for (const comment of ["", "PREÇO DESCONTO", "PRECO DESCONTO 2"]) {
      const env = fixture(cases[3]);
      env.source.layer(4).comment = comment;
      assertValueDiscountUnavailable(env);
    }
  });
});

test("DESCONTO R$ optional fallback accepts only PRECO DESCONTO at any position, preserving the stable field ID", () => {
  withLayerNameFallback(true, () => {
    const env = fixture(cases[3]);
    const price = env.source.layer(4);
    price.comment = "";
    price.name = "  preco desconto\t";
    setLayerOrder(env.source, [price, new AVLayer("Fundo"), new AVLayer("Outra camada"), new AVLayer("Antiga posição do desconto")]);
    mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.equal(mechanic.fields[0].property, price.text.sourceText);
    assert.equal(mechanic.fields[0].id, "desconto-reais");
    assert.equal(updateOfferField(1, 0, "desconto-reais", "R$ 9,75").ok, true);
    assert.equal(price.text.sourceText.value.text, "9,75");
    assertUndoClosed();
    for (const name of ["DESCONTO REAIS", "Nome desconhecido"]) {
      const invalid = fixture(cases[3]);
      invalid.source.layer(4).comment = "";
      invalid.source.layer(4).name = name;
      assertValueDiscountUnavailable(invalid);
    }
  });
});

test("DESCONTO R$ duplicate comments and duplicate fallback names reject ambiguous targets without writes", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[3]);
    const duplicate = new TextLayer("Outro desconto", "99,99");
    duplicate.comment = " preco desconto ";
    setLayerOrder(env.source, [...env.source.layers, duplicate]);
    assertValueDiscountUnavailable(env);
  });
  withLayerNameFallback(true, () => {
    const env = fixture(cases[3]);
    env.source.layer(4).comment = "";
    setLayerOrder(env.source, [...env.source.layers, new TextLayer(" preco desconto ", "99,99")]);
    assertValueDiscountUnavailable(env);
  });
});

test("DESCONTO R$ an identified non-text layer cannot fall through to a valid named price", () => {
  withLayerNameFallback(true, () => {
    const env = fixture(cases[3]);
    env.source.layer(4).comment = "";
    const invalid = new AVLayer("Desconto sem Source Text");
    invalid.comment = "PRECO DESCONTO";
    setLayerOrder(env.source, [invalid, ...env.source.layers]);
    assertValueDiscountUnavailable(env);
  });
});

const installmentRoles = [
  { role: "markers", index: 1, comment: "MARCADORES", jump: true },
  { role: "fullJump", index: 2, comment: "PULO PRECO CHEIO", jump: true },
  { role: "parcelJump", index: 3, comment: "PULO PARCELA", jump: true },
  { role: "control", index: 5, comment: "CONTROLADOR DE MECANICA" },
  { role: "de", index: 6, comment: "PRECO DE", fieldIndex: 0, fieldId: "preco-de" },
  { role: "price", index: 11, comment: "PRECO", fieldIndex: 1, fieldId: "preco" },
  { role: "parcel", index: 17, comment: "PRECO PARCELA", fieldIndex: 2, fieldId: "preco-parcela" },
  { role: "count", index: 20, comment: "NUMERO DE PARCELAS", fieldIndex: 3, fieldId: "numero-de-parcelas" },
];

function installmentLayers(env) {
  return Object.fromEntries(installmentRoles.map(({ role, index }) => [role, env.source.layer(index)]));
}

const layerTimings = (layers) => layers.map((layer) => [layer.startTime, layer.inPoint]);

function assertRoleUnavailable(env, spec, roles, role) {
  mountOffer(env);
  const definition = roles.find((item) => item.role === role);
  const properties = propertiesIn(env.source);
  const before = properties.map((property) => property.value);
  const timings = layerTimings(env.source.layers);
  const errors = [];
  const mechanic = readMechanic(env.valueLayer, errors);
  assert.equal(mechanic.type, spec.type);
  assert.deepEqual(plain(mechanic.fields.map(({ id, label, format }) => [id, label, format])), spec.fields.map(([id, label, format]) => [id, label, format]));
  const disabledFieldIndices = definition.disabledFieldIndices || [definition.fieldIndex];
  mechanic.fields.forEach((field, index) => assert.equal(field.enabled, !disabledFieldIndices.includes(index)));
  mechanic.optionGroups.forEach((group) => assert.equal(group.enabled, role !== "control"));
  assert.equal(mechanic.installmentJump.enabled, !definition.jump);
  assert.ok(errors.length > 0);
  if (definition.jump) {
    for (const target of ["preco-cheio", "preco-parcela"]) {
      assert.equal(updateOfferInstallmentJump(1, 0, target).ok, false);
      assert.deepEqual(layerTimings(env.source.layers), timings);
    }
  } else if (role === "control") {
    mechanic.optionGroups.forEach((group) => updateOfferOption(1, 0, group.id, 0));
    for (const index of definition.disabledFieldIndices || []) {
      assert.equal(updateOfferField(1, 0, spec.fields[index][0], "99").ok, false);
    }
  } else {
    assert.equal(updateOfferField(1, 0, definition.fieldId, "99").ok, false);
  }
  assert.deepEqual(properties.map((property) => property.value), before);
  assert.deepEqual(layerTimings(env.source.layers), timings);
  assertUndoClosed();
}

function assertInstallmentRoleUnavailable(env, role) {
  assertRoleUnavailable(env, cases[4], installmentRoles, role);
}

test("DE X POR Y PARCELAMENTO comments preserve all moved/renamed roles through editor, Roteiro, field actions and both jumps", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[4]);
    const layers = installmentLayers(env);
    Object.entries(layers).forEach(([role, layer]) => {
      layer.name = "Nome visual " + role;
      layer.comment = "  " + layer.comment.toLowerCase() + "\t";
    });
    setLayerOrder(env.source, [...env.source.layers].reverse());
    const miolo = mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), cases[4].fields);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    assert.deepEqual(plain(mechanic.optionGroups.map(({ id, label, selectedIndex, options, placement }) => ({ id, label, selectedIndex, options: options.map(({ label }) => label), placement }))), cases[4].groups);
    assert.equal(mechanic.installmentJump.enabled, true);
    const initialTimings = layerTimings(env.source.layers);
    let info = getOffersFirstProductInfo()[0];
    assert.deepEqual(plain(info.deField), { fieldId: "preco-de", fieldIndex: 0, value: "199,90" });
    assert.deepEqual(plain(info.porField), { fieldId: "preco", fieldIndex: 1, value: "179,90" });
    assert.deepEqual(plain(info.priceField), { fieldId: "preco-parcela", fieldIndex: 2, value: "59,97" });
    for (const [target, input] of [[info.deField, "R$ 299,90"], [info.porField, "R$ 249,90"], [info.priceField, "R$ 49,98"]]) {
      assert.equal(updateOfferField(1, 0, target.fieldId, input, target.fieldIndex).ok, true);
    }
    assert.equal(updateOfferField(1, 0, "numero-de-parcelas", "5 vezes").ok, true);
    info = getOffersFirstProductInfo()[0];
    assert.deepEqual(plain(info.priceAcceptedValues), ["249,90", "49,98"]);
    assert.deepEqual([info.deValue, info.porValue, info.priceValue], ["299,90", "249,90", "49,98"]);
    assert.deepEqual(plain(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields.map(({ id, value }) => [id, value])), [["preco-de", "299,90"], ["preco", "249,90"], ["preco-parcela", "49,98"], ["numero-de-parcelas", "5"]]);
    assert.equal(updateOfferOption(1, 0, "mechanicCondition", 6).ok, true);
    assert.equal(env.optionProperties[0].value, 7);
    assert.equal(layers.control.property("ADBE Effect Parade").property(1).property(1).value, 19);
    assert.deepEqual(layerTimings(env.source.layers), initialTimings);
    const properties = propertiesIn(miolo);
    const values = properties.map((property) => property.value);
    const unaffected = env.source.layers.filter((layer) => layer !== layers.fullJump && layer !== layers.parcelJump);
    const timing = layerTimings(unaffected);
    const offsets = [layers.fullJump, layers.parcelJump].map((layer) => layer.inPoint - layer.startTime);
    for (const target of ["preco-cheio", "preco-parcela", "preco-cheio"]) {
      assert.equal(updateOfferInstallmentJump(1, 0, target).ok, true);
      assert.deepEqual([layers.fullJump.inPoint, layers.parcelJump.inPoint], target === "preco-cheio" ? [5, 12] : [12, 5]);
      assert.deepEqual([layers.fullJump, layers.parcelJump].map((layer) => layer.inPoint - layer.startTime), offsets);
      assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump.selectedTarget, target);
      assert.deepEqual(properties.map((property) => property.value), values);
      assert.deepEqual(layerTimings(unaffected), timing);
      assert.deepEqual(layers.markers.marker.times, [1.25, 5, 9]);
    }
    assertUndoClosed();
  });
});

test("DE X POR Y PARCELAMENTO comments take priority over named decoys for all eight roles", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[4]);
    const layers = installmentLayers(env);
    Object.entries(layers).forEach(([role, layer]) => { layer.name = "Identificado " + role; });
    const decoy = fixture(cases[4]);
    decoy.source.layers.forEach((layer) => { layer.comment = ""; });
    const decoyProperties = propertiesIn(decoy.source);
    const values = decoyProperties.map((property) => property.value);
    const timings = layerTimings(decoy.source.layers);
    setLayerOrder(env.source, [...decoy.source.layers, ...env.source.layers].reverse());
    mountOffer(env);
    const mechanic = readMechanic(env.valueLayer, []);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
    assert.equal(updateOfferField(1, 0, "preco", "99,90").ok, true);
    assert.equal(updateOfferOption(1, 0, "mechanicCondition", 0).ok, true);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
    assert.deepEqual([layers.fullJump.inPoint, layers.parcelJump.inPoint], [5, 12]);
    assert.deepEqual(decoyProperties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(decoy.source.layers), timings);
    assertUndoClosed();
  });
});

test("DE X POR Y PARCELAMENTO comments-only mode refuses all legacy names and layer indices", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[4]);
    env.source.layers.forEach((layer) => { layer.comment = ""; });
    mountOffer(env);
    const properties = propertiesIn(env.source);
    const values = properties.map((property) => property.value);
    const timings = layerTimings(env.source.layers);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.equal(mechanic.fields.every((field) => !field.enabled), true);
    assert.equal(mechanic.optionGroups[0].enabled, false);
    assert.equal(mechanic.installmentJump.enabled, false);
    assert.ok(errors.length > 0);
    for (const definition of installmentRoles.filter((item) => item.fieldId)) {
      assert.equal(updateOfferField(1, 0, definition.fieldId, "99").ok, false);
    }
    updateOfferOption(1, 0, "mechanicCondition", 0);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
    assert.deepEqual(properties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(env.source.layers), timings);
    assertUndoClosed();
  });
});

test("DE X POR Y PARCELAMENTO optional name fallback supports moved layers and accented/plain controller and jump aliases", () => {
  withLayerNameFallback(true, () => {
    for (const [controlName, jumpName] of [[" controlador de mecânica ", " pulo preço cheio "], [" CONTROLADOR DE MECANICA ", " PULO PRECO CHEIO "]]) {
      const env = fixture(cases[4]);
      const layers = installmentLayers(env);
      Object.values(layers).forEach((layer) => { layer.comment = ""; layer.name = " " + layer.name.toLowerCase() + " "; });
      layers.control.name = controlName;
      layers.fullJump.name = jumpName;
      setLayerOrder(env.source, [...env.source.layers].reverse());
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
      assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
      assert.equal(mechanic.installmentJump.enabled, true);
      assert.equal(updateOfferField(1, 0, "numero-de-parcelas", "8 vezes").ok, true);
      assert.equal(env.fields[3].value.text, "8");
      assert.equal(updateOfferOption(1, 0, "mechanicCondition", 5).ok, true);
      assert.equal(env.optionProperties[0].value, 6);
      assert.equal(updateOfferInstallmentJump(1, 0, "preco-parcela").ok, true);
      assert.deepEqual([layers.fullJump.inPoint, layers.parcelJump.inPoint], [12, 5]);
      assertUndoClosed();
    }
  });
});

test("DE X POR Y PARCELAMENTO duplicate comments reject only the affected role without name fallback or partial mutations", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const definition of installmentRoles) {
      const env = fixture(cases[4]);
      const duplicate = new AVLayer("Comentário duplicado");
      duplicate.comment = " " + definition.comment.toLowerCase() + " ";
      setLayerOrder(env.source, [...env.source.layers, duplicate]);
      assertInstallmentRoleUnavailable(env, definition.role);
    }
  });
});

test("DE X POR Y PARCELAMENTO duplicate fallback names reject ambiguous targets for all eight roles", () => {
  withLayerNameFallback(true, () => {
    for (const definition of installmentRoles) {
      const env = fixture(cases[4]);
      const original = env.source.layer(definition.index);
      original.comment = "";
      const duplicateName = definition.role === "control" ? " CONTROLADOR DE MECANICA " : definition.role === "fullJump" ? " PULO PRECO CHEIO " : " " + original.name.toLowerCase() + " ";
      setLayerOrder(env.source, [...env.source.layers, new AVLayer(duplicateName)]);
      assertInstallmentRoleUnavailable(env, definition.role);
    }
  });
});

test("DE X POR Y PARCELAMENTO missing identities disable only their role and never fall back to fixed indices", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const definition of installmentRoles) {
      const env = fixture(cases[4]);
      const original = env.source.layer(definition.index);
      original.comment = "";
      if (enabled) original.name = "Identidade ausente";
      assertInstallmentRoleUnavailable(env, definition.role);
    }
  });
});

test("DE X POR Y PARCELAMENTO invalid commented text/controller cannot fall through to valid named layers", () => {
  withLayerNameFallback(true, () => {
    for (const definition of installmentRoles.filter((item) => !item.jump)) {
      const env = fixture(cases[4]);
      env.source.layer(definition.index).comment = "";
      const invalid = new AVLayer("Sem propriedades necessárias");
      invalid.comment = definition.comment;
      setLayerOrder(env.source, [invalid, ...env.source.layers]);
      assertInstallmentRoleUnavailable(env, definition.role);
    }
  });
});

test("DE X POR Y PARCELAMENTO missing or non-finite second marker disables jumps before moving any layer", () => {
  for (const times of [[], [1.25], [1.25, NaN], [1.25, Infinity]]) withLayerNameFallback(false, () => {
    const env = fixture(cases[4]);
    env.source.layer(1).marker = new MarkerProperty(times);
    assertInstallmentRoleUnavailable(env, "markers");
  });
});

test("DE X POR Y PARCELAMENTO rejects a single layer resolving to two jump roles through comment/name fallback", () => {
  withLayerNameFallback(true, () => {
    for (const [existingRole, missingRole] of [["markers", "parcelJump"], ["markers", "fullJump"], ["fullJump", "parcelJump"]]) {
      const env = fixture(cases[4]);
      const layers = installmentLayers(env);
      const missingDefinition = installmentRoles.find(({ role }) => role === missingRole);
      layers[existingRole].name = missingDefinition.comment;
      layers[missingRole].comment = "";
      layers[missingRole].name = "Papel sem identidade";
      assertInstallmentRoleUnavailable(env, missingRole);
    }
  });
});

test("DE X POR Y PARCELAMENTO keeps Condição lookup by effect name independently of effect order", () => {
  withLayerNameFallback(false, () => {
    for (const effectIndex of [0, 2]) {
      const env = fixture(cases[4]);
      const effects = env.source.layer(5).property("ADBE Effect Parade");
      const condition = effects.properties[1];
      const firstDecoy = effect("Outro menu", 19);
      const secondDecoy = effect("Outro slider", 23, false);
      effects.properties = [firstDecoy, secondDecoy];
      effects.properties.splice(effectIndex, 0, condition);
      mountOffer(env);
      assert.equal(readMechanic(env.valueLayer, []).optionGroups[0].controllerProperty, env.optionProperties[0]);
      assert.equal(updateOfferOption(1, 0, "mechanicCondition", 6).ok, true);
      assert.equal(condition.property(1).value, 7);
      assert.deepEqual([firstDecoy.property(1).value, secondDecoy.property(1).value], [19, 23]);
      assertUndoClosed();
    }
    for (const condition of [null, effect("Condicao", 4), new PropertyGroup("Condição", [new Property("Menu", "texto")])]) {
      const env = fixture(cases[4]);
      env.source.layer(5).property("ADBE Effect Parade").properties = [effect("Outro menu", 19), ...(condition ? [condition] : []), effect("Outro slider", 23, false)];
      assertInstallmentRoleUnavailable(env, "control");
    }
  });
});

const meuCardRoles = [
  { role: "markers", index: 1, comment: "MARCADORES", jump: true },
  { role: "meuJump", index: 2, comment: "PULO PRECO MEU CRF", jump: true },
  { role: "cardJump", index: 3, comment: "PULO PRECO CARTAO CRF", jump: true },
  { role: "de", index: 4, comment: "PRECO DE", fieldIndex: 0, fieldId: "preco-de" },
  { role: "por", index: 6, comment: "PRECO POR", fieldIndex: 1, fieldId: "preco-por" },
  { role: "card", index: 8, comment: "PRECO POR CARTAO", fieldIndex: 2, fieldId: "preco-por-cartao" },
  { role: "control", index: 9, comment: "CONTROLADOR DE MECANICA" },
];

function meuCardLayers(env) {
  return Object.fromEntries(meuCardRoles.map(({ role, index }) => [role, env.source.layer(index)]));
}

function assertMeuCardRoleUnavailable(env, role) {
  assertRoleUnavailable(env, cases[6], meuCardRoles, role);
}

test("MEU CRF/CARTAO screenshot comments resolve the card jump without MEU with locked markers and two keys", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[6]);
    const layers = meuCardLayers(env);
    assert.equal(layers.cardJump.comment, "PULO PRECO CARTAO CRF");
    layers.markers.locked = true;
    layers.markers.marker = new MarkerProperty([1.25, 5]);
    Object.entries(layers).forEach(([role, layer]) => { layer.name = "Nome livre " + role; });
    const namedDecoy = new AVLayer("PULO PREÇO CARTAO CRF");
    namedDecoy.inPoint = 1;
    setLayerOrder(env.source, [...env.source.layers, namedDecoy].reverse());
    const miolo = mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.equal(mechanic.installmentJump.enabled, true);
    assert.equal(mechanic.fields.every((field) => field.enabled), true);
    assert.deepEqual(plain(mechanic.fields.map(({ id }) => id)), ["preco-de", "preco-por", "preco-por-cartao"]);
    const properties = propertiesIn(miolo);
    const values = properties.map((property) => property.value);
    const untouched = env.source.layers.filter((layer) => layer !== layers.meuJump && layer !== layers.cardJump);
    const times = layerTimings(untouched);
    for (const target of ["preco-cheio", "preco-parcela"]) {
      const action = updateOfferInstallmentJump(1, 0, target);
      assert.equal(action.ok, true, action.message);
      assert.deepEqual([layers.meuJump.inPoint, layers.cardJump.inPoint], target === "preco-cheio" ? [5, 12] : [12, 5]);
      const publicJump = getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump;
      assert.equal(publicJump.enabled, true);
      assert.equal(publicJump.selectedTarget, target);
      assert.deepEqual(properties.map((property) => property.value), values);
      assert.deepEqual(layerTimings(untouched), times);
      assert.equal(layers.markers.locked, true);
      assert.deepEqual(layers.markers.marker.times, [1.25, 5]);
    }
    assertUndoClosed();
  });
});

test("MEU CRF/CARTAO comments preserve moved/renamed prices, editor/actions/Roteiro identity and both jump targets", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[6]);
    const layers = meuCardLayers(env);
    Object.entries(layers).forEach(([role, layer]) => {
      layer.name = "Nome visual " + role;
      layer.comment = "  " + layer.comment.toLowerCase() + "\t";
    });
    setLayerOrder(env.source, [...env.source.layers].reverse());
    const miolo = mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), cases[6].fields);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    assert.deepEqual(plain(mechanic.optionGroups.map(({ id, label, selectedIndex, options, placement }) => ({ id, label, selectedIndex, options: options.map(({ label }) => label), placement }))), cases[6].groups);
    assert.deepEqual(plain(getOffersFirstProductInfo()[0].priceField), { fieldId: "preco-de", fieldIndex: 0, value: "18,90" });
    const originalTiming = layerTimings(env.source.layers);
    for (const [index, value] of ["R$ 29,90", "R$ 25,90", "R$ 19,90"].entries()) {
      assert.equal(updateOfferField(1, 0, cases[6].fields[index][0], value).ok, true);
    }
    assert.deepEqual(plain(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.fields.map(({ id, value }) => [id, value])), [["preco-de", "29,90"], ["preco-por", "25,90"], ["preco-por-cartao", "19,90"]]);
    assert.deepEqual(plain(getOffersFirstProductInfo()[0].priceField), { fieldId: "preco-de", fieldIndex: 0, value: "29,90" });
    assert.equal(updateOfferOption(1, 0, "unit", 3).ok, true);
    assert.equal(env.optionProperties[0].value, 4);
    assert.equal(layers.control.property("ADBE Effect Parade").property(1).property(1).value, 33);
    assert.deepEqual(layerTimings(env.source.layers), originalTiming);
    const properties = propertiesIn(miolo);
    const values = properties.map((property) => property.value);
    const unaffected = env.source.layers.filter((layer) => layer !== layers.meuJump && layer !== layers.cardJump);
    const timing = layerTimings(unaffected);
    const offsets = [layers.meuJump, layers.cardJump].map((layer) => layer.inPoint - layer.startTime);
    for (const target of ["preco-cheio", "preco-parcela", "preco-cheio"]) {
      assert.equal(updateOfferInstallmentJump(1, 0, target).ok, true);
      assert.deepEqual([layers.meuJump.inPoint, layers.cardJump.inPoint], target === "preco-cheio" ? [5, 12] : [12, 5]);
      assert.deepEqual([layers.meuJump, layers.cardJump].map((layer) => layer.inPoint - layer.startTime), offsets);
      assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump.selectedTarget, target);
      assert.deepEqual(properties.map((property) => property.value), values);
      assert.deepEqual(layerTimings(unaffected), timing);
      assert.deepEqual(layers.markers.marker.times, [1.25, 5, 9]);
    }
    assertUndoClosed();
  });
});

test("MEU CRF/CARTAO comments take priority over named decoys and another layer's Unidade dropdown", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[6]);
    const layers = meuCardLayers(env);
    Object.entries(layers).forEach(([role, layer]) => { layer.name = "Identificado " + role; });
    const decoy = fixture(cases[6]);
    decoy.source.layers.forEach((layer) => { layer.comment = ""; });
    const decoyProperties = propertiesIn(decoy.source);
    const values = decoyProperties.map((property) => property.value);
    const timings = layerTimings(decoy.source.layers);
    setLayerOrder(env.source, [...env.source.layers, ...decoy.source.layers].reverse());
    mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
    assert.equal(updateOfferField(1, 0, "preco-por-cartao", "9,90").ok, true);
    assert.equal(updateOfferOption(1, 0, "unit", 0).ok, true);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
    assert.deepEqual([layers.meuJump.inPoint, layers.cardJump.inPoint], [5, 12]);
    assert.deepEqual(decoyProperties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(decoy.source.layers), timings);
    assertUndoClosed();
  });
});

test("MEU CRF/CARTAO comments-only mode rejects all names/indices and requires the exact new card-jump comment", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[6]);
    env.source.layers.forEach((layer) => { layer.comment = ""; });
    mountOffer(env);
    const properties = propertiesIn(env.source);
    const values = properties.map((property) => property.value);
    const timings = layerTimings(env.source.layers);
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields.every((field) => !field.enabled), true);
    assert.equal(mechanic.optionGroups[0].enabled, false);
    assert.equal(mechanic.installmentJump.enabled, false);
    assert.equal(updateOfferField(1, 0, "preco-de", "99,90").ok, false);
    updateOfferOption(1, 0, "unit", 0);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
    assert.deepEqual(properties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(env.source.layers), timings);
    assertUndoClosed();
    const oldComment = fixture(cases[6]);
    oldComment.source.layer(3).comment = "PULO PRECO MEU CARTAO CRF";
    assertMeuCardRoleUnavailable(oldComment, "cardJump");
  });
});

test("MEU CRF/CARTAO optional name fallback resolves moved roles using the supported old/new jump aliases", () => {
  withLayerNameFallback(true, () => {
    for (const [controlName, meuName, cardName] of [
      [" controlador de mecânica ", " pulo preço meu crf ", " pulo preço cartao crf "],
      [" CONTROLADOR DE MECANICA ", " PULO PRECO MEU CRF ", " PULO PRECO CARTAO CRF "],
    ]) {
      const env = fixture(cases[6]);
      const layers = meuCardLayers(env);
      Object.values(layers).forEach((layer) => { layer.comment = ""; layer.name = " " + layer.name.toLowerCase() + " "; });
      layers.control.name = controlName;
      layers.meuJump.name = meuName;
      layers.cardJump.name = cardName;
      setLayerOrder(env.source, [...env.source.layers].reverse());
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
      assert.equal(mechanic.optionGroups[0].controllerProperty, env.optionProperties[0]);
      assert.equal(updateOfferField(1, 0, "preco-por", "11,50").ok, true);
      assert.equal(env.fields[1].value.text, "11,50");
      assert.equal(updateOfferOption(1, 0, "unit", 1).ok, true);
      assert.equal(env.optionProperties[0].value, 2);
      assert.equal(updateOfferInstallmentJump(1, 0, "preco-parcela").ok, true);
      assert.deepEqual([layers.meuJump.inPoint, layers.cardJump.inPoint], [12, 5]);
      assertUndoClosed();
    }
  });
});

test("MEU CRF/CARTAO duplicate or missing comments disable only the affected role and never use fixed indices", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const definition of meuCardRoles) {
      for (const duplicate of [false, true]) {
        const env = fixture(cases[6]);
        if (duplicate) {
          const conflicting = new AVLayer("Comentário duplicado");
          conflicting.comment = " " + definition.comment.toLowerCase() + " ";
          setLayerOrder(env.source, [...env.source.layers, conflicting]);
        } else {
          const original = env.source.layer(definition.index);
          original.comment = "";
          if (enabled) original.name = "Identidade ausente";
        }
        assertMeuCardRoleUnavailable(env, definition.role);
      }
    }
  });
});

test("MEU CRF/CARTAO duplicate fallback names reject ambiguity for all seven roles", () => {
  withLayerNameFallback(true, () => {
    for (const definition of meuCardRoles) {
      const env = fixture(cases[6]);
      const original = env.source.layer(definition.index);
      original.comment = "";
      setLayerOrder(env.source, [...env.source.layers, new AVLayer(" " + definition.comment.toLowerCase() + " ")]);
      assertMeuCardRoleUnavailable(env, definition.role);
    }
  });
});

test("MEU CRF/CARTAO invalid commented fields/controller cannot fall through to valid named layers", () => {
  withLayerNameFallback(true, () => {
    for (const definition of meuCardRoles.filter((item) => !item.jump)) {
      const env = fixture(cases[6]);
      env.source.layer(definition.index).comment = "";
      const invalid = new AVLayer("Sem propriedades necessárias");
      invalid.comment = definition.comment;
      setLayerOrder(env.source, [invalid, ...env.source.layers]);
      assertMeuCardRoleUnavailable(env, definition.role);
    }
  });
});

test("MEU CRF/CARTAO Unidade is scoped to the identified controller and duplicate native dropdowns there disable only the unit", () => {
  withLayerNameFallback(false, () => {
    for (const controllerEffects of [[], [effect("Unidade", 2, false)], [effect("unidade", 2)], [effect("Unidade", 1), effect("Unidade", 4)]]) {
      const env = fixture(cases[6]);
      const layers = meuCardLayers(env);
      layers.control.property("ADBE Effect Parade").properties = controllerEffects;
      const outsideUnit = effect("Unidade", 3);
      const outside = new AVLayer("Outro controlador", [new PropertyGroup("ADBE Effect Parade", [outsideUnit])]);
      setLayerOrder(env.source, [...env.source.layers, outside]);
      assertMeuCardRoleUnavailable(env, "control");
      assert.equal(outsideUnit.property(1).value, 3);
    }
  });
});

test("MEU CRF/CARTAO missing or invalid second marker and shared jump-role layers cause no partial timing changes", () => {
  for (const times of [[], [1.25], [1.25, NaN], [1.25, Infinity]]) withLayerNameFallback(false, () => {
    const env = fixture(cases[6]);
    env.source.layer(1).marker = new MarkerProperty(times);
    assertMeuCardRoleUnavailable(env, "markers");
  });
  withLayerNameFallback(true, () => {
    for (const [existingRole, missingRole] of [["markers", "cardJump"], ["markers", "meuJump"], ["meuJump", "cardJump"]]) {
      const env = fixture(cases[6]);
      const layers = meuCardLayers(env);
      layers[existingRole].name = meuCardRoles.find(({ role }) => role === missingRole).comment;
      layers[missingRole].comment = "";
      layers[missingRole].name = "Papel sem identidade";
      assertMeuCardRoleUnavailable(env, missingRole);
    }
  });
});

const combinedRoles = [
  { role: "markers", index: 1, comment: "MARCADORES", jump: true },
  { role: "fullJump", index: 2, comment: "PULO PRECO CHEIO", jump: true },
  { role: "priceJump", index: 3, comment: "PULO", jump: true },
  { role: "control", index: 5, comment: "CONTROLADOR DE MECANICA", disabledFieldIndices: [2] },
  { role: "de", index: 6, comment: "PRECO DE", fieldIndex: 0, fieldId: "preco-de" },
  { role: "por", index: 12, comment: "PRECO POR", fieldIndex: 1, fieldId: "preco-por" },
  { role: "percent", index: 16, comment: "PORCENTAGEM DESCONTO", fieldIndex: 3, fieldId: "por-centagem-desconto" },
];

function combinedLayers(env) {
  return Object.fromEntries(combinedRoles.map(({ role, index }) => [role, env.source.layer(index)]));
}

function assertCombinedRoleUnavailable(env, role) {
  assertRoleUnavailable(env, cases[5], combinedRoles, role);
}

test("COMBINADA comments preserve moved/renamed layers, stable panel/RN field IDs, Roteiro references and both jumps", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[5]);
    const layers = combinedLayers(env);
    Object.entries(layers).forEach(([role, layer]) => {
      layer.name = "Nome visual " + role;
      layer.comment = " " + layer.comment.toLowerCase() + "\t";
    });
    setLayerOrder(env.source, [...env.source.layers].reverse());
    const miolo = mountOffer(env);
    const errors = [];
    const mechanic = readMechanic(env.valueLayer, errors);
    assert.deepEqual(errors, []);
    assert.deepEqual(plain(mechanic.fields.map(({ id, label, format, value }) => [id, label, format, value])), cases[5].fields);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    assert.equal(mechanic.fields[2].valueKind, "value");
    assert.deepEqual(plain(mechanic.optionGroups.map(({ id, label, selectedIndex, options, placement }) => ({ id, label, selectedIndex, options: options.map(({ label }) => label), placement }))), cases[5].groups);
    let info = getOffersFirstProductInfo()[0];
    assert.deepEqual(plain(info.deField), { fieldId: "preco-de", fieldIndex: 0, value: "25,90" });
    assert.deepEqual(plain(info.porField), { fieldId: "preco-por", fieldIndex: 1, value: "20,90" });
    assert.deepEqual(plain(info.priceField), { fieldId: "preco-por", fieldIndex: 1, value: "20,90" });
    const originalTiming = layerTimings(env.source.layers);
    assert.equal(updateOfferField(1, 0, info.deField.fieldId, "R$ 29,90", info.deField.fieldIndex).ok, true);
    assert.equal(updateOfferField(1, 0, info.porField.fieldId, "R$ 24,90", info.porField.fieldIndex).ok, true);
    assert.equal(updateOfferField(1, 0, "quantidade-x", "8 unidades").ok, true);
    assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "30%").ok, true);
    assert.equal(env.fields[2].value, 8);
    assert.equal(typeof env.fields[2].value, "number");
    for (const [index, option] of [4, 2, 0].entries()) {
      assert.equal(updateOfferOption(1, 0, cases[5].groups[index].id, option).ok, true);
    }
    assert.deepEqual(env.optionProperties.map((property) => property.value), [5, 3, 1]);
    const publicMechanic = getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic;
    // These stable IDs drive the existing RN/Card price and discount layout.
    assert.deepEqual(plain(publicMechanic.fields.map(({ id, value }) => [id, value])), [["preco-de", "29,90"], ["preco-por", "24,90"], ["quantidade-x", "8"], ["por-centagem-desconto", "30"]]);
    assert.equal(publicMechanic.optionGroups[1].id, "mechanicSubtype");
    assert.equal(publicMechanic.optionGroups[1].selectedIndex, 2);
    info = getOffersFirstProductInfo()[0];
    assert.deepEqual([info.deValue, info.porValue, info.priceValue], ["29,90", "24,90", "24,90"]);
    assert.deepEqual(layerTimings(env.source.layers), originalTiming);
    const properties = propertiesIn(miolo);
    const values = properties.map((property) => property.value);
    const unaffected = env.source.layers.filter((layer) => layer !== layers.fullJump && layer !== layers.priceJump);
    const timing = layerTimings(unaffected);
    const offsets = [layers.fullJump, layers.priceJump].map((layer) => layer.inPoint - layer.startTime);
    for (const target of ["preco-cheio", "preco-parcela", "preco-cheio"]) {
      assert.equal(updateOfferInstallmentJump(1, 0, target).ok, true);
      assert.deepEqual([layers.fullJump.inPoint, layers.priceJump.inPoint], target === "preco-cheio" ? [5, 12] : [12, 5]);
      assert.deepEqual([layers.fullJump, layers.priceJump].map((layer) => layer.inPoint - layer.startTime), offsets);
      assert.equal(getOffersEditorSnapshot(1).selectedOffer.products[0].mechanic.installmentJump.selectedTarget, target);
      assert.deepEqual(properties.map((property) => property.value), values);
      assert.deepEqual(layerTimings(unaffected), timing);
      assert.deepEqual(layers.markers.marker.times, [1.25, 5, 9]);
    }
    assertUndoClosed();
  });
});

test("COMBINADA comments take priority over named decoys for all roles, including the quantity controller", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    const env = fixture(cases[5]);
    const layers = combinedLayers(env);
    Object.entries(layers).forEach(([role, layer]) => { layer.name = "Identificado " + role; });
    const decoy = fixture(cases[5]);
    decoy.source.layers.forEach((layer) => { layer.comment = ""; });
    const decoyProperties = propertiesIn(decoy.source);
    const values = decoyProperties.map((property) => property.value);
    const timings = layerTimings(decoy.source.layers);
    setLayerOrder(env.source, [...env.source.layers, ...decoy.source.layers].reverse());
    mountOffer(env);
    const mechanic = readMechanic(env.valueLayer, []);
    mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
    mechanic.optionGroups.forEach((group, index) => assert.equal(group.controllerProperty, env.optionProperties[index]));
    assert.equal(updateOfferField(1, 0, "quantidade-x", "9 unidades").ok, true);
    assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "40%").ok, true);
    assert.equal(updateOfferOption(1, 0, "mechanicSubtype", 2).ok, true);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, true);
    assert.equal(env.fields[2].value, 9);
    assert.deepEqual([layers.fullJump.inPoint, layers.priceJump.inPoint], [5, 12]);
    assert.deepEqual(decoyProperties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(decoy.source.layers), timings);
    assertUndoClosed();
  });
});

test("COMBINADA comments-only mode refuses all names and fixed layer indices", () => {
  withLayerNameFallback(false, () => {
    const env = fixture(cases[5]);
    env.source.layers.forEach((layer) => { layer.comment = ""; });
    mountOffer(env);
    const properties = propertiesIn(env.source);
    const values = properties.map((property) => property.value);
    const timings = layerTimings(env.source.layers);
    const mechanic = readMechanic(env.valueLayer, []);
    assert.equal(mechanic.fields.every((field) => !field.enabled), true);
    assert.equal(mechanic.optionGroups.every((group) => !group.enabled), true);
    assert.equal(mechanic.installmentJump.enabled, false);
    for (const [id] of cases[5].fields) assert.equal(updateOfferField(1, 0, id, "99").ok, false);
    for (const group of cases[5].groups) updateOfferOption(1, 0, group.id, 0);
    assert.equal(updateOfferInstallmentJump(1, 0, "preco-cheio").ok, false);
    assert.deepEqual(properties.map((property) => property.value), values);
    assert.deepEqual(layerTimings(env.source.layers), timings);
    assertUndoClosed();
  });
});

test("COMBINADA optional name fallback resolves moved roles and the configured controller/jump aliases", () => {
  withLayerNameFallback(true, () => {
    for (const [controlName, jumpName] of [[" controlador de mecânica ", " pulo preço cheio "], [" CONTROLADOR DE MECANICA ", " PULO PRECO CHEIO "]]) {
      const env = fixture(cases[5]);
      const layers = combinedLayers(env);
      Object.values(layers).forEach((layer) => { layer.comment = ""; layer.name = " " + layer.name.toLowerCase() + " "; });
      layers.control.name = controlName;
      layers.fullJump.name = jumpName;
      setLayerOrder(env.source, [...env.source.layers].reverse());
      mountOffer(env);
      const errors = [];
      const mechanic = readMechanic(env.valueLayer, errors);
      assert.deepEqual(errors, []);
      mechanic.fields.forEach((field, index) => assert.equal(field.property, env.fields[index]));
      assert.equal(updateOfferField(1, 0, "preco-de", "39,90").ok, true);
      assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "45%").ok, true);
      assert.equal(updateOfferOption(1, 0, "unit", 1).ok, true);
      assert.equal(updateOfferInstallmentJump(1, 0, "preco-parcela").ok, true);
      assert.deepEqual([env.fields[0].value.text, env.fields[3].value.text, env.optionProperties[2].value], ["39,90", "45", 2]);
      assert.deepEqual([layers.fullJump.inPoint, layers.priceJump.inPoint], [12, 5]);
      assertUndoClosed();
    }
    const oldPercentName = fixture(cases[5]);
    oldPercentName.source.layer(16).comment = "";
    oldPercentName.source.layer(16).name = "POR CENTAGEM DESCONTO";
    assertCombinedRoleUnavailable(oldPercentName, "percent");
  });
});

test("COMBINADA duplicate or missing comments disable only affected fields/options/jumps without fallback to indices", () => {
  for (const enabled of [false, true]) withLayerNameFallback(enabled, () => {
    for (const definition of combinedRoles) {
      for (const duplicate of [false, true]) {
        const env = fixture(cases[5]);
        if (duplicate) {
          const conflicting = new AVLayer("Comentário duplicado");
          conflicting.comment = " " + definition.comment.toLowerCase() + " ";
          setLayerOrder(env.source, [...env.source.layers, conflicting]);
        } else {
          const original = env.source.layer(definition.index);
          original.comment = "";
          if (enabled) original.name = "Identidade ausente";
        }
        assertCombinedRoleUnavailable(env, definition.role);
      }
    }
  });
});

test("COMBINADA duplicate fallback names reject ambiguity for all seven roles", () => {
  withLayerNameFallback(true, () => {
    for (const definition of combinedRoles) {
      const env = fixture(cases[5]);
      env.source.layer(definition.index).comment = "";
      setLayerOrder(env.source, [...env.source.layers, new AVLayer(" " + definition.comment.toLowerCase() + " ")]);
      assertCombinedRoleUnavailable(env, definition.role);
    }
  });
});

test("COMBINADA invalid commented texts/controller cannot fall through to valid named layers", () => {
  withLayerNameFallback(true, () => {
    for (const definition of combinedRoles.filter((item) => !item.jump)) {
      const env = fixture(cases[5]);
      env.source.layer(definition.index).comment = "";
      const invalid = new AVLayer("Sem propriedades necessárias");
      invalid.comment = definition.comment;
      setLayerOrder(env.source, [invalid, ...env.source.layers]);
      assertCombinedRoleUnavailable(env, definition.role);
    }
  });
});

test("COMBINADA E1 through E4 remain independent indexed controls and an invalid effect never redirects writes", () => {
  withLayerNameFallback(false, () => {
    for (let invalidIndex = 0; invalidIndex < 4; invalidIndex += 1) {
      for (const missing of [false, true]) {
        const env = fixture(cases[5]);
        const effects = env.source.layer(5).property("ADBE Effect Parade");
        effects.properties.forEach((item, index) => { item.name = "Nome arbitrário " + index; });
        effects.properties[invalidIndex] = missing
          ? new PropertyGroup("Sem propriedades")
          : new PropertyGroup("Valor inválido", [new Property("Menu", "texto")]);
        const unrelated = effect("Controle extra", 41, false);
        effects.properties.push(unrelated);
        mountOffer(env);
        const properties = propertiesIn(env.source);
        const values = properties.map((property) => property.value);
        const errors = [];
        const mechanic = readMechanic(env.valueLayer, errors);
        assert.ok(errors.length > 0);
        assert.equal(mechanic.installmentJump.enabled, true);
        mechanic.optionGroups.forEach((group, index) => assert.equal(group.enabled, index !== invalidIndex));
        mechanic.fields.forEach((field, index) => assert.equal(field.enabled, !(index === 2 && invalidIndex === 3)));
        if (invalidIndex === 3) assert.equal(updateOfferField(1, 0, "quantidade-x", "99").ok, false);
        else updateOfferOption(1, 0, cases[5].groups[invalidIndex].id, 0);
        assert.deepEqual(properties.map((property) => property.value), values);
        for (let index = 0; index < 4; index += 1) {
          if (index === invalidIndex) continue;
          if (index === 3) {
            assert.equal(updateOfferField(1, 0, "quantidade-x", "9 unidades").ok, true);
            assert.equal(env.fields[2].value, 9);
          } else {
            assert.equal(updateOfferOption(1, 0, cases[5].groups[index].id, 0).ok, true);
            assert.equal(env.optionProperties[index].value, 1);
          }
        }
        assert.equal(updateOfferField(1, 0, "por-centagem-desconto", "50%").ok, true);
        assert.equal(env.fields[3].value.text, "50");
        assert.equal(unrelated.property(1).value, 41);
        assertUndoClosed();
      }
    }
  });
});

test("COMBINADA missing/invalid second marker and shared jump-role layers produce no partial timing changes", () => {
  for (const times of [[], [1.25], [1.25, NaN], [1.25, Infinity]]) withLayerNameFallback(false, () => {
    const env = fixture(cases[5]);
    env.source.layer(1).marker = new MarkerProperty(times);
    assertCombinedRoleUnavailable(env, "markers");
  });
  withLayerNameFallback(true, () => {
    for (const [existingRole, missingRole] of [["markers", "priceJump"], ["markers", "fullJump"], ["fullJump", "priceJump"]]) {
      const env = fixture(cases[5]);
      const layers = combinedLayers(env);
      layers[existingRole].name = combinedRoles.find(({ role }) => role === missingRole).comment;
      layers[missingRole].comment = "";
      layers[missingRole].name = "Papel sem identidade";
      assertCombinedRoleUnavailable(env, missingRole);
    }
  });
});
