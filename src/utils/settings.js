export const DEFAULT_SETTINGS = Object.freeze({
  aeVersion: "2026",
  moveLayersBackwardShortcut: "Ctrl+Numpad1",
  moveLayersForwardShortcut: "Ctrl+Numpad3",
  moveJumpMarkerShortcut: "Ctrl+Numpad2",
  selectJumpMarkerLayerShortcut: "Ctrl+Numpad0",
  adjustMarkersShortcut: "Ctrl+NumpadDecimal",
  swapLayersShortcut: "Ctrl+Numpad5",
  exportPrintFramesShortcut: "Ctrl+Numpad6",
  exportPrintCompName: "EXPORT",
  renderShortcut: "Ctrl+NumpadEnter",
  renderMovTemplateName: "PROXY",
  renderMp4TemplateName: "MP4",
  drive: "",
  produtos: "PRODUTOS",
  produtosYear: "",
  produtosPath: "",
});

export function normalizeSettings(config) {
  const next = { ...DEFAULT_SETTINGS, ...(config || {}) };
  return {
    ...next,
    aeVersion: normalizeFourDigits(next.aeVersion),
    moveLayersBackwardShortcut: String(next.moveLayersBackwardShortcut ?? "").trim(),
    moveLayersForwardShortcut: String(next.moveLayersForwardShortcut ?? "").trim(),
    moveJumpMarkerShortcut: String(next.moveJumpMarkerShortcut ?? "").trim(),
    selectJumpMarkerLayerShortcut: String(next.selectJumpMarkerLayerShortcut ?? "").trim(),
    adjustMarkersShortcut: String(next.adjustMarkersShortcut ?? "").trim(),
    swapLayersShortcut: String(next.swapLayersShortcut ?? "").trim(),
    exportPrintFramesShortcut: String(next.exportPrintFramesShortcut ?? "").trim(),
    exportPrintCompName: String(next.exportPrintCompName ?? "").trim(),
    renderShortcut: String(next.renderShortcut ?? "").trim(),
    renderMovTemplateName: String(next.renderMovTemplateName ?? "").trim(),
    renderMp4TemplateName: String(next.renderMp4TemplateName ?? "").trim(),
    drive: String(next.drive ?? "").trim(),
    produtosYear: normalizeProductsYear(next.produtosYear),
    produtosPath: String(next.produtosPath ?? "").trim(),
  };
}

export function missingRequiredPaths(config) {
  const missing = [];
  if (!String(config?.drive ?? "").trim()) missing.push("Carrefour Drive");
  if (!String(config?.produtosPath ?? "").trim()) missing.push("Fotos Flow");
  return missing;
}

export function normalizeProductsYear(value) {
  const text = normalizeFourDigits(value);
  if (String(value ?? "").trim().toLowerCase() === "auto") return "";
  return text;
}

export function normalizeFourDigits(value) {
  const text = String(value ?? "").trim();
  return text.replace(/\D/g, "").slice(0, 4);
}

export function isSettingsReady(config) {
  const aeVersion = String(config?.aeVersion ?? "").trim();
  const year = String(config?.produtosYear ?? "").trim();
  return Boolean(
    missingRequiredPaths(config).length === 0
      && /^\d{4}$/.test(aeVersion)
      && String(config?.produtos ?? "").trim()
      && String(config?.exportPrintCompName ?? "").trim()
      && String(config?.renderMovTemplateName ?? "").trim()
      && String(config?.renderMp4TemplateName ?? "").trim()
      && !isIncompleteDriveEntrypoint(config?.drive)
      && (year === "" || /^\d{4}$/.test(year))
  );
}

function isIncompleteDriveEntrypoint(value) {
  const parts = String(value ?? "")
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";
  return !lastPart || lastPart.toLowerCase() === "drives compartilhados";
}
