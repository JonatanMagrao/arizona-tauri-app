import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isAllTakePayMechanicType } from "../src/shared/allTakePayMechanic.js";

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
const sharedMocks = {
  "../../../../../shared/allTakePayMechanic": { isAllTakePayMechanicType },
};
const segmentsModule = { exports: {} };
vm.runInNewContext(transpile(segmentsSource, ts.ModuleKind.CommonJS), {
  module: segmentsModule,
  exports: segmentsModule.exports,
  require: (specifier) => {
    assert.ok(Object.hasOwn(sharedMocks, specifier), `Unexpected import: ${specifier}`);
    return sharedMocks[specifier];
  },
});
const buildLineSegments = (line, info) => JSON.parse(JSON.stringify(
  segmentsModule.exports.buildLineSegments(line, info)
));
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
    ...sharedMocks,
    "../mechanics/schemaRuntime": {
      withMechanicsSchema: (callback) => callback(),
    },
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

test("the current combined mechanic validates grouped decimal prices against Por", () => {
  const info = validationSnapshot(COMBINED_TYPE, combinedFields("1.299,90", "999,90"));
  assert.equal(info.priceValue, "999,90");
  assert.deepEqual(info.priceField, { fieldId: "preco-por", fieldIndex: 1, value: "999,90" });
  assert.equal(validatedSegments("PRODUTO 999,90", info)[0].match, "correct");
  assert.equal(validatedSegments("PRODUTO 1.299,90", info)[0].match, "wrong");
});

const installmentFields = (de, price, installment) => [
  field("preco-de", "De", de),
  field("preco-cheio", "Preco", price),
  field("preco-parcela", "Parcela", installment),
  field("numero-parcelas", "Parcelas", "10", "integer"),
];

test("current installment discovery uses Parcela, accepts full price and excludes De from generic matches", () => {
  const info = validationSnapshot("De X Por Y Parcelamento", installmentFields("1.299,90", "999,90", "99,99"));
  assert.equal(info.priceValue, "99,99");
  assert.equal(info.porValue, "999,90");
  assert.equal(info.deValue, "1.299,90");
  assert.deepEqual(info.priceAcceptedValues, ["999,90", "99,99"]);
  assert.deepEqual(info.priceField, { fieldId: "preco-parcela", fieldIndex: 2, value: "99,99" });
  assert.deepEqual(info.porField, { fieldId: "preco-cheio", fieldIndex: 1, value: "999,90" });
  assert.deepEqual(info.deField, { fieldId: "preco-de", fieldIndex: 0, value: "1.299,90" });

  const segments = validatedSegments("PRODUTO DE 1.299,90 POR 999,90 EM 10 VEZES DE 99,99", info);
  assert.deepEqual(segments.map(({ match, fieldKey }) => ({ match, fieldKey })), [
    { match: "correct", fieldKey: "de" },
    { match: "correct", fieldKey: "por" },
    { match: "correct", fieldKey: "price" },
  ]);
  const ambiguous = validatedSegments("PRODUTO 1.299,90 OU 99,99", info);
  assert.equal(ambiguous[0].match, "wrong");
  assert.equal(ambiguous[0].action, "open");
  assert.equal(ambiguous[1].match, "correct");
  for (const price of ["999,90", "99,99"]) {
    const [segment] = validatedSegments(`PRODUTO ${price}`, info);
    assert.equal(segment.match, "correct");
  }
  const [unknownPrice] = validatedSegments("PRODUTO 899,90", info);
  assert.equal(unknownPrice.match, "wrong");
  assert.equal(unknownPrice.action, "open");
  assert.equal(unknownPrice.fieldKey, undefined);
});

test("current installment corrections retain the exact De, full price and installment field targets", () => {
  const info = validationSnapshot("De X Por Y Parcelamento", installmentFields("1.299,90", "999,90", "99,99"));
  const segments = validatedSegments("PRODUTO DE 1.399,90 POR 899,90 EM 10 VEZES DE 89,99", info);
  assert.deepEqual(segments.map(({ match, fieldKey, action, value }) => ({ match, fieldKey, action, value })), [
    { match: "wrong", fieldKey: "de", action: "fix", value: "1.399,90" },
    { match: "wrong", fieldKey: "por", action: "fix", value: "899,90" },
    { match: "wrong", fieldKey: "price", action: "fix", value: "89,99" },
  ]);
  for (const expression of ["10X DE", "10 X DE", "10x", "10 VEZES DE"]) {
    const [segment] = validatedSegments(`PRODUTO EM ${expression} 89,99`, info);
    assert.equal(segment.fieldKey, "price");
    assert.equal(segment.action, "fix");
  }
});

