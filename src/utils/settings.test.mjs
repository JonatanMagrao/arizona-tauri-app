import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  isSettingsReady,
  normalizeSettings,
} from "./settings.js";

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
  assert.equal(isSettingsReady(DEFAULT_SETTINGS), true);

  for (const field of [
    "exportPrintCompName",
    "renderMovTemplateName",
    "renderMp4TemplateName",
  ]) {
    assert.equal(isSettingsReady({ ...DEFAULT_SETTINGS, [field]: "" }), false);
  }
});
