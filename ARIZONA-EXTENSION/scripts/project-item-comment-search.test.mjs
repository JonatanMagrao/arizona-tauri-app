import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceUrl = new URL("../src/jsx/aeft/domains/project/findProjectItemsByComment.ts", import.meta.url);
const source = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
}).outputText;

class Item {
  constructor(name, comment = "") {
    this.name = name;
    this.comment = comment;
  }
}
class CompItem extends Item {}
class FootageItem extends Item {}
class FolderItem extends Item {
  constructor(name, comment, children = []) {
    super(name, comment);
    this.items = children;
  }
}

function harness(items = []) {
  const reads = [];
  const app = {
    project: {
      numItems: items.length,
      item(index) {
        reads.push(index);
        const item = items[index - 1];
        if (item instanceof Error) throw item;
        return item;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, app, CompItem, FootageItem, FolderItem });
  return { app, reads, search: (comment, itemType) => Array.from(module.exports.findProjectItemsByComment(comment, itemType)) };
}

test("global comment search returns every matching folder, composition and footage, including nested items once", () => {
  const comp = new CompItem("Nome livre", "  alvo\t");
  const footage = new FootageItem("Produto.png", "ALVO");
  const nested = new FolderItem("Pasta filha", "Alvo", [footage]);
  const folder = new FolderItem("Pasta principal", "ALVO", [comp, nested]);
  const duplicate = new CompItem("Outra composição", "ALVO");
  const h = harness([folder, comp, nested, footage, duplicate]);

  assert.deepEqual(h.search("\r\n AlVo  "), [folder, comp, nested, footage, duplicate]);
  assert.deepEqual(h.reads, [1, 2, 3, 4, 5]);
  assert.equal(comp.comment, "  alvo\t");
  assert.equal(folder.items[0], comp);
});

test("optional filters use native item classes and retain all matches of that type", () => {
  const comps = [new CompItem("A", "TAG"), new CompItem("B", "TAG")];
  const footage = new FootageItem("C", "TAG");
  const folder = new FolderItem("D", "TAG");
  const h = harness([comps[0], footage, folder, comps[1]]);

  assert.deepEqual(h.search("tag", "comp"), comps);
  assert.deepEqual(h.search("tag", "footage"), [footage]);
  assert.deepEqual(h.search("tag", "folder"), [folder]);
});

test("search is exact by Item.comment, without name fallback, substring matching or Layer.comment lookup", () => {
  const namedOnly = new CompItem("ALVO", "");
  const layerOnly = new CompItem("Composição", "OUTRO");
  layerOnly.layers = [{ name: "Camada", comment: "ALVO" }];
  const partial = new FootageItem("Arquivo", "ALVO EXTRA");
  const exact = new FolderItem("Pasta", "ALVO");
  const h = harness([namedOnly, layerOnly, partial, exact]);

  assert.deepEqual(h.search("ALVO"), [exact]);
  assert.deepEqual(h.search("inexistente"), []);
});

test("empty identity and absent project return no matches without enumerating items", () => {
  const h = harness([new CompItem("Sem comentário")]);
  assert.deepEqual(h.search(""), []);
  assert.deepEqual(h.search(" \t\r\n "), []);
  assert.deepEqual(h.reads, []);
  h.app.project = null;
  assert.deepEqual(h.search("ALVO"), []);
  assert.deepEqual(h.reads, []);
});

test("an unavailable item or unreadable comment does not hide later matching items", () => {
  const unreadable = new CompItem("Item indisponível");
  Object.defineProperty(unreadable, "comment", { get() { throw new Error("Unavailable native item"); } });
  const match = new FootageItem("Disponível", "ALVO");
  const h = harness([null, new Error("Cannot read item"), unreadable, match]);

  assert.deepEqual(h.search("ALVO"), [match]);
  assert.deepEqual(h.reads, [1, 2, 3, 4]);
});
