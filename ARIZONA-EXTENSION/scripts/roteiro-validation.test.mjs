import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const [segmentsSource, discoverySource] = await Promise.all([
  readFile(
    new URL("../src/js/main/domains/roteiro/utils/textSegments.ts", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../src/jsx/aeft/domains/ofertas/snapshot/offerDiscovery.ts", import.meta.url),
    "utf8"
  ),
]);
const transpile = (source, module) =>
  ts.transpileModule(source, {
    compilerOptions: { module, target: ts.ScriptTarget.ES2020 },
  }).outputText;
const { buildLineSegments } = await import(
  "data:text/javascript;base64," +
    Buffer.from(transpile(segmentsSource, ts.ModuleKind.ESNext)).toString("base64")
);
const discoveryJavaScript = transpile(discoverySource, ts.ModuleKind.CommonJS);

const COMBINED_TYPE = "De X Por Y | X% Desconto | Leve X Pague Y";
const field = (id, label, value, format = "price") => ({
  id, label, value, format, enabled: true,
});
// Field order, labels and formats match the mechanic readers' DTOs.
const combinedFields = (de, por) => [
  field("preco-de", "Preco De", de),
  field("preco-por", "Preco Por", por),
  field("quantidade-x", "Quantidade X", "1", "integer"),
  field("desconto", "Desconto", "20", "percent"),
];
const simpleFields = (price) => [field("preco", "Preco", price)];

function validationSnapshot(mechanicType, fields) {
  const offerLayer = { index: 7 };
  const comp = { name: "Miolo" };
  const module = { exports: {} };
  const mocks = {
    "../layers/findLayers": {
      getOffersComp: () => comp,
      getOfferLayers: (actualComp) => {
        assert.equal(actualComp, comp);
        return [offerLayer];
      },
    },
    "./firstOfferProductForValidation": {
      getFirstOfferProductForValidation: (actualLayer) => {
        assert.equal(actualLayer, offerLayer);
        return { index: 0, mechanic: { type: mechanicType, fields } };
      },
    },
  };
  vm.runInNewContext(discoveryJavaScript, {
    module,
    exports: module.exports,
    require: (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
      return mocks[specifier];
    },
  });
  // The CEP bridge serializes the host snapshot before the panel consumes it.
  const entries = JSON.parse(JSON.stringify(module.exports.getOffersFirstProductInfo()));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].offerLayerIndex, offerLayer.index);
  assert.equal(entries[0].mechanicType, mechanicType);
  return entries[0];
}

function validatedSegments(line, info) {
  const segments = buildLineSegments(line, info);
  assert.equal(segments.map((segment) => segment.text).join(""), line);
  return segments.filter((segment) => segment.match);
}

for (const [offer, line, de, por] of [
  ["01", "BANANA-NANICA 1,99 O QUILO NO MEU CARREFOUR", "2,99", "1,99"],
  ["02", "OVO BRANCO COM 20 UNIDADES 8,59 NO MEU CARREFOUR - 1", "10,99", "8,59"],
  ["05", "QUEIJO MUSSARELA IMPORTADO PEÇA 31,90 O QUILO EM NOSSOS CARTÕES - 1", "39,90", "31,90"],
]) {
  test(`screenshot offer ${offer} validates the combined mechanic against Preco Por`, () => {
    const info = validationSnapshot(COMBINED_TYPE, combinedFields(de, por));
    assert.equal(info.priceValue, por);
    assert.equal(info.deValue, de);
    assert.equal(info.porValue, por);
    assert.deepEqual(info.priceField, { fieldId: "preco-por", fieldIndex: 1, value: por });
    assert.deepEqual(info.porField, info.priceField);
    assert.deepEqual(info.deField, { fieldId: "preco-de", fieldIndex: 0, value: de });
    const segments = validatedSegments(line, info);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, por);
    assert.equal(segments[0].match, "correct");

    const [wrong] = validatedSegments(line.replace(por, de), info);
    assert.equal(wrong.match, "wrong");
    assert.equal(wrong.fieldKey, "price");
    assert.equal(wrong.action, "fix");
    assert.equal(wrong.value, de);
  });
}

