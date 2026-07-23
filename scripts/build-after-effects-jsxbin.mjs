import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jsxbin from "jsxbin";

const ACTION_PLACEHOLDER = "__ARIZONA_ACTION__";
const ACTIONS = Object.freeze([
  "move_layers_backward",
  "move_layers_forward",
  "move_jump_marker",
  "select_jump_marker_layer",
  "adjust_markers_to_tail",
  "render",
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourcePath = join(
  repositoryRoot,
  "src-tauri",
  "src",
  "after_effects",
  "arizona_actions.jsx"
);
const outputDirectory = readOutputDirectory(process.argv.slice(2));
const temporaryDirectory = join(outputDirectory, "readable-sources");

await mkdir(temporaryDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const source = await readFile(sourcePath, "utf8");
const placeholderCount = source.split(ACTION_PLACEHOLDER).length - 1;
if (placeholderCount !== 1) {
  throw new Error(
    `Esperado exatamente um placeholder ${ACTION_PLACEHOLDER} em ${sourcePath}; encontrado: ${placeholderCount}.`
  );
}

const inputPaths = [];
const outputPaths = [];
for (const action of ACTIONS) {
  const inputPath = join(temporaryDirectory, `${action}.jsx`);
  const outputPath = join(outputDirectory, `${action}.jsxbin`);
  await writeFile(inputPath, source.replace(ACTION_PLACEHOLDER, action), "utf8");
  inputPaths.push(inputPath);
  outputPaths.push(outputPath);
}

try {
  await jsxbin(inputPaths, outputPaths);

  for (const outputPath of outputPaths) {
    const compiled = await readFile(outputPath, "utf8");
    if (!compiled.startsWith("@JSXBIN@")) {
      throw new Error(`JSXBIN invalido gerado em ${outputPath}.`);
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function readOutputDirectory(args) {
  const outputIndex = args.indexOf("--output");
  const value = outputIndex >= 0 ? args[outputIndex + 1] : "";
  if (!value) {
    throw new Error("Uso: node scripts/build-after-effects-jsxbin.mjs --output <diretorio>");
  }
  return resolve(value);
}
