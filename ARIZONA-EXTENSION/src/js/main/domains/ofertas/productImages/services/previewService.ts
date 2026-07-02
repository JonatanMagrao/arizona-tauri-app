import { fs } from "../../../../../lib/cep/node";
import {
  extractPsdThumbnailPreview,
  renderPsdCompositePreview,
} from "./psdPreview";
import type { LocalImage } from "../types";
import { readPngDataUrl } from "../utils/imageFiles";
import { getMessage } from "../../../../utils/errors";
import { renderWindowsShellThumbnail } from "./windowsThumbnail";

export const createPreviewPatch = async (
  image: LocalImage
): Promise<Partial<LocalImage>> => {
  if (image.kind === "png") {
    return {
      previewUrl: readPngDataUrl(image.fullPath),
      previewStatus: "ready",
      previewSource: "png",
    };
  }

  const buffer = fs.readFileSync(image.fullPath);
  let thumbnail: ReturnType<typeof extractPsdThumbnailPreview> = undefined;
  let parserError = "";

  try {
    thumbnail = extractPsdThumbnailPreview(buffer);
  } catch (caught) {
    parserError = getMessage(caught);
  }

  try {
    const composite = renderPsdCompositePreview(buffer, 1800);

    return {
      previewUrl: composite.dataUrl,
      previewStatus: "ready",
      previewSource: "psd-composite",
      width: composite.width,
      height: composite.height,
    };
  } catch (caught) {
    parserError = parserError || getMessage(caught);
  }

  if (thumbnail) {
    return {
      previewUrl: thumbnail.dataUrl,
      previewStatus: "ready",
      previewSource: "psd-thumbnail",
      width: thumbnail.width,
      height: thumbnail.height,
    };
  }

  try {
    const shellThumbnail = await renderWindowsShellThumbnail(image.fullPath);

    return {
      previewUrl: shellThumbnail.dataUrl,
      previewStatus: "ready",
      previewSource: "windows-thumbnail",
      width: shellThumbnail.width,
      height: shellThumbnail.height,
    };
  } catch (caught) {
    throw new Error(parserError || getMessage(caught));
  }
};
