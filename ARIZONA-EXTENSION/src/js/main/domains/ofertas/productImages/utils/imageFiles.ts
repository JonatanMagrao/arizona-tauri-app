import { fs, path as nodePath } from "../../../../../lib/cep/node";
import { SUPPORTED_EXTENSIONS } from "../constants";
import type { ImageKind, LocalImage } from "../types";

export const fileSorter = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export const isNodeAvailable = () =>
  typeof window.cep !== "undefined" && typeof fs.readdirSync === "function";

export const normalizePathInput = (value: string) =>
  value.trim().replace(/^"|"$/g, "");

export const getImageKind = (extension: string): ImageKind =>
  extension === ".psd" ? "psd" : "png";

export const buildLocalImage = (
  directory: string,
  entry: import("fs").Dirent
): LocalImage | undefined => {
  const fullPath = nodePath.join(directory, entry.name);
  const extension = nodePath.extname(entry.name).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return undefined;
  }

  const stats = fs.statSync(fullPath);

  return {
    fullPath,
    name: entry.name,
    extension,
    kind: getImageKind(extension),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    previewStatus: "idle",
  };
};

export const scanImageDirectory = (directory: string) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => buildLocalImage(directory, entry))
    .filter((image): image is LocalImage => Boolean(image))
    .sort((a, b) => fileSorter.compare(a.name, b.name));

export const readPngDataUrl = (filePath: string) => {
  const buffer = fs.readFileSync(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
};