test("combined mechanic does not accept Preco De when Preco Por is absent or empty", () => {
  for (const fields of [
    combinedFields("2,99", "").filter((entry) => entry.label !== "Preco Por"),
    combinedFields("2,99", ""),
  ]) {
    const info = validationSnapshot(COMBINED_TYPE, fields);
    assert.equal(info.priceValue, "");
    assert.equal(info.deValue, "2,99");
    assert.deepEqual(validatedSegments("BANANA 2,99 O QUILO", info), []);
  }
});

test("screenshot offer 04 validates the percentage and preserves its correction target", () => {
  const line = "TODA A PEIXARIA COM 20% DE DESCONTO EM NOSSOS CARTÕES";
  for (const [discount, expectedMatch] of [["20", "correct"], ["15", "wrong"]]) {
    const info = validationSnapshot("Todos A Com X% Desconto", [
      field("desconto", "Desconto", discount, "percent"),
    ]);
    assert.deepEqual(info.priceField, { fieldId: "desconto", fieldIndex: 0, value: discount });
    const segments = validatedSegments(line, info);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, "20%");
    assert.equal(segments[0].match, expectedMatch);
    assert.equal(segments[0].value, "20%");
    assert.equal(segments[0].action, expectedMatch === "wrong" ? "fix" : undefined);
  }
});

test("screenshot offer 03 retains ordinary decimal price validation", () => {
  const info = validationSnapshot("Simples", simpleFields("7,90"));
  const segments = validatedSegments("COXA COM SOBRECOXA DE FRANGO 7,90 O QUILO", info);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "7,90");
  assert.equal(segments[0].match, "correct");
  assert.equal(segments[0].value, "7,90");
});

test("screenshot offer 06 recognizes 99 CENTAVOS and supplies a normalized fix value", () => {
  const line = "SELEÇÃO DE OFERTAS POR ATÉ 99 CENTAVOS";
  for (const [price, expectedMatch] of [["0,99", "correct"], ["1,99", "wrong"]]) {
    const info = validationSnapshot("Simples", simpleFields(price));
    const segments = validatedSegments(line, info);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, "99 CENTAVOS");
    assert.equal(segments[0].match, expectedMatch);
    assert.equal(segments[0].fieldKey, "price");
    assert.equal(segments[0].value, "0,99");
    assert.equal(segments[0].action, expectedMatch === "wrong" ? "fix" : undefined);
  }
});

test("centavo recognition accepts singular, plural, mixed case and whitespace", () => {
  for (const [text, price] of [["1 centavo", "0,01"], ["99 CeNtAvOs", "0,99"], ["9  CENTAVOS", "0,09"]]) {
    const info = validationSnapshot("Simples", simpleFields(price));
    const [segment] = validatedSegments(`OFERTA POR ${text}!`, info);
    assert.equal(segment.text, text);
    assert.equal(segment.match, "correct");
    assert.equal(segment.value, price);
  }
});

test("integer quantities and product sizes remain uncolored", () => {
  const info = validationSnapshot("Simples", simpleFields("0,99"));
  assert.deepEqual(validatedSegments("OVOS COM 20 UNIDADES - 1 / PACOTE 99 G", info), []);
});

test("legacy De Por still selects Por and validates grouped decimal prices", () => {
  const info = validationSnapshot("De Por", [
    field("preco-de", "De", "1.299,90"),
    field("preco-por", "Por", "999,90"),
    field("quantidade-x", "Quantidade X", "1", "integer"),
  ]);
  assert.equal(info.priceValue, "999,90");
  assert.deepEqual(info.priceField, { fieldId: "preco-por", fieldIndex: 1, value: "999,90" });
  assert.equal(validatedSegments("PRODUTO 999,90", info)[0].match, "correct");
  assert.equal(validatedSegments("PRODUTO 1.299,90", info)[0].match, "wrong");
});
