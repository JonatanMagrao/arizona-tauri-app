import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const helperUrl = new URL(
  "../src/jsx/aeft/domains/ofertas/mechanics/mechanicIdentity.ts",
  import.meta.url
);
const registryUrl = new URL(
  "../src/jsx/aeft/domains/ofertas/mechanics/registry.ts",
  import.meta.url
);
const helperSource = await readFile(helperUrl, "utf8");
const registrySource = await readFile(registryUrl, "utf8");
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helperModuleUrl =
  "data:text/javascript;base64," +
  Buffer.from(helperJavaScript, "utf8").toString("base64");
const { buildMechanicSourceIdentity } = await import(helperModuleUrl);

test("prioritizes the source comment over the source name", () => {
  assert.deepEqual(
    buildMechanicSourceIdentity(
      "TODOS A COM LEVE X PAGUE Y",
      "TODOS A COM LEVE X PAGUE Y 1"
    ),
    {
      comment: "TODOS A COM LEVE X PAGUE Y",
      sourceName: "TODOS A COM LEVE X PAGUE Y 1",
      candidates: [
        "TODOS A COM LEVE X PAGUE Y",
        "TODOS A COM LEVE X PAGUE Y 1",
      ],
    }
  );
});

test("uses the source name when the comment is empty", () => {
  assert.deepEqual(
    buildMechanicSourceIdentity("  \r\n", " TODOS A COM LEVE X PAGUE Y 2 "),
    {
      comment: "",
      sourceName: "TODOS A COM LEVE X PAGUE Y 2",
      candidates: ["TODOS A COM LEVE X PAGUE Y 2"],
    }
  );
});

test("keeps an unrecognized comment first so the registry can try the source name", () => {
  assert.deepEqual(buildMechanicSourceIdentity("anotacao antiga", "SIMPLES"), {
    comment: "anotacao antiga",
    sourceName: "SIMPLES",
    candidates: ["anotacao antiga", "SIMPLES"],
  });
});

test("does not duplicate identical comment and source name candidates", () => {
  assert.deepEqual(buildMechanicSourceIdentity(" SIMPLES ", "SIMPLES"), {
    comment: "SIMPLES",
    sourceName: "SIMPLES",
    candidates: ["SIMPLES"],
  });
});

test("the registry ignores the timeline layer name as an identity", () => {
  assert.equal(registrySource.includes("source.comment"), true);
  assert.equal(registrySource.includes("source.name"), true);
  assert.equal(registrySource.includes("valueLayer.name"), false);
});

function loadRegistry(config) {
  const module = { exports: {} };
  const reader = (type) => () => ({ type, fields: [], optionGroups: [] });
  vm.runInNewContext(ts.transpileModule(registrySource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5,
  } }).outputText, { module, exports: module.exports, require(specifier) {
    if (specifier.endsWith("findLayers")) return { getLayerSource: (layer) => layer.source,
      nameMatches: (value, matcher) => matcher.test(String(value).trim()) };
    if (specifier.endsWith("templateIdentities")) return { getTemplateIdentities: () => config,
      normalizeTemplateIdentity: (value) => String(value).trim().toUpperCase(), matchTemplatePattern: () => null };
    if (specifier.endsWith("schemaRuntime")) return { withMechanicsSchema: (callback) => callback() };
    if (specifier.endsWith("mechanicIdentity")) return { buildMechanicSourceIdentity };
    return {
      readSimpleMechanic: reader("SIMPLES"), readAllPercentDiscountMechanic: reader("TODOS A COM X% DESCONTO"),
      readCrfCardValueDiscountMechanic: reader("DESCONTO R$ CARTAO CRF"), readDeXPorYInstallmentMechanic: reader("DE X POR Y PARCELAMENTO"),
      readMeuCrfCardMechanic: reader("DE X POR Y MEU CRF POR Z CARTAO CRF"),
      readDeXPorYDiscountTakePayMechanic: reader("DE X POR Y | X% DESCONTO | LEVE X PAGUE Y"),
      readAllTakeXPayYMechanic: reader("TODOS A COM LEVE X PAGUE Y"),
    };
  } });
  return module.exports;
}

test("registry recognizes generated numeric comments from the configured family with name fallback disabled", async () => {
  const config = JSON.parse(await readFile(new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"));
  config.fallback.projectItems = false;
  config.mechanics["TODOS A COM X% DESCONTO"].comment = "BONUS CRF";
  const errors = [];
  const value = loadRegistry(config).readMechanic({ source: { comment: "BONUS CRF 2", name: "Sem identidade pelo nome" } }, errors);
  assert.equal(value.type, "TODOS A COM X% DESCONTO");
  assert.deepEqual(errors, []);
});

test("registry uses the configured name fallback for empty and unknown comments only when enabled", async () => {
  for (const enabled of [true, false]) {
    const config = JSON.parse(await readFile(new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"));
    config.fallback.projectItems = enabled;
    const registry = loadRegistry(config);
    for (const comment of ["", "ANOTACAO ANTIGA"]) {
      const errors = [];
      const value = registry.readMechanic({ source: { comment, name: "TODOS A COM X% DESCONTO 2" } }, errors);
      if (enabled) assert.equal(value.type, "TODOS A COM X% DESCONTO");
      else assert.equal(value.unsupported, true);
      assert.deepEqual(errors, []);
    }
  }
});

test("compiled mechanic identity and allocation avoid ExtendScript's chained conditional ambiguity", async () => {
  const sources = [registryUrl, new URL("../src/jsx/aeft/domains/ofertas/offers/layoutMechanicInstances.ts", import.meta.url)];
  for (const url of sources) {
    const source = await readFile(url, "utf8");
    const { code } = transformSync(source, {
      filename: url.pathname, babelrc: false, configFile: false,
      presets: [require.resolve("@babel/preset-env"), require.resolve("@babel/preset-typescript")],
    });
    const ast = ts.createSourceFile(url.pathname, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const ambiguous = [];
    const inspect = (node) => {
      if (ts.isConditionalExpression(node) && ts.isConditionalExpression(node.whenFalse)) {
        ambiguous.push(node.getText(ast));
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    assert.deepEqual(ambiguous, [], url.pathname + " contains an ungrouped chained conditional after Babel");
  }
});
