import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { validateMechanicsSchemaFile } from "./validate-mechanics-schema.mjs";

const validatorPath = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/mechanics/schemaValidation.ts", import.meta.url));
const module = { exports: {} };
const javaScript = ts.transpileModule(readFileSync(validatorPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
}).outputText;
vm.runInNewContext(javaScript, { module, exports: module.exports }, { filename: validatorPath });
const { validateMechanicsSchema } = module.exports;
const approved = JSON.parse(readFileSync(new URL("../src/js/assets/schema.json", import.meta.url), "utf8"));
const copy = () => JSON.parse(JSON.stringify(approved));
const combinedId = "DE X POR Y | X% DESCONTO | LEVE X PAGUE Y";

function removeTemporaryDirectory(directory) {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith("arizona-mechanics-"));
  rmSync(target, { recursive: true, force: true });
}

test("accepts all seven approved mechanics and preserves the object", () => {
  assert.equal(validateMechanicsSchema(approved), approved);
});

test("allows edited comments, labels and distinct AE values", () => {
  const schema = copy();
  schema.SIMPLES.layers.preco = "PREÇO PERSONALIZADO";
  schema.SIMPLES.effects.unit.name = "Unidade editada";
  schema.SIMPLES.effects.unit.options.forEach((option, index) => {
    option.index = 10 + index;
    option.label = "Opção " + index;
  });
  assert.equal(validateMechanicsSchema(schema), schema);
});

const invalidCases = [
  ["null root", () => null, /null/],
  ["null layer", (schema) => { schema.SIMPLES.layers.preco = null; }, /null/],
  ["null effect", (schema) => { schema.SIMPLES.effects.unit = null; }, /null/],
  ["null option", (schema) => { schema.SIMPLES.effects.unit.options[0] = null; }, /null/],
  ["null extra attribute", (schema) => { schema.extra = { nested: null }; }, /null/],
  ["unsupported version", (schema) => { schema.version = 2; }, /versao 1/],
  ["missing mechanic", (schema) => { delete schema.SIMPLES; }, /obrigatorio ausente/],
  ["extra mechanic", (schema) => { schema.ANTIGA = schema.SIMPLES; }, /inesperado/],
  ["renamed layer role", (schema) => { schema.SIMPLES.layers.preço = schema.SIMPLES.layers.preco; delete schema.SIMPLES.layers.preco; }, /inesperado|ausente/],
  ["renamed effect id", (schema) => { schema.SIMPLES.effects.unidade = schema.SIMPLES.effects.unit; delete schema.SIMPLES.effects.unit; }, /inesperado|ausente/],
  ["extra effect attribute", (schema) => { schema.SIMPLES.effects.unit.enabled = true; }, /inesperado/],
  ["extra option attribute", (schema) => { schema.SIMPLES.effects.unit.options[0].value = 1; }, /inesperado/],
  ["duplicate normalized comment", (schema) => { schema.SIMPLES.layers.controlador = "  preco  "; }, /comentario duplicado/],
  ["missing layer reference", (schema) => { schema.SIMPLES.effects.unit.layer = "ausente"; }, /referencia de camada inexistente/],
  ["empty comment", (schema) => { schema.SIMPLES.layers.preco = " \t "; }, /texto nao vazio/],
  ["empty effect name", (schema) => { schema.SIMPLES.effects.unit.name = " "; }, /texto nao vazio/],
  ["empty option label", (schema) => { schema.SIMPLES.effects.unit.options[0].label = " "; }, /texto nao vazio/],
  ["missing dropdown options", (schema) => { delete schema.SIMPLES.effects.unit.options; }, /obrigatorio ausente/],
  ["changed dropdown option count", (schema) => { schema.SIMPLES.effects.unit.options.pop(); }, /esperadas 4 opcoes/],
  ["duplicate option values", (schema) => { schema.SIMPLES.effects.unit.options[0].index = 2; }, /indice de opcao duplicado/],
  ["zero option value", (schema) => { schema.SIMPLES.effects.unit.options[0].index = 0; }, /inteiro positivo/],
  ["fractional option value", (schema) => { schema.SIMPLES.effects.unit.options[0].index = 1.5; }, /inteiro positivo/],
  ["non-finite option value", (schema) => { schema.SIMPLES.effects.unit.options[0].index = Infinity; }, /inteiro positivo/],
  ["unsafe option value", (schema) => { schema.SIMPLES.effects.unit.options[0].index = 9007199254740992; }, /inteiro positivo/],
  ["zero effect index", (schema) => { schema.SIMPLES.effects.unit.index = 0; }, /inteiro positivo/],
  ["string effect index", (schema) => { schema.SIMPLES.effects.unit.index = "1"; }, /inteiro positivo/],
  ["fractional effect index", (schema) => { schema.SIMPLES.effects.unit.index = 1.5; }, /inteiro positivo/],
  ["non-finite effect index", (schema) => { schema.SIMPLES.effects.unit.index = NaN; }, /inteiro positivo/],
  ["unsafe effect index", (schema) => { schema.SIMPLES.effects.unit.index = 9007199254740992; }, /inteiro positivo/],
  ["positional effects sharing index and layer", (schema) => { schema[combinedId].effects.unit.index = 1; }, /indice compartilhado/],
  ["quantity control with options", (schema) => { schema[combinedId].effects["quantidade-x"].options = []; }, /inesperado/],
];

