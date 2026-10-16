import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTemplateIdentitiesModule, validateTemplateIdentitiesFile } from "./validate-template-identities.mjs";

const approved = () => JSON.parse(readFileSync(new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"));
const parser = loadTemplateIdentitiesModule();
const parse = (value) => parser.parseTemplateIdentitiesJson(JSON.stringify(value));

test("distributed identity map has all seven mechanics, independently controlled fallbacks and observed aliases", () => {
  const config = validateTemplateIdentitiesFile();
  assert.equal(Object.keys(config.mechanics).length, 7);
  assert.deepEqual(config.fallback, { offerLayers: true, mechanicLayers: true, projectItems: true });
  assert.ok(config.projectItems.mechanicsFolder.names.includes("_MECANICAS"));
  assert.ok(config.mechanics["TODOS A COM X% DESCONTO"].layers["por-centagem-desconto"].includes("POR CENTAGEM DESCONTO"));
  assert.ok(config.offerLayers.legal.names.includes("TEXTO LEGAL_06"));
  const disabled = approved();
  disabled.fallback.offerLayers = false;
  disabled.fallback.mechanicLayers = false;
  disabled.fallback.projectItems = false;
  assert.deepEqual(JSON.parse(JSON.stringify(parse(disabled).fallback)), disabled.fallback);
});

test("strict validation rejects missing roles, unknown fields, string flags, collisions and illegal placeholders", () => {
  const cases = [
    (config) => { delete config.mechanics.SIMPLES.layers.preco; },
    (config) => { config.mechanics.SIMPLES.layers.unused = ["Unused"]; },
    (config) => { config.fallback.offerLayers = "true"; },
    (config) => { config.fallback.unused = true; },
    (config) => { config.version = 2; },
    (config) => { config.mechanics.SIMPLES.layers.controlador = ["PRECO"]; },
    (config) => { config.offerLayers.product.names = ["DESCRITIVO {n}"]; },
    (config) => { config.layouts["OFERTA SIMPLES"].names = ["OFERTA REGUA 2 PRODUTOS"]; },
    (config) => { config.projectItems.offerFolder.names = ["OFERTA {slot}"]; },
    (config) => { config.mechanics.SIMPLES.names = ["SIMPLES"]; },
    (config) => { config.mechanics["TODOS A COM X% DESCONTO"].names = ["SIMPLES 317"]; },
    (config) => { config.mechanics["TODOS A COM X% DESCONTO"].sourceNames = ["SIMPLES"]; },
    (config) => { config.mechanics.SIMPLES.sourceNames = ["SIMPLES 2"]; },
    (config) => { config.offerLayers.product.names = ["PRODUTO 1{n}"]; },
    (config) => { config.offerLayers.legal.names = []; },
    (config) => { config.offerLayers.legal.names = ["TEXTO LEGAL", "texto legal"]; },
    (config) => { delete config.banners; },
    (config) => { delete config.banners.eletroPneu.layers.control; },
    (config) => { config.banners.eletroPneu.layers.electro.comment = "PNEU"; },
    (config) => { config.banners.eletroPneu.layers.electro.names = ["CARTAO CONTROL"]; },
    (config) => { config.banners.eletroPneu.layers.electro.names = ["TARJA"]; },
    (config) => { config.banners.eletroPneu.sourceNames = []; },
    (config) => { config.banners.eletroPneu.layerNames = ["TARJA {n}"]; },
  ];
  for (const change of cases) {
    const config = approved();
    change(config);
    assert.throws(() => parse(config), /invalido/);
  }
});

test("strict JSON and UTF-8 behavior also applies to the identity asset", () => {
  const json = JSON.stringify(approved());
  assert.throws(() => parser.parseTemplateIdentitiesJson(json.replace('"version":1', '"version":1,"versi\\u006fn":1')), /duplicada/);
  assert.throws(() => parser.parseTemplateIdentitiesJson(json.slice(0, -1) + ",}"), /JSON/);
  assert.throws(() => parser.parseTemplateIdentitiesJson("\ufeff\ufeff" + json), /JSON/);
  assert.throws(() => parser.decodeTemplateIdentitiesUtf8(String.fromCharCode(0xc0, 0xaf)), /UTF-8/);
  assert.equal(parser.parseTemplateIdentitiesJson("\ufeff" + json).version, 1);
});

test("explicit slot patterns preserve zero padding and cannot confuse Simples product slots", () => {
  assert.equal(parser.expandTemplatePattern("Oferta_{nn}", 1), "Oferta_01");
  assert.equal(parser.expandTemplatePattern("Oferta_{nn}", 100), "Oferta_100");
  assert.equal(parser.matchTemplatePattern(" oferta_01 ", "Oferta_{nn}"), 1);
  assert.equal(parser.matchTemplatePattern("Oferta_1", "Oferta_{nn}"), null);
  assert.equal(parser.matchTemplatePattern("CAMADA OFERTA 01", "CAMADA OFERTA {n}"), null);
  assert.equal(parser.matchTemplatePattern("SIMPLES 2", "SIMPLES {n}"), 2);
  assert.equal(parser.matchTemplatePattern("SIMPLES 2 3", "SIMPLES {n}"), null);
  assert.equal(parser.matchTemplatePattern("SIMPLES 0", "SIMPLES {n}"), null);
  assert.throws(() => parser.expandTemplatePattern("Oferta_{nn}", 0), /positivo/);
});

function runtime() {
  const state = { config: approved(), reads: 0, exists: true, raw: null, readError: "", truncate: false,
    closes: 0, paths: [], closeResult: true };
  class File {
    constructor(path) { state.paths.push(path); this.error = ""; }
    get bytes() { return Buffer.from(state.raw ?? JSON.stringify(state.config), "utf8").toString("latin1"); }
    get length() { return this.bytes.length; }
    get exists() { return state.exists; }
    open(mode) { assert.equal(mode, "r"); return true; }
    seek(offset) { assert.equal(offset, 0); return true; }
    read() { assert.equal(this.encoding, "BINARY"); state.reads += 1; this.error = state.readError; return state.truncate ? this.bytes.slice(0, -1) : this.bytes; }
    close() { state.closes += 1; return state.closeResult; }
  }
  const api = loadTemplateIdentitiesModule({ File });
  api.configureTemplateIdentitiesPath("C:/CEP/template-identities.json");
  return { state, api };
}

test("nested operation pins one snapshot and observes edited flags next operation", () => {
  const { api, state } = runtime();
  api.withTemplateIdentities(() => {
    assert.equal(api.getTemplateIdentities().fallback.offerLayers, true);
    state.config.fallback.offerLayers = false;
    api.withTemplateIdentities(() => assert.equal(api.getTemplateIdentities().fallback.offerLayers, true));
    assert.equal(state.reads, 1);
    assert.throws(() => api.configureTemplateIdentitiesPath("C:/other.json"), /durante/);
  });
  assert.equal(api.getTemplateIdentities().fallback.offerLayers, false);
  assert.equal(state.reads, 2);
  assert.equal(state.closes, 2);
});

test("failed configuration remains pinned and never falls back to stale data or compiled defaults", () => {
  const { api, state } = runtime();
  api.withTemplateIdentities(() => assert.equal(api.getTemplateIdentities().version, 1));
  state.raw = "{";
  api.withTemplateIdentities(() => {
    assert.throws(() => api.getTemplateIdentities(), /invalido/);
    state.raw = null;
    assert.throws(() => api.getTemplateIdentities(), /invalido/);
  });
  assert.equal(state.reads, 2);
  assert.equal(api.getTemplateIdentities().version, 1);
  state.exists = false;
  assert.throws(() => api.getTemplateIdentities(), /nao encontrado/);
  api.configureTemplateIdentitiesPath("");
  assert.throws(() => api.getTemplateIdentities(), /nao configurado/);
  assert.throws(() => api.configureTemplateIdentitiesPath("relative.json"), /absoluto/);
});

test("read errors and partial reads fail before a map can be used", () => {
  const { api, state } = runtime();
  state.readError = "Read failed";
  assert.throws(() => api.getTemplateIdentities(), /Read failed/);
  assert.equal(state.closes, 1);
  state.readError = "";
  state.truncate = true;
  assert.throws(() => api.getTemplateIdentities(), /Leitura incompleta/);
});

test("unchanged identity bytes reuse the validated object but still read each operation", () => {
  const { api, state } = runtime();
  api.withTemplateIdentities(() => 42);
  assert.equal(state.reads, 0, "the cache does not make lazy scopes eager");
  const first = api.withTemplateIdentities(() => api.getTemplateIdentities());
  for (let index = 0; index < 4; index += 1) {
    assert.equal(api.withTemplateIdentities(() => api.getTemplateIdentities()), first);
  }
  assert.equal(api.getTemplateIdentities(), first);
  assert.equal(state.reads, 6);
  assert.equal(state.closes, 6);
});

test("same-size identity edits and formatting-only changes invalidate the cache", () => {
  const { api, state } = runtime();
  const first = api.getTemplateIdentities();
  const size = Buffer.byteLength(JSON.stringify(state.config));
  state.config.named.offersComp = "MIOLO";
  assert.equal(Buffer.byteLength(JSON.stringify(state.config)), size);
  const second = api.withTemplateIdentities(() => api.getTemplateIdentities());
  assert.notEqual(second, first);
  assert.equal(second.named.offersComp, "MIOLO");
  state.raw = " " + JSON.stringify(state.config);
  const third = api.getTemplateIdentities();
  assert.notEqual(third, second);
  assert.deepEqual(JSON.parse(JSON.stringify(third)), JSON.parse(JSON.stringify(second)));
  assert.equal(api.getTemplateIdentities(), third);
});

test("all identity path reconfigurations invalidate the cache, including empty or rejected paths", () => {
  const { api, state } = runtime();
  const previous = api.getTemplateIdentities();
  api.configureTemplateIdentitiesPath("C:/other/template-identities.json");
  assert.notEqual(api.getTemplateIdentities(), previous);
  assert.equal(state.paths.at(-1), "C:/other/template-identities.json");
  for (const next of ["C:/CEP/template-identities.json", "", "relative.json", null]) {
    const current = api.getTemplateIdentities();
    if (next === null || next === "relative.json") {
      assert.throws(() => api.configureTemplateIdentitiesPath(next));
    } else api.configureTemplateIdentitiesPath(next);
    if (next !== "C:/CEP/template-identities.json") assert.throws(() => api.getTemplateIdentities(), /nao configurado/);
    api.configureTemplateIdentitiesPath("C:/CEP/template-identities.json");
    assert.notEqual(api.getTemplateIdentities(), current);
  }
});

for (const issue of ["exists", "truncate", "closeResult", "readError", "malformed", "invalid map"]) {
  test(`${issue}: identity cache is discarded on failure and recovers only after a new valid read`, () => {
    const { api, state } = runtime();
    const previous = api.getTemplateIdentities();
    if (issue === "malformed") state.raw = "{";
    else if (issue === "invalid map") state.raw = '{"version":1}';
    else if (issue === "readError") state.readError = "Native read failure";
    else state[issue] = issue === "truncate";
    api.withTemplateIdentities(() => {
      assert.throws(() => api.getTemplateIdentities());
      Object.assign(state, { raw: null, exists: true, truncate: false, closeResult: true, readError: "" });
      assert.throws(() => api.withTemplateIdentities(() => api.getTemplateIdentities()),
        "repairing the file cannot unpin an operation failure");
    });
    const recovered = api.getTemplateIdentities();
    assert.notEqual(recovered, previous);
    assert.equal(recovered.version, 1);
    assert.equal(api.getTemplateIdentities(), recovered);
    assert.equal(state.reads, issue === "exists" ? 3 : 4);
  });
}
