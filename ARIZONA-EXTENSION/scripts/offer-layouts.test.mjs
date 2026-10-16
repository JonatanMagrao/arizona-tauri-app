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
const COMMENTS = ["OFERTA REGUA 2 PRODUTOS", "OFERTA REGUA 2 PRODUTOS ELETRO", "OFERTA REGUA 3 PRODUTOS", "OFERTA SIMPLES"];
let nextItemId = 100;
let nextLayerId = 2000;

class Item {
  constructor(name, comment = "") {
    this.id = nextItemId++;
    this.name = name;
    this.comment = comment;
    this.parentFolder = null;
  }
}
class CompItem extends Item {
  constructor(name, comment = "", layers = []) {
    super(name, comment);
    this.layers = layers;
    this.time = 7.25;
    layers.forEach((layer) => { layer.containingComp = this; });
  }
  get numLayers() { return this.layers.length; }
  layer(index) { return this.layers[index - 1] || null; }
}
class FolderItem extends Item {
  constructor(name, comment = "", children = []) {
    super(name, comment);
    this.children = children;
    children.forEach((item) => { item.parentFolder = this; });
  }
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
    this.selected = true;
    this.startTime = 4.125;
    this.inPoint = 4.375;
    this.outPoint = 10.75;
    this.stretch = 75;
    this.label = 9;
    this.transform = { anchor: [50, 60], position: [200, 300], rotation: 12, opacity: 88 };
    this.scale = { value: [87, 93], numKeys: 2, expression: "value * 1.1", expressionEnabled: true,
      setValue() { throw new Error("Scale must not be written"); } };
    this.timeRemap = { keys: [[0, 0], [3, 4]], expression: "value", expressionEnabled: true };
    this.sourceWrites = [];
    this.nameWrites = [];
    this.autoName = false;
  }
  get name() { return this.storedName; }
  set name(value) {
    if (this.nameFailures) { this.nameFailures -= 1; throw new Error("Cannot restore name"); }
    this.nameWrites.push(value);
    this.storedName = value;
  }
  get index() { return this.containingComp.layers.indexOf(this) + 1; }
  replaceSource(source, fixExpressions) {
    const callIndex = this.sourceWrites.length;
    this.sourceWrites.push({ source, fixExpressions });
    if (this.failBeforeCall === callIndex) throw new Error("Native replacement failed before write");
    this.source = source;
    if (this.autoName) this.storedName = source.name;
    if (this.failAfterCall === callIndex) throw new Error("Native replacement failed after write");
  }
}

