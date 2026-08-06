import { useEffect } from "react";
import { csi } from "../../../../lib/utils/bolt";
import { getMessage } from "../../../utils/errors";
import { isEditableOfferTextControl } from "../utils/keyboard";

interface UseOfferShortcutsOptions {
  onStatus: (message: string) => void;
  onUndo: () => void | Promise<void>;
}

const OFFER_KEY_EVENTS = JSON.stringify([
  {
    keyCode: 90,
    ctrlKey: true,
  },
]);

const UNDO_DEDUPE_MS = 250;

const isUndoKeyboardEvent = (event: KeyboardEvent) => {
  if (event.repeat) return false;
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
    return false;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  return key === "z" || event.code === "KeyZ" || event.keyCode === 90;
};

export const useOfferShortcuts = ({
  onStatus,
  onUndo,
}: UseOfferShortcutsOptions) => {
  useEffect(() => {
    if (!window.cep) return;

    csi.registerKeyEventsInterest(OFFER_KEY_EVENTS);

    return () => {
      csi.registerKeyEventsInterest("");
    };
  }, []);

  useEffect(() => {
    let lastUndoTime = 0;

    const triggerUndo = () => {
      const now = Date.now();
      if (now - lastUndoTime < UNDO_DEDUPE_MS) return;

      lastUndoTime = now;

      try {
        void Promise.resolve(onUndo()).catch((caught) =>
          onStatus(getMessage(caught))
        );
      } catch (caught) {
        onStatus(getMessage(caught));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUndoKeyboardEvent(event)) return;
      if (isEditableOfferTextControl(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      triggerUndo();
    };

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo") return;
      if (isEditableOfferTextControl(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      triggerUndo();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("beforeinput", handleBeforeInput, true);
    };
  }, [onStatus, onUndo]);
};
