import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/jsx/aeft/domains/project/openProject.ts", import.meta.url),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES5,
  },
}).outputText;

function runOpenProject(options = {}) {
  const calls = [];
  const dialogLocations = [];
  const selectedFile = Object.hasOwn(options, "selectedFile")
    ? options.selectedFile
    : { name: "Novo projeto.aep", exists: true };
  function showDialog(prompt, filter, multiSelect) {
    calls.push("dialog");
    assert.ok(prompt);
    assert.ok(filter.includes("*.aep") && filter.includes("*.aepx"));
    assert.equal(multiSelect, false);
    if (options.dialogError) throw new Error(options.dialogError);
    return selectedFile;
  }
  const projectFile = {
    name: "Projeto atual.aep",
    fsName: "E:/Projetos/Promoção atual/Projeto atual.aep",
    parent: { exists: !options.missingProjectFolder },
    openDlg(prompt, filter, multiSelect) {
      assert.equal(this, projectFile);
      dialogLocations.push(projectFile.fsName);
      return showDialog(prompt, filter, multiSelect);
    },
  };
  const currentProject = {
    file: options.unsavedProject ? null : projectFile,
    close(value) {
      calls.push("close");
      assert.equal(value, "prompt-save");
      if (options.closeError) throw new Error(options.closeError);
      if (options.cancelSave) return false;
      app.project = null;
      return true;
    },
  };
  const openedProject = { name: "New project" };
  const app = {
    project: options.noProject ? null : currentProject,
    purge(value) {
      calls.push("purge");
      assert.equal(value, "all-caches");
      assert.equal(app.project, null);
      if (options.purgeError) throw new Error(options.purgeError);
    },
    open(file) {
      calls.push("open");
      assert.equal(file, selectedFile);
      assert.equal(app.project, null);
      if (options.openError) throw new Error(options.openError);
      if (options.openReturnsNull) return null;
      app.project = openedProject;
      return openedProject;
    },
    beginUndoGroup() {
      assert.fail("Project switching must not open an undo group");
    },
    endUndoGroup() {
      assert.fail("Project switching must not close an undo group");
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    app,
    File: {
      openDialog(prompt, filter, multiSelect) {
        dialogLocations.push("default");
        return showDialog(prompt, filter, multiSelect);
      },
    },
    CloseOptions: { PROMPT_TO_SAVE_CHANGES: "prompt-save" },
    PurgeTarget: { ALL_CACHES: "all-caches" },
  });
  // Match the serialization boundary between ExtendScript and the CEP panel.
  const result = JSON.parse(JSON.stringify(module.exports.openProject()));
  assert.deepEqual(Object.keys(result).sort(), [
    "errors", "message", "projectChanged", "status",
  ]);
  return { result, calls, app, currentProject, openedProject, dialogLocations };
}

test("the dialog starts from the current project and can open a file in another folder", () => {
  const { result, dialogLocations } = runOpenProject({
    selectedFile: { name: "Outro.aep", fsName: "F:/Outra pasta/Outro.aep", exists: true },
  });
  assert.deepEqual(dialogLocations, ["E:/Projetos/Promoção atual/Projeto atual.aep"]);
  assert.equal(result.status, "opened");
});

test("the file dialog also allows reopening the current project", () => {
  const { result, calls, dialogLocations } = runOpenProject({
    selectedFile: {
      name: "Projeto atual.aep",
      fsName: "E:/Projetos/Promoção atual/Projeto atual.aep",
      exists: true,
    },
  });
  assert.deepEqual(dialogLocations, ["E:/Projetos/Promoção atual/Projeto atual.aep"]);
  assert.deepEqual(calls, ["dialog", "close", "purge", "open"]);
  assert.equal(result.status, "opened");
  assert.equal(result.projectChanged, true);
});

test("the default dialog remains available without a saved project or accessible folder", () => {
  for (const options of [{ noProject: true }, { unsavedProject: true }, { missingProjectFolder: true }]) {
    const { result, calls, dialogLocations } = runOpenProject({ ...options, selectedFile: null });
    assert.deepEqual(dialogLocations, ["default"]);
    assert.deepEqual(calls, ["dialog"]);
    assert.equal(result.status, "cancelled");
    assert.equal(result.projectChanged, false);
  }
});

