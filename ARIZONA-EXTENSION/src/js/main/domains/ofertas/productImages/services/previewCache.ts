import {
  fs,
  os,
  path as nodePath,
} from "../../../../../lib/cep/node";

const APP_CACHE_DIRECTORY_NAME = "Arizona Carrefour";
const PANEL_CACHE_DIRECTORY_NAME = "Product Viewer";
const PREVIEW_CACHE_DIRECTORY_NAME = "preview-cache";

export interface ClearPreviewCacheResult {
  directory: string;
  removedCount: number;
}

const getAppDataDirectory = () => {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return localAppData;

  const appData = process.env.APPDATA;
  if (appData) return appData;

  try {
    return nodePath.join(os.homedir(), "AppData", "Local");
  } catch {
    return os.tmpdir();
  }
};

export const getPreviewCacheDirectory = () =>
  nodePath.join(
    getAppDataDirectory(),
    APP_CACHE_DIRECTORY_NAME,
    PANEL_CACHE_DIRECTORY_NAME,
    PREVIEW_CACHE_DIRECTORY_NAME
  );

export const ensurePreviewCacheDirectory = () => {
  const directory = getPreviewCacheDirectory();

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return directory;
};

const removeCacheEntry = (targetPath: string): number => {
  const stats = fs.lstatSync(targetPath);

  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    let removedCount = 0;
    const children = fs.readdirSync(targetPath);

    for (let index = 0; index < children.length; index += 1) {
      removedCount += removeCacheEntry(nodePath.join(targetPath, children[index]));
    }

    fs.rmdirSync(targetPath);
    return removedCount + 1;
  }

  fs.unlinkSync(targetPath);
  return 1;
};

export const clearPreviewCache = (): ClearPreviewCacheResult => {
  const directory = ensurePreviewCacheDirectory();
  const entries = fs.readdirSync(directory);
  let removedCount = 0;

  for (let index = 0; index < entries.length; index += 1) {
    removedCount += removeCacheEntry(nodePath.join(directory, entries[index]));
  }

  return { directory, removedCount };
};
