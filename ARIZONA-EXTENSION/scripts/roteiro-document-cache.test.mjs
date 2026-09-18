import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/js/main/domains/roteiro/services/roteiroDocumentCache.ts", import.meta.url),
  "utf8"
);
const javaScript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture() {
  const documents = new Map();
  const reads = [];
  const stats = [];
  let afterRead = null;
  const normalize = (filePath) => path.win32.resolve("C:\\roteiros", filePath);
  const getDocument = (filePath) => {
    const document = documents.get(normalize(filePath));
    if (!document) throw new Error("ENOENT");
    return document;
  };
  const node = {
    path: { resolve: normalize },
    fs: {
      statSync(filePath) {
        stats.push(filePath);
        const document = getDocument(filePath);
        if (document.statError) throw document.statError;
        return {
          size: document.size,
          mtimeMs: document.mtimeMs,
          ctimeMs: document.ctimeMs,
          isFile: () => true,
        };
      },
    },
  };
  const mocks = {
    "../../../../lib/cep/node": node,
    "../utils/docxReader": {
      readDocxText(filePath) {
        reads.push(filePath);
        const document = getDocument(filePath);
        if (document.readError) throw document.readError;
        const content = document.content;
        if (afterRead) afterRead(document);
        return content;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(javaScript, {
    module,
    exports: module.exports,
    require: (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
      return mocks[specifier];
    },
  });
  return {
    createCache: module.exports.createRoteiroDocumentCache,
    node,
    documents,
    reads,
    stats,
    normalize,
    add(filePath = "roteiro.docx", overrides = {}) {
      const document = { content: "BANANA 1,99", size: 1000, mtimeMs: 10, ctimeMs: 20, ...overrides };
      documents.set(normalize(filePath), document);
      return document;
    },
    onRead(callback) {
      afterRead = callback;
    },
  };
}

function assertRead(cache, filePath, content, cacheHit, forceRead) {
  const result = cache.read(filePath, forceRead);
  assert.equal(result.content, content);
  assert.equal(result.cacheHit, cacheHit);
}

test("unchanged DOCX reuses text after checking metadata and normalized path", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  assertRead(cache, ".\\roteiro.docx", document.content, false);
  assertRead(cache, "C:\\roteiros\\roteiro.docx", document.content, true);
  assert.equal(env.reads.length, 1);
  assert.equal(env.stats.length, 3);
});

for (const field of ["size", "mtimeMs", "ctimeMs"]) {
  test(`changed ${field} reloads the document before reusing it`, () => {
    const env = fixture();
    const document = env.add();
    const cache = env.createCache();
    cache.read("roteiro.docx");
    document[field] += 1;
    document.content = "BANANA 2,99";
    assertRead(cache, "roteiro.docx", document.content, false);
    assertRead(cache, "roteiro.docx", document.content, true);
    assert.equal(env.reads.length, 2);
  });
}

test("explicit refresh reads the file even when metadata has not changed", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  document.content = "OVO 8,59";
  assertRead(cache, "roteiro.docx", document.content, false, true);
  assertRead(cache, "roteiro.docx", document.content, true);
  assert.equal(env.reads.length, 2);
});

test("changing the document path replaces the only cached entry", () => {
  const env = fixture();
  env.add("a.docx", { content: "A" });
  env.add("b.docx", { content: "B" });
  const cache = env.createCache();
  assertRead(cache, "a.docx", "A", false);
  assertRead(cache, "b.docx", "B", false);
  assertRead(cache, "a.docx", "A", false);
  assertRead(cache, "a.docx", "A", true);
  assert.equal(env.reads.length, 3);
});

test("missing document clears the entry even if the original metadata later returns", () => {
  const env = fixture();
  const original = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  env.documents.delete(env.normalize("roteiro.docx"));
  assert.throws(() => cache.read("roteiro.docx"), /ENOENT/);
  env.add("roteiro.docx", { ...original, content: "RESTAURADO" });
  assertRead(cache, "roteiro.docx", "RESTAURADO", false);
});

test("unreadable metadata clears the entry without returning old text", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  document.statError = new Error("EACCES");
  assert.throws(() => cache.read("roteiro.docx"), /EACCES/);
  delete document.statError;
  document.content = "RECUPERADO";
  assertRead(cache, "roteiro.docx", document.content, false);
});

