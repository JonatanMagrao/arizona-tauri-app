import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_TOAST = Object.freeze({
  open: false,
  message: "",
  variant: "error",
});

export function useAutoHideToast(timeoutMs = 5000) {
  const [toast, setToast] = useState(DEFAULT_TOAST);
  const hideTimerRef = useRef(null);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const hideToast = useCallback(() => {
    clearHideTimer();
    setToast((current) => ({ ...current, open: false }));
  }, [clearHideTimer]);

  const showToast = useCallback((message, variant = "error") => {
    clearHideTimer();
    setToast({ open: true, message, variant });
    hideTimerRef.current = setTimeout(() => {
      setToast((current) => ({ ...current, open: false }));
      hideTimerRef.current = null;
    }, timeoutMs);
  }, [clearHideTimer, timeoutMs]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  return { toast, showToast, hideToast };
}