test("current installment uses full price when Parcela is unavailable, never De", () => {
  for (const fields of [
    installmentFields("1.299,90", "999,90", ""),
    installmentFields("1.299,90", "999,90", "").filter(({ label }) => label !== "Parcela"),
  ]) {
    const info = validationSnapshot("De X Por Y Parcelamento", fields);
    assert.equal(info.priceValue, "999,90");
    if (info.priceField) {
      assert.deepEqual(info.priceField, { fieldId: "preco-parcela", fieldIndex: 2, value: "" });
    }
    assert.deepEqual(info.priceAcceptedValues, ["999,90"]);
    assert.equal(validatedSegments("PRODUTO 999,90", info)[0].match, "correct");
    assert.equal(validatedSegments("PRODUTO 1.299,90", info)[0].match, "wrong");
    const [installment] = validatedSegments("PRODUTO EM 10X DE 999,90", info);
    assert.equal(installment.match, "wrong");
    assert.equal(installment.fieldKey, "price");
    assert.equal(installment.action, info.priceField ? "fix" : "open");
  }
  const missingPrices = validationSnapshot("De X Por Y Parcelamento", installmentFields("1.299,90", "", ""));
  assert.equal(missingPrices.priceValue, "");
  assert.deepEqual(missingPrices.priceAcceptedValues, []);
  assert.deepEqual(validatedSegments("PRODUTO 1.299,90", missingPrices), []);
});

test("current all-take-pay family and its alias validate both quantities and retain correction identities", () => {
  for (const type of ["Todos A Com Leve X Pague Y", "Todos A Leve X Pague Y"]) {
    const info = validationSnapshot(type, [
      field("leve", "Leve X", "3", "integer"),
      field("pague", "Pague Y", "2", "integer"),
    ]);
    assert.equal(info.priceValue, "");
    assert.equal(info.leveValue, "3");
    assert.equal(info.pagueValue, "2");
    assert.deepEqual(info.leveField, { fieldId: "leve", fieldIndex: 0, value: "3" });
    assert.deepEqual(info.pagueField, { fieldId: "pague", fieldIndex: 1, value: "2" });
    assert.deepEqual(validatedSegments("TODOS OS PRODUTOS LEVE 3 E PAGUE 2", info).map(({ match, fieldKey }) => ({ match, fieldKey })), [
      { match: "correct", fieldKey: "leve" },
      { match: "correct", fieldKey: "pague" },
    ]);
    assert.deepEqual(validatedSegments("LEVE X 4 PAGUE Y 3", info).map(({ match, fieldKey, action, value }) => ({ match, fieldKey, action, value })), [
      { match: "wrong", fieldKey: "leve", action: "open", value: "4" },
      { match: "wrong", fieldKey: "pague", action: "open", value: "3" },
    ]);
    assert.deepEqual(validatedSegments("PACOTE COM 3 UNIDADES 2,99", info), []);
  }
});

test("all-take-pay missing quantities keep the script readable without a correction target", () => {
  const info = validationSnapshot("Todos A Com Leve X Pague Y", [field("leve", "Leve X", "3", "integer")]);
  assert.deepEqual(buildLineSegments("LEVE 3 PAGUE 2", info), [{ text: "LEVE 3 PAGUE 2" }]);
});

test("removed families and unsupported mechanics do not highlight or offer stale corrections", () => {
  for (const mechanicType of [
    "De Por", "De Por Cartao CRF", "De Por Meu CRF (Dual)",
    "De Por Parcelamento Cartao Carrefour", "Leve X Pague Y",
    "Desconto X%", "Porcentagem Desconto", "Desconto X% Meu CRF",
    "Desconto X% Cartao CRF", "Desconto X% Cartao CRF Segunda Unidade",
    "De A Unidade Sai Por", "Mecanica nao mapeada: DE POR 1",
  ]) {
    const info = {
      ...validationSnapshot(mechanicType, simpleFields("1,99")),
      leveValue: "3", pagueValue: "2",
    };
    const line = "PRODUTO 2,99 COM 20% DE DESCONTO LEVE 4 PAGUE 3";
    assert.deepEqual(buildLineSegments(line, info), [{ text: line }]);
  }
});

test("Meu CRF/card and currency discount retain their readable generic discovery without new highlighting", () => {
  for (const [type, fields] of [
    ["De X Por Y Meu CRF Por Z Cartao CRF", [
      field("preco-de", "De", "4,99"),
      field("preco-por", "Por", "3,99"),
      field("preco-por-cartao", "Por cartão", "2,99"),
    ]],
    ["Desconto R$ Cartao CRF", [field("desconto", "Desconto", "4,99")]],
  ]) {
    const info = validationSnapshot(type, fields);
    assert.equal(info.priceValue, "4,99");
    assert.deepEqual(buildLineSegments("PRODUTO 4,99 NO CARTÃO", info), [{ text: "PRODUTO 4,99 NO CARTÃO" }]);
  }
});