function harness(fallback = { offerLayers: false, mechanicLayers: false, projectItems: false }) {
  const identities = createTemplateIdentitiesHarness(fallback);
  const layouts = COMMENTS.map((comment, index) => new CompItem("Nome livre " + index, comment));
  const folder = new FolderItem("Nome livre da pasta", "OFERTA 01", layouts);
  const offer = new AVLayer("Oferta_01", "CAMADA OFERTA 01", layouts[0]);
  const other = new AVLayer("Outra camada", "DECORACAO", new CompItem("Fundo"));
  other.selected = false;
  const miolo = new CompItem("Miolo", "", [offer, other]);
  const items = [miolo, folder, ...layouts, other.source];
  const project = { file: { fsName: "C:/Projetos/Oferta.aep", name: "Oferta.aep" },
    get numItems() { return items.length; }, item(index) { return items[index - 1]; } };
  const app = { project, undoEvents: [], beginUndoGroup(name) { this.undoEvents.push(["begin", name]); }, endUndoGroup() { this.undoEvents.push(["end"]); } };
  const modules = new Map();
  function load(filename) {
    if (!path.isAbsolute(filename)) filename = path.join(domainDirectory, filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText);
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, app, AVLayer, CompItem, FolderItem, FootageItem, File: identities.File,
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
  const api = { ...load("offers/offerLayouts.ts"), ...load("actions/replaceOfferLayout.ts") };
  load("../template/templateIdentities.ts").configureTemplateIdentitiesPath("/template-identities.json");
  const h = { ...api, app, project, items, layouts, folder, offer, other, miolo, identities };
  h.request = (targetItemId = layouts[1].id) => ({ context: plain(h.getOfferLayoutOptions(offer.index).context), targetItemId });
  return h;
}

const state = (h) => plain({
  name: h.offer.name, comment: h.offer.comment, locked: h.offer.locked, enabled: h.offer.enabled,
  selected: h.offer.selected, startTime: h.offer.startTime, inPoint: h.offer.inPoint, outPoint: h.offer.outPoint,
  stretch: h.offer.stretch, label: h.offer.label, transform: h.offer.transform, scale: h.offer.scale,
  timeRemap: h.offer.timeRemap, playhead: h.miolo.time,
  other: { sourceId: h.other.source.id, selected: h.other.selected, comment: h.other.comment },
  folders: h.items.map((item) => [item.id, item.parentFolder?.id || 0, item.name, item.comment]),
});
const noWrites = (h) => {
  assert.deepEqual(h.offer.sourceWrites, []);
  assert.deepEqual(h.other.sourceWrites, []);
  assert.deepEqual(h.app.undoEvents, []);
};
const undoClosed = (h) => assert.deepEqual(h.app.undoEvents, [["begin", "Trocar régua da oferta"], ["end"]]);

function useOnlyNames(h) {
  h.offer.comment = "";
  h.offer.storedName = "Oferta_01";
  h.folder.comment = "";
  h.folder.name = "OFERTA 01";
  h.layouts.forEach((item, index) => {
    item.comment = "";
    item.name = h.identities.config.layouts[COMMENTS[index]].names[0];
  });
}

test("name-only layouts resolve aliases from the asset and replace only the source", () => {
  const h = harness({});
  useOnlyNames(h);
  h.identities.config.layouts[COMMENTS[1]].names.push("Régua alternativa validada");
  h.layouts[1].name = "Régua alternativa validada";
  h.offer.autoName = true;
  const before = state(h);
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, true, menu.errors.join("; "));
  assert.equal(menu.context.layerComment, "CAMADA OFERTA 01");
  assert.equal(menu.context.folderComment, "OFERTA 01");
  assert.ok(menu.options.every((option) => option.enabled));
  assert.equal(h.replaceOfferLayout({ context: plain(menu.context), targetItemId: h.layouts[1].id }).ok, true);
  assert.equal(h.offer.source, h.layouts[1]);
  assert.deepEqual(state(h), before);
  undoClosed(h);
});

test("each fallback flag controls its own scope and mechanicLayers does not disable layout discovery", () => {
  for (const flag of ["offerLayers", "projectItems", "mechanicLayers"]) {
    const h = harness({});
    useOnlyNames(h);
    h.identities.config.fallback[flag] = false;
    assert.equal(h.getOfferLayoutOptions(1).ok, flag === "mechanicLayers", flag);
    noWrites(h);
  }
});

test("offer name patterns are anchored and keep padded numbers separate from duplicate suffixes", () => {
  for (const name of ["Oferta_01 extra", "Cópia Oferta_01", "Oferta_01 2", "Oferta_00", "Oferta_001"]) {
    const h = harness({});
    useOnlyNames(h);
    h.offer.storedName = name;
    assert.equal(h.getOfferLayoutOptions(1).ok, false, name);
    noWrites(h);
  }
});

test("a unique comment beats duplicate names at every layout discovery scope", () => {
  const h = harness({});
  h.other.storedName = "Oferta_01";
  h.other.comment = "";
  const decoyFolder = new FolderItem("OFERTA 01", "");
  const decoyLayout = new CompItem(h.identities.config.layouts[COMMENTS[1]].names[0], "");
  decoyLayout.parentFolder = h.folder;
  h.folder.children.push(decoyLayout);
  h.items.push(decoyFolder, decoyLayout);
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, true);
  assert.equal(menu.context.folderItemId, h.folder.id);
  assert.equal(menu.options[1].itemId, h.layouts[1].id);
  noWrites(h);
});

test("recognized conflicting comments are never reinterpreted through offer, folder or layout names", () => {
  for (const scope of ["offer", "folder", "layout"]) {
    const h = harness({});
    useOnlyNames(h);
    if (scope === "offer") h.offer.comment = "MECANICA 1";
    if (scope === "folder") h.folder.comment = "OFERTA 02";
    if (scope === "layout") h.layouts[1].comment = COMMENTS[2];
    const menu = h.getOfferLayoutOptions(1);
    if (scope === "layout") assert.equal(menu.options[1].enabled, false);
    else assert.equal(menu.ok, false);
    noWrites(h);
  }
});

