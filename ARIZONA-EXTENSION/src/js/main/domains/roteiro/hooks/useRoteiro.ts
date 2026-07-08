import { useCallback, useEffect, useState } from "react";
import { fs } from "../../../../lib/cep/node";
import { getMessage } from "../../../utils/errors";
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
import { isNodeAvailable, scanRoteiroDirectory } from "../utils/roteiroFiles";
import { scanAudioDirectory } from "../utils/audioFiles";
import { readDocxText } from "../utils/docxReader";
import type {
  OfferValidationFieldKey,
  OfferValidationFieldRef,
  OfferValidationInfo,
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

const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

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

  const readCurrentRoteiroData = useCallback(async (): Promise<LoadedRoteiroData> => {
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

    const files = scanRoteiroDirectory(roteiroDirectory, projectName);
    const target = files.find((f) => f.matched) ?? files[0];

    if (!target) {
      throw new Error("Nenhum roteiro encontrado.");
    }

    return {
      fileName: target.name,
      content: readDocxText(target.fullPath),
      offerValidationInfos: offerInfos,
      audioContext: {
        audioBounceDir: deriveAudioBounceDir(roteiroDirectory),
        projectName,
        roteiroRegions: target.regions,
      },
    };
  }, [hasNodeAccess]);

  const updateAudio = async () => {
    setAudioUpdating(true);
    setError("");

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
      const message = getMessage(caught);
      clearRoteiroState();
      setError(message);
      showToast(message, "error");
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
    clearRoteiroState();

    try {
      applyLoadedRoteiroData(await readCurrentRoteiroData());
    } catch (caught) {
      setError(getMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [applyLoadedRoteiroData, clearRoteiroState, readCurrentRoteiroData]);

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
    load,
    updateAudio,
    adjustMarkers,
    queueRender,
    fixOfferValue,
    openOfferPrecomp,
    toast,
    dismissToast,
  };
};
