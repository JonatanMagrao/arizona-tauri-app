import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTemplateIdentitiesHarness } from "./template-identities-test-harness.mjs";

const domainDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const compiled = new Map();
const plain = (value) => JSON.parse(JSON.stringify(value));
let nextId = 100;
class CompItem {
  constructor(name, layers = []) {
    this.id = nextId++;
    this.name = name;
    this.layers = layers;
    this.time = 0;
    this.frameDuration = 1 / 30;
    this.duration = 60;
    this.opens = 0;
    layers.forEach((layer) => { layer.containingComp = this; });
  }
  get numLayers() { return this.layers.length; }
  get selectedLayers() { return this.layers.filter((layer) => layer.selected); }
  layer(index) { return this.layers[index - 1] || null; }
  openInViewer() { this.opens += 1; return { setActive() {} }; }
}
class AVLayer {
  constructor(name, comment = "", source = new CompItem("Régua")) {
    this.id = nextId++;
    this.name = name;
    this.comment = comment;
    this.source = source;
    this.startTime = 3;
    this.label = 1;
    this.selected = false;
    this.enabled = true;
    this.writes = [];
    this.scale = { value: [100, 100], setValue(value) { this.value = value; } };
  }
  get index() { return this.containingComp.layers.indexOf(this) + 1; }
  replaceSource(source, fixExpressions) {
    this.writes.push({ source, fixExpressions });
    this.source = source;
    this.name = source.name;
  }
}

function harness(fallback = {}) {
  const identities = createTemplateIdentitiesHarness(fallback);
  const first = new AVLayer("Oferta_01");
  const second = new AVLayer("Oferta_2");
  second.startTime = 10;
  second.label = 8;
  const decoration = new AVLayer("Texto Oferta_01 adicional");
  const comp = new CompItem("Miolo", [first, second, decoration]);
  const app = { project: { activeItem: comp, numItems: 1, item: () => comp },
    undoEvents: [], beginUndoGroup(name) { this.undoEvents.push(["begin", name]); }, endUndoGroup() { this.undoEvents.push(["end"]); } };
  const modules = new Map();
  function load(filename) {
    if (!path.isAbsolute(filename)) filename = path.join(domainDirectory, filename);
    if (filename === path.join(domainDirectory, "actions/shared.ts")) {
      return { createActionResult: () => ({ ok: false, message: "", selectedOfferLayerIndex: 0, errors: [] }) };
    }
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText);
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, app, AVLayer, CompItem, File: identities.File,
      require(specifier) {
        assert.ok(specifier.startsWith("."));
        const base = path.resolve(path.dirname(filename), specifier);
        const target = [base, base + ".ts"].find(existsSync);
        assert.ok(target, specifier);
        return load(target);
      },
    }, { filename });
    return module.exports;
  }
  const api = { ...load("layers/findLayers.ts"), ...load("actions/navigation.ts"), ...load("actions/swapOfferSources.ts") };
  load("../template/templateIdentities.ts").configureTemplateIdentitiesPath("/template-identities.json");
  return { ...api, app, identities, first, second, decoration, comp };
}
const actionResult = () => ({ ok: false, message: "", selectedOfferLayerIndex: 0, errors: [] });
const noWrites = (h) => {
  assert.deepEqual(h.app.undoEvents, []);
  assert.deepEqual(h.first.writes, []);
  assert.deepEqual(h.second.writes, []);
};

test("offer discovery uses exact padded and unpadded mapped names in reverse timeline order", () => {
  const h = harness();
  const offers = h.getOfferLayers(h.comp);
  assert.deepEqual(Array.from(offers), [h.second, h.first]);
  assert.equal(h.getOfferByLayerIndex(2, actionResult()), h.second);
  assert.equal(h.getOfferByLayerIndex(3, actionResult()), null);
  assert.deepEqual(plain(h.createOfferSummaries(offers)).map(({ layerIndex, label, markerIndex, startTime }) => ({ layerIndex, label, markerIndex, startTime })), [
    { layerIndex: 2, label: 8, markerIndex: 3, startTime: 10 },
    { layerIndex: 1, label: 1, markerIndex: 1, startTime: 3 },
  ]);
  noWrites(h);
});

test("discovery accepts a configured custom alias and comments on arbitrarily renamed layers", () => {
  const h = harness();
  h.identities.config.offerLayers.offer.names = ["INSERCAO-{nn}"];
  h.first.name = "INSERCAO-01";
  h.second.name = "Nome livre do cliente";
  h.second.comment = "CAMADA OFERTA 02";
  const offers = h.getOfferLayers(h.comp);
  assert.deepEqual(Array.from(offers), [h.second, h.first]);
  assert.equal(h.resolveSelectedOffer(h.comp, offers, 1), h.first);
  assert.equal(h.getOfferByLayerIndex(2, actionResult()), h.second);
  noWrites(h);
});

