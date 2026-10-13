import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const domainDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/", import.meta.url));
const schema = JSON.parse(readFileSync(new URL("../src/js/assets/schema.json", import.meta.url), "utf8"));
const FAMILIES = Object.keys(schema).filter((key) => key !== "version" && key !== "SIMPLES");
const plain = (value) => JSON.parse(JSON.stringify(value));
const compiled = new Map();
let nextItemId = 100;
let nextLayerId = 1000;

class Item {
  constructor(name, comment = "") { this.id = nextItemId++; this.name = name; this.comment = comment; this.parentFolder = null; }
}
class CompItem extends Item {
  constructor(name, comment = "", layers = []) { super(name, comment); this.layers = layers; this.time = 8.5; layers.forEach((layer) => { layer.containingComp = this; }); }
  get numLayers() { return this.layers.length; }
  layer(index) { return this.layers[index - 1] || null; }
}
class FolderItem extends Item {
  constructor(name, comment = "", children = []) { super(name, comment); this.children = children; children.forEach((item) => { item.parentFolder = this; }); }
  get numItems() { return this.children.length; }
  item(index) { return this.children[index - 1] || null; }
}
class FootageItem extends Item {}
class AVLayer {
  constructor(name, comment, source) {
    this.id = nextLayerId++;
    this.storedName = name;
    this.comment = comment;
    this.source = source;
    this.locked = false;
    this.enabled = true;
    this.selected = false;
    this.startTime = 2.5;
    this.inPoint = 3.25;
    this.outPoint = 12.75;
    this.stretch = 85;
    this.transform = { position: [25, 50], anchor: [10, 15], opacity: 90, rotation: 35 };
    this.scale = { value: [125, 150], numKeys: 2, expression: "value + 1", expressionEnabled: true,
      setValue() { throw new Error("Scale must not be written"); } };
    this.timeRemap = { keys: [[0, 0], [3, 4]], expression: "value", expressionEnabled: true };
    this.sourceWrites = [];
    this.nameWrites = [];
  }
  get index() { return this.containingComp.layers.indexOf(this) + 1; }
  get name() { return this.storedName; }
  set name(value) {
    if (this.nameFailures) { this.nameFailures -= 1; throw new Error("Cannot restore name"); }
    this.nameWrites.push(value);
    this.storedName = value;
  }
  replaceSource(source, fixExpressions) {
    const callIndex = this.sourceWrites.length;
    this.sourceWrites.push({ source, fixExpressions });
    if (this.failBeforeCall === callIndex) throw new Error("Native replacement failed before write");
    this.source = source;
    if (this.autoName) this.storedName = source.name;
    if (this.failAfterCall === callIndex) throw new Error("Native replacement failed after write");
  }
}

function harness() {
  const simples = [1, 2, 3].map((slot) => new CompItem("Simples livre " + slot, "SIMPLES " + slot));
  const families = FAMILIES.map((comment, index) => new CompItem("Família livre " + index, comment));
  const deep = new FolderItem("Subpasta profunda", "", families.slice(3));
  const subgroup = new FolderItem("Grupo livre", "", [simples[1], simples[2], deep]);
  const mechanicsFolder = new FolderItem("Nome livre", "MECANICAS", [simples[0], ...families.slice(0, 3), subgroup]);
  const mechanicLayers = simples.map((source, index) => new AVLayer("Layer livre " + (index + 1), "MECANICA " + (index + 1), source));
  mechanicLayers[1].selected = true;
  const layout = new CompItem("Régua atual", "OFERTA REGUA 3 PRODUTOS", mechanicLayers);
  const offerFolder = new FolderItem("Pasta livre", "OFERTA 01", [layout, mechanicsFolder]);
  const offer = new AVLayer("Oferta_01", "CAMADA OFERTA 1", layout);
  const miolo = new CompItem("Miolo", "", [offer]);
  const items = [miolo, offerFolder, layout, mechanicsFolder, subgroup, deep, ...simples, ...families];
  const project = { file: { fsName: "C:/Projetos/Oferta.aep", name: "Oferta.aep" }, get numItems() { return items.length; }, item(index) { return items[index - 1]; } };
  const app = { project, undoEvents: [], beginUndoGroup(name) { this.undoEvents.push(["begin", name]); }, endUndoGroup() { this.undoEvents.push(["end"]); } };
  const modules = new Map();
  function load(filename) {
    if (!path.isAbsolute(filename)) filename = path.join(domainDirectory, filename);
    assert.equal(/schemaRuntime|buildOfferSnapshot|legalControls/.test(filename), false, "Discovery and replacement must not invoke mechanic readers or snapshot side effects");
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText);
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, app, AVLayer, CompItem, FolderItem, FootageItem,
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
  const api = { ...load("offers/offerMechanics.ts"), ...load("actions/replaceOfferMechanic.ts") };
  const h = { ...api, app, items, offer, layout, miolo, offerFolder, mechanicsFolder, subgroup, deep, simples, families, mechanicLayers };
  h.request = (productIndex = 1, targetItemId = families[0].id) => ({ context: plain(h.getOfferMechanicOptions(offer.index, productIndex).context), targetItemId });
  return h;
}

