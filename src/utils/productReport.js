export function parseProductImportReport(value) {
  if (!value) return null;
  if (typeof value === "object") return normalizeProductReport(value);

  try {
    return normalizeProductReport(JSON.parse(value));
  } catch {
    return null;
  }
}

export function normalizeProductReport(value) {
  if (!value || typeof value !== "object") return null;

  const groups = toArray(value.groups).map((group) => ({
    folderName: String(group?.folderName || group?.folder_name || "").trim(),
    importedFiles: toArray(group?.importedFiles || group?.imported_files).map(String),
    existingFiles: toArray(group?.existingFiles || group?.existing_files).map(String),
    notFoundFiles: toArray(group?.notFoundFiles || group?.not_found_files).map(String),
  }));

  return {
    jobaoCod: String(value.jobaoCod || value.jobao_cod || "").trim(),
    productPath: String(value.productPath || value.product_path || "").trim(),
    sourcePath: String(value.sourcePath || value.source_path || "").trim(),
    importedFiles: toArray(value.importedFiles || value.imported_files).map(String),
    existingFiles: toArray(value.existingFiles || value.existing_files).map(String),
    notFoundFiles: toArray(value.notFoundFiles || value.not_found_files).map(String),
    groups,
    totalProcessed: numberOrZero(value.totalProcessed ?? value.total_processed),
    totalImported: numberOrZero(value.totalImported ?? value.total_imported),
    totalExisting: numberOrZero(value.totalExisting ?? value.total_existing),
    totalNotFound: numberOrZero(value.totalNotFound ?? value.total_not_found),
    durationMillis: numberOrZero(value.durationMillis ?? value.duration_millis),
  };
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
