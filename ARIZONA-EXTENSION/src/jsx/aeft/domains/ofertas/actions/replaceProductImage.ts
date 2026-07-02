import type { OfferEditorActionResult } from "../types";
import {
  getOfferByLayerIndex,
  openOfferSourceInViewer,
} from "../layers/findLayers";
import { generateOfferData } from "../snapshot/buildOfferSnapshot";
import { createActionResult } from "./shared";

export const replaceOfferProductImage = (
  offerLayerIndex: number,
  productIndex: number,
  filePath: string,
  openOfferPrecomp?: boolean
): OfferEditorActionResult => {
  const result = createActionResult();
  const offer = getOfferByLayerIndex(offerLayerIndex, result);

  if (offer === null) return result;

  app.beginUndoGroup("Substituir imagem da oferta");

  try {
    const details = generateOfferData(offer);
    const product = details.products[productIndex];
    result.errors = details.errors.slice(0);

    if (!product) {
      throw new Error("Produto da oferta nao encontrado.");
    }

    const imageLayer = product.imageLayer;

    if (imageLayer === null || !(imageLayer instanceof AVLayer)) {
      throw new Error("Layer de imagem da oferta nao encontrada.");
    }

    const footage = getOrImportFootage(filePath);

    imageLayer.replaceSource(footage, false);
    imageLayer.name = footage.name;

    if (openOfferPrecomp === true) {
      openOfferSourceInViewer(offer);
    }

    result.ok = true;
    result.selectedOfferLayerIndex = offer.index;
    result.message = "Imagem da oferta substituida por " + footage.name + ".";
  } catch (error) {
    result.message =
      error instanceof Error
        ? error.message
        : "Erro ao substituir imagem da oferta.";
    result.errors.push(result.message);
  } finally {
    app.endUndoGroup();
  }

  return result;
};

const getOrImportFootage = (filePath: string): FootageItem => {
  const file = new File(filePath);

  if (!file.exists) {
    throw new Error("Arquivo de imagem nao encontrado.");
  }

  if (app.project === null) {
    throw new Error("Nenhum projeto aberto.");
  }

  const existingFootage = findImportedFootageByFile(file);

  if (existingFootage !== null) return existingFootage;

  const importOptions = new ImportOptions(file);

  if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
    importOptions.importAs = ImportAsType.FOOTAGE;
  }

  return app.project.importFile(importOptions);
};

const findImportedFootageByFile = (file: File): FootageItem | null => {
  if (app.project === null) return null;

  const targetPath = file.fsName;

  for (let index = 1; index <= app.project.numItems; index += 1) {
    const item = app.project.item(index);

    if (!(item instanceof FootageItem)) continue;

    try {
      if (
        item.mainSource instanceof FileSource &&
        item.mainSource.file.fsName === targetPath
      ) {
        return item;
      }
    } catch (error) {
    }
  }

  return null;
};
