import { fs } from "../../../../lib/cep/node";
import {
  extractPsdThumbnailPreview,
  renderPsdCompositePreview,
} from "../productImages/services/psdPreview";
import { renderWindowsShellThumbnail } from "../productImages/services/windowsThumbnail";
import { readPrewarmedPreviewDataUrl } from "../productImages/services/prewarmedPreview";
import { getMessage } from "../../../utils/errors";

const RASTER_MIME_TYPES = new Map([
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const getExtension = (filePath: string) => {
  const normalized = filePath.toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");

  return dotIndex >= 0 ? normalized.substring(dotIndex) : "";
};

export const isRasterOfferImage = (filePath: string) =>
  RASTER_MIME_TYPES.has(getExtension(filePath));

export const isPsdFile = (filePath: string) => {
  const extension = getExtension(filePath);

  return extension === ".psd" || extension === ".psb";
};

export const createOfferRasterPreview = (filePath: string) => {
  const prewarmedPreview = readPrewarmedPreviewDataUrl(filePath);
  if (prewarmedPreview) return prewarmedPreview;

  const mimeType = RASTER_MIME_TYPES.get(getExtension(filePath));

  if (!mimeType) {
    throw new Error("Formato de imagem nao suportado.");
  }

  const buffer = fs.readFileSync(filePath);

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

export const createOfferPsdPreview = async (filePath: string) => {
  const prewarmedPreview = readPrewarmedPreviewDataUrl(filePath);
  if (prewarmedPreview) return prewarmedPreview;

  const buffer = fs.readFileSync(filePath);
  let thumbnail: ReturnType<typeof extractPsdThumbnailPreview> = undefined;
  let parserError = "";

  try {
    thumbnail = extractPsdThumbnailPreview(buffer);
  } catch (caught) {
    parserError = getMessage(caught);
  }

  try {
    const composite = renderPsdCompositePreview(buffer, 900);

    return composite.dataUrl;
  } catch (caught) {
    parserError = parserError || getMessage(caught);
  }

  if (thumbnail) {
    return thumbnail.dataUrl;
  }

  try {
    const shellThumbnail = await renderWindowsShellThumbnail(filePath, 900);

    return shellThumbnail.dataUrl;
  } catch (caught) {
    throw new Error(parserError || getMessage(caught));
  }
};
