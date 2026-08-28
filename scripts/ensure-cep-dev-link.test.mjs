import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureCepDevLink } from "./ensure-cep-dev-link.mjs";

const EXTENSION_ID = "com.arizona-carrefour.cep";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arizona-cep-dev-link-"));
  const cepRoot = path.join(root, "Adobe", "CEP");
  return {
    root,
    backupRoot: path.join(cepRoot, ".arizona-dev-backup"),
    devTargetPath: path.join(root, "repository", "ARIZONA-EXTENSION", "dist", "cep"),
    installedPath: path.join(cepRoot, "extensions", EXTENSION_ID),
  };
}

function removeFixture(root) {
  rmSync(root, { recursive: true, force: true });
}

test("preserves a normal CEP installation and replaces it with the development junction", () => {
  const paths = fixture();
  try {
    mkdirSync(paths.installedPath, { recursive: true });
    writeFileSync(path.join(paths.installedPath, "installed-marker.txt"), "produção");

    const result = ensureCepDevLink({
      ...paths,
      now: Date.parse("2026-08-28T18:45:00.000Z"),
    });

    assert.equal(result.status, "created");
    assert.ok(result.backupPath);
    assert.equal(readFileSync(path.join(result.backupPath, "installed-marker.txt"), "utf8"), "produção");
    assert.equal(lstatSync(paths.installedPath).isSymbolicLink(), true);
    assert.equal(realpathSync(paths.installedPath), realpathSync(paths.devTargetPath));
  } finally {
    removeFixture(paths.root);
  }
});

test("creates the development target and junction when no CEP installation exists", () => {
  const paths = fixture();
  try {
    const result = ensureCepDevLink(paths);

    assert.equal(result.status, "created");
    assert.equal(result.backupPath, null);
    assert.equal(lstatSync(paths.devTargetPath).isDirectory(), true);
    assert.equal(realpathSync(paths.installedPath), realpathSync(paths.devTargetPath));
  } finally {
    removeFixture(paths.root);
  }
});

test("keeps the correct development junction unchanged on later runs", () => {
  const paths = fixture();
  try {
    mkdirSync(paths.devTargetPath, { recursive: true });
    mkdirSync(path.dirname(paths.installedPath), { recursive: true });
    symlinkSync(
      paths.devTargetPath,
      paths.installedPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = ensureCepDevLink(paths);

    assert.equal(result.status, "exists");
    assert.equal(result.backupPath, null);
    assert.equal(existsSync(paths.backupRoot), false);
    assert.equal(realpathSync(paths.installedPath), realpathSync(paths.devTargetPath));
  } finally {
    removeFixture(paths.root);
  }
});

test("backs up an incorrect junction before creating the expected one", () => {
  const paths = fixture();
  try {
    const otherTarget = path.join(paths.root, "other-extension");
    mkdirSync(otherTarget, { recursive: true });
    mkdirSync(path.dirname(paths.installedPath), { recursive: true });
    symlinkSync(
      otherTarget,
      paths.installedPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = ensureCepDevLink({
      ...paths,
      now: Date.parse("2026-08-28T18:45:00.000Z"),
    });

    assert.equal(result.status, "created");
    assert.ok(result.backupPath);
    assert.deepEqual(readdirSync(paths.backupRoot), [path.basename(result.backupPath)]);
    assert.equal(realpathSync(paths.installedPath), realpathSync(paths.devTargetPath));
  } finally {
    removeFixture(paths.root);
  }
});

test("restores the previous installation when junction creation fails", () => {
  const paths = fixture();
  try {
    mkdirSync(paths.installedPath, { recursive: true });
    writeFileSync(path.join(paths.installedPath, "installed-marker.txt"), "preservado");

    assert.throws(
      () => ensureCepDevLink({
        ...paths,
        createLink() {
          throw new Error("falha simulada");
        },
      }),
      /falha simulada/u,
    );

    assert.equal(lstatSync(paths.installedPath).isDirectory(), true);
    assert.equal(readFileSync(path.join(paths.installedPath, "installed-marker.txt"), "utf8"), "preservado");
    assert.deepEqual(readdirSync(paths.backupRoot), []);
  } finally {
    removeFixture(paths.root);
  }
});

test("refuses to replace an unexpected file at the CEP destination", () => {
  const paths = fixture();
  try {
    mkdirSync(path.dirname(paths.installedPath), { recursive: true });
    writeFileSync(paths.installedPath, "não é uma extensão");

    assert.throws(
      () => ensureCepDevLink(paths),
      /não é uma pasta nem uma junction/u,
    );
    assert.equal(readFileSync(paths.installedPath, "utf8"), "não é uma extensão");
  } finally {
    removeFixture(paths.root);
  }
});
