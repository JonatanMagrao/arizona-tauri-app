import { useCallback, useEffect, useState } from "react";
import { fs } from "../../../../lib/cep/node";
import { getPublicErrorMessage } from "../../../utils/errors";
import {
  createDiagnosticOperationId,
  recordDiagnosticFailure,
  recordLocalDiagnostic,
} from "../../../services/localDiagnostics";
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

interface AudioUpdateOutcome {
  level: "info" | "warning" | "error";
  status: "completed" | "already_current" | "skipped" | "needs_user_input" | "failed";
  code?: string;
  runtime?: "cep" | "extendscript";
  message: string;
  caught?: unknown;
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
  } catch (caught) {
    recordDiagnosticFailure(
      "roteiro",
      "ler_docx",
      "Não foi possível ler o arquivo de roteiro selecionado.",
      caught,
      { code: "roteiro_docx_read_failed" }
    );
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
    roteiroRegions: string[],
    operationId: string
  ): Promise<AudioUpdateOutcome> => {
    try {
      const wavInfo = await loadProjectWavFootageInfo();

      if (wavInfo.count === 0) {
        showToast("Nenhum arquivo de áudio foi encontrado no projeto.", "warning");
        return {
          level: "warning",
          status: "skipped",
          code: "project_wav_missing",
          runtime: "extendscript",
          message: "A atualização do áudio foi interrompida porque o projeto não possui um WAV.",
        };
      }

      if (wavInfo.count > 1) {
        showToast(
          "Há mais de um arquivo de áudio no projeto. Escolha manualmente qual deve ser usado.",
          "warning"
        );
        return {
          level: "warning",
          status: "needs_user_input",
          code: "multiple_project_wavs",
          runtime: "extendscript",
          message: "Há mais de um WAV no projeto; a escolha do áudio precisa ser manual.",
        };
      }

      if (!fs.existsSync(audioBounceDir)) {
        showToast("A pasta de áudio AUDIO/BOUNCE não foi encontrada.", "warning");
        return {
          level: "warning",
          status: "skipped",
          code: "audio_bounce_directory_missing",
          message: "A pasta AUDIO/BOUNCE não foi encontrada.",
        };
      }

      const audioFiles = scanAudioDirectory(
        audioBounceDir,
        projectName,
        roteiroRegions
      );
      const matched = audioFiles.find((f) => f.matched);

      if (!matched) {
        recordLocalDiagnostic({
          level: "warning",
          component: "roteiro",
          action: "localizar_audio",
          status: "needs_user_input",
          code: "matching_audio_not_found",
          operationId,
          message: "Nenhum áudio compatível foi identificado automaticamente; abrindo a escolha manual.",
          details: { candidateCount: audioFiles.length },
        });
        const result = await openProjectAudioDialogAndReplace(audioBounceDir);
        if (result.replaced) {
          showToast(`Áudio atualizado: ${result.fileName}`);
          return {
            level: "info",
            status: "completed",
            runtime: "extendscript",
            message: "O áudio do projeto foi substituído pela seleção manual.",
          };
        }
        return {
          level: "warning",
          status: "needs_user_input",
          code: "audio_manual_selection_cancelled",
          runtime: "extendscript",
          message: "A escolha manual do áudio foi encerrada sem substituição.",
        };
      }

      if (normPath(wavInfo.path) === normPath(matched.fullPath)) {
        showToast(`O áudio já está atualizado: ${matched.name}`);
        return {
          level: "info",
          status: "already_current",
          message: "O áudio do projeto já estava atualizado.",
        };
      }

      const result = await replaceProjectWavFootage(matched.fullPath);
      if (result.ok) {
        showToast(`Áudio atualizado: ${result.fileName}`);
        return {
          level: "info",
          status: "completed",
          runtime: "extendscript",
          message: "O áudio do projeto foi atualizado automaticamente.",
        };
      }
      showToast("Não foi possível atualizar o áudio.", "error");
      return {
        level: "error",
        status: "failed",
        code: "audio_replace_rejected",
        runtime: "extendscript",
        message: "O After Effects não conseguiu substituir o áudio do projeto.",
      };
    } catch (caught) {
      showToast("Não foi possível atualizar o áudio.", "error");
      return {
        level: "error",
        status: "failed",
        code: "audio_update_failed",
        runtime: "extendscript",
        message: "Ocorreu um erro durante a atualização do áudio.",
        caught,
      };
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

  const showRoteiroLoadError = useCallback((
    caught: unknown,
    operationId?: string,
    logDiagnostic = true
  ) => {
    const message = getPublicErrorMessage(
      caught,
      "Não foi possível carregar o roteiro deste projeto. Verifique o arquivo e tente novamente.",
    );
    setError(message);
    setSelectionContext(
      caught instanceof RoteiroSelectionRequiredError ? caught.context : null
    );
    setToast(null);
    if (!logDiagnostic) return;
    if (caught instanceof RoteiroSelectionRequiredError) {
      recordLocalDiagnostic({
        level: "warning",
        component: "roteiro",
        action: "carregar",
        status: "needs_user_input",
        code: "roteiro_selection_required",
        operationId,
        message: "O roteiro não foi identificado automaticamente; é necessário escolher o DOCX.",
      });
    } else {
      recordDiagnosticFailure(
        "roteiro",
        "carregar",
        "Não foi possível carregar o roteiro do projeto.",
        caught,
        { code: "roteiro_load_failed", operationId, runtime: "extendscript" }
      );
    }
  }, []);

  const updateAudio = async () => {
    setAudioUpdating(true);
    setError("");
    setSelectionContext(null);
    const operationId = createDiagnosticOperationId("roteiro-audio");
    const startedAt = Date.now();
    let audioOutcomeRecorded = false;
    recordLocalDiagnostic({
      component: "roteiro",
      action: "atualizar_audio",
      status: "started",
      operationId,
      message: "Atualização do áudio iniciada.",
    });

    try {
      const currentData = await readCurrentRoteiroData();
      applyLoadedRoteiroData(currentData);
      const outcome = await validateAndUpdateAudio(
        currentData.audioContext.audioBounceDir,
        currentData.audioContext.projectName,
        currentData.audioContext.roteiroRegions,
        operationId
      );
      if (outcome.caught !== undefined) {
        recordDiagnosticFailure(
          "roteiro",
          "atualizar_audio",
          outcome.message,
          outcome.caught,
          {
            code: outcome.code,
            operationId,
            runtime: outcome.runtime,
            details: { durationMs: Date.now() - startedAt },
          }
        );
      } else {
        recordLocalDiagnostic({
          level: outcome.level,
          component: "roteiro",
          action: "atualizar_audio",
          status: outcome.status,
          code: outcome.code,
          runtime: outcome.runtime,
          operationId,
          message: outcome.message,
          details: { durationMs: Date.now() - startedAt },
        });
      }
      audioOutcomeRecorded = true;
      const previewResult = await openTimelineCompPreview();
      if (!previewResult.ok) {
        showToast(
          getPublicErrorMessage(
            previewResult.message,
            "O áudio foi atualizado, mas não foi possível abrir a visualização do projeto.",
          ),
          "warning",
        );
        recordLocalDiagnostic({
          level: "warning",
          component: "roteiro",
          action: "abrir_preview",
          status: "completed_with_warnings",
          code: "timeline_preview_unavailable",
          runtime: "extendscript",
          operationId,
          message: "O áudio foi atualizado, mas a visualização do projeto não pôde ser aberta.",
        });
      }
      await load();
    } catch (caught) {
      clearRoteiroState();
      const needsUserInput = caught instanceof RoteiroSelectionRequiredError;
      if (audioOutcomeRecorded) {
        recordDiagnosticFailure(
          "roteiro",
          "finalizar_atualizacao_audio",
          "A atualização do áudio terminou, mas uma etapa auxiliar falhou.",
          caught,
          {
            code: "audio_followup_failed",
            operationId,
            runtime: "extendscript",
            details: { durationMs: Date.now() - startedAt },
          }
        );
      } else if (needsUserInput) {
        recordLocalDiagnostic({
          level: "warning",
          component: "roteiro",
          action: "atualizar_audio",
          status: "needs_user_input",
          code: "roteiro_selection_required",
          operationId,
          message: "A atualização do áudio precisa que o roteiro seja escolhido manualmente.",
          details: { durationMs: Date.now() - startedAt },
        });
      } else {
        recordDiagnosticFailure(
          "roteiro",
          "atualizar_audio",
          "A atualização do áudio foi interrompida antes de terminar.",
          caught,
          {
            code: "audio_update_failed",
            operationId,
            runtime: "extendscript",
            details: { durationMs: Date.now() - startedAt },
          }
        );
      }
      showRoteiroLoadError(caught, undefined, false);
    } finally {
      setAudioUpdating(false);
    }
  };

  const queueRender = async () => {
    setRenderQueueLoading(true);
    const operationId = createDiagnosticOperationId("roteiro-render");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "adicionar_fila_render",
      status: "started",
      runtime: "extendscript",
      operationId,
      message: "Inclusão das saídas na fila de render iniciada.",
    });

    try {
      const result = await queueActiveCompRenderOutputs();
      showToast(
        getPublicErrorMessage(
          result.message,
          result.ok
            ? "As saídas foram adicionadas à fila de render."
            : "Não foi possível adicionar as saídas à fila de render.",
        ),
        result.ok ? "success" : "error",
      );
      recordLocalDiagnostic({
        level: result.ok ? "info" : "error",
        component: "roteiro",
        action: "adicionar_fila_render",
        status: result.ok ? "completed" : "failed",
        code: result.ok ? undefined : "render_queue_rejected",
        runtime: "extendscript",
        operationId,
        message: result.ok
          ? "As saídas foram adicionadas à fila de render."
          : "O After Effects não conseguiu preparar a fila de render.",
        details: { durationMs: Date.now() - startedAt },
      });
    } catch (caught) {
      showToast(
        getPublicErrorMessage(
          caught,
          "Não foi possível adicionar as saídas à fila de render.",
        ),
        "error",
      );
      recordDiagnosticFailure(
        "roteiro",
        "adicionar_fila_render",
        "Ocorreu um erro ao preparar a fila de render.",
        caught,
        {
          code: "render_queue_failed",
          operationId,
          runtime: "extendscript",
          details: { durationMs: Date.now() - startedAt },
        }
      );
    } finally {
      setRenderQueueLoading(false);
    }
  };

  const adjustMarkers = async () => {
    setMarkerAdjusting(true);
    const operationId = createDiagnosticOperationId("roteiro-markers");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "ajustar_markers",
      status: "started",
      runtime: "extendscript",
      operationId,
      message: "Ajuste dos marcadores de tempo iniciado.",
    });

    try {
      const result = await adjustTimelineMarkersToTail();
      showToast(
        getPublicErrorMessage(
          result.message,
          result.ok
            ? "Os tempos das ofertas foram ajustados."
            : "Não foi possível ajustar os tempos das ofertas.",
        ),
        result.ok ? "success" : "error",
      );
      recordLocalDiagnostic({
        level: result.ok ? "info" : "error",
        component: "roteiro",
        action: "ajustar_markers",
        status: result.ok ? "completed" : "failed",
        code: result.ok ? undefined : "marker_adjustment_rejected",
        runtime: "extendscript",
        operationId,
        message: result.ok
          ? "Os marcadores de tempo foram ajustados."
          : "O After Effects não conseguiu ajustar os marcadores de tempo.",
        details: { durationMs: Date.now() - startedAt },
      });
    } catch (caught) {
      showToast(
        getPublicErrorMessage(caught, "Não foi possível ajustar os tempos das ofertas."),
        "error",
      );
      recordDiagnosticFailure(
        "roteiro",
        "ajustar_markers",
        "Não foi possível ajustar os marcadores de tempo.",
        caught,
        {
          code: "marker_adjustment_failed",
          operationId,
          runtime: "extendscript",
          details: { durationMs: Date.now() - startedAt },
        }
      );
    } finally {
      setMarkerAdjusting(false);
    }
  };

  const load = useCallback(async () => {
    if (!window.cep) return;

    const operationId = createDiagnosticOperationId("roteiro-load");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "carregar",
      status: "started",
      operationId,
      message: "Leitura do roteiro e validação das ofertas iniciadas.",
    });

    setLoading(true);
    setError("");
    setSelectionContext(null);
    clearRoteiroState();

    try {
      const data = await readCurrentRoteiroData();
      applyLoadedRoteiroData(data);
      setToast((current) => (current?.variant === "error" ? null : current));
      recordLocalDiagnostic({
        component: "roteiro",
        action: "carregar",
        status: "completed",
        operationId,
        message: "Roteiro carregado e ofertas validadas.",
        details: {
          durationMs: Date.now() - startedAt,
          offerCount: data.offerValidationInfos.length,
        },
      });
    } catch (caught) {
      showRoteiroLoadError(caught, operationId);
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
      recordLocalDiagnostic({
        level: "error",
        component: "roteiro",
        action: "selecionar_docx",
        status: "failed",
        code: "roteiro_dialog_failed",
        message: "Não foi possível abrir o seletor de arquivos do roteiro.",
      });
      return;
    }

    setLoading(true);
    setError("");
    setSelectionContext(null);
    clearRoteiroState();
    const operationId = createDiagnosticOperationId("roteiro-manual");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "selecionar_docx",
      status: "started",
      operationId,
      message: "Leitura do roteiro escolhido manualmente iniciada.",
    });

    try {
      const data = await readCurrentRoteiroData({
        fullPath: dialogResult.filePath,
        expectedContext: selectionContext,
      });
      applyLoadedRoteiroData(data);
      setToast(null);
      recordLocalDiagnostic({
        component: "roteiro",
        action: "selecionar_docx",
        status: "completed",
        operationId,
        message: "O roteiro escolhido manualmente foi carregado.",
        details: {
          durationMs: Date.now() - startedAt,
          offerCount: data.offerValidationInfos.length,
        },
      });
    } catch (caught) {
      showRoteiroLoadError(caught, operationId);
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
      showToast("Não foi possível localizar esta oferta no projeto aberto.", "warning");
      return;
    }

    setOfferActionLoading(true);
    const operationId = createDiagnosticOperationId("roteiro-open-offer");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "abrir_oferta",
      status: "started",
      runtime: "extendscript",
      operationId,
      message: "Abertura da oferta no After Effects iniciada.",
    });
    try {
      const result = await openValidatedOfferPrecomp(info.offerLayerIndex);
      showToast(
        getPublicErrorMessage(
          result.message,
          result.ok
            ? "A oferta foi aberta no After Effects."
            : "Não foi possível abrir a oferta no After Effects.",
        ),
        result.ok ? "success" : "error",
      );
      recordLocalDiagnostic({
        level: result.ok ? "info" : "error",
        component: "roteiro",
        action: "abrir_oferta",
        status: result.ok ? "completed" : "failed",
        code: result.ok ? undefined : "open_offer_rejected",
        runtime: "extendscript",
        operationId,
        message: result.ok
          ? "A oferta foi aberta no After Effects."
          : "O After Effects não conseguiu abrir a oferta.",
        details: { durationMs: Date.now() - startedAt },
      });
    } catch (caught) {
      showToast(
        getPublicErrorMessage(caught, "Não foi possível abrir a oferta no After Effects."),
        "error",
      );
      recordDiagnosticFailure(
        "roteiro",
        "abrir_oferta",
        "Ocorreu um erro ao abrir a oferta no After Effects.",
        caught,
        {
          code: "open_offer_failed",
          operationId,
          runtime: "extendscript",
          details: { durationMs: Date.now() - startedAt },
        }
      );
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
      showToast("Não foi possível identificar qual informação da oferta deve ser corrigida.", "warning");
      return;
    }

    const field = getValidationField(info, fieldKey);

    if (!field) {
      await openOfferPrecomp(info);
      return;
    }

    setOfferActionLoading(true);
    const operationId = createDiagnosticOperationId("roteiro-fix-offer");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "roteiro",
      action: "corrigir_oferta",
      status: "started",
      runtime: "extendscript",
      operationId,
      message: "Correção de um campo da oferta iniciada.",
      details: { fieldKey },
    });
    try {
      const result = await updateValidatedOfferField(
        info.offerLayerIndex,
        info.productIndex,
        field.fieldId,
        value,
        field.fieldIndex
      );
      showToast(
        getPublicErrorMessage(
          result.message,
          result.ok
            ? "O campo da oferta foi corrigido."
            : "Não foi possível corrigir o campo da oferta.",
        ),
        result.ok ? "success" : "error",
      );

      recordLocalDiagnostic({
        level: result.ok ? "info" : "error",
        component: "roteiro",
        action: "corrigir_oferta",
        status: result.ok ? "completed" : "failed",
        code: result.ok ? undefined : "offer_field_update_rejected",
        runtime: "extendscript",
        operationId,
        message: result.ok
          ? "O campo da oferta foi corrigido."
          : "O After Effects não conseguiu corrigir o campo da oferta.",
        details: {
          durationMs: Date.now() - startedAt,
          fieldKey,
        },
      });

      if (result.ok) {
        await load();
      }
    } catch (caught) {
      showToast(
        getPublicErrorMessage(caught, "Não foi possível corrigir o campo da oferta."),
        "error",
      );
      recordDiagnosticFailure(
        "roteiro",
        "corrigir_oferta",
        "Ocorreu um erro ao corrigir o campo da oferta.",
        caught,
        {
          code: "offer_field_update_failed",
          operationId,
          runtime: "extendscript",
          details: {
            durationMs: Date.now() - startedAt,
            fieldKey,
          },
        }
      );
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