test("name-only selected offer cannot steal a slot owned by another layer comment", () => {
  const h = harness({});
  h.offer.comment = "";
  h.other.comment = "CAMADA OFERTA 01";
  assert.equal(h.getOfferLayoutOptions(1).ok, false);
  noWrites(h);
});

test("duplicate names fail closed separately for offers, folders and layout targets", () => {
  for (const scope of ["offer", "folder", "layout"]) {
    const h = harness({});
    useOnlyNames(h);
    const request = h.request();
    if (scope === "offer") { h.other.storedName = "Oferta_01"; h.other.comment = ""; }
    if (scope === "folder") h.items.push(new FolderItem("OFERTA 01"));
    if (scope === "layout") {
      const duplicate = new CompItem(h.layouts[1].name);
      duplicate.parentFolder = h.folder;
      h.folder.children.push(duplicate);
      h.items.push(duplicate);
    }
    const menu = h.getOfferLayoutOptions(1);
    if (scope === "layout") assert.equal(menu.options[1].enabled, false);
    else assert.equal(menu.ok, false);
    assert.equal(h.replaceOfferLayout(request).ok, false);
    noWrites(h);
  }
});

test("duplicate comments cannot be repaired by a unique matching name", () => {
  const h = harness({});
  const duplicate = new CompItem("Outra régua", COMMENTS[1]);
  duplicate.parentFolder = h.folder;
  h.layouts[1].name = h.identities.config.layouts[COMMENTS[1]].names[0];
  h.folder.children.push(duplicate);
  h.items.push(duplicate);
  assert.equal(h.getOfferLayoutOptions(1).options[1].enabled, false);
  noWrites(h);
});

test("one validated map is pinned per listing and configuration failures block mutation", () => {
  const h = harness({});
  useOnlyNames(h);
  h.identities.state.afterRead = () => { h.identities.state.malformed = true; };
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, true);
  assert.equal(h.identities.state.reads, 1);
  const result = h.replaceOfferLayout({ context: plain(menu.context), targetItemId: h.layouts[1].id });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("template-identities.json")));
  noWrites(h);
});

test("menu resolves the numbered layer comment and direct folder items, with four serializable options and no writes", () => {
  const h = harness();
  h.offer.comment = "  camada oferta 01\t";
  h.folder.comment = " oferta 01 ";
  h.layouts.forEach((item) => { item.comment = item.comment.toLowerCase() + " "; });
  const before = state(h);
  const menu = h.getOfferLayoutOptions(h.offer.index);
  assert.equal(menu.ok, true);
  assert.deepEqual(plain(menu.options.map(({ comment, label, current, enabled }) => ({ comment, label, current, enabled }))), COMMENTS.map((comment, index) => ({
    comment, label: ["2 produtos", "2 produtos eletro", "3 produtos", "Simples"][index], current: index === 0, enabled: true,
  })));
  assert.deepEqual(plain(menu.context), { projectKey: h.project.file.fsName, compItemId: h.miolo.id,
    offerLayerIndex: 1, offerLayerId: h.offer.id, layerComment: "CAMADA OFERTA 01", sourceItemId: h.layouts[0].id,
    folderItemId: h.folder.id, folderComment: "OFERTA 01" });
  assert.equal(JSON.stringify(menu).includes("replaceSource"), false);
  assert.deepEqual(state(h), before);
  noWrites(h);
});

test("offer number comes from its comment, independently of layer name and index", () => {
  for (const [slot, folderComment] of [[1, "OFERTA 01"], [2, "OFERTA 02"], [10, "OFERTA 10"], [100, "OFERTA 100"]]) {
    const h = harness();
    h.offer.storedName = "Nome sem número";
    h.offer.comment = "CAMADA OFERTA " + String(slot).padStart(2, "0");
    h.folder.comment = folderComment;
    h.miolo.layers.reverse();
    const menu = h.getOfferLayoutOptions(h.offer.index);
    assert.equal(menu.ok, true);
    assert.equal(menu.context.offerLayerIndex, 2);
    assert.equal(menu.context.folderComment, folderComment);
    noWrites(h);
  }
});