test("read failure during forced refresh invalidates previously cached text", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  document.readError = new Error("DOCX invalido");
  assert.throws(() => cache.read("roteiro.docx", true), /DOCX invalido/);
  delete document.readError;
  document.content = "REPARADO";
  assertRead(cache, "roteiro.docx", document.content, false);
});

test("a document changed during reading is not cached", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  env.onRead((current) => { current.mtimeMs += 1; });
  assertRead(cache, "roteiro.docx", document.content, false);
  env.onRead(null);
  document.content = "ALTERADO DURANTE A LEITURA";
  assertRead(cache, "roteiro.docx", document.content, false);
  assertRead(cache, "roteiro.docx", document.content, true);
  assert.equal(env.reads.length, 2);
});

test("an error checking metadata after reading does not keep an entry", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  env.onRead((current) => { current.statError = new Error("EIO"); });
  assert.throws(() => cache.read("roteiro.docx", true), /EIO/);
  delete document.statError;
  env.onRead(null);
  assertRead(cache, "roteiro.docx", document.content, false);
});

test("separate instances isolate projects and clear forces a fresh read", () => {
  const env = fixture();
  const document = env.add();
  const first = env.createCache();
  const second = env.createCache();
  assertRead(first, "roteiro.docx", document.content, false);
  assertRead(second, "roteiro.docx", document.content, false);
  first.clear();
  assertRead(second, "roteiro.docx", document.content, true);
  assertRead(first, "roteiro.docx", document.content, false);
  assert.equal(env.reads.length, 3);
});

test("oversized text is returned without retaining it or the previous entry", () => {
  const env = fixture();
  env.add("small.docx");
  const large = env.add("large.docx", { content: "a".repeat(2_000_001) });
  const cache = env.createCache();
  cache.read("small.docx");
  assertRead(cache, "large.docx", large.content, false);
  assertRead(cache, "large.docx", large.content, false);
  assertRead(cache, "small.docx", "BANANA 1,99", false);
  assert.equal(env.reads.length, 4);
});

test("empty text and text at the limit can be cached", () => {
  const env = fixture();
  env.add("empty.docx", { content: "" });
  const atLimit = env.add("limit.docx", { content: "a".repeat(2_000_000) });
  const cache = env.createCache();
  assertRead(cache, "empty.docx", "", false);
  assertRead(cache, "empty.docx", "", true);
  assertRead(cache, "limit.docx", atLimit.content, false);
  assertRead(cache, "limit.docx", atLimit.content, true);
  assert.equal(env.reads.length, 2);
});

test("missing or invalid metadata falls back to reading without caching", () => {
  for (const field of ["size", "mtimeMs", "ctimeMs"]) {
    for (const value of [undefined, null, NaN, Infinity, -1, "10"]) {
      const env = fixture();
      const document = env.add("roteiro.docx", { [field]: value });
      const cache = env.createCache();
      assertRead(cache, "roteiro.docx", document.content, false);
      assertRead(cache, "roteiro.docx", document.content, false);
      assert.equal(env.reads.length, 2, `${field}: ${value}`);
    }
  }
});

test("browser fallback reports unavailable file access and clears the cache", () => {
  const env = fixture();
  const document = env.add();
  const cache = env.createCache();
  cache.read("roteiro.docx");
  const statSync = env.node.fs.statSync;
  delete env.node.fs.statSync;
  assert.throws(() => cache.read("roteiro.docx"), /indisponivel fora do After Effects/);
  env.node.fs.statSync = statSync;
  assertRead(cache, "roteiro.docx", document.content, false);
});
