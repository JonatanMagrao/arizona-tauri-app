import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const mechanicsDirectory = fileURLToPath(new URL("../src/jsx/aeft/domains/ofertas/mechanics/", import.meta.url));
const defaultInput = fileURLToPath(new URL("../src/js/assets/schema.json", import.meta.url));

function loadParser() {
  const modules = new Map();
  const load = (modulePath) => {
    if (modules.has(modulePath)) return modules.get(modulePath).exports;
    const module = { exports: {} };
    modules.set(modulePath, module);
    const javaScript = ts.transpileModule(readFileSync(modulePath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText;
    vm.runInNewContext(javaScript, {
      exports: module.exports,
      module,
      require: (specifier) => {
        if (specifier !== "./schemaValidation") throw new Error("Unexpected schema import: " + specifier);
        return load(path.join(mechanicsDirectory, "schemaValidation.ts"));
      },
    }, { filename: modulePath });
    return module.exports;
  };
  return load(path.join(mechanicsDirectory, "schemaJson.ts"));
}

// Validate the exact asset using the same UTF-8 decoder and parser as the host.
// This command never generates a configuration copy or changes the source JSON.
export function validateMechanicsSchemaFile(input = defaultInput) {
  const inputPath = path.resolve(input);
  const parser = loadParser();
  try {
    const binary = readFileSync(inputPath).toString("latin1");
    const schema = parser.parseMechanicsSchemaJson(parser.decodeMechanicsSchemaUtf8(binary));
    return JSON.parse(JSON.stringify(schema));
  } catch (error) {
    throw new Error("Schema de mecânicas inválido em " + inputPath + ": " + String(error));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateMechanicsSchemaFile();
  console.log("Schema de mecânicas validado; o JSON será distribuído como asset.");
}