test("an unpadded folder comment is rejected and explains the exact comment to add in the Project panel", () => {
  const h = harness();
  h.folder.name = "OFERTA 01";
  h.folder.comment = "  oferta 1\t";
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, false);
  assert.equal(menu.context, null);
  assert.equal(menu.disabledSummary, 'Nenhuma pasta do projeto tem o comentário "OFERTA 01".');
  assert.equal(menu.disabledReason, 'No painel Projeto, adicione o comentário "OFERTA 01" à pasta desta oferta.');
  noWrites(h);

  h.folder.comment = "  oferta 01\t";
  const corrected = h.getOfferLayoutOptions(1);
  assert.equal(corrected.ok, true);
  assert.equal(corrected.context.folderComment, "OFERTA 01");
  assert.equal(corrected.disabledReason, undefined);
  const result = h.replaceOfferLayout({ context: plain(corrected.context), targetItemId: h.layouts[1].id });
  assert.equal(result.ok, true);
  assert.equal(h.offer.source, h.layouts[1]);
  undoClosed(h);
});

test("an unpadded comment on another folder is not an alias for the required padded identity", () => {
  const h = harness();
  h.items.push(new FolderItem("OFERTA 01", "OFERTA 1"));
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, true);
  assert.equal(menu.context.folderItemId, h.folder.id);
  assert.equal(menu.context.folderComment, "OFERTA 01");
  noWrites(h);
});

test("removing the required leading zero after opening the menu blocks replacement", () => {
  const h = harness();
  const request = h.request();
  h.folder.comment = "OFERTA 1";
  assert.equal(h.getOfferLayoutOptions(1).ok, false);
  assert.equal(h.replaceOfferLayout(request).ok, false);
  noWrites(h);
});

test("missing, nested and non-composition candidates cannot substitute direct comment matches", () => {
  const h = harness();
  const nested = new FolderItem("Subpasta", "", [h.layouts[1]]);
  nested.parentFolder = h.folder;
  const namedOnly = new CompItem(COMMENTS[1]);
  namedOnly.parentFolder = h.folder;
  const footage = new FootageItem("Mesmo comentário, outro tipo", COMMENTS[1]);
  footage.parentFolder = h.folder;
  h.folder.children.splice(1, 1, nested, namedOnly, footage);
  h.items.push(nested, namedOnly, footage);
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.ok, true);
  const option = menu.options[1];
  assert.equal(option.enabled, false);
  assert.equal(option.itemId, null);
  assert.ok(option.disabledReason.includes('"' + COMMENTS[1] + '"'));
  assert.ok(option.disabledReason.includes('"OFERTA 01"'));
  assert.match(option.disabledReason, /diretamente/);
  assert.ok(option.disabledSummary.includes('"' + COMMENTS[1] + '"'));
  assert.ok(option.disabledSummary.includes('pasta com o comentário "OFERTA 01"'));
  assert.match(option.disabledReason, /No painel Projeto/);
  assert.equal(h.replaceOfferLayout(h.request(h.layouts[1].id)).ok, false);
  noWrites(h);
});

test("duplicate layout comments disable only their option and never choose the first match", () => {
  const h = harness();
  const duplicate = new CompItem("Duplicata", " " + COMMENTS[0].toLowerCase());
  duplicate.parentFolder = h.folder;
  h.folder.children.push(duplicate);
  h.items.push(duplicate);
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.options[0].enabled, false);
  assert.equal(menu.options[0].current, true);
  assert.equal(menu.options[0].itemId, null);
  assert.match(menu.options[0].disabledSummary, /Mais de uma precomp diretamente/);
  assert.ok(menu.options[0].disabledSummary.includes('"' + COMMENTS[0] + '"'));
  assert.ok(menu.options[0].disabledSummary.includes('pasta com o comentário "OFERTA 01"'));
  assert.match(menu.options[0].disabledReason, /No painel Projeto/);
  assert.equal(menu.options.slice(1).every((option) => option.enabled), true);
  assert.equal(h.replaceOfferLayout(h.request(h.layouts[0].id)).ok, false);
  noWrites(h);
});

