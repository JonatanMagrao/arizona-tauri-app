import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DuplicateIdenticalModal from "./DuplicateIdenticalModal";
import HistoryWindow from "./HistoryWindow";
import previewImg from "./assets/hierarquia_pracas.jpg";
import { commandNames, invokeAction } from "./lib/tauriCommands";

const DEFAULT_SECONDARY_STATE = {
  view: "places",
  jobaoCod: "",
  mediaPath: "",
  mediaKind: "video",
  mediaTitle: "",
};

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
    pauseWindowMedia();
    const result = await invokeAction(
      commandNames.closeSecondaryWindow,
      {},
      "Não foi possível fechar a janela."
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

  if (state.view === "media") {
    return (
      <MediaView
        key={`media-${state.mediaPath}`}
        state={state}
        showError={(message) => showToast(message, "error")}
      />
    );
  }

  return <PlacesView />;
}

function PlacesView() {
  return (
    <main className="secondary-places" aria-label="Praças CRF">
      <img src={previewImg} alt="Praças CRF" />
    </main>
  );
}

function MediaView({ state, showError }) {
  const mediaRef = useRef(null);
  const controlsHideTimerRef = useRef(null);
  const nativeFallbackRef = useRef(false);
  const autoplayAttemptRef = useRef(false);
  const [mediaError, setMediaError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const mediaKind = state.mediaKind === "audio" ? "audio" : "video";
  const mediaPath = state.mediaPath;
  const mediaTitle = state.mediaTitle || fileNameFromPath(mediaPath) || "Mídia";
  const mediaSrc = useMemo(() => pathToMediaSrc(mediaPath), [mediaPath]);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const controlsClass = mediaKind === "video" && !controlsVisible
    ? "media-controls--hidden"
    : "media-controls--visible";

  useEffect(() => {
    setMediaError("");
    nativeFallbackRef.current = false;
    autoplayAttemptRef.current = false;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setControlsVisible(true);
  }, [mediaPath]);

  useEffect(() => {
    if (mediaRef.current) {
      autoplayAttemptRef.current = false;
      mediaRef.current.load();
    }
  }, [mediaSrc]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      showControls();
      togglePlayback();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (mediaKind === "video" && mediaSrc) {
      scheduleControlsHide();
    } else {
      clearControlsHideTimer();
      setControlsVisible(true);
    }

    return clearControlsHideTimer;
  }, [mediaKind, mediaSrc]);

  const clearControlsHideTimer = () => {
    if (!controlsHideTimerRef.current) return;
    clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  };

  const scheduleControlsHide = () => {
    if (mediaKind !== "video") return;
    clearControlsHideTimer();
    controlsHideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
      controlsHideTimerRef.current = null;
    }, 2600);
  };

  const showControls = () => {
    setControlsVisible(true);
    scheduleControlsHide();
  };

  const syncMediaState = () => {
    const media = mediaRef.current;
    if (!media) return;

    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    setCurrentTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
    setIsPlaying(!media.paused && !media.ended);
  };

  const togglePlayback = async () => {
    const media = mediaRef.current;
    if (!media || !mediaSrc) return;

    if (media.paused || media.ended) {
      try {
        setMediaError("");
        await media.play();
      } catch (error) {
        await openNativeMediaFallback();
      }
      return;
    }

    media.pause();
  };

  const handleSurfaceClick = () => {
    showControls();
    togglePlayback();
  };

  const handleSeek = (event) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;

    showControls();
    setCurrentTime(nextTime);
    if (mediaRef.current) mediaRef.current.currentTime = nextTime;
  };

  const handleControlClick = (event) => {
    event.stopPropagation();
    showControls();
  };

  const attemptAutoplay = async () => {
    const media = mediaRef.current;
    if (!media || !mediaSrc || autoplayAttemptRef.current) return;

    autoplayAttemptRef.current = true;
    try {
      await media.play();
    } catch (error) {
      // O clique/tecla continuam disponíveis caso o WebView bloqueie autoplay.
    }
  };

  const openNativeMediaFallback = async () => {
    const message = playbackErrorMessage(mediaPath);
    setMediaError(`${message} Abrindo no visualizador do sistema.`);
    showError(message);

    if (nativeFallbackRef.current || !mediaPath) return;
    nativeFallbackRef.current = true;
    if (mediaRef.current) mediaRef.current.pause();

    const result = await invokeAction(
      commandNames.openMediaNative,
      { mediaPath },
      "Não foi possível abrir no visualizador do sistema."
    );

    if (!result.ok) {
      setMediaError(result.message);
      showError(result.message);
    }
  };

  const mediaProps = {
    ref: mediaRef,
    autoPlay: true,
    preload: "metadata",
    onLoadedMetadata: syncMediaState,
    onCanPlay: () => {
      syncMediaState();
      attemptAutoplay();
    },
    onDurationChange: syncMediaState,
    onTimeUpdate: syncMediaState,
    onPlay: syncMediaState,
    onPause: syncMediaState,
    onEnded: syncMediaState,
    onError: () => {
      openNativeMediaFallback();
    },
  };

  return (
    <main className={`media-view media-view--${mediaKind}`} aria-label={mediaTitle}>
      <section className="media-stage" onPointerMove={mediaKind === "video" ? showControls : undefined}>
        {!mediaSrc && <div className="media-empty">Mídia não encontrada.</div>}
        {mediaError && <div className="media-error">{mediaError}</div>}

        {mediaSrc && mediaKind === "video" && (
          <video
            className="media-element"
            playsInline
            onClick={handleSurfaceClick}
            {...mediaProps}
          >
            <source src={mediaSrc} type={videoMimeType(mediaPath)} />
          </video>
        )}

        {mediaSrc && mediaKind === "audio" && (
          <div className="media-audio-stage" onClick={handleSurfaceClick}>
            <div className="media-audio-mark" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <strong title={mediaTitle}>{mediaTitle}</strong>
            <audio className="media-hidden-audio" {...mediaProps}>
              <source src={mediaSrc} type={audioMimeType(mediaPath)} />
            </audio>
          </div>
        )}
      </section>

      <footer
        className={`media-controls ${controlsClass}`}
        onClick={handleControlClick}
        onPointerDown={showControls}
        onPointerMove={showControls}
      >
        <button
          type="button"
          className="media-play-btn"
          onClick={togglePlayback}
          disabled={!mediaSrc}
          aria-label={isPlaying ? "Pausar" : "Reproduzir"}
          title={isPlaying ? "Pausar" : "Reproduzir"}
        >
          <span
            className={`media-play-icon ${isPlaying ? "media-play-icon--pause" : "media-play-icon--play"}`}
            aria-hidden="true"
          ></span>
        </button>
        <input
          className="media-timeline"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          disabled={!duration}
          aria-label="Linha do tempo"
          style={{
            background: `linear-gradient(90deg, var(--primary) 0%, var(--primary) ${progress}%, #2b3037 ${progress}%, #2b3037 100%)`,
          }}
        />
        <div className="media-time" aria-live="off">
          {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
        </div>
      </footer>
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
      mediaPath: params.get("path") || "",
      mediaKind: params.get("kind") || "video",
      mediaTitle: params.get("title") || "",
    });
  } catch (error) {
    return DEFAULT_SECONDARY_STATE;
  }
}