for (const [label, mutate, expected] of invalidCases) {
  test("rejects " + label, () => {
    const original = copy();
    const replacement = mutate(original);
    assert.throws(() => validateMechanicsSchema(replacement === undefined ? original : replacement), expected);
  });
}

test("permits the same positional index on different configured layers", () => {
  const schema = copy();
  schema[combinedId].effects.unit.index = 1;
  schema[combinedId].effects.unit.layer = "preco-de";
  assert.equal(validateMechanicsSchema(schema), schema);
});

test("validates the editable JSON and never writes generated modules or rewrites the input", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arizona-mechanics-schema-"));
  try {
    const input = path.join(directory, "schema.json");
    writeFileSync(input, JSON.stringify(approved), "utf8");
    const content = readFileSync(input, "utf8");
    const modified = statSync(input).mtimeMs;
    assert.deepEqual(JSON.parse(JSON.stringify(validateMechanicsSchemaFile(input))), approved);
    assert.equal(readFileSync(input, "utf8"), content);
    assert.equal(statSync(input).mtimeMs, modified);
    assert.deepEqual(readdirSync(directory), ["schema.json"]);
    writeFileSync(input, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(approved), "utf8")]));
    assert.deepEqual(JSON.parse(JSON.stringify(validateMechanicsSchemaFile(input))), approved);
    assert.deepEqual(readdirSync(directory), ["schema.json"]);

    const invalid = copy();
    invalid.SIMPLES.effects.unit.index = null;
    writeFileSync(input, JSON.stringify(invalid), "utf8");
    const invalidContent = readFileSync(input, "utf8");
    assert.throws(() => validateMechanicsSchemaFile(input), /null/);
    assert.equal(readFileSync(input, "utf8"), invalidContent);
    assert.deepEqual(readdirSync(directory), ["schema.json"]);
  } finally {
    removeTemporaryDirectory(directory);
  }
});

test("rejects invalid JSON, invalid UTF-8 and a double BOM without writing outputs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arizona-mechanics-json-"));
  try {
    const input = path.join(directory, "schema.json");
    writeFileSync(input, '{ "version": 1, }', "utf8");
    assert.throws(() => validateMechanicsSchemaFile(input), /JSON.*inv[aá]lido/i);
    writeFileSync(input, Buffer.from([0xc3, 0x28]));
    assert.throws(() => validateMechanicsSchemaFile(input), /encoded data|encoding|UTF-8/i);
    writeFileSync(input, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(approved), "utf8")]));
    assert.throws(() => validateMechanicsSchemaFile(input), /JSON|inv[aá]lido/i);
    assert.deepEqual(readdirSync(directory), ["schema.json"]);
  } finally {
    removeTemporaryDirectory(directory);
  }
});

const duplicateCases = [
  ["top-level mechanic", '"SIMPLES":', '"SIMPLES":null,"SIMPLES":'],
  ["layer role", '"preco":"PRECO"', '"preco":null,"preco":"PRECO"'],
  ["effect id", '"unit":', '"unit":null,"unit":'],
  ["effect attribute", '"name":"Unidade"', '"name":null,"name":"Unidade"'],
  ["option attribute", '"label":"Cada"', '"label":null,"label":"Cada"'],
  ["escaped and literal keys", '"index":1', '"\\u0069ndex":null,"index":1'],
];

for (const [label, original, duplicate] of duplicateCases) {
  test("rejects duplicate JSON " + label + " without overwriting files", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "arizona-mechanics-duplicates-"));
    try {
      const input = path.join(directory, "schema.json");
      const output = path.join(directory, "unrelated.txt");
      const source = JSON.stringify(approved);
      assert.ok(source.includes(original));
      writeFileSync(input, source.replace(original, duplicate), "utf8");
      writeFileSync(output, "preserved output", "utf8");
      assert.throws(() => validateMechanicsSchemaFile(input), /chave duplicada/);
      assert.equal(readFileSync(output, "utf8"), "preserved output");
      assert.deepEqual(readdirSync(directory), ["schema.json", "unrelated.txt"]);
    } finally {
      removeTemporaryDirectory(directory);
    }
  });
}