for (const invalidation of ["missing-layer-comment", "malformed-layer-comment", "duplicate-layer-comment", "missing-folder-comment", "duplicate-folder-comment", "duplicate-miolo"]) {
  test(`invalid identity prevents listing and mutation without name fallback (${invalidation})`, () => {
    const h = harness();
    const request = h.request();
    if (invalidation === "missing-layer-comment") { h.offer.comment = ""; h.offer.storedName = "CAMADA OFERTA 1"; }
    if (invalidation === "malformed-layer-comment") h.offer.comment = "CAMADA OFERTA 01 EXTRA";
    if (invalidation === "duplicate-layer-comment") h.other.comment = " camada oferta 01 ";
    if (invalidation === "missing-folder-comment") { h.folder.comment = ""; h.folder.name = "OFERTA 01"; }
    if (invalidation === "duplicate-folder-comment") h.items.push(new FolderItem("Outra", " oferta 01 "));
    if (invalidation === "duplicate-miolo") h.items.push(new CompItem("Miolo"));
    const menu = h.getOfferLayoutOptions(1);
    assert.equal(menu.ok, false);
    assert.equal(menu.context, null);
    assert.ok(menu.disabledReason);
    if (invalidation === "missing-folder-comment") {
      assert.equal(menu.disabledSummary, 'Nenhuma pasta do projeto tem o comentário "OFERTA 01".');
      assert.equal(menu.disabledReason, 'No painel Projeto, adicione o comentário "OFERTA 01" à pasta desta oferta.');
    }
    if (invalidation === "duplicate-folder-comment") {
      assert.equal(menu.disabledSummary, 'Mais de uma pasta do projeto tem o comentário "OFERTA 01".');
      assert.equal(menu.disabledReason, 'No painel Projeto, mantenha o comentário "OFERTA 01" apenas na pasta desta oferta.');
    }
    assert.equal(h.replaceOfferLayout(request).ok, false);
    noWrites(h);
  });
}

test("absent project, missing Miolo, invalid layer index and non-comp source fail without writes", () => {
  for (const invalidation of ["project", "miolo", "index", "source"]) {
    const h = harness();
    if (invalidation === "project") h.app.project = null;
    if (invalidation === "miolo") h.miolo.name = "Outra";
    if (invalidation === "source") h.offer.source = new FootageItem("Arquivo");
    assert.equal(h.getOfferLayoutOptions(invalidation === "index" ? 99 : 1).ok, false);
    noWrites(h);
  }
});

test("replacement changes only the selected layer source and restores automatic name changes in one undo group", () => {
  const h = harness();
  h.offer.autoName = true;
  const before = state(h);
  const result = h.replaceOfferLayout(h.request());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.selectedOfferLayerIndex, h.offer.index);
  assert.equal(h.offer.source, h.layouts[1]);
  assert.deepEqual(h.offer.sourceWrites, [{ source: h.layouts[1], fixExpressions: false }]);
  assert.deepEqual(h.other.sourceWrites, []);
  assert.deepEqual(state(h), before);
  assert.deepEqual(h.offer.nameWrites, ["Oferta_01"]);
  undoClosed(h);
});

test("same-source request is a no-op and locked layers are never unlocked", () => {
  const h = harness();
  assert.equal(h.replaceOfferLayout(h.request(h.layouts[0].id)).ok, true);
  noWrites(h);
  h.offer.locked = true;
  const result = h.replaceOfferLayout(h.request());
  assert.equal(result.ok, false);
  assert.match(result.message, /bloqueada/);
  assert.equal(h.offer.locked, true);
  noWrites(h);
});

test("every context field is checked before writes, including project, layer and source identities", () => {
  for (const field of ["projectKey", "compItemId", "offerLayerIndex", "offerLayerId", "layerComment", "sourceItemId", "folderItemId", "folderComment"]) {
    const h = harness();
    const request = h.request();
    request.context[field] = typeof request.context[field] === "number" ? request.context[field] + 100 : request.context[field] + " CHANGED";
    assert.equal(h.replaceOfferLayout(request).ok, false, field);
    noWrites(h);
  }
});

test("a replaced layer at the same index or a different current source makes the menu stale", () => {
  for (const invalidation of ["layer", "source", "project", "folder"]) {
    const h = harness();
    const request = h.request();
    if (invalidation === "layer") h.offer.id += 100;
    if (invalidation === "source") h.offer.source = h.layouts[2];
    if (invalidation === "project") h.project.file.fsName = "C:/Projetos/Outro.aep";
    if (invalidation === "folder") h.folder.id += 100;
    assert.equal(h.replaceOfferLayout(request).ok, false, invalidation);
    noWrites(h);
  }
});

