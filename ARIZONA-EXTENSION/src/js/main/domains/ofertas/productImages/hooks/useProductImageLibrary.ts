import { useCallback, useState } from "react";
import { fs } from "../../../../../lib/cep/node";
import { loadProjectProductsDirectory } from "../services/projectProductsDirectory";
import { clearPreviewCache } from "../services/previewCache";
import { recordDiagnosticFailure } from "../../../../services/localDiagnostics";
import type { LocalImage } from "../types";
import {
  isNodeAvailable,
  normalizePathInput,
  scanImageDirectory,
} from "../utils/imageFiles";

export const useProductImageLibrary = () => {
  const [images, setImages] = useState<LocalImage[]>([]);

  const hasNodeAccess = isNodeAvailable();

  const updateImage = useCallback(
    (fullPath: string, patch: Partial<LocalImage>) => {
      setImages((current) =>
        current.map((image) =>
          image.fullPath === fullPath ? { ...image, ...patch } : image
        )
      );
    },
    []
  );

  const scanDirectory = useCallback(
    (targetDirectory: string) => {
      if (!hasNodeAccess) {
        setImages([]);
        return;
      }

      const normalizedDirectory = normalizePathInput(targetDirectory);

      try {
        if (!normalizedDirectory) {
          throw new Error("Informe um path para carregar os arquivos.");
        }

        if (!fs.existsSync(normalizedDirectory)) {
          throw new Error("Path nao encontrado.");
        }

        const directoryStats = fs.statSync(normalizedDirectory);
        if (!directoryStats.isDirectory()) {
          throw new Error("O path informado nao e uma pasta.");
        }

        const nextImages = scanImageDirectory(normalizedDirectory);

        setImages(nextImages);
      } catch (caught) {
        setImages([]);
        recordDiagnosticFailure(
          "previews",
          "ler_pasta_produtos",
          "Não foi possível ler a pasta de imagens dos produtos.",
          caught,
          { code: "product_images_scan_failed" }
        );
      }
    },
    [hasNodeAccess]
  );

  const scanProjectProductsDirectory = useCallback(async () => {
    if (!hasNodeAccess) {
      setImages([]);
      return;
    }

    try {
      const productsDirectory = await loadProjectProductsDirectory();
      scanDirectory(productsDirectory);
    } catch (caught) {
      setImages([]);
      recordDiagnosticFailure(
        "previews",
        "localizar_pasta_produtos",
        "Não foi possível localizar a pasta de produtos do projeto.",
        caught,
        { code: "project_products_directory_failed", runtime: "extendscript" }
      );
    }
  }, [hasNodeAccess, scanDirectory]);

  const clearProductImagePreviewCache = useCallback(async () => {
    if (!hasNodeAccess) {
      return { directory: "", removedCount: 0 };
    }

    const result = clearPreviewCache();

    setImages((current) =>
      current.map((image) => ({
        ...image,
        previewUrl: undefined,
        previewStatus: "idle",
        previewSource: undefined,
        width: undefined,
        height: undefined,
        error: undefined,
      }))
    );

    return result;
  }, [hasNodeAccess]);

  return {
    images,
    hasNodeAccess,
    clearProductImagePreviewCache,
    scanProjectProductsDirectory,
    updateImage,
  };
};
