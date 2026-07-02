import { path as nodePath } from "../../../../lib/cep/node";
import type { AerenderOutputPlan } from "../types";

interface SaveDialogResult {
  data: string;
  err: number;
}

const getExtension = (output: AerenderOutputPlan): string => {
  const extension = nodePath.extname(output.outputPath).replace(".", "");
  return extension || output.id;
};

export const chooseRenderOutputPath = (
  output: AerenderOutputPlan
): string | null => {
  if (!window.cep?.fs?.showSaveDialogEx) {
    return null;
  }

  const extension = getExtension(output);
  const result = window.cep.fs.showSaveDialogEx(
    `Escolher saida ${output.label}`,
    nodePath.dirname(output.outputPath),
    [extension],
    nodePath.basename(output.outputPath),
    `${output.label} (*.${extension})`,
    "Salvar",
    "Arquivo:"
  ) as SaveDialogResult;

  if (result.err !== window.cep.fs.NO_ERROR || !result.data) {
    return null;
  }

  return result.data;
};