const state = (h) => plain({
  layers: [h.offer, ...h.mechanicLayers].map((layer) => ({ name: layer.name, comment: layer.comment, locked: layer.locked,
    enabled: layer.enabled, selected: layer.selected, startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint,
    stretch: layer.stretch, transform: layer.transform, scale: layer.scale, timeRemap: layer.timeRemap })),
  playheads: [h.miolo.time, h.layout.time],
  folders: h.items.map((item) => [item.id, item.name, item.comment, item.parentFolder?.id || 0]),
});
const noWrites = (h) => {
  [h.offer, ...h.mechanicLayers].forEach((layer) => assert.deepEqual(layer.sourceWrites, []));
  assert.deepEqual(h.app.undoEvents, []);
};
const undoClosed = (h) => assert.deepEqual(h.app.undoEvents, [["begin", "Trocar mecânica do produto"], ["end"]]);
const optionFor = (menu, comment) => menu.options.find((option) => option.comment === comment);

test("recursive read-only catalog covers exactly the seven schema families and numbers Simples per product", () => {
  const h = harness();
  h.mechanicsFolder.comment = "  mecanicas\t";
  h.simples[1].comment = " simples 2 ";
  const before = state(h);
  for (const productIndex of [0, 1, 2]) {
    const menu = h.getOfferMechanicOptions(1, productIndex);
    assert.equal(menu.ok, true);
    assert.equal(menu.options.length, 7);
    assert.deepEqual(plain(menu.options.map(({ comment }) => comment.replace(/^SIMPLES \d+$/, "SIMPLES")).sort()), Object.keys(schema).filter((key) => key !== "version").sort());
    assert.ok(menu.options.every((option) => option.enabled));
    assert.equal(optionFor(menu, "SIMPLES " + (productIndex + 1)).itemId, h.simples[productIndex].id);
    assert.equal(menu.options.filter((option) => option.current).length, 1);
    assert.equal(menu.context.productIndex, productIndex);
    assert.equal(menu.context.mechanicLayerComment, "MECANICA " + (productIndex + 1));
    assert.equal(menu.context.mechanicsFolderItemId, h.mechanicsFolder.id);
    assert.equal(menu.context.offer.folderComment, "OFERTA 01");
  }
  assert.deepEqual(state(h), before);
  noWrites(h);
});

test("only the matching numbered Simples comment is eligible, with no name or other-product fallback", () => {
  const h = harness();
  h.simples[1].comment = "SIMPLES";
  h.simples[1].name = "SIMPLES 2";
  const menu = h.getOfferMechanicOptions(1, 1);
  const option = optionFor(menu, "SIMPLES 2");
  assert.equal(option.enabled, false);
  assert.equal(option.itemId, null);
  assert.match(option.disabledSummary, /não foi encontrada.*"OFERTA 01"/);
  assert.match(option.disabledReason, /"SIMPLES 2".*"MECANICAS".*subpastas/);
  assert.equal(h.replaceOfferMechanic(h.request(1, h.simples[0].id)).ok, false);
  assert.equal(h.replaceOfferMechanic(h.request(1, h.simples[1].id)).ok, false);
  noWrites(h);
});

test("matching comments outside this offer's mechanics subtree are ignored", () => {
  const h = harness();
  const outside = new CompItem("Outra oferta", FAMILIES[0]);
  const otherMechanics = new FolderItem("Mecânicas externas", "MECANICAS", [outside]);
  const otherOffer = new FolderItem("Outra oferta", "OFERTA 02", [otherMechanics]);
  const directDecoy = new CompItem("Direto na oferta", FAMILIES[0]);
  directDecoy.parentFolder = h.offerFolder;
  h.offerFolder.children.push(directDecoy);
  h.items.push(outside, otherMechanics, otherOffer, directDecoy);
  const menu = h.getOfferMechanicOptions(1, 1);
  assert.equal(optionFor(menu, FAMILIES[0]).itemId, h.families[0].id);
  assert.equal(h.replaceOfferMechanic(h.request(1, outside.id)).ok, false);
  assert.equal(h.replaceOfferMechanic(h.request(1, directDecoy.id)).ok, false);
  noWrites(h);
});

