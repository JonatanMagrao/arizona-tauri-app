import { useCallback, useRef } from "react";
import { createPreviewPatch } from "../services/previewService";
import type { LocalImage } from "../types";
import { getMessage } from "../../../../utils/errors";

interface UseImagePreviewsOptions {
  hasNodeAccess: boolean;
  updateImage: (fullPath: string, patch: Partial<LocalImage>) => void;
}

export const useProductImagePreviews = ({
  hasNodeAccess,
  updateImage,
}: UseImagePreviewsOptions) => {
  const loadingPreviewPaths = useRef(new Set<string>());

  const loadImagePreview = useCallback(
    async (image: LocalImage) => {
      if (!hasNodeAccess) return;
      if (loadingPreviewPaths.current.has(image.fullPath)) return;

      loadingPreviewPaths.current.add(image.fullPath);

      updateImage(image.fullPath, {
        previewStatus: "loading",
        error: undefined,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 20));

      try {
        updateImage(image.fullPath, await createPreviewPatch(image));
      } catch (caught) {
        updateImage(image.fullPath, {
          previewStatus: "error",
          error: getMessage(caught),
        });
      } finally {
        loadingPreviewPaths.current.delete(image.fullPath);
      }
    },
    [hasNodeAccess, updateImage]
  );

  return { loadImagePreview };
};