function normalizeSecondaryState(payload) {
  const rawView = String(payload?.view || "").trim();
  const view = normalizeView(rawView);
  const jobaoCod = String(payload?.jobaoCod || payload?.jobao_cod || "").trim();
  const mediaPath = String(payload?.mediaPath || payload?.media_path || "").trim();
  const mediaTitle = String(payload?.mediaTitle || payload?.media_title || "").trim();
  const rawMediaKind = String(payload?.mediaKind || payload?.media_kind || "").trim().toLowerCase();
  const mediaKind = rawMediaKind === "audio" ? "audio" : "video";

  return {
    view,
    jobaoCod,
    mediaPath,
    mediaKind,
    mediaTitle,
  };
}

function normalizeView(value) {
  if (value === "duplicate-identical") return "duplicate";
  if (value === "midia") return "media";
  if (["duplicate", "history", "places", "media"].includes(value)) return value;
  return DEFAULT_SECONDARY_STATE.view;
}

function pathToMediaSrc(path) {
  if (!path) return "";

  try {
    return convertFileSrc(path);
  } catch (error) {
    const normalized = path.replace(/\\/g, "/");
    return /^[a-zA-Z]:\//.test(normalized) ? `file:///${encodeURI(normalized)}` : encodeURI(normalized);
  }
}

function fileNameFromPath(path) {
  return String(path || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || "";
}

function fileExtension(path) {
  const fileName = fileNameFromPath(path);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

function videoMimeType(path) {
  const extension = fileExtension(path);
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp4") return "video/mp4";
  return "video/mp4";
}

function audioMimeType(path) {
  const extension = fileExtension(path);
  const types = {
    aac: "audio/aac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    wma: "audio/x-ms-wma",
  };

  return types[extension] || "audio/mpeg";
}

function playbackErrorMessage(path) {
  if (fileExtension(path) === "mov") {
    return "Não foi possível reproduzir o MOV nesta janela. Se o arquivo usa ProRes, Animation ou outro codec QuickTime, o WebView do Windows não consegue decodificar.";
  }

  return "Não foi possível reproduzir a mídia.";
}

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return ["input", "textarea", "select", "button"].includes(tagName) || Boolean(target?.isContentEditable);
}

function formatMediaTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondsText = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  }

  return `${minutes}:${secondsText}`;
}

function pauseWindowMedia() {
  document.querySelectorAll("audio, video").forEach((media) => {
    if (typeof media.pause === "function") media.pause();
  });
}

export default SecondaryWindow;