for (const invalidation of ["missing-layer", "duplicate-layer", "invalid-layer-source", "missing-folder", "nested-folder", "duplicate-folder"]) {
  test(`invalid mechanic identity returns precise layer or folder guidance (${invalidation})`, () => {
    const h = harness();
    const request = h.request();
    if (invalidation === "missing-layer") { h.mechanicLayers[1].comment = ""; h.mechanicLayers[1].storedName = "MECANICA 2"; }
    if (invalidation === "duplicate-layer") h.mechanicLayers[2].comment = " mecanica 2 ";
    if (invalidation === "invalid-layer-source") h.mechanicLayers[1].source = new FootageItem("Imagem");
    if (invalidation === "missing-folder") { h.mechanicsFolder.comment = ""; h.mechanicsFolder.name = "MECANICAS"; }
    if (invalidation === "nested-folder") {
      const wrapper = new FolderItem("Grupo", "", [h.mechanicsFolder]);
      wrapper.parentFolder = h.offerFolder;
      h.offerFolder.children.splice(1, 1, wrapper);
      h.items.push(wrapper);
    }
    if (invalidation === "duplicate-folder") {
      const duplicate = new FolderItem("Duplicada", " mecanicas ");
      duplicate.parentFolder = h.offerFolder;
      h.offerFolder.children.push(duplicate);
      h.items.push(duplicate);
    }
    const menu = h.getOfferMechanicOptions(1, 1);
    assert.equal(menu.ok, false);
    assert.equal(menu.context, null);
    if (invalidation === "missing-layer" || invalidation === "duplicate-layer") {
      assert.match(menu.disabledReason, /"MECANICA 2"/);
      assert.ok(menu.disabledReason.includes('régua "' + h.layout.name + '"'));
    } else if (invalidation.includes("folder")) {
      assert.match(menu.disabledReason, /"MECANICAS".*diretamente.*"OFERTA 01"/);
    }
    assert.equal(h.replaceOfferMechanic(request).ok, false);
    noWrites(h);
  });
}

test("duplicate matching comments across subfolders disable only the affected mechanic", () => {
  const h = harness();
  const duplicate = new CompItem("Duplicata profunda", FAMILIES[0].toLowerCase());
  duplicate.parentFolder = h.deep;
  h.deep.children.push(duplicate);
  h.items.push(duplicate);
  const menu = h.getOfferMechanicOptions(1, 1);
  assert.equal(menu.ok, true);
  const option = optionFor(menu, FAMILIES[0]);
  assert.equal(option.enabled, false);
  assert.equal(option.itemId, null);
  assert.match(option.disabledSummary, /mais de uma precomp.*"OFERTA 01"/);
  assert.ok(option.disabledReason.includes('"' + FAMILIES[0] + '"'));
  assert.match(option.disabledReason, /"MECANICAS".*subpastas/);
  assert.equal(menu.options.filter((entry) => entry.enabled).length, 6);
  assert.equal(h.replaceOfferMechanic(h.request()).ok, false);
  noWrites(h);
});

test("source-only replacement preserves names, comments, timing, animation, folders and other products", () => {
  const h = harness();
  h.mechanicLayers[1].autoName = true;
  const before = state(h);
  const result = h.replaceOfferMechanic(h.request());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.selectedOfferLayerIndex, 1);
  assert.equal(h.mechanicLayers[1].source, h.families[0]);
  assert.deepEqual(h.mechanicLayers[1].sourceWrites, [{ source: h.families[0], fixExpressions: false }]);
  assert.equal(h.mechanicLayers[0].source, h.simples[0]);
  assert.equal(h.mechanicLayers[2].source, h.simples[2]);
  assert.equal(h.offer.source, h.layout);
  assert.deepEqual(h.mechanicLayers[0].sourceWrites, []);
  assert.deepEqual(h.mechanicLayers[2].sourceWrites, []);
  assert.deepEqual(h.offer.sourceWrites, []);
  assert.deepEqual(state(h), before);
  undoClosed(h);
});

test("shared unnumbered family sources remain selectable for different products without creating copies", () => {
  const h = harness();
  const count = h.items.length;
  assert.equal(h.replaceOfferMechanic(h.request(0)).ok, true);
  assert.equal(h.replaceOfferMechanic(h.request(1)).ok, true);
  assert.equal(h.mechanicLayers[0].source, h.families[0]);
  assert.equal(h.mechanicLayers[1].source, h.families[0]);
  assert.equal(h.items.length, count);
});

test("same-source is a no-op and locked mechanic layers are never unlocked", () => {
  const h = harness();
  assert.equal(h.replaceOfferMechanic(h.request(1, h.simples[1].id)).ok, true);
  noWrites(h);
  h.mechanicLayers[1].locked = true;
  const result = h.replaceOfferMechanic(h.request());
  assert.equal(result.ok, false);
  assert.match(result.message, /bloqueada/);
  assert.equal(h.mechanicLayers[1].locked, true);
  noWrites(h);
});

