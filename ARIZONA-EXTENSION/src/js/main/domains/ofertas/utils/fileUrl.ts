const RENDERABLE_IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const getExtension = (filePath: string) => {
  const normalized = filePath.toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");

  return dotIndex >= 0 ? normalized.substring(dotIndex) : "";
};

export const canRenderOfferImage = (filePath: string) =>
  RENDERABLE_IMAGE_EXTENSIONS.has(getExtension(filePath));

export const toFileUrl = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/");
  const encoded = encodeURI(normalized).replace(/#/g, "%23");

  if (/^[a-zA-Z]:\//.test(normalized)) {
    return "file:///" + encoded;
  }

  return "file://" + encoded;
};
