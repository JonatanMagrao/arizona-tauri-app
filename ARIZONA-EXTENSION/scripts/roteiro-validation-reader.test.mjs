import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isAllTakePayMechanicType } from "../src/shared/allTakePayMechanic.js";

const [readerSource, editorSource, discoverySource] = await Promise.all([
  readFile(new URL("../src/jsx/aeft/domains/ofertas/snapshot/firstOfferProductForValidation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/jsx/aeft/domains/ofertas/snapshot/buildOfferSnapshot.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/jsx/aeft/domains/ofertas/snapshot/offerDiscovery.ts", import.meta.url), "utf8"),
]);
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const readerJavaScript = transpile(readerSource);
const editorJavaScript = transpile(editorSource);
const discoveryJavaScript = transpile(discoverySource);
const serialize = (value) => JSON.parse(JSON.stringify(value));

function load(javaScript, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(javaScript, {
    module,
    exports: module.exports,
    require: (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
      return mocks[specifier];
    },
  });
  return module.exports;
}

function fixture() {
  const calls = { mechanics: [], legal: 0, description: 0, images: 0 };
  const offers = [];
  const resetCalls = () => {
    calls.mechanics.length = 0;
    calls.legal = 0;
    calls.description = 0;
    calls.images = 0;
  };
  const mocks = {
    "../mechanics/schemaRuntime": {
      withMechanicsSchema: (callback) => callback(),
    },
    "../layers/findLayers": {
      getLayerSource: (layer) => layer.source || null,
      getLayerByIndex: (source, index) => source?.unavailableIndices?.includes(index)
        ? null
        : source?.layers[index - 1] || null,
      nameMatches: (name, pattern) => String(name).match(pattern) !== null,
      readProductImageInfo: () => { calls.images += 1; return { filePath: "product.png" }; },
      getOffersComp: () => ({}),
      getOfferLayers: () => offers,
    },
    "../layers/offerStructure": {
      // Association is covered with native AE mocks and the production resolver
      // in offer-structure.test.mjs. This suite isolates the lightweight reader.
      resolveOfferProductLayers: (source, errors, unresolvedSlots = []) => {
        const result = [];
        if (source === null) return result;
        for (let slot = 1; slot <= 3; slot += 1) {
          const matching = (comment) => source.layers.filter((item) => item.comment === comment &&
            !source.unavailableIndices?.includes(item.index));
          const descriptions = matching(`DESCRITIVO ${slot}`);
          const mechanics = matching(`MECANICA ${slot}`);
          const images = matching(`PRODUTO ${slot}`);
          if (descriptions.length !== 1) {
            if (descriptions.length || mechanics.length || images.length) unresolvedSlots.push(slot);
            continue;
          }
          if (!descriptions[0].enabled) continue;
          result.push({ slot, descriptionLayer: descriptions[0], mechanicLayer: mechanics[0] || null,
            imageLayer: images[0] || null, valid: mechanics.length === 1 && images.length === 1 });
        }
        return result;
      },
    },
    "../layers/textFields": {
      getNestedTextProperty: (layer) => {
        calls.description += 1;
        return layer.descriptionMissing ? null : { value: "DESCRIPTION" };
      },
      readText: (property) => { calls.description += 1; return property?.value || ""; },
      hasPropertyExpression: () => { calls.description += 1; return false; },
      isPropertyExpressionEnabled: () => { calls.description += 1; return false; },
      readLegalText: () => { calls.legal += 1; return "LEGAL"; },
    },
    "../layers/legalControls": {
      getLegalTextSource: () => { calls.legal += 1; return {}; },
      getLegalTextProperty: () => { calls.legal += 1; return {}; },
      readLegalControls: () => { calls.legal += 1; return []; },
    },
    "../mechanics/registry": {
      readMechanic: (layer) => {
        calls.mechanics.push(layer.name);
        if (layer.mechanicError) throw layer.mechanicError;
        return serialize(layer.mechanic || {
          type: "Mecanica nao mapeada",
          fields: [],
          optionGroups: [],
          unsupported: true,
        });
      },
    },
  };
  const reader = load(readerJavaScript, mocks).getFirstOfferProductForValidation;
  const editor = load(editorJavaScript, mocks).generateOfferData;
  const discovery = load(discoveryJavaScript, {
    "../../../../../shared/allTakePayMechanic": { isAllTakePayMechanicType },
    "../layers/findLayers": mocks["../layers/findLayers"],
    "../mechanics/schemaRuntime": mocks["../mechanics/schemaRuntime"],
    "./firstOfferProductForValidation": { getFirstOfferProductForValidation: reader },
  }).getOffersFirstProductInfo;
  const offer = (layers) => {
    layers.forEach((layer, index) => { layer.index = index + 1; });
    const usedSlots = new Set();
    for (const item of layers) {
      if (!/^DESCRITIVO(?:\s+\d+)?$/.test(item.name)) continue;
      const explicit = item.name.match(/\s+(\d+)$/);
      const slot = explicit ? Number(explicit[1]) : [1, 2, 3].find((candidate) => !usedSlots.has(candidate));
      usedSlots.add(slot);
      item.comment = `DESCRITIVO ${slot}`;
      if (layers[item.index]) layers[item.index].comment = `MECANICA ${slot}`;
      if (layers[item.index + 1]) layers[item.index + 1].comment = `PRODUTO ${slot}`;
    }
    const result = {
      index: offers.length + 1,
      name: `Oferta_${offers.length + 1}`,
      source: { layers, numLayers: layers.length, layer: (index) => layers[index - 1] },
    };
    offers.push(result);
    return result;
  };
  return { reader, editor, discovery, offer, calls, resetCalls };
}

