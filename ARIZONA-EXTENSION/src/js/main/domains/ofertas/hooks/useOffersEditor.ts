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
  replaceOfferLayout,
  replaceOfferMechanic,
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
  OfferLayoutChangeRequest,
  OfferLegalOptionsContext,
  OfferMechanicChangeRequest,
} from "../types";

interface UseOffersEditorOptions {
  initialOfferLayerIndex?: number;
  onStatus: (message: string) => void;
}

const UNDO_REFRESH_DELAY_MS = 180;
const UNDO_DEDUPE_MS = 250;
const INITIAL_SNAPSHOT_RETRY_MS = 1500;
const INITIAL_SNAPSHOT_RETRIES = 5;

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
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const pendingActionCountRef = useRef(0);
  const selectedOfferLayerIndexRef = useRef<number | undefined>(
    initialOfferLayerIndex
  );
  const lastUndoAtRef = useRef(0);
  const undoInFlightRef = useRef(false);
  const snapshotReadCountRef = useRef(0);
  const snapshotRequestIdRef = useRef(0);
  const initialSnapshotReadyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginAction = useCallback(() => {
    pendingActionCountRef.current += 1;
    setPendingActionCount(pendingActionCountRef.current);
  }, []);

  const endAction = useCallback(() => {
    pendingActionCountRef.current = Math.max(0, pendingActionCountRef.current - 1);
    if (mountedRef.current) {
      setPendingActionCount(pendingActionCountRef.current);
    }
  }, []);

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
      if (!window.cep || !mountedRef.current) return false;

      const requestId = ++snapshotRequestIdRef.current;
      snapshotReadCountRef.current += 1;
      setLoading(true);

      try {
        const nextSnapshot = await loadOffersEditorSnapshot(offerLayerIndex);
        if (!mountedRef.current || requestId !== snapshotRequestIdRef.current) return false;
        selectedOfferLayerIndexRef.current =
          nextSnapshot.selectedOfferLayerIndex || offerLayerIndex;
        if ((nextSnapshot.selectedOffer?.products?.length || 0) > 0) {
          initialSnapshotReadyRef.current = true;
        }
        setSnapshot(nextSnapshot);
        return true;
      } catch (caught) {
        if (!mountedRef.current || requestId !== snapshotRequestIdRef.current) return false;
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
        snapshotReadCountRef.current -= 1;
        if (mountedRef.current) setLoading(snapshotReadCountRef.current > 0);
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
      if (!mountedRef.current) return;

      beginAction();
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
        if (!mountedRef.current) return;
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
      } finally {
        endAction();
      }
    },
    [appendLog, beginAction, endAction, onStatus, refreshOffers]
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
    (offerLayerIndex: number, controlId: string, enabled: boolean, expectedContext?: OfferLegalOptionsContext) =>
      runOfferAction("alterar_controle_legal", "Alterar controle legal", () =>
        expectedContext
          ? updateOfferLegalControl(offerLayerIndex, controlId, enabled, expectedContext)
          : updateOfferLegalControl(offerLayerIndex, controlId, enabled)
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
    (offerLayerIndex: number, controlId: string, selectedIndex: number, expectedContext?: OfferLegalOptionsContext) =>
      runOfferAction("selecionar_opcao_legal", "Selecionar opção legal", () =>
        expectedContext
          ? updateOfferLegalControlOption(offerLayerIndex, controlId, selectedIndex, expectedContext)
          : updateOfferLegalControlOption(offerLayerIndex, controlId, selectedIndex)
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

  const replaceLayout = useCallback(
    (request: OfferLayoutChangeRequest) => {
      if (loading || pendingActionCountRef.current > 0) return Promise.resolve();

      return runOfferAction("trocar_regua", "Trocar régua da oferta", () =>
        replaceOfferLayout(request)
      );
    },
    [loading, runOfferAction]
  );

  const replaceMechanic = useCallback(
    (request: OfferMechanicChangeRequest) => {
      if (loading || pendingActionCountRef.current > 0) return Promise.resolve();

      return runOfferAction("trocar_mecanica", "Trocar mecânica do produto", () =>
        replaceOfferMechanic(request)
      );
    },
    [loading, runOfferAction]
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
    if (!mountedRef.current) return false;

    const now = Date.now();
    if (undoInFlightRef.current) return false;
    if (now - lastUndoAtRef.current < UNDO_DEDUPE_MS) return false;

    lastUndoAtRef.current = now;
    undoInFlightRef.current = true;
    beginAction();
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
      endAction();
    }
  }, [appendLog, beginAction, endAction, onStatus, refreshOffers]);

  useEffect(() => {
    if (!window.cep) return;
    let disposed = false;
    let timer = 0;
    let retries = 0;
    const scheduleRecovery = () => {
      if (disposed || initialSnapshotReadyRef.current || retries >= INITIAL_SNAPSHOT_RETRIES) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(recoverInitialSnapshot, INITIAL_SNAPSHOT_RETRY_MS);
    };
    const recoverInitialSnapshot = async () => {
      window.clearTimeout(timer);
      timer = 0;
      if (disposed || initialSnapshotReadyRef.current) return;
      // The path can already be known while the first offer snapshot is still
      // empty. Retry that startup read, without polling a populated editor or
      // racing a selection/edit, another read, or a hidden panel.
      if (snapshotReadCountRef.current > 0 || pendingActionCountRef.current > 0 ||
          (typeof document !== "undefined" && (document.hidden || document.visibilityState === "hidden"))) {
        scheduleRecovery();
        return;
      }
      retries += 1;
      await refreshOffers();
      scheduleRecovery();
    };
    const recoverWhenVisible = () => {
      if (disposed || initialSnapshotReadyRef.current || document.hidden || document.visibilityState === "hidden") return;
      // A long external open can outlast the bounded startup window. Returning
      // to this still-empty panel gives it a fresh chance, without refreshing
      // products that the operator has already loaded and started editing.
      retries = 0;
      void recoverInitialSnapshot();
    };
    void refreshOffers().then(scheduleRecovery);
    window.addEventListener("focus", recoverWhenVisible);
    document.addEventListener("visibilitychange", recoverWhenVisible);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", recoverWhenVisible);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
    };
  }, [refreshOffers]);

  return {
    snapshot,
    loading,
    busy: loading || pendingActionCount > 0,
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
    replaceLayout,
    replaceMechanic,
    swapProducts,
    undo,
  };
};
