import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

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
    buildMechanicSourceIdentity("  \r\n", " LEVE X PAGUE Y 2 "),
    {
      comment: "",
      sourceName: "LEVE X PAGUE Y 2",
      candidates: ["LEVE X PAGUE Y 2"],
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
  assert.deepEqual(buildMechanicSourceIdentity(" DE POR ", "DE POR"), {
    comment: "DE POR",
    sourceName: "DE POR",
    candidates: ["DE POR"],
  });
});

test("the registry ignores the timeline layer name as an identity", () => {
  assert.equal(registrySource.includes("source.comment"), true);
  assert.equal(registrySource.includes("source.name"), true);
  assert.equal(registrySource.includes("valueLayer.name"), false);
});
