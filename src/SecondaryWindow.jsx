import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DuplicateIdenticalModal from "./DuplicateIdenticalModal";
import HistoryWindow from "./HistoryWindow";
import previewImg from "./assets/hierarquia_pracas.jpg";
import { commandNames, invokeAction } from "./lib/tauriCommands";

const DEFAULT_SECONDARY_STATE = { view: "places", jobaoCod: "" };

function SecondaryWindow() {
  const [toast, setToast] = useState({ open: false, message: "", variant: "error" });
  const [secondaryState, setSecondaryState] = useState(getInitialSecondaryState);
  const hideTimerRef = useRef(null);

  const hideToast = () => {
    setToast((current) => ({ ...current, open: false }));
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const showToast = (message, variant = "error") => {
    setToast({ open: true, message, variant });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(hideToast, 5000);
  };

  const closeWindow = async () => {
    const result = await invokeAction(
      commandNames.closeSecondaryWindow,
      {},
      "Nao foi possivel fechar a janela."
    );

    if (!result.ok) showToast(result.message, "error");
  };

  useEffect(() => {
    const handleStateChange = (event) => {
      setSecondaryState(normalizeSecondaryState(event.detail));
    };
    let unlistenClose = null;

    window.addEventListener("arizona-secondary:set-view", handleStateChange);
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await closeWindow();
      })
      .then((unlisten) => {
        unlistenClose = unlisten;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("arizona-secondary:set-view", handleStateChange);
      if (unlistenClose) unlistenClose();
      hideToast();
    };
  }, []);

  return (
    <div className="secondary-window">
      {renderSecondaryView(secondaryState, closeWindow, showToast)}

      {toast.open && (
        <div
          className={`toast ${toast.variant === "error" ? "toast--error" : toast.variant === "success" ? "toast--success" : ""}`}
          role="alert"
          aria-live="polite"
        >
          <span className="toast__text">{toast.message}</span>
          <button className="toast__close" onClick={hideToast} aria-label="Fechar">x</button>
        </div>
      )}
    </div>
  );
}

function renderSecondaryView(state, closeWindow, showToast) {
  if (state.view === "duplicate") {
    return (
      <DuplicateIdenticalModal
        key={`duplicate-${state.jobaoCod}`}
        initialJobaoCod={state.jobaoCod}
        onClose={closeWindow}
        showError={(message) => showToast(message, "error")}
        showSuccess={(message) => showToast(message, "success")}
        standalone
        closeOnSuccess={false}
      />
    );
  }

  if (state.view === "history") {
    return <HistoryWindow key="history" />;
  }

  return <PlacesView />;
}

function PlacesView() {
  return (
    <main className="secondary-places" aria-label="Pracas CRF">
      <img src={previewImg} alt="Pracas CRF" />
    </main>
  );
}

function getInitialSecondaryState() {
  if (window.__ARIZONA_SECONDARY_STATE__) {
    return normalizeSecondaryState(window.__ARIZONA_SECONDARY_STATE__);
  }

  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeSecondaryState({
      view: params.get("view"),
      jobaoCod: params.get("jobao") || "",
    });
  } catch (error) {
    return DEFAULT_SECONDARY_STATE;
  }
}

function normalizeSecondaryState(payload) {
  const rawView = String(payload?.view || "").trim();
  const view = normalizeView(rawView);
  const jobaoCod = String(payload?.jobaoCod || payload?.jobao_cod || "").trim();

  return { view, jobaoCod };
}

function normalizeView(value) {
  if (value === "duplicate-identical") return "duplicate";
  if (["duplicate", "history", "places"].includes(value)) return value;
  return DEFAULT_SECONDARY_STATE.view;
}

export default SecondaryWindow;
