import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const hostRoot = fileURLToPath(new URL("../src/jsx/aeft/", import.meta.url));
const defaultInput = fileURLToPath(new URL("../src/js/assets/template-identities.json", import.meta.url));

export function loadTemplateIdentitiesModule(globals = {}) {
  const modules = new Map();
  function load(filename) {
    const resolved = path.resolve(filename);
    if (!resolved.startsWith(hostRoot)) throw new Error("Unexpected identity module: " + filename);
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const module = { exports: {} };
    modules.set(resolved, module);
    const compiled = ts.transpileModule(readFileSync(resolved, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
    }).outputText;
    vm.runInNewContext(compiled, {
      ...globals, exports: module.exports, module,
      require(specifier) {
        if (!specifier.startsWith(".")) throw new Error("Unexpected identity import: " + specifier);
        return load(path.resolve(path.dirname(resolved), specifier + ".ts"));
      },
    }, { filename: resolved });
    return module.exports;
  }
  return load(path.join(hostRoot, "domains/template/templateIdentities.ts"));
}

// Validate the exact asset with the same strict parser and validator as AE.
// No generated mirror or bundled defaults can become stale after an edit.
export function validateTemplateIdentitiesFile(input = defaultInput) {
  const inputPath = path.resolve(input);
  const parser = loadTemplateIdentitiesModule();
  try {
    const binary = readFileSync(inputPath).toString("latin1");
    return JSON.parse(JSON.stringify(parser.parseTemplateIdentitiesJson(parser.decodeTemplateIdentitiesUtf8(binary))));
  } catch (error) {
    throw new Error("Mapa de identidades invalido em " + inputPath + ": " + String(error));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateTemplateIdentitiesFile();
  console.log("Mapa de identidades validado; o JSON sera distribuido como asset.");
}
