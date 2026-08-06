import { useCallback, useEffect, useRef, useState } from "react";
import { getMessage } from "../../../utils/errors";
import {
  loadOffersEditorSnapshot,
  openOfferPrecompForEditor,
  replaceOfferProductImage,
  selectOfferForEditor,
  swapOfferSources,
  swapOfferProducts,
  updateOfferDescription,
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
        onStatus(getMessage(caught));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [onStatus]
  );

  const runOfferAction = useCallback(
    async (
      action: () => Promise<OfferEditorActionResult>
    ) => {
      try {
        const result = await action();
        onStatus(result.message);

        if (!result.ok) {
          appendLog(result.message || "Acao de ofertas falhou.");
        }

        if (result.errors?.length > 0) {
          appendLog(result.errors);
        }

        selectedOfferLayerIndexRef.current =
          result.selectedOfferLayerIndex ||
          selectedOfferLayerIndexRef.current;
        await refreshOffers(selectedOfferLayerIndexRef.current);
      } catch (caught) {
        const message = getMessage(caught);
        onStatus(message);
        appendLog(message);
      }
    },
    [appendLog, onStatus, refreshOffers]
  );

  const selectOffer = useCallback(
    (offerLayerIndex: number) =>
      runOfferAction(() => selectOfferForEditor(offerLayerIndex)),
    [runOfferAction]
  );

  const openOfferPrecomp = useCallback(
    (offerLayerIndex: number) =>
      runOfferAction(() => openOfferPrecompForEditor(offerLayerIndex)),
    [runOfferAction]
  );

  const updateDescription = useCallback(
    (offerLayerIndex: number, productIndex: number, value: string) =>
      runOfferAction(() =>
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
      runOfferAction(() =>
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
      runOfferAction(() =>
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
      runOfferAction(() =>
        updateOfferInstallmentJump(offerLayerIndex, productIndex, target)
      ),
    [runOfferAction]
  );

  const updateLegalText = useCallback(
    (offerLayerIndex: number, value: string) =>
      runOfferAction(() => updateOfferLegalText(offerLayerIndex, value)),
    [runOfferAction]
  );

  const updateLegalControl = useCallback(
    (offerLayerIndex: number, controlId: string, enabled: boolean) =>
      runOfferAction(() =>
        updateOfferLegalControl(offerLayerIndex, controlId, enabled)
      ),
    [runOfferAction]
  );

  const updateLegalControlValue = useCallback(
    (offerLayerIndex: number, controlId: string, value: string) =>
      runOfferAction(() =>
        updateOfferLegalControlValue(offerLayerIndex, controlId, value)
      ),
    [runOfferAction]
  );

  const updateLegalControlOption = useCallback(
    (offerLayerIndex: number, controlId: string, selectedIndex: number) =>
      runOfferAction(() =>
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
      runOfferAction(() =>
        swapOfferProducts(
          offerLayerIndex,
          sourceProductIndex,
          targetProductIndex,
          openOfferPrecomp
        )
      ),
    [runOfferAction]
  );

  const swapOffers = useCallback(
    (sourceOfferLayerIndex: number, targetOfferLayerIndex: number) =>
      runOfferAction(() =>
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
      runOfferAction(() =>
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
    if (now - lastUndoAtRef.current < UNDO_DEDUPE_MS) return;

    lastUndoAtRef.current = now;

    try {
      const result = await undoOffersEditorAction();
      onStatus(result.message);

      if (!result.ok) {
        appendLog(result.message || "Undo nao executado.");
      }

      if (result.errors?.length > 0) {
        appendLog(result.errors);
      }

      await wait(UNDO_REFRESH_DELAY_MS);
      await refreshOffers(selectedOfferLayerIndexRef.current);
    } catch (caught) {
      const message = getMessage(caught);
      onStatus(message);
      appendLog(message);
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
