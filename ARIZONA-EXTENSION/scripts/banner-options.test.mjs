import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createTemplateTestAssets } from "./template-test-assets.mjs";

const domain = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const compiled = new Map();
const plain = (value) => JSON.parse(JSON.stringify(value));
let nextId = 1;
class Property {
  constructor(name, value) { this.name = name; this.value = value; this.matchName = name; }
}
class PropertyGroup {
  constructor(name, properties = []) { this.name = name; this.properties = properties; }
  property(key) { return this.properties.find((item) => item.name === key) || null; }
  get numProperties() { return this.properties.length; }
}
class AVLayer extends PropertyGroup {
  constructor(name, source = null, properties = []) {
    super(name, properties);
    this.id = nextId++;
    this.source = source;
    this.comment = "";
    this.locked = false;
    this.visibility = false;
    this.writes = [];
  }
  get enabled() { return this.visibility; }
  set enabled(value) {
    if (this.rejectWrite) throw new Error("Unexpected write outside the banner");
    this.writes.push(value);
    this.visibility = value;
    if (this.failOnce) { this.failOnce = false; throw new Error("Native visibility failure"); }
  }
}
class TextLayer extends AVLayer {
  constructor(name, comment = "") {
    const sourceText = new Property("ADBE Text Document", { text: "Different source text" });
    super(name, null, [new PropertyGroup("ADBE Text Properties", [sourceText])]);
    this.text = { sourceText };
    this.comment = comment;
  }
}
class CompItem {
  constructor(name, layers = []) { this.id = nextId++; this.name = name; this.comment = ""; this.reorder(layers); }
  reorder(layers) { this.layers = layers; layers.forEach((layer, index) => { layer.index = index + 1; }); }
  get numLayers() { return this.layers.length; }
  layer(index) { return this.layers[index - 1] || null; }
}

function fixture({ fallback = true, legacy = false, extra = false } = {}) {
  const assets = createTemplateTestAssets({ offerLayers: fallback });
  const definitions = assets.map.banners.eletroPneu.layers;
  const control = new AVLayer("CARTAO CONTROL");
  control.comment = legacy ? "" : "CONTROL";
  control.visibility = true;
  const background = new AVLayer("TARJA_ROSA");
  background.comment = legacy ? "" : "TARJA";
  background.visibility = true;
  const image = new AVLayer("NOSSOS_CARTOES.png");
  image.visibility = true;
  const electro = new TextLayer(legacy ? definitions.electro.names[0] : "Eletro  15x, sem juros", legacy ? "" : "ELETRO");
  const tire = new TextLayer(legacy ? definitions.tire.names[0] : "Pneus 10x", legacy ? "" : "PNEU");
  const dynamicA = new TextLayer("  Promoção de aves  15%  ");
  const dynamicB = new TextLayer("Bazar");
  dynamicB.visibility = true;
  const foreign = new TextLayer("Outro controle", "OUTRO CONTROLE");
  foreign.visibility = true;
  const bannerSource = new CompItem("TARJA_ELETRO_PNEU", [image, dynamicA, control, electro, tire, dynamicB, foreign, background]);
  if (extra) bannerSource.reorder(bannerSource.layers.concat(new TextLayer("Maturatta")));
  const bannerLayer = new AVLayer("Camada renomeada pelo editor", bannerSource);
  bannerLayer.visibility = true;
  const unrelated = new AVLayer("Outra camada");
  unrelated.rejectWrite = true;
  const legalSource = new CompItem("Legal da oferta", [unrelated, bannerLayer]);
  const legalLayer = new AVLayer("Legal", legalSource);
  legalLayer.comment = "TEXTO LEGAL";
  const offerSource = new CompItem("Oferta", [legalLayer]);
  const offer = new AVLayer("Oferta_01", offerSource);
  offer.comment = "CAMADA OFERTA 01";
  const miolo = new CompItem("Miolo", [offer]);
  const undo = { opened: 0, closed: 0 };
  const app = {
    project: { file: { fsName: "C:/projeto.aep", name: "projeto.aep" }, numItems: 1, item: () => miolo },
    beginUndoGroup() { undo.opened++; }, endUndoGroup() { undo.closed++; },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, app, CompItem, AVLayer, TextLayer,
      Property, PropertyGroup, PropertyValueType: { OneD: 1 }, File: assets.wrapFile(), Error,
      require(specifier) {
        const base = path.resolve(path.dirname(filename), specifier);
        const target = [base, base + ".ts", base + ".js"].find(existsSync);
        assert.ok(target, "Missing dependency " + specifier);
        return load(target);
      },
    }, { filename });
    if (filename.endsWith("templateIdentities.ts")) module.exports.configureTemplateIdentitiesPath(assets.filePath);
    return module.exports;
  }
  const reader = load(path.join(domain, "layers/bannerOptions.ts"));
  const actions = load(path.join(domain, "actions/legalControls.ts"));
  const allLayers = () => [offer, legalLayer, bannerLayer, unrelated, ...bannerSource.layers];
  const read = () => reader.readBannerControl(legalSource, [], offer);
  const context = () => plain(read().optionGroup.context);
  const select = (index, expected = context()) => actions.updateOfferLegalControlOption(1, "tarja-eletro-pneu", index, expected);
  const toggle = (enabled, expected = context()) => actions.updateOfferLegalControl(1, "tarja-eletro-pneu", enabled, expected);
  const assertNoWrites = () => { assert.equal(allLayers().reduce((sum, layer) => sum + layer.writes.length, 0), 0); assert.deepEqual(undo, { opened: 0, closed: 0 }); };
  return { assets, app, control, background, image, electro, tire, dynamicA, dynamicB, foreign, bannerSource,
    bannerLayer, legalSource, legalLayer, offerSource, offer, miolo, undo, allLayers, read, context, select, toggle, actions, reader, assertNoWrites };
}

