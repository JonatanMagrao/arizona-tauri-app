import { useCallback, useRef } from "react";
import { createPreviewPatch } from "../services/previewService";
import type { LocalImage } from "../types";
import { getPublicErrorMessage } from "../../../../utils/errors";
import { recordDiagnosticFailure } from "../../../../services/localDiagnostics";

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
          error: getPublicErrorMessage(
            caught,
            "Não foi possível mostrar esta imagem.",
          ),
        });
        recordDiagnosticFailure(
          "previews",
          "gerar_preview",
          "Não foi possível preparar a imagem de visualização de um produto.",
          caught,
          {
            code: "product_preview_failed",
            details: { fileType: image.extension || "unknown" },
          }
        );
      } finally {
        loadingPreviewPaths.current.delete(image.fullPath);
      }
    },
    [hasNodeAccess, updateImage]
  );

  return { loadImagePreview };
};
