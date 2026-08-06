import {
  crypto,
  fs,
  path as nodePath,
} from "../../../../../lib/cep/node";
import type { LocalImage } from "../types";
import { getPreviewCacheDirectory } from "./previewCache";

const SHARED_CACHE_VERSION_DIRECTORY = "prewarmed-v1";
const CACHE_FILES_DIRECTORY = "files";
const PREVIEW_SIZE = 512;

const normalizeSourcePath = (filePath: string) =>
  nodePath.resolve(filePath).replace(/\//g, "\\").toLowerCase();

const createCacheKey = (
  filePath: string,
  size: number,
  modifiedAtMs: number
) =>
  crypto
    .createHash("sha256")
    .update(
      [
        normalizeSourcePath(filePath),
        String(size),
        String(Math.trunc(modifiedAtMs)),
        String(PREVIEW_SIZE),
      ].join("\u001f")
    )
    .digest("hex");

const resolvePrewarmedPreviewPath = (
  filePath: string,
  size: number,
  modifiedAtMs: number
) =>
  nodePath.join(
    getPreviewCacheDirectory(),
    SHARED_CACHE_VERSION_DIRECTORY,
    CACHE_FILES_DIRECTORY,
    `${createCacheKey(filePath, size, modifiedAtMs)}.png`
  );

export const readPrewarmedPreviewDataUrl = (
  filePath: string,
  knownSize?: number,
  knownModifiedAtMs?: number
): string | undefined => {
  try {
    const stats =
      typeof knownSize === "number" && typeof knownModifiedAtMs === "number"
        ? null
        : fs.statSync(filePath);
    const previewPath = resolvePrewarmedPreviewPath(
      filePath,
      knownSize ?? stats?.size ?? 0,
      knownModifiedAtMs ?? stats?.mtimeMs ?? 0
    );

    if (!fs.existsSync(previewPath)) return undefined;

    return `data:image/png;base64,${fs
      .readFileSync(previewPath)
      .toString("base64")}`;
  } catch {
    return undefined;
  }
};

export const readPrewarmedPreview = (
  image: LocalImage
): Partial<LocalImage> | undefined => {
  const previewUrl = readPrewarmedPreviewDataUrl(
    image.fullPath,
    image.size,
    image.modifiedAt
  );

  if (!previewUrl) return undefined;

  return {
    previewUrl,
    previewStatus: "ready",
    previewSource: "prewarmed-cache",
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
  };
};
