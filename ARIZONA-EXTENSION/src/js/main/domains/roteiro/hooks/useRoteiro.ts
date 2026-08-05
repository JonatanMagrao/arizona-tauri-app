import { useCallback, useEffect, useState } from "react";
import { fs } from "../../../../lib/cep/node";
import { getMessage } from "../../../utils/errors";
import { chooseRoteiroFile as openRoteiroFileDialog } from "../services/roteiroFileDialog";
import { loadProjectRoteiroInfo } from "../services/roteiroService";
import {
  loadOffersFirstProductInfo,
  openValidatedOfferPrecomp,
  updateValidatedOfferField,
} from "../services/offersValidationService";
import {
  loadProjectWavFootageInfo,
  replaceProjectWavFootage,
  openProjectAudioDialogAndReplace,
} from "../services/audioService";
import {
  adjustTimelineMarkersToTail,
  openTimelineCompPreview,
} from "../services/markerService";
import { queueActiveCompRenderOutputs } from "../services/renderService";
import {
  getRoteiroFile,
  isNodeAvailable,
  scanRoteiroDirectory,
} from "../utils/roteiroFiles";
import { scanAudioDirectory } from "../utils/audioFiles";
import { readDocxText } from "../utils/docxReader";
import type {
  OfferValidationFieldKey,
  OfferValidationFieldRef,
  OfferValidationInfo,
  RoteiroFile,
} from "../types";

export interface RoteiroToast {
  text: string;
  variant: "success" | "warning" | "error";
  autoDismiss: boolean;
}

interface RoteiroAudioContext {
  audioBounceDir: string;
  projectName: string;
  roteiroRegions: string[];
}

interface LoadedRoteiroData {
  fileName: string;
  content: string;
  offerValidationInfos: OfferValidationInfo[];
  audioContext: RoteiroAudioContext;
}

interface RoteiroSelectionContext {
  roteiroDirectory: string;
  projectName: string;
}

interface RequestedRoteiroFile {
  fullPath: string;
  expectedContext: RoteiroSelectionContext;
}

class RoteiroSelectionRequiredError extends Error {
  constructor(
    readonly context: RoteiroSelectionContext,
    message =
      "Não encontramos automaticamente o roteiro deste projeto. Escolha o arquivo .docx para continuar."
  ) {
    super(message);
    this.name = "RoteiroSelectionRequiredError";
  }
}

const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

const manualRoteiroSelections = new Map<string, string>();

const getSelectionKey = (context: RoteiroSelectionContext): string =>
  `${normPath(context.roteiroDirectory)}::${context.projectName.toLowerCase()}`;

const readRoteiroTarget = (
  target: RoteiroFile | null | undefined
): { target: RoteiroFile; content: string } | null => {
  if (!target) return null;

  try {
    const content = readDocxText(target.fullPath);
    return content.trim() ? { target, content } : null;
  } catch {
    return null;
  }
};

const deriveAudioBounceDir = (roteiroDirectory: string): string =>
  roteiroDirectory
    .replace(/\\/g, "/")
    .replace(/\/ROTEIRO$/i, "/AUDIO/BOUNCE");

const isAudioToast = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    lower.includes("udio") ||
    lower.includes(".wav") ||
    lower.includes("bounce")
  );
};