test("banner menu uses direct text layer names in timeline order, preserving whitespace and per-comp variations", () => {
  for (const extra of [false, true]) {
    const env = fixture({ extra });
    const control = env.read();
    assert.equal(control.available, true);
    assert.equal(control.locked, false);
    assert.equal(control.layerIndex, 2);
    assert.equal(control.optionGroup.enabled, true);
    assert.deepEqual(plain(control.optionGroup.options), [env.dynamicA, env.electro, env.tire, env.dynamicB, ...(extra ? [env.bannerSource.layer(9)] : [])]
      .map((layer) => ({ id: String(layer.id), label: layer.name })));
    assert.equal(control.optionGroup.selectedIndex, 3);
    const serialized = plain(control);
    assert.equal(serialized.optionGroup.context.bannerSourceId, env.bannerSource.id);
    assert.equal(JSON.stringify(serialized).includes("visibility"), false);
    env.assertNoWrites();
  }
});

test("comment identities ignore fixed names and positions; legacy names obey the configured fallback", () => {
  const tagged = fixture({ fallback: false });
  tagged.electro.name = "Completamente renomeado";
  tagged.bannerSource.reorder(tagged.bannerSource.layers.slice().reverse());
  assert.equal(tagged.read().available, true);
  const legacy = fixture({ legacy: true });
  assert.equal(legacy.read().optionGroup.options.length, 4);
  legacy.assets.map.fallback.offerLayers = false;
  assert.equal(legacy.read().available, false);
  assert.match(legacy.read().disabledReason, /ELETRO.*nao foi encontrado/);
  legacy.assertNoWrites();
});

