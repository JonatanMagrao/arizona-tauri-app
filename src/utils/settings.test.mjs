import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  isSettingsReady,
  missingRequiredPaths,
  normalizeSettings,
} from "./settings.js";

test("leaves customer-specific folders empty on first use", () => {
  assert.equal(DEFAULT_SETTINGS.drive, "");
  assert.equal(DEFAULT_SETTINGS.produtosPath, "");
  assert.deepEqual(missingRequiredPaths(DEFAULT_SETTINGS), ["Carrefour Drive", "Fotos Flow"]);
  assert.equal(isSettingsReady(DEFAULT_SETTINGS), false);
});

test("preserves and normalizes previously saved customer folders", () => {
  const settings = normalizeSettings({
    drive: "  I:\\Drives compartilhados\\Cliente  ",
    produtosPath: "  I:\\Fotos Flow  ",
  });

  assert.equal(settings.drive, "I:\\Drives compartilhados\\Cliente");
  assert.equal(settings.produtosPath, "I:\\Fotos Flow");
  assert.deepEqual(missingRequiredPaths(settings), []);
});

test("uses backward-compatible defaults for local After Effects actions", () => {
  const settings = normalizeSettings({});

  assert.equal(settings.exportPrintCompName, "EXPORT");
  assert.equal(settings.renderMovTemplateName, "PROXY");
  assert.equal(settings.renderMp4TemplateName, "MP4");
});

test("normalizes custom local After Effects action names", () => {
  const settings = normalizeSettings({
    exportPrintCompName: "  PRINT_EXPORT  ",
    renderMovTemplateName: "  MOV CUSTOM  ",
    renderMp4TemplateName: "  H264 CUSTOM  ",
  });

  assert.equal(settings.exportPrintCompName, "PRINT_EXPORT");
  assert.equal(settings.renderMovTemplateName, "MOV CUSTOM");
  assert.equal(settings.renderMp4TemplateName, "H264 CUSTOM");
});

test("requires all local After Effects action names before settings are ready", () => {
  const configuredSettings = {
    ...DEFAULT_SETTINGS,
    drive: "I:\\Drives compartilhados\\Cliente",
    produtosPath: "I:\\Fotos Flow",
  };
  assert.equal(isSettingsReady(configuredSettings), true);

  for (const field of [
    "exportPrintCompName",
    "renderMovTemplateName",
    "renderMp4TemplateName",
  ]) {
    assert.equal(isSettingsReady({ ...configuredSettings, [field]: "" }), false);
  }
});