export const useRoteiro = () => {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [offerValidationInfos, setOfferValidationInfos] = useState<
    OfferValidationInfo[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [audioUpdating, setAudioUpdating] = useState(false);
  const [markerAdjusting, setMarkerAdjusting] = useState(false);
  const [renderQueueLoading, setRenderQueueLoading] = useState(false);
  const [offerActionLoading, setOfferActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<RoteiroToast | null>(null);
  const [selectionContext, setSelectionContext] =
    useState<RoteiroSelectionContext | null>(null);
  const [audioContext, setAudioContext] = useState<RoteiroAudioContext | null>(
    null
  );

  const hasNodeAccess = isNodeAvailable();

  const showToast = (
    text: string,
    variant: RoteiroToast["variant"] = "success",
    autoDismiss = true
  ) =>
    setToast({
      text,
      variant,
      autoDismiss: autoDismiss && !isAudioToast(text),
    });

  const dismissToast = () => setToast(null);

  const clearRoteiroState = useCallback(() => {
    setContent("");
    setFileName("");
    setOfferValidationInfos([]);
    setAudioContext(null);
  }, []);

  const applyLoadedRoteiroData = useCallback((data: LoadedRoteiroData) => {
    setFileName(data.fileName);
    setContent(data.content);
    setOfferValidationInfos(data.offerValidationInfos);
    setAudioContext(data.audioContext);
  }, []);

  useEffect(() => {
    if (!toast || !toast.autoDismiss) return;

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const getValidationField = (
    info: OfferValidationInfo,
    fieldKey: OfferValidationFieldKey
  ): OfferValidationFieldRef | undefined => {
    if (fieldKey === "price") return info.priceField;
    if (fieldKey === "de") return info.deField;
    if (fieldKey === "por") return info.porField;
    if (fieldKey === "leve") return info.leveField;
    return info.pagueField;
  };

  const validateAndUpdateAudio = async (
    audioBounceDir: string,
    projectName: string,
    roteiroRegions: string[]
  ) => {
    try {
      const wavInfo = await loadProjectWavFootageInfo();

      if (wavInfo.count === 0) {
        showToast("Nenhum arquivo .wav encontrado no projeto.", "warning");
        return;
      }

      if (wavInfo.count > 1) {
        showToast(
          "Múltiplos arquivos .wav encontrados no projeto. Atualize o áudio manualmente.",
          "warning"
        );
        return;
      }

      if (!fs.existsSync(audioBounceDir)) {
        showToast("Pasta AUDIO/BOUNCE não encontrada.", "warning");
        return;
      }

      const audioFiles = scanAudioDirectory(
        audioBounceDir,
        projectName,
        roteiroRegions
      );
      const matched = audioFiles.find((f) => f.matched);

      if (!matched) {
        const result = await openProjectAudioDialogAndReplace(audioBounceDir);
        if (result.replaced) {
          showToast(`Áudio atualizado: ${result.fileName}`);
        }
        return;
      }

      if (normPath(wavInfo.path) === normPath(matched.fullPath)) {
        showToast(`Audio ja atualizado: ${matched.name}`);
        return;
      }

      const result = await replaceProjectWavFootage(matched.fullPath);
      if (result.ok) {
        showToast(`Áudio atualizado: ${result.fileName}`);
      } else {
        showToast("Não foi possível atualizar o áudio.", "error");
      }
    } catch {
      showToast("Nao foi possivel atualizar o audio.", "error");
    }
  };

  const readCurrentRoteiroData = useCallback(
    async (selectedFile?: RequestedRoteiroFile): Promise<LoadedRoteiroData> => {
      const [{ roteiroDirectory, projectName }, offerInfos] =
        await Promise.all([
          loadProjectRoteiroInfo(),
          loadOffersFirstProductInfo(),
        ]);

      if (!hasNodeAccess) {
        throw new Error("Acesso ao sistema de arquivos nao disponivel.");
      }

      if (!fs.existsSync(roteiroDirectory)) {
        throw new Error("Pasta ROTEIRO nao encontrada.");
      }

      const context = { roteiroDirectory, projectName };
      const selectionKey = getSelectionKey(context);

      if (
        selectedFile &&
        getSelectionKey(selectedFile.expectedContext) !== selectionKey
      ) {
        throw new RoteiroSelectionRequiredError(
          context,
          "O projeto mudou enquanto o arquivo era escolhido. Escolha o roteiro do projeto atual."
        );
      }

      const files = scanRoteiroDirectory(roteiroDirectory, projectName);
      const automaticTarget = files.find((file) => file.matched);
      const selectedTarget = selectedFile
        ? getRoteiroFile(selectedFile.fullPath, projectName)
        : null;
      const savedSelectionPath = manualRoteiroSelections.get(selectionKey);
      const savedTarget = savedSelectionPath
        ? getRoteiroFile(savedSelectionPath, projectName)
        : null;

      if (savedSelectionPath && !savedTarget) {
        manualRoteiroSelections.delete(selectionKey);
      }

      let readableTarget = selectedFile
        ? readRoteiroTarget(selectedTarget)
        : readRoteiroTarget(automaticTarget);

      if (!selectedFile && !readableTarget && savedTarget) {
        const isSameAsAutomatic =
          automaticTarget &&
          normPath(automaticTarget.fullPath) === normPath(savedTarget.fullPath);

        if (!isSameAsAutomatic) {
          readableTarget = readRoteiroTarget(savedTarget);
        }

        if (!readableTarget) {
          manualRoteiroSelections.delete(selectionKey);
        }
      }

      if (!readableTarget) {
        const unreadableFileFound = selectedFile
          ? true
          : Boolean(automaticTarget || savedTarget);

        throw new RoteiroSelectionRequiredError(
          context,
          unreadableFileFound
            ? "Não conseguimos ler o roteiro encontrado. Escolha outro arquivo .docx."
            : undefined
        );
      }

      const { target, content: roteiroContent } = readableTarget;

      const data: LoadedRoteiroData = {
        fileName: target.name,
        content: roteiroContent,
        offerValidationInfos: offerInfos,
        audioContext: {
          audioBounceDir: deriveAudioBounceDir(roteiroDirectory),
          projectName,
          roteiroRegions: target.regions,
        },
      };

      if (selectedFile) {
        manualRoteiroSelections.set(selectionKey, target.fullPath);
      }

      return data;
    },
    [hasNodeAccess]
  );

  const showRoteiroLoadError = useCallback((caught: unknown) => {
    const message = getMessage(caught);
    setError(message);
    setSelectionContext(
      caught instanceof RoteiroSelectionRequiredError ? caught.context : null
    );
    setToast(null);
  }, []);

  const updateAudio = async () => {
    setAudioUpdating(true);
    setError("");
    setSelectionContext(null);

    try {
      const currentData = await readCurrentRoteiroData();
      applyLoadedRoteiroData(currentData);
      await validateAndUpdateAudio(
        currentData.audioContext.audioBounceDir,
        currentData.audioContext.projectName,
        currentData.audioContext.roteiroRegions
      );
      const previewResult = await openTimelineCompPreview();
      if (!previewResult.ok) {
        showToast(previewResult.message, "warning");
      }
      await load();
    } catch (caught) {
      clearRoteiroState();
      showRoteiroLoadError(caught);
    } finally {
      setAudioUpdating(false);
    }
  };

  const queueRender = async () => {
    setRenderQueueLoading(true);

    try {
      const result = await queueActiveCompRenderOutputs();
      showToast(result.message, result.ok ? "success" : "error");
    } catch (caught) {
      showToast(getMessage(caught), "error");
    } finally {
      setRenderQueueLoading(false);
    }
  };

  const adjustMarkers = async () => {
    setMarkerAdjusting(true);

    try {
      const result = await adjustTimelineMarkersToTail();
      showToast(result.message, result.ok ? "success" : "error");
    } catch (caught) {
      showToast(getMessage(caught), "error");
    } finally {
      setMarkerAdjusting(false);
    }
  };

  const load = useCallback(async () => {
    if (!window.cep) return;

    setLoading(true);
    setError("");
    setSelectionContext(null);
    clearRoteiroState();

    try {
      const data = await readCurrentRoteiroData();
      applyLoadedRoteiroData(data);
      setToast((current) => (current?.variant === "error" ? null : current));
    } catch (caught) {
      showRoteiroLoadError(caught);
    } finally {
      setLoading(false);
    }
  }, [
    applyLoadedRoteiroData,
    clearRoteiroState,
    readCurrentRoteiroData,
    showRoteiroLoadError,
  ]);

  const chooseRoteiroFile = useCallback(async () => {
    if (!selectionContext) return;

    const dialogResult = openRoteiroFileDialog(
      selectionContext.roteiroDirectory
    );
    if (dialogResult.status === "cancelled") return;
    if (dialogResult.status === "error") {
      setError(
        "Não foi possível abrir o seletor de arquivos. Tente novamente."
      );
      setToast(null);
      return;
    }

    setLoading(true);
    setError("");
    setSelectionContext(null);
    clearRoteiroState();

    try {
      const data = await readCurrentRoteiroData({
        fullPath: dialogResult.filePath,
        expectedContext: selectionContext,
      });
      applyLoadedRoteiroData(data);
      setToast(null);
    } catch (caught) {
      showRoteiroLoadError(caught);
    } finally {
      setLoading(false);
    }
  }, [
    applyLoadedRoteiroData,
    clearRoteiroState,
    readCurrentRoteiroData,
    selectionContext,
    showRoteiroLoadError,
  ]);

  const openOfferPrecomp = async (info: OfferValidationInfo | undefined) => {
    if (!info?.offerLayerIndex) {
      showToast("Oferta nao encontrada no After.", "warning");
      return;
    }

    setOfferActionLoading(true);
    try {
      const result = await openValidatedOfferPrecomp(info.offerLayerIndex);
      showToast(result.message, result.ok ? "success" : "error");
    } catch (caught) {
      showToast(getMessage(caught), "error");
    } finally {
      setOfferActionLoading(false);
    }
  };

  const fixOfferValue = async (
    info: OfferValidationInfo | undefined,
    fieldKey: OfferValidationFieldKey | undefined,
    value: string | undefined
  ) => {
    if (!info || !fieldKey || value === undefined) {
      showToast("Nao foi possivel identificar o campo da oferta.", "warning");
      return;
    }

    const field = getValidationField(info, fieldKey);

    if (!field) {
      await openOfferPrecomp(info);
      return;
    }

    setOfferActionLoading(true);
    try {
      const result = await updateValidatedOfferField(
        info.offerLayerIndex,
        info.productIndex,
        field.fieldId,
        value,
        field.fieldIndex
      );
      showToast(result.message, result.ok ? "success" : "error");

      if (result.ok) {
        await load();
      }
    } catch (caught) {
      showToast(getMessage(caught), "error");
    } finally {
      setOfferActionLoading(false);
    }
  };

  return {
    fileName,
    content,
    offerValidationInfos,
    loading,
    audioUpdating,
    markerAdjusting,
    renderQueueLoading,
    offerActionLoading,
    error,
    canChooseRoteiroFile: selectionContext !== null,
    load,
    chooseRoteiroFile,
    updateAudio,
    adjustMarkers,
    queueRender,
    fixOfferValue,
    openOfferPrecomp,
    toast,
    dismissToast,
  };
};
