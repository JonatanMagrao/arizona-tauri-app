import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_ROOTS = ["src", "src-tauri/src"];
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".jsx", ".json", ".mjs", ".rs"]);
const MOJIBAKE_PATTERN = /(?:Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|\u00e2\u20ac)/u;

async function textSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await textSourceFiles(target));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(target);
    }
  }

  return files;
}

test("Tauri source messages do not contain common UTF-8 mojibake", async () => {
  const files = (await Promise.all(
    SOURCE_ROOTS.map((sourceRoot) => textSourceFiles(path.join(REPOSITORY_ROOT, sourceRoot)))
  )).flat();
  const corrupted = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    text.split(/\r?\n/u).forEach((line, index) => {
      if (MOJIBAKE_PATTERN.test(line)) {
        corrupted.push(`${path.relative(REPOSITORY_ROOT, file)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(corrupted, []);
});
