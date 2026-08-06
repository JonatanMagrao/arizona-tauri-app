export type ImageKind = "png" | "psd";
export type PreviewStatus = "idle" | "loading" | "ready" | "error";
export type PreviewSource =
  | "png"
  | "psd-thumbnail"
  | "psd-composite"
  | "prewarmed-cache"
  | "windows-thumbnail";

export interface LocalImage {
  fullPath: string;
  name: string;
  extension: string;
  kind: ImageKind;
  size: number;
  modifiedAt: number;
  previewUrl?: string;
  previewStatus: PreviewStatus;
  previewSource?: PreviewSource;
  width?: number;
  height?: number;
  error?: string;
}