test("target ownership and uniqueness are revalidated after opening the menu", () => {
  for (const invalidation of ["comment", "moved", "duplicate", "unknown-id", "wrong-type"]) {
    const h = harness();
    const request = h.request();
    if (invalidation === "comment") h.layouts[1].comment = "Outra identidade";
    if (invalidation === "moved") {
      h.folder.children.splice(1, 1);
      h.items.push(new FolderItem("Outra pasta", "OFERTA 02", [h.layouts[1]]));
    }
    if (invalidation === "duplicate") {
      const duplicate = new CompItem("Duplicata", COMMENTS[1]);
      duplicate.parentFolder = h.folder;
      h.folder.children.push(duplicate);
      h.items.push(duplicate);
    }
    if (invalidation === "unknown-id") request.targetItemId = 9876543;
    if (invalidation === "wrong-type") request.targetItemId = h.folder.id;
    assert.equal(h.replaceOfferLayout(request).ok, false, invalidation);
    noWrites(h);
  }
});

test("Miolo cannot be chosen as a source for its own layer", () => {
  const h = harness();
  h.layouts[1].comment = "Outra régua";
  h.miolo.comment = COMMENTS[1];
  h.miolo.parentFolder = h.folder;
  h.folder.children.push(h.miolo);
  const menu = h.getOfferLayoutOptions(1);
  assert.equal(menu.options[1].enabled, false);
  assert.equal(menu.options[1].itemId, null);
  assert.match(menu.options[1].disabledReason, /Miolo/);
  assert.equal(h.replaceOfferLayout(h.request(h.miolo.id)).ok, false);
  noWrites(h);
});

test("older hosts without Layer.id retain unique-comment and index validation", () => {
  const h = harness();
  Object.defineProperty(h.offer, "id", { get() { throw new Error("Layer.id unavailable"); } });
  const request = h.request();
  assert.equal(request.context.offerLayerId, 0);
  assert.equal(h.replaceOfferLayout(request).ok, true);
  assert.equal(h.offer.source, h.layouts[1]);
  undoClosed(h);
});

test("native failure before a write leaves the layer intact and closes the undo group", () => {
  const h = harness();
  const before = state(h);
  h.offer.failBeforeCall = 0;
  const result = h.replaceOfferLayout(h.request());
  assert.equal(result.ok, false);
  assert.equal(h.offer.source, h.layouts[0]);
  assert.equal(h.offer.sourceWrites.length, 1);
  assert.deepEqual(state(h), before);
  undoClosed(h);
});

test("native failure after a write rolls back the source and automatic layer name", () => {
  const h = harness();
  h.offer.autoName = true;
  const before = state(h);
  h.offer.failAfterCall = 0;
  const result = h.replaceOfferLayout(h.request());
  assert.equal(result.ok, false);
  assert.equal(h.offer.source, h.layouts[0]);
  assert.deepEqual(h.offer.sourceWrites.map(({ source, fixExpressions }) => [source.id, fixExpressions]), [[h.layouts[1].id, false], [h.layouts[0].id, false]]);
  assert.deepEqual(state(h), before);
  undoClosed(h);
});

test("failure to restore the name also rolls back the source", () => {
  const h = harness();
  h.offer.autoName = true;
  h.offer.nameFailures = 1;
  const before = state(h);
  assert.equal(h.replaceOfferLayout(h.request()).ok, false);
  assert.equal(h.offer.source, h.layouts[0]);
  assert.deepEqual(state(h), before);
  undoClosed(h);
});

test("rollback failure is reported while still restoring the name and closing undo", () => {
  const h = harness();
  h.offer.autoName = true;
  h.offer.failAfterCall = 0;
  h.offer.failBeforeCall = 1;
  const result = h.replaceOfferLayout(h.request());
  assert.equal(result.ok, false);
  assert.equal(h.offer.source, h.layouts[1]);
  assert.equal(h.offer.name, "Oferta_01");
  assert.ok(result.errors.some((error) => error.includes("Use Desfazer")));
  undoClosed(h);
});