test("disabling offerLayers requires comments without affecting comment-based navigation", () => {
  const h = harness({ offerLayers: false });
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp)), []);
  assert.equal(h.selectOfferForEditor(1).ok, false);
  noWrites(h);
  h.first.comment = "CAMADA OFERTA 01";
  h.first.name = "Renomeada";
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp)), [h.first]);
  assert.equal(h.selectOfferForEditor(1).ok, true);
  assert.equal(h.first.selected, true);
  assert.equal(h.comp.time, 4);
  assert.deepEqual(h.app.undoEvents, [["begin", "Selecionar oferta"], ["end"]]);
});

test("global comment priority excludes name decoys for the same offer slot", () => {
  const h = harness();
  h.first.comment = "CAMADA OFERTA 01";
  h.first.name = "Primária renomeada";
  h.decoration.name = "Oferta_1";
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp)), [h.second, h.first]);
  assert.equal(h.getOfferByLayerIndex(3, actionResult()), null);
  assert.equal(h.selectOfferForEditor(3).ok, false);
  noWrites(h);
});

test("duplicated offer comments never fall back to a unique matching name", () => {
  const h = harness();
  h.first.comment = "CAMADA OFERTA 01";
  h.decoration.comment = "CAMADA OFERTA 01";
  const errors = [];
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp, errors)), [h.second]);
  assert.match(errors[0], /CAMADA OFERTA 01/);
  assert.equal(h.getOfferByLayerIndex(1, actionResult()), null);
  assert.equal(h.swapOfferSources(1, 2).ok, false);
  noWrites(h);
});

test("duplicate name aliases for the same numeric slot fail closed for discovery and navigation", () => {
  const h = harness();
  h.decoration.name = "Oferta_1";
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp)), [h.second]);
  assert.equal(h.selectOfferForEditor(1).ok, false);
  assert.equal(h.openOfferPrecompForEditor(3).ok, false);
  noWrites(h);
});

test("recognized foreign comments and unreadable comments cannot be reassigned through offer names", () => {
  for (const comment of ["MECANICA 1", "DESCRITIVO 2", "CAMADA OFERTA 02", "unreadable"]) {
    const h = harness();
    if (comment === "unreadable") Object.defineProperty(h.first, "comment", { get() { throw new Error("unavailable"); } });
    else h.first.comment = comment;
    const offers = Array.from(h.getOfferLayers(h.comp));
    if (comment === "CAMADA OFERTA 02") {
      assert.deepEqual(offers, [h.first]);
      assert.equal(h.getOfferByLayerIndex(2, actionResult()), null);
    } else assert.deepEqual(offers, [h.second]);
    noWrites(h);
  }
});

test("selected offer resolution revalidates requested and selected layers against current identities", () => {
  const h = harness();
  const oldOffers = h.getOfferLayers(h.comp);
  h.first.selected = true;
  assert.equal(h.resolveSelectedOffer(h.comp, oldOffers), h.first);
  h.decoration.name = "Oferta_1";
  assert.equal(h.resolveSelectedOffer(h.comp, oldOffers, 1), h.second);
  h.second.name = "Não é oferta";
  assert.equal(h.resolveSelectedOffer(h.comp, oldOffers, 1), null);
  noWrites(h);
});

test("opening an offer precomp supports a renamed commented layer and preserves marker navigation", () => {
  const h = harness({ offerLayers: false });
  h.second.name = "Cliente renomeou";
  h.second.comment = "CAMADA OFERTA 02";
  const result = h.openOfferPrecompForEditor(2);
  assert.equal(result.ok, true);
  assert.equal(result.selectedOfferLayerIndex, 2);
  assert.equal(h.second.source.opens, 1);
  assert.equal(h.comp.time, 11);
  assert.equal(h.second.selected, true);
  assert.deepEqual(h.app.undoEvents, [["begin", "Abrir precomp da oferta"], ["end"]]);
});

test("offer source swapping accepts mixed identities and keeps slot names, comments, indices and one undo", () => {
  const h = harness();
  h.second.name = "Oferta do cliente";
  h.second.comment = "CAMADA OFERTA 02";
  const before = [h.first, h.second].map(({ id, index, name, comment, startTime, label, source }) => ({ id, index, name, comment, startTime, label, source }));
  const result = h.swapOfferSources(1, 2);
  assert.equal(result.ok, true);
  assert.equal(h.first.source, before[1].source);
  assert.equal(h.second.source, before[0].source);
  assert.deepEqual([h.first, h.second].map(({ id, index, name, comment, startTime, label }) => ({ id, index, name, comment, startTime, label })), before.map(({ source, ...entry }) => entry));
  assert.equal(h.second.selected, true);
  assert.equal(h.comp.time, 11);
  assert.ok([...h.first.writes, ...h.second.writes].every(({ fixExpressions }) => fixExpressions === false));
  assert.deepEqual(h.app.undoEvents, [["begin", "Trocar conteudo das ofertas"], ["end"]]);
  assert.equal(h.identities.state.reads, 1);
});

test("missing map prevents discovery, navigation and swaps without beginning undo", () => {
  const h = harness();
  h.identities.state.missing = true;
  assert.deepEqual(Array.from(h.getOfferLayers(h.comp)), []);
  assert.equal(h.selectOfferForEditor(1).ok, false);
  assert.equal(h.openOfferPrecompForEditor(1).ok, false);
  assert.equal(h.swapOfferSources(1, 2).ok, false);
  noWrites(h);
});
