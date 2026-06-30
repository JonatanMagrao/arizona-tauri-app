export const DEFAULT_SETTINGS = Object.freeze({
  aeVersion: "2024",
  drive: "I:\\Drives compartilhados\\Phx CRF Copa",
  produtos: "PRODUTOS",
  produtosYear: "",
  produtosPath: "I:\\Drives compartilhados\\Phx CRF Copa\\CARREFOUR\\ASSETS\\_FOTOS FLOW",
});

export function normalizeSettings(config) {
  const next = { ...DEFAULT_SETTINGS, ...(config || {}) };
  return {
    ...next,
    produtosYear: normalizeProductsYear(next.produtosYear),
    produtosPath: String(next.produtosPath ?? "").trim(),
  };
}

export function normalizeProductsYear(value) {
  const text = String(value ?? "").trim();
  if (text.toLowerCase() === "auto") return "";
  return text.replace(/\D/g, "").slice(0, 4);
}

export function isSettingsReady(config) {
  const year = String(config?.produtosYear ?? "").trim();
  return Boolean(
    String(config?.drive ?? "").trim()
      && String(config?.produtosPath ?? "").trim()
      && String(config?.aeVersion ?? "").trim()
      && String(config?.produtos ?? "").trim()
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