test("configured source identifies only the parent in this legal comp; name fallback is gated and duplicates block", () => {
  const env = fixture({ fallback: false });
  assert.equal(env.read().available, true);
  env.bannerSource.name = "Fonte personalizada";
  env.bannerLayer.name = "TARJA_ELETRO_PNEU";
  assert.equal(env.read().available, false);
  env.assets.map.fallback.offerLayers = true;
  assert.equal(env.read().available, true);
  env.legalSource.reorder([env.bannerLayer, new AVLayer("TARJA_ELETRO_PNEU", new CompItem("Outra"))]);
  assert.equal(env.read().available, false);
  env.assertNoWrites();
});

test("fixed duplicates, missing roles, wrong native types and foreign comments fail closed", () => {
  const changes = [
    (env) => env.bannerSource.reorder(env.bannerSource.layers.concat(new TextLayer("Duplicado", "ELETRO"))),
    (env) => { env.electro.comment = "OUTRA IDENTIDADE"; env.electro.name = env.assets.map.banners.eletroPneu.layers.electro.names[0]; },
    (env) => { env.electro.comment = ""; },
    (env) => { const fake = new AVLayer("Eletro"); fake.comment = "ELETRO"; env.bannerSource.reorder(env.bannerSource.layers.map((layer) => layer === env.electro ? fake : layer)); },
  ];
  for (const change of changes) {
    const env = fixture();
    const context = env.context();
    change(env);
    assert.equal(env.read().available, false);
    assert.equal(env.select(0, context).ok, false);
    env.assertNoWrites();
  }
});

test("CONTROL/TARJA aliases remain infrastructure even when text layers lack comments and fallback is disabled", () => {
  const env = fixture({ fallback: false });
  env.bannerSource.reorder(env.bannerSource.layers.concat(new TextLayer("CARTAO CONTROL"), new TextLayer("TARJA_ROSA")));
  assert.equal(env.read().optionGroup.options.length, 4);
  assert.equal(env.select(0).ok, true);
  assert.equal(env.bannerSource.layer(9).writes.length, 0);
  assert.equal(env.bannerSource.layer(10).writes.length, 0);
});

test("selection changes only eligible text visibility and keeps controls, artwork, foreign comments and parent unchanged", () => {
  const env = fixture();
  const protectedLayers = [env.control, env.background, env.image, env.foreign, env.bannerLayer, env.legalLayer, env.offer];
  const protectedStates = protectedLayers.map((layer) => layer.enabled);
  assert.equal(env.select(1).ok, true);
  assert.deepEqual([env.dynamicA, env.electro, env.tire, env.dynamicB].map((layer) => layer.enabled), [false, true, false, false]);
  assert.deepEqual(protectedLayers.map((layer) => layer.enabled), protectedStates);
  assert.equal(protectedLayers.every((layer) => layer.writes.length === 0), true);
  assert.deepEqual(env.undo, { opened: 1, closed: 1 });
});

test("native partial failure restores all eligible visibility and closes one undo group", () => {
  const env = fixture();
  const original = env.allLayers().map((layer) => layer.enabled);
  env.dynamicB.failOnce = true;
  const result = env.select(1);
  assert.equal(result.ok, false);
  assert.match(result.message, /Native visibility failure/);
  assert.deepEqual(env.allLayers().map((layer) => layer.enabled), original);
  assert.deepEqual(env.undo, { opened: 1, closed: 1 });
});

test("stale project, scope, identity, order, names, visibility and policy reject before undo or writes", () => {
  const changes = [
    (env) => { env.app.project.file.fsName = "C:/outro.aep"; },
    (env) => { env.miolo.id++; },
    (env) => { env.offer.id++; },
    (env) => { env.offer.comment = "CAMADA OFERTA 02"; },
    (env) => { env.offerSource.id++; },
    (env) => { env.legalLayer.id++; },
    (env) => { env.legalSource.id++; },
    (env) => { env.bannerLayer.id++; },
    (env) => { env.bannerSource.id++; },
    (env) => { env.electro.id++; },
    (env) => { env.dynamicA.name = "Novo rótulo"; },
    (env) => { env.dynamicA.comment = "CONTROL"; },
    (env) => { env.dynamicA.visibility = true; },
    (env) => { env.bannerLayer.visibility = false; },
    (env) => { env.bannerSource.reorder(env.bannerSource.layers.slice().reverse()); },
    (env) => { env.bannerSource.reorder(env.bannerSource.layers.filter((layer) => layer !== env.dynamicA)); },
    (env) => { env.bannerSource.reorder(env.bannerSource.layers.concat(new TextLayer("Novo texto"))); },
    (env) => { env.assets.map.fallback.offerLayers = false; },
  ];
  for (const change of changes) {
    const env = fixture();
    const context = env.context();
    change(env);
    assert.equal(env.select(0, context).ok, false, change.toString());
    assert.equal(env.toggle(false, context).ok, false, change.toString());
    env.assertNoWrites();
  }
});

