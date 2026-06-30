import { getCurrentWindow } from "@tauri-apps/api/window";

const SECONDARY_ROUTE_VIEWS = Object.freeze([
  "secondary",
  "duplicate",
  "duplicate-identical",
  "history",
  "places",
  "media",
  "midia",
  "products",
  "produtos",
  "products-log",
  "admin",
  "settings",
  "config",
  "configuracoes",
]);

export function isSecondaryWindowRoute() {
  try {
    const view = new URLSearchParams(window.location.search).get("view");
    return SECONDARY_ROUTE_VIEWS.includes(view);
  } catch {
    return false;
  }
}

export function currentWindowLabel() {
  try {
    return getCurrentWindow().label || "";
  } catch {
    return "";
  }
}