const layer = (name, overrides = {}) => ({ name, enabled: true, ...overrides });
const description = (overrides = {}) => layer("DESCRITIVO", overrides);
const mechanic = (price = "1,99", overrides = {}) => layer(`SIMPLES ${price}`, {
  mechanic: {
    type: "Simples",
    fields: [{ id: "preco", label: "Preco", value: price, format: "price", enabled: true }],
    optionGroups: [],
  },
  ...overrides,
});
const image = () => layer("IMAGEM");

function assertFirstProductParity(env, offer, expectedProductCount) {
  env.resetCalls();
  const full = env.editor(offer);
  assert.equal(full.products.length, expectedProductCount);
  const expected = full.products.length > 0
    ? { index: full.products[0].index, mechanic: full.products[0].mechanic }
    : null;
  env.resetCalls();
  const actual = env.reader(offer);
  assert.deepEqual(serialize(actual), serialize(expected));
  assert.equal(env.calls.mechanics.length,
    expectedProductCount > 0 && full.products[0].associationValid !== false ? 1 : 0);
  assert.equal(env.calls.legal, 0);
  assert.equal(env.calls.description, 0);
  assert.equal(env.calls.images, 0);
  return actual;
}

test("reads the same first product as the editor while skipping all other products and assets", () => {
  const env = fixture();
  const offer = env.offer([
    layer("TEXTO LEGAL"),
    description(), mechanic("1,99"), image(),
    description({ name: "DESCRITIVO 2" }), mechanic("2,99"), image(),
    description({ name: "DESCRITIVO 3" }), mechanic("3,99"), image(),
  ]);
  env.editor(offer);
  assert.equal(env.calls.mechanics.length, 3);
  assert.ok(env.calls.legal > 0);
  assert.ok(env.calls.description > 0);
  assert.equal(env.calls.images, 3);
  assertFirstProductParity(env, offer, 3);
});

test("ignores disabled descriptions and follows the editor's numbered slot order", () => {
  const env = fixture();
  const offer = env.offer([
    description({ enabled: false }), mechanic("0,99"), image(),
    layer("OUTRA LAYER"),
    description({ name: "DESCRITIVO 3" }), mechanic("3,99"), image(),
    description({ name: "DESCRITIVO 2" }), mechanic("2,99"), image(),
  ]);
  const first = assertFirstProductParity(env, offer, 2);
  assert.equal(first.index, 1);
  assert.equal(first.mechanic.fields[0].value, "2,99");
});

test("missing description text does not hide a product accepted by the editor", () => {
  const env = fixture();
  assertFirstProductParity(env, env.offer([
    description({ descriptionMissing: true }), mechanic(), image(),
  ]), 1);
});

test("preserves unsupported and disabled mechanic layers instead of selecting another product", () => {
  const env = fixture();
  const first = assertFirstProductParity(env, env.offer([
    description(), layer("UNKNOWN", { enabled: false }), image(),
    description(), mechanic(), image(),
  ]), 2);
  assert.equal(first.mechanic.unsupported, true);
});

test("missing first mechanic does not redirect validation to another slot", () => {
  const env = fixture();
  const offer = env.offer([
    description(), mechanic("1,99"), image(),
    description(), mechanic("2,99"), image(),
  ]);
  // Simulate a temporarily unavailable identified mechanic.
  offer.source.unavailableIndices = [2];
  const first = assertFirstProductParity(env, offer, 2);
  assert.equal(first.index, 0);
  assert.equal(first.mechanic.unsupported, true);
  assert.deepEqual(serialize(first.mechanic.fields), []);
});

test("returns null for no active product or no offer source and preserves a partial active slot", () => {
  const env = fixture();
  assertFirstProductParity(env, env.offer([layer("OTHER")]), 0);
  assertFirstProductParity(env, env.offer([description({ enabled: false }), mechanic()]), 0);
  const partial = assertFirstProductParity(env, env.offer([description()]), 1);
  assert.equal(partial.index, 0);
  assert.equal(partial.mechanic.unsupported, true);
  assertFirstProductParity(env, { index: 1, name: "Oferta_1", source: null }, 0);
});

test("validation reads fresh mechanic values on every request and keeps field identity", () => {
  const env = fixture();
  const valueLayer = mechanic("1,99");
  env.offer([description(), valueLayer, image(), description(), mechanic("4,99"), image()]);
  const [before] = env.discovery();
  assert.equal(before.priceValue, "1,99");
  valueLayer.mechanic.fields[0].value = "2,59";
  env.resetCalls();
  const [after] = env.discovery();
  assert.equal(after.priceValue, "2,59");
  assert.deepEqual(serialize(after.priceField), { fieldId: "preco", fieldIndex: 0, value: "2,59" });
  assert.equal(after.productIndex, 0);
  assert.equal(after.offerLayerIndex, 1);
  assert.equal(env.calls.mechanics.length, 1);
  assert.equal(env.calls.legal + env.calls.description + env.calls.images, 0);
});

test("a failed first mechanic preserves the validation's existing empty defaults", () => {
  const env = fixture();
  env.offer([
    description(), mechanic("1,99", { mechanicError: new Error("unavailable") }), image(),
    description(), mechanic("2,99"), image(),
  ]);
  const [result] = env.discovery();
  assert.equal(result.offerLayerIndex, 1);
  assert.equal(result.priceValue, "");
  assert.equal(result.mechanicType, "");
  assert.equal(env.calls.mechanics.length, 1);
});