test("old callers without context, invalid selections and unsupported stable IDs cannot mutate", () => {
  const env = fixture();
  for (const invalid of [-1, 4, 0.5, NaN, "1"]) assert.equal(env.select(invalid).ok, false);
  assert.equal(env.actions.updateOfferLegalControlOption(1, "tarja-eletro-pneu", 0).ok, false);
  assert.equal(env.actions.updateOfferLegalControl(1, "tarja-eletro-pneu", false).ok, false);
  const context = env.context();
  delete env.electro.id;
  assert.equal(env.read().available, false);
  assert.equal(env.select(0, context).ok, false);
  env.assertNoWrites();
});

test("parent checkbox uses scoped identity and context, preserving the selected inner option", () => {
  const env = fixture();
  const context = env.context();
  const inner = env.bannerSource.layers.map((layer) => layer.enabled);
  assert.equal(env.toggle(false, context).ok, true);
  assert.equal(env.bannerLayer.enabled, false);
  assert.deepEqual(env.bannerSource.layers.map((layer) => layer.enabled), inner);
  assert.equal(env.toggle(true, context).ok, false);
  assert.equal(env.toggle(true).ok, true);
  assert.deepEqual(env.undo, { opened: 2, closed: 2 });
});

test("locked layers are disabled without presenting the legacy always-visible flag and never open undo", () => {
  for (const target of ["offer", "bannerLayer", "dynamicA"]) {
    const env = fixture();
    env[target].locked = true;
    const control = env.read();
    assert.equal(control.locked, false);
    if (target === "bannerLayer" || target === "offer") assert.equal(control.available, false);
    if (target === "dynamicA") assert.equal(control.optionGroup.enabled, false);
    assert.equal(env.select(0).ok, false);
    env.assertNoWrites();
  }
});

test("duplicate display names remain distinct IDs; zero/multiple visible texts stay unselected without writes", () => {
  const env = fixture();
  env.dynamicA.name = env.dynamicB.name;
  const options = env.read().optionGroup.options;
  assert.equal(options[0].label, options[3].label);
  assert.notEqual(options[0].id, options[3].id);
  env.dynamicB.visibility = false;
  assert.equal(env.read().optionGroup.selectedIndex, -1);
  env.dynamicA.visibility = true;
  env.electro.visibility = true;
  assert.equal(env.read().optionGroup.selectedIndex, -1);
  env.assertNoWrites();
});

test("empty or expression-driven Source Text does not replace the requested layer name label or invalidate the menu", () => {
  const env = fixture();
  const context = env.context();
  env.dynamicA.text.sourceText.value.text = "";
  env.electro.text.sourceText.value.text = "Evaluated differently at another time";
  assert.equal(env.read().optionGroup.options[0].label, env.dynamicA.name);
  assert.equal(env.select(0, context).ok, true);
});

test("invalid identity assets disable the banner and block stale mutations before undo", () => {
  const env = fixture();
  const context = env.context();
  env.assets.map.banners.eletroPneu.layers.electro.comment = "PNEU";
  assert.equal(env.read().available, false);
  assert.equal(env.select(0, context).ok, false);
  env.assertNoWrites();
});
