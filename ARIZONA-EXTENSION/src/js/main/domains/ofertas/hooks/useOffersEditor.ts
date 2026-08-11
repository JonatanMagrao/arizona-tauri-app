import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicErrorMessage } from "../../../utils/errors";
import {
  createDiagnosticOperationId,
  recordDiagnosticFailure,
  recordLocalDiagnostic,
} from "../../../services/localDiagnostics";
import {
  loadOffersEditorSnapshot,
  openOfferPrecompForEditor,
  replaceOfferProductImage,
  selectOfferForEditor,
  swapOfferSources,
  swapOfferProducts,
  updateOfferDescription,
  updateOfferDescriptionExpression,
  updateOfferField,
  updateOfferInstallmentJump,
  updateOfferLegalControl,
  updateOfferLegalControlOption,
  updateOfferLegalControlValue,
  updateOfferLegalText,
  updateOfferOption,
  undoOffersEditorAction,
} from "../services/ofertas";
import type {
  OfferEditorActionResult,
  OfferEditorSnapshot,
  OfferInstallmentJumpTarget,
} from "../types";

interface UseOffersEditorOptions {
  initialOfferLayerIndex?: number;
  onStatus: (message: string) => void;
}

const UNDO_REFRESH_DELAY_MS = 180;
const UNDO_DEDUPE_MS = 250;

const wait = (durationMs: number) =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));

const normalizeOfferDescription = (value: string) =>
  value.toLocaleUpperCase("pt-BR");

const formatLogEntry = (message: string) => {
  const time = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return `${time} - ${message}`;
};