test("all mechanic and nested offer context fields are checked before mutation", () => {
  for (const field of ["productIndex", "mechanicLayerIndex", "mechanicLayerId", "mechanicLayerComment", "mechanicSourceItemId", "mechanicsFolderItemId"]) {
    const h = harness();
    const request = h.request();
    request.context[field] = typeof request.context[field] === "number" ? request.context[field] + 100 : request.context[field] + " changed";
    assert.equal(h.replaceOfferMechanic(request).ok, false, field);
    noWrites(h);
  }
  for (const field of ["projectKey", "compItemId", "offerLayerIndex", "offerLayerId", "layerComment", "sourceItemId", "folderItemId", "folderComment"]) {
    const h = harness();
    const request = h.request();
    request.context.offer[field] = typeof request.context.offer[field] === "number" ? request.context.offer[field] + 100 : request.context.offer[field] + " changed";
    assert.equal(h.replaceOfferMechanic(request).ok, false, field);
    noWrites(h);
  }
});

test("layer reorder, replacement, source change and mechanics folder replacement invalidate stale menus", () => {
  for (const mutation of ["reorder", "layer", "source", "folder"]) {
    const h = harness();
    const request = h.request();
    if (mutation === "reorder") h.layout.layers.unshift(h.layout.layers.pop());
    if (mutation === "layer") h.mechanicLayers[1].id += 100;
    if (mutation === "source") h.mechanicLayers[1].source = h.families[1];
    if (mutation === "folder") h.mechanicsFolder.id += 100;
    assert.equal(h.replaceOfferMechanic(request).ok, false, mutation);
    noWrites(h);
  }
});

test("moving or retagging a target after menu creation removes its authority", () => {
  for (const mutation of ["move", "comment"]) {
    const h = harness();
    const request = h.request();
    if (mutation === "comment") h.families[0].comment = "Outra família";
    else {
      h.mechanicsFolder.children.splice(h.mechanicsFolder.children.indexOf(h.families[0]), 1);
      h.offerFolder.children.push(h.families[0]);
      h.families[0].parentFolder = h.offerFolder;
    }
    assert.equal(h.replaceOfferMechanic(request).ok, false);
    noWrites(h);
  }
});

test("direct and recursive references to the current layout or Miolo cannot be selected", () => {
  for (const destination of ["layout", "miolo", "recursive"]) {
    const h = harness();
    const target = h.families[0];
    if (destination === "recursive") {
      const bridge = new CompItem("Ponte", "", [new AVLayer("Referência", "", h.layout)]);
      target.layers.push(new AVLayer("Precomp interna", "", bridge));
    } else {
      target.comment = "Sem identidade";
      const forbidden = destination === "layout" ? h.layout : h.miolo;
      forbidden.comment = FAMILIES[0];
      forbidden.parentFolder = h.mechanicsFolder;
      h.mechanicsFolder.children.push(forbidden);
    }
    const menu = h.getOfferMechanicOptions(1, 1);
    assert.equal(menu.ok, true);
    const option = optionFor(menu, FAMILIES[0]);
    assert.equal(option.enabled, false);
    assert.equal(option.itemId, null);
    assert.match(option.disabledSummary, /própria oferta ou o Miolo/);
    noWrites(h);
  }
});

test("missing request context, invalid product indexes and missing native Layer.id are handled", () => {
  const h = harness();
  for (const request of [null, {}, { context: {} }, { context: { offer: null } }]) assert.equal(h.replaceOfferMechanic(request).ok, false);
  for (const productIndex of [-1, 0.5, NaN]) assert.equal(h.getOfferMechanicOptions(1, productIndex).ok, false);
  noWrites(h);
  Object.defineProperty(h.mechanicLayers[1], "id", { get() { throw new Error("Layer.id unavailable"); } });
  const request = h.request();
  assert.equal(request.context.mechanicLayerId, 0);
  assert.equal(h.replaceOfferMechanic(request).ok, true);
  undoClosed(h);
});

for (const failure of ["before", "after", "name", "rollback"]) {
  test(`native replacement failure is contained and undo is closed (${failure})`, () => {
    const h = harness();
    const layer = h.mechanicLayers[1];
    layer.autoName = true;
    const before = state(h);
    if (failure === "before") layer.failBeforeCall = 0;
    if (failure === "after" || failure === "rollback") layer.failAfterCall = 0;
    if (failure === "name") layer.nameFailures = 1;
    if (failure === "rollback") layer.failBeforeCall = 1;
    const result = h.replaceOfferMechanic(h.request());
    assert.equal(result.ok, false);
    assert.equal(layer.source, failure === "rollback" ? h.families[0] : h.simples[1]);
    assert.equal(layer.name, "Layer livre 2");
    assert.ok(layer.sourceWrites.every(({ fixExpressions }) => fixExpressions === false));
    if (failure === "rollback") assert.ok(result.errors.some((error) => error.includes("Use Desfazer")));
    assert.deepEqual(state(h), before);
    undoClosed(h);
  });
}