test("canceling the file dialog leaves the project and caches untouched", () => {
  const { result, calls, app, currentProject } = runOpenProject({ selectedFile: null });
  assert.deepEqual(calls, ["dialog"]);
  assert.deepEqual(result, {
    status: "cancelled", projectChanged: false, message: "", errors: [],
  });
  assert.equal(app.project, currentProject);
});

test("canceling the save prompt prevents purge and opening", () => {
  const { result, calls, app, currentProject } = runOpenProject({ cancelSave: true });
  assert.deepEqual(calls, ["dialog", "close"]);
  assert.equal(result.status, "cancelled");
  assert.equal(result.projectChanged, false);
  assert.equal(app.project, currentProject);
});

test("missing and unsupported files are rejected before closing", () => {
  for (const selectedFile of [
    { name: "missing.aep", exists: false },
    { name: "document.txt", exists: true },
    { name: "project.aep.backup", exists: true },
  ]) {
    const { result, calls, app, currentProject } = runOpenProject({ selectedFile });
    assert.deepEqual(calls, ["dialog"]);
    assert.equal(result.status, "error");
    assert.equal(result.projectChanged, false);
    assert.ok(result.message);
    assert.equal(app.project, currentProject);
  }
});

test("successful switch selects, closes with save prompt, purges, then opens", () => {
  for (const name of ["Novo projeto.aep", "PROJETO.AEPX"]) {
    const { result, calls, app, openedProject } = runOpenProject({
      selectedFile: { name, exists: true },
    });
    assert.deepEqual(calls, ["dialog", "close", "purge", "open"]);
    assert.equal(result.status, "opened");
    assert.equal(result.projectChanged, true);
    assert.deepEqual(result.errors, []);
    assert.equal(app.project, openedProject);
  }
});

test("opening without a current project skips close and still refreshes", () => {
  const { result, calls } = runOpenProject({ noProject: true });
  assert.deepEqual(calls, ["dialog", "purge", "open"]);
  assert.equal(result.status, "opened");
  assert.equal(result.projectChanged, true);
});

test("a purge failure is reported while the selected project still opens", () => {
  const { result, calls, app, openedProject } = runOpenProject({
    purgeError: "cache unavailable",
  });
  assert.deepEqual(calls, ["dialog", "close", "purge", "open"]);
  assert.equal(result.status, "opened");
  assert.equal(result.projectChanged, true);
  assert.match(result.message, /não foi possível limpar/);
  assert.match(result.errors[0], /cache unavailable/);
  assert.equal(app.project, openedProject);
});

test("an open exception after close requests a refresh of the empty host", () => {
  const { result, calls, app } = runOpenProject({ openError: "invalid project data" });
  assert.deepEqual(calls, ["dialog", "close", "purge", "open"]);
  assert.equal(result.status, "error");
  assert.equal(result.projectChanged, true);
  assert.match(result.message, /abrir o projeto/);
  assert.match(result.errors[0], /invalid project data/);
  assert.equal(app.project, null);
});

test("null from app.open is not reported as success and clears old CEP data", () => {
  const { result, calls, app } = runOpenProject({ openReturnsNull: true });
  assert.deepEqual(calls, ["dialog", "close", "purge", "open"]);
  assert.equal(result.status, "error");
  assert.equal(result.projectChanged, true);
  assert.match(result.message, /não abriu/);
  assert.equal(app.project, null);
});

test("dialog and close exceptions are contained without purge or opening", () => {
  for (const [options, expectedCalls] of [
    [{ dialogError: "dialog unavailable" }, ["dialog"]],
    [{ closeError: "save failed" }, ["dialog", "close"]],
  ]) {
    const { result, calls, app, currentProject } = runOpenProject(options);
    assert.deepEqual(calls, expectedCalls);
    assert.equal(result.status, "error");
    assert.equal(result.projectChanged, false);
    assert.equal(result.errors.length, 1);
    assert.equal(app.project, currentProject);
  }
});

test("purge warnings survive an opening error", () => {
  const { result } = runOpenProject({
    purgeError: "cache unavailable", openError: "invalid project data",
  });
  assert.equal(result.status, "error");
  assert.equal(result.projectChanged, true);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /cache unavailable/);
  assert.match(result.errors[1], /invalid project data/);
});
