import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/js/lib/utils/bolt.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const schemaSuffix = "/js/assets/schema.json";
const identitiesSuffix = "/js/assets/template-identities.json";
const plain = (value) => JSON.parse(JSON.stringify(value));

// Run the production bootstrap and evalTS bridge against a serial host queue.
// The host namespace becomes available only when its script is evaluated.
function harness({ cep = true, extensionRoot = "C:/Arizona CEP", script = "index.js" } = {}) {
  const requests = [];
  const events = [];
  const alerts = [];
  const loadPath = `${extensionRoot}/jsx/${script}`;
  let configuredPath;
  let configuredIdentitiesPath;
  let initializeCount = 0;
  const host = {
    evalFile(filePath) {
      events.push(["load", filePath]);
      assert.equal(filePath, loadPath);
      host.arizona = {
        configureMechanicsSchemaPath(schemaPath) {
          configuredPath = schemaPath;
          events.push(["configure", schemaPath]);
          return { ok: true };
        },
        configureTemplateIdentitiesPath(identitiesPath) {
          configuredIdentitiesPath = identitiesPath;
          events.push(["configure-identities", identitiesPath]);
        },
        getOffersEditorSnapshot() {
          events.push(["snapshot", configuredPath, configuredIdentitiesPath]);
          return { ok: true, schemaPath: configuredPath, identitiesPath: configuredIdentitiesPath };
        },
      };
    },
  };
  const hostContext = vm.createContext({ $, JSON, alert: (value) => alerts.push(value) });
  function $(...args) { return args; }
  Object.assign($, host);
  // evalFile assigns the namespace to the same $ object used by evalTS.
  $.evalFile = (filePath) => {
    host.evalFile(filePath);
    $.arizona = host.arizona;
  };
  class CSInterface {
    getSystemPath(kind) { assert.equal(kind, "extension"); return extensionRoot; }
    evalScript(code, callback) { requests.push({ code, callback }); }
  }
  const imports = {
    "../cep/csinterface": { default: CSInterface, CSEvent: class {} },
    "../cep/vulcan": { default: class {}, VulcanMessage: {} },
    "../../../shared/shared": { ns: "arizona" },
    "../cep/node": { fs: { existsSync: (candidate) => candidate === loadPath } },
    "./init-cep": { initializeCEP: () => { initializeCount += 1; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    window: { cep: cep ? {} : undefined },
    console: { log() {}, error() {} },
    require: (specifier) => {
      assert.ok(Object.hasOwn(imports, specifier), `Unexpected import: ${specifier}`);
      return imports[specifier];
    },
  });
  return {
    bridge: module.exports,
    requests,
    events,
    alerts,
    get initializeCount() { return initializeCount; },
    flush() {
      while (requests.length > 0) {
        const request = requests.shift();
        const result = vm.runInContext(request.code, hostContext);
        request.callback(result === undefined ? "undefined" : String(result));
      }
    },
  };
}

for (const script of ["index.js", "index.jsxbin"]) {
  test(`bootstrap ${script} loads and configures before a queued snapshot`, async () => {
    const extensionRoot = "C:/Arizona CEP/Área 'cliente' \"principal\"";
    const context = harness({ extensionRoot, script });
    context.bridge.initBolt(false);
    // initBolt keeps its existing synchronous UI contract. Host setup must be
    // atomic in its first request, ahead of calls queued by mounted panels.
    assert.equal(context.requests.length, 1);
    const snapshot = context.bridge.evalTS("getOffersEditorSnapshot");
    assert.equal(context.requests.length, 2);
    assert.equal(context.events.length, 0);
    context.flush();
    assert.deepEqual(context.events, [
      ["load", `${extensionRoot}/jsx/${script}`],
      ["configure", extensionRoot + schemaSuffix],
      ["configure-identities", extensionRoot + identitiesSuffix],
      ["snapshot", extensionRoot + schemaSuffix, extensionRoot + identitiesSuffix],
    ]);
    assert.deepEqual(plain(await snapshot), { ok: true, schemaPath: extensionRoot + schemaSuffix, identitiesPath: extensionRoot + identitiesSuffix });
    assert.deepEqual(context.alerts, []);
    assert.equal(context.initializeCount, 1);
  });
}

test("evalFile retains its standalone behavior and safely quotes a Windows path", async () => {
  const extensionRoot = "E:\\Arizona\\Área 'teste' \"aspas\"";
  const context = harness({ extensionRoot });
  const loading = context.bridge.evalFile(`${extensionRoot}/jsx/index.js`);
  context.flush();
  await loading;
  assert.deepEqual(context.events, [["load", `${extensionRoot}/jsx/index.js`]]);
  assert.deepEqual(context.alerts, []);
});

test("bootstrap remains inert without CEP", () => {
  const context = harness({ cep: false });
  context.bridge.initBolt(false);
  assert.equal(context.requests.length, 0);
  assert.equal(context.initializeCount, 0);
  assert.deepEqual(context.events, []);
});