export const useOffersEditor = ({
  initialOfferLayerIndex,
  onStatus,
}: UseOffersEditorOptions) => {
  const [snapshot, setSnapshot] = useState<OfferEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const selectedOfferLayerIndexRef = useRef<number | undefined>(
    initialOfferLayerIndex
  );
  const lastUndoAtRef = useRef(0);
  const undoInFlightRef = useRef(false);

  const appendLog = useCallback((messages: string | string[]) => {
    const nextMessages = Array.isArray(messages) ? messages : [messages];
    const validMessages = nextMessages.filter(Boolean);

    if (validMessages.length === 0) return;

    setActionLog((current) =>
      [...validMessages.map(formatLogEntry), ...current].slice(0, 12)
    );
  }, []);

  const clearActionLog = useCallback(() => {
    setActionLog([]);
  }, []);

  const refreshOffers = useCallback(
    async (offerLayerIndex = selectedOfferLayerIndexRef.current) => {
      if (!window.cep) return false;

      setLoading(true);

      try {
        const nextSnapshot = await loadOffersEditorSnapshot(offerLayerIndex);
        selectedOfferLayerIndexRef.current =
          nextSnapshot.selectedOfferLayerIndex || offerLayerIndex;
        setSnapshot(nextSnapshot);
        return true;
      } catch (caught) {
        const message = getPublicErrorMessage(
          caught,
          "Não foi possível carregar as ofertas deste projeto.",
        );
        onStatus(message);
        recordDiagnosticFailure(
          "ofertas",
          "carregar_painel",
          "Não foi possível carregar as ofertas do projeto.",
          caught,
          { code: "offers_snapshot_failed", runtime: "extendscript" }
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [onStatus]
  );

  const runOfferAction = useCallback(
    async (
      actionName: string,
      actionLabel: string,
      action: () => Promise<OfferEditorActionResult>
    ) => {
      const operationId = createDiagnosticOperationId(`offers-${actionName}`);
      const startedAt = Date.now();
      recordLocalDiagnostic({
        component: "ofertas",
        action: actionName,
        status: "started",
        runtime: "extendscript",
        operationId,
        message: `${actionLabel}: ação iniciada no After Effects.`,
      });
      try {
        const result = await action();
        const publicMessage = getPublicErrorMessage(
          result.message,
          result.ok
            ? "Alteração concluída."
            : "Não foi possível concluir esta alteração na oferta.",
        );
        onStatus(publicMessage);

        if (!result.ok) {
          appendLog(publicMessage);
          recordLocalDiagnostic({
            level: "error",
            component: "ofertas",
            action: actionName,
            status: "failed",
            code: "offers_action_rejected",
            runtime: "extendscript",
            operationId,
            message: `${actionLabel}: o After Effects não conseguiu concluir a ação.`,
            details: {
              durationMs: Date.now() - startedAt,
              errorCount: result.errors?.length || 0,
            },
          });
        } else {
          recordLocalDiagnostic({
            level: result.errors?.length > 0 ? "warning" : "info",
            component: "ofertas",
            action: actionName,
            status: result.errors?.length > 0 ? "completed_with_warnings" : "completed",
            code: result.errors?.length > 0 ? "offers_action_partial" : undefined,
            runtime: "extendscript",
            operationId,
            message: result.errors?.length > 0
              ? `${actionLabel}: ação concluída com avisos.`
              : `${actionLabel}: ação concluída.`,
            details: {
              durationMs: Date.now() - startedAt,
              errorCount: result.errors?.length || 0,
            },
          });
        }

        if (result.errors?.length > 0) {
          appendLog(
            result.errors.map((error) =>
              getPublicErrorMessage(
                error,
                "Uma parte da alteração não pôde ser concluída.",
              )
            )
          );
        }

        selectedOfferLayerIndexRef.current =
          result.selectedOfferLayerIndex ||
          selectedOfferLayerIndexRef.current;
        await refreshOffers(selectedOfferLayerIndexRef.current);
      } catch (caught) {
        const message = getPublicErrorMessage(
          caught,
          "Não foi possível concluir esta alteração na oferta.",
        );
        onStatus(message);
        appendLog(message);
        recordDiagnosticFailure(
          "ofertas",
          actionName,
          `${actionLabel}: ocorreu um erro ao conversar com o After Effects.`,
          caught,
          {
            code: "offers_host_action_failed",
            operationId,
            runtime: "extendscript",
            details: { durationMs: Date.now() - startedAt },
          }
        );
      }
    },
    [appendLog, onStatus, refreshOffers]
  );

  const selectOffer = useCallback(
    (offerLayerIndex: number) =>
      runOfferAction("selecionar_oferta", "Selecionar oferta", () =>
        selectOfferForEditor(offerLayerIndex)
      ),
    [runOfferAction]
  );

  const openOfferPrecomp = useCallback(
    (offerLayerIndex: number) =>
      runOfferAction("abrir_precomposicao", "Abrir pré-composição da oferta", () =>
        openOfferPrecompForEditor(offerLayerIndex)
      ),
    [runOfferAction]
  );

  const updateDescription = useCallback(
    (offerLayerIndex: number, productIndex: number, value: string) =>
      runOfferAction("atualizar_descricao", "Atualizar descrição", () =>
        updateOfferDescription(
          offerLayerIndex,
          productIndex,
          normalizeOfferDescription(value)
        )
      ),
    [runOfferAction]
  );

  const updateField = useCallback(
    (
      offerLayerIndex: number,
      productIndex: number,
      fieldId: string,
      value: string,
      fieldIndex?: number
    ) =>
      runOfferAction("atualizar_campo", "Atualizar campo da oferta", () =>
        updateOfferField(
          offerLayerIndex,
          productIndex,
          fieldId,
          value,
          fieldIndex
        )
      ),
    [runOfferAction]
  );

  const updateOption = useCallback(
    (
      offerLayerIndex: number,
      productIndex: number,
      optionGroupId: string,
      selectedIndex: number
    ) =>
      runOfferAction("alterar_opcao", "Alterar opção da oferta", () =>
        updateOfferOption(
          offerLayerIndex,
          productIndex,
          optionGroupId,
          selectedIndex
        )
      ),
    [runOfferAction]
  );

  const updateInstallmentJump = useCallback(
    (
      offerLayerIndex: number,
      productIndex: number,
      target: OfferInstallmentJumpTarget
    ) =>
      runOfferAction("ajustar_parcelamento", "Ajustar salto do parcelamento", () =>
        updateOfferInstallmentJump(offerLayerIndex, productIndex, target)
      ),
    [runOfferAction]
  );

  const updateLegalText = useCallback(
    (offerLayerIndex: number, value: string) =>
      runOfferAction("atualizar_legal", "Atualizar texto legal", () =>
        updateOfferLegalText(offerLayerIndex, value)
      ),
    [runOfferAction]
  );

  const updateLegalControl = useCallback(
    (offerLayerIndex: number, controlId: string, enabled: boolean) =>
      runOfferAction("alterar_controle_legal", "Alterar controle legal", () =>
        updateOfferLegalControl(offerLayerIndex, controlId, enabled)
      ),
    [runOfferAction]
  );

  const updateLegalControlValue = useCallback(
    (offerLayerIndex: number, controlId: string, value: string) =>
      runOfferAction("atualizar_valor_legal", "Atualizar valor legal", () =>
        updateOfferLegalControlValue(offerLayerIndex, controlId, value)
      ),
    [runOfferAction]
  );

  const updateLegalControlOption = useCallback(
    (offerLayerIndex: number, controlId: string, selectedIndex: number) =>
      runOfferAction("selecionar_opcao_legal", "Selecionar opção legal", () =>
        updateOfferLegalControlOption(offerLayerIndex, controlId, selectedIndex)
      ),
    [runOfferAction]
  );

  const swapProducts = useCallback(
    (
      offerLayerIndex: number,
      sourceProductIndex: number,
      targetProductIndex: number,
      openOfferPrecomp: boolean
    ) =>
      runOfferAction("trocar_produtos", "Trocar produtos da oferta", () =>
        swapOfferProducts(
          offerLayerIndex,
          sourceProductIndex,
          targetProductIndex,
          openOfferPrecomp
        )
      ),
    [runOfferAction]
  );

  const updateDescriptionExpression = useCallback(
    (offerLayerIndex: number, productIndex: number, enabled: boolean) =>
      runOfferAction("alternar_expressao", "Alterar expressão da descrição", () =>
        updateOfferDescriptionExpression(
          offerLayerIndex,
          productIndex,
          enabled
        )
      ),
    [runOfferAction]
  );

  const swapOffers = useCallback(
    (sourceOfferLayerIndex: number, targetOfferLayerIndex: number) =>
      runOfferAction("trocar_ofertas", "Trocar ofertas", () =>
        swapOfferSources(sourceOfferLayerIndex, targetOfferLayerIndex)
      ),
    [runOfferAction]
  );

  const replaceProductImage = useCallback(
    (
      offerLayerIndex: number,
      productIndex: number,
      filePath: string,
      openOfferPrecomp: boolean
    ) =>
      runOfferAction("substituir_imagem", "Substituir imagem do produto", () =>
        replaceOfferProductImage(
          offerLayerIndex,
          productIndex,
          filePath,
          openOfferPrecomp
        )
      ),
    [runOfferAction]
  );

  const undo = useCallback(async () => {
    const now = Date.now();
    if (undoInFlightRef.current) return false;
    if (now - lastUndoAtRef.current < UNDO_DEDUPE_MS) return false;

    lastUndoAtRef.current = now;
    undoInFlightRef.current = true;
    const operationId = createDiagnosticOperationId("offers-undo");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "ofertas",
      action: "desfazer",
      status: "started",
      runtime: "extendscript",
      operationId,
      message: "Desfazer última alteração: ação iniciada no After Effects.",
    });

    try {
      const result = await undoOffersEditorAction();
      const publicMessage = getPublicErrorMessage(
        result.message,
        result.ok
          ? "A última alteração foi desfeita."
          : "Não foi possível desfazer a última alteração.",
      );
      onStatus(publicMessage);

      if (!result.ok) {
        appendLog(publicMessage);
      }

      if (result.errors?.length > 0) {
        appendLog(
          result.errors.map((error) =>
            getPublicErrorMessage(
              error,
              "Uma parte da alteração não pôde ser desfeita.",
            )
          )
        );
      }

      recordLocalDiagnostic({
        level: result.ok ? (result.errors?.length > 0 ? "warning" : "info") : "error",
        component: "ofertas",
        action: "desfazer",
        status: result.ok ? (result.errors?.length > 0 ? "completed_with_warnings" : "completed") : "failed",
        code: result.ok ? (result.errors?.length > 0 ? "offers_undo_partial" : undefined) : "offers_undo_rejected",
        runtime: "extendscript",
        operationId,
        message: result.ok
          ? "A última alteração das ofertas foi desfeita."
          : "O After Effects não conseguiu desfazer a última alteração.",
        details: {
          durationMs: Date.now() - startedAt,
          errorCount: result.errors?.length || 0,
        },
      });

      await wait(UNDO_REFRESH_DELAY_MS);
      return await refreshOffers(selectedOfferLayerIndexRef.current);
    } catch (caught) {
      const message = getPublicErrorMessage(
        caught,
        "Não foi possível desfazer a última alteração.",
      );
      onStatus(message);
      appendLog(message);
      recordDiagnosticFailure(
        "ofertas",
        "desfazer",
        "Ocorreu um erro ao desfazer a última alteração.",
        caught,
        {
          code: "offers_undo_failed",
          operationId,
          runtime: "extendscript",
          details: { durationMs: Date.now() - startedAt },
        }
      );
      return false;
    } finally {
      undoInFlightRef.current = false;
    }
  }, [appendLog, onStatus, refreshOffers]);

  useEffect(() => {
    void refreshOffers();
  }, [refreshOffers]);

  return {
    snapshot,
    loading,
    actionLog,
    clearActionLog,
    refreshOffers,
    selectOffer,
    openOfferPrecomp,
    updateDescription,
    updateDescriptionExpression,
    updateField,
    updateOption,
    updateInstallmentJump,
    updateLegalText,
    updateLegalControl,
    updateLegalControlValue,
    updateLegalControlOption,
    replaceProductImage,
    swapOffers,
    swapProducts,
    undo,
  };
};
