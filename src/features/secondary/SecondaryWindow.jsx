import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import AdminWindow from "../admin/AdminWindow";
import DuplicateIdenticalModal from "../duplicates/DuplicateIdenticalModal";
import HistoryWindow from "../history/HistoryWindow";
import RoteiroViewer from "./RoteiroViewer";
import AppDropdown from "../../components/AppDropdown";
import previewImg from "../../assets/hierarquia_pracas.jpg";
import { useAutoHideToast } from "../../hooks/useAutoHideToast";
import { commandNames, invokeAction, invokeCommand } from "../../services/tauriCommands";
import { formatDuration } from "../../utils/formatters";
import { normalizeProductReport } from "../../utils/productReport";
import { publicErrorMessage } from "../../utils/publicErrors";
import {
  DEFAULT_SETTINGS,
  normalizeFourDigits,
  normalizeSettings,
} from "../../utils/settings";
import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import closeFullscreenIcon from "../../assets/icones/close_fullscreen.svg";
import openInFullIcon from "../../assets/icones/open_in_full.svg";
import { releaseCurrentDevice, releaseDeviceErrorMessage } from "../../services/auth";

const DEFAULT_SECONDARY_STATE = {
  view: "places",
  jobaoCod: "",
  mediaPath: "",
  mediaKind: "video",
  mediaTitle: "",
  mediaLoading: false,
  mediaError: "",
  roteiroDocument: null,
  productReport: null,
  adminAuth: null,
  sessionAuth: null,
};

const AFTER_EFFECTS_SHORTCUT_ACTIONS = Object.freeze([
  {
    field: "moveLayersBackwardShortcut",
    label: "Mover Layers Atrás",
    placeholder: "Ctrl+Numpad1",
  },
  {
    field: "moveLayersForwardShortcut",
    label: "Mover Layers Frente",
    placeholder: "Ctrl+Numpad3",
  },
  {
    field: "moveJumpMarkerShortcut",
    label: "Mover Jump",
    placeholder: "Ctrl+Numpad2",
  },
  {
    field: "selectJumpMarkerLayerShortcut",
    label: "Selecionar Oferta",
    placeholder: "Ctrl+Numpad0",
  },
  {
    field: "adjustMarkersShortcut",
    label: "Reset Markers",
    placeholder: "Ctrl+NumpadDecimal",
  },
  {
    field: "swapLayersShortcut",
    label: "Trocar Layers",
    placeholder: "Ctrl+Numpad5",
  },
  {
    field: "exportPrintFramesShortcut",
    label: "Exportar Prints",
    placeholder: "Ctrl+Numpad6",
    settings: [
      {
        field: "exportPrintCompName",
        label: "Precomp dos prints",
        placeholder: "EXPORT",
      },
    ],
    settingsSavedMessage: "Precomp dos prints salva.",
  },
  {
    field: "renderShortcut",
    label: "Render",
    placeholder: "Ctrl+NumpadEnter",
    settings: [
      {
        field: "renderMovTemplateName",
        label: "Template MOV",
        placeholder: "PROXY",
      },
      {
        field: "renderMp4TemplateName",
        label: "Template MP4",
        placeholder: "MP4",
      },
    ],
    settingsSavedMessage: "Templates locais de render salvos.",
  },
]);
const AFTER_EFFECTS_SHORTCUT_FIELDS = Object.freeze(
  AFTER_EFFECTS_SHORTCUT_ACTIONS.map((action) => action.field)
);

const SETTINGS_TABS = Object.freeze({
  GENERAL: "general",
  AFTER_SHORTCUTS: "afterShortcuts",
  DIAGNOSTICS: "diagnostics",
  EXTENSION: "extension",
});

const CEP_DEV_LINK_MESSAGE =
  "Esta pasta é um atalho para a sua build local da extensão (máquina de desenvolvimento).";

const NUMERIC_SETTINGS_SAVE_DELAY_MS = 1000;
const TEXT_SETTINGS_SAVE_DELAY_MS = 1500;

function SecondaryWindow() {
  const { toast, showToast, hideToast } = useAutoHideToast();
  const [secondaryState, setSecondaryState] = useState(getInitialSecondaryState);
  const [duplicateOpenSequence, setDuplicateOpenSequence] = useState(0);
  const title = useMemo(() => secondaryWindowTitle(secondaryState), [secondaryState]);

  const handleAdminAccessRestricted = async () => {
    await invokeCommand(commandNames.restrictAdminSession).catch(() => {});
  };

  const closeWindow = async () => {
    pauseWindowMedia();
    const result = await invokeAction(
      commandNames.closeSecondaryWindow,
      {},
      "Não foi possível fechar a janela."
    );

    if (!result.ok) {
      showToast(result.message, "error");
      return;
    }

    hideToast();
    setSecondaryState(DEFAULT_SECONDARY_STATE);
  };

  useEffect(() => {
    const handleStateChange = (event) => {
      const nextState = normalizeSecondaryState(event.detail);
      if (nextState.view === "duplicate") {
        setDuplicateOpenSequence((sequence) => sequence + 1);
      }
      setSecondaryState(nextState);
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
    };
  }, []);

  useEffect(() => {
    const handleReloadShortcut = (event) => {
      const isReloadShortcut = (event.key?.toLowerCase() === "r" && (event.ctrlKey || event.metaKey))
        || event.key === "F5";
      if (!isReloadShortcut) return;

      event.preventDefault();
      event.stopPropagation();

      if (secondaryState.view === "admin") {
        window.dispatchEvent(new Event("arizona-admin:refresh"));
      }
    };

    window.addEventListener("keydown", handleReloadShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleReloadShortcut, { capture: true });
  }, [secondaryState.view]);

  return (
    <div className="secondary-window secondary-window--custom">
      <SecondaryTitlebar title={title} view={secondaryState.view} onClose={closeWindow} />

      <div className="secondary-window__content">
        {renderSecondaryView(
          secondaryState,
          closeWindow,
          showToast,
          handleAdminAccessRestricted,
          duplicateOpenSequence
        )}
      </div>

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

function SecondaryTitlebar({ title, view, onClose }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const isSettingsTitlebar = view === "settings";
  const isDuplicateTitlebar = view === "duplicate";
  const isRoteiroTitlebar = view === "roteiro";
  const useSingleTitle = isSettingsTitlebar || isDuplicateTitlebar || isRoteiroTitlebar;

  useEffect(() => {
    let unlistenResize = null;
    const currentWindow = getCurrentWindow();
    const syncMaximized = () => {
      currentWindow.isMaximized().then(setIsMaximized).catch(() => {});
    };

    syncMaximized();
    currentWindow
      .onResized(syncMaximized)
      .then((unlisten) => {
        unlistenResize = unlisten;
      })
      .catch(() => {});

    return () => {
      if (unlistenResize) unlistenResize();
    };
  }, []);

  const toggleMaximize = async () => {
    const currentWindow = getCurrentWindow();
    try {
      await currentWindow.toggleMaximize();
      setIsMaximized(await currentWindow.isMaximized());
    } catch (error) {
      // O botão permanece silencioso para não interromper fluxos como vídeo/histórico.
    }
  };

  return (
    <header
      className="secondary-titlebar"
      aria-label="Barra da janela"
    >
      <div
        className="secondary-titlebar__brand"
      >
        <img
          className="secondary-titlebar__logo"
          src={appLogo}
          alt=""
          aria-hidden="true"
        />
        <span>{useSingleTitle ? title : "Arizona App"}</span>
      </div>
      <div className="secondary-titlebar__drag">
        {!useSingleTitle && <span>{title}</span>}
      </div>
      <div className="secondary-titlebar__controls">
        <button
          className="titlebar-icon-btn titlebar-icon-btn--maximize"
          onClick={toggleMaximize}
          tabIndex="-1"
          title={isMaximized ? "Restaurar" : "Maximizar"}
          aria-label={isMaximized ? "Restaurar" : "Maximizar"}
        >
          <img src={isMaximized ? closeFullscreenIcon : openInFullIcon} alt="" aria-hidden="true" />
        </button>
        <button
          className="titlebar-icon-btn titlebar-icon-btn--close"
          onClick={onClose}
          tabIndex="-1"
          title="Fechar"
          aria-label="Fechar"
        >
          <img src={closeIcon} alt="" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function renderSecondaryView(state, closeWindow, showToast, onAdminAccessRestricted, duplicateOpenSequence) {
  if (state.view === "duplicate") {
    return (
      <div className="duplicate-window">
        <DuplicateIdenticalModal
          key={`duplicate-${state.jobaoCod}-${duplicateOpenSequence}`}
          initialJobaoCod={state.jobaoCod}
          onClose={closeWindow}
          showError={(message) => showToast(message, "error")}
          showSuccess={(message) => showToast(message, "success")}
          standalone
          closeOnSuccess={false}
        />
      </div>
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

  if (state.view === "roteiro") {
    return (
      <RoteiroViewer
        key={`roteiro-${state.roteiroDocument?.fileName || "empty"}`}
        document={state.roteiroDocument}
        showError={(message) => showToast(message, "error")}
      />
    );
  }

  if (state.view === "products") {
    return <ProductsImportView key={`products-${state.productReport?.jobaoCod || "empty"}`} report={state.productReport} />;
  }

  if (state.view === "settings") {
    return (
      <SettingsView
        key="settings"
        auth={state.sessionAuth}
        showError={(message) => showToast(message, "error")}
        showSuccess={(message) => showToast(message, "success")}
      />
    );
  }

  if (state.view === "admin") {
    return (
      <AdminWindow
        key="admin"
        auth={state.adminAuth}
        showError={(message) => showToast(message, "error")}
        showSuccess={(message) => showToast(message, "success")}
        onAccessRestricted={onAdminAccessRestricted}
      />
    );
  }

  return <PlacesView />;
}

function SettingsView({ auth, showError, showSuccess }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState(SETTINGS_TABS.GENERAL);
  const [persistedSettings, setPersistedSettings] = useState(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [shortcutDraft, setShortcutDraft] = useState(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = useState({ version: "", authorName: "", authorUrl: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReleasingDevice, setIsReleasingDevice] = useState(false);
  const [isReleaseConfirmOpen, setIsReleaseConfirmOpen] = useState(false);
  const [savingShortcutField, setSavingShortcutField] = useState("");
  const [savingShortcutOperation, setSavingShortcutOperation] = useState("");
  const [choosingField, setChoosingField] = useState("");
  const [recordingShortcutField, setRecordingShortcutField] = useState("");
  const [installedAfterEffectsVersions, setInstalledAfterEffectsVersions] = useState([]);
  const [isShortcutRecordingTransition, setIsShortcutRecordingTransition] = useState(false);
  const persistedSettingsRef = useRef(DEFAULT_SETTINGS);
  const autoSaveTimersRef = useRef({});
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;

    Promise.all([
      invokeCommand(commandNames.loadAppConfig),
      invokeCommand(commandNames.listInstalledAfterEffectsVersions),
    ])
      .then(async ([config, detectedVersions]) => {
        if (!mounted) return;
        const versions = [...new Set(
          (Array.isArray(detectedVersions) ? detectedVersions : [])
            .map((version) => String(version || "").trim())
            .filter((version) => /^\d{4}$/.test(version))
        )].sort((left, right) => Number(right) - Number(left));
        let normalized = normalizeSettings(config);

        if (versions.length > 0 && !versions.includes(normalized.aeVersion)) {
          normalized = normalizeSettings({
            ...normalized,
            aeVersion: versions[0],
          });
          normalized = normalizeSettings(
            await invokeCommand(commandNames.saveAppConfig, { config: normalized })
          );
        }

        if (!mounted) return;
        persistedSettingsRef.current = normalized;
        setInstalledAfterEffectsVersions(versions);
        setPersistedSettings(normalized);
        setSettingsDraft(normalized);
        setShortcutDraft(normalized);
      })
      .catch((error) => showError(publicErrorMessage(
        error,
        "Não foi possível carregar as configurações.",
      )))
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    persistedSettingsRef.current = persistedSettings;
  }, [persistedSettings]);

  useEffect(() => () => {
    Object.values(autoSaveTimersRef.current).forEach((timer) => {
      clearTimeout(timer);
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    invokeCommand(commandNames.appInfo)
      .then((info) => {
        if (mounted) setAppInfo(normalizeAppInfo(info));
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const updateSettingsDraft = (field, value) => {
    setSettingsDraft((config) => ({ ...config, [field]: value }));
  };

  const clearSettingsAutoSaveTimer = (field) => {
    const timer = autoSaveTimersRef.current[field];
    if (!timer) return;

    clearTimeout(timer);
    delete autoSaveTimersRef.current[field];
  };

  const saveSettingsPatch = async (patch, successMessage = "Configurações salvas.") => {
    const runSave = async () => {
      const config = normalizeSettings({
        ...persistedSettingsRef.current,
        ...patch,
      });
      const savedFields = Object.keys(patch);

      setIsSaving(true);
      try {
        const saved = await invokeCommand(commandNames.saveAppConfig, {
          config,
        });
        const normalized = normalizeSettings(saved);
        const normalizedPatch = savedFields.reduce((nextPatch, field) => ({
          ...nextPatch,
          [field]: normalized[field],
        }), {});

        persistedSettingsRef.current = normalized;
        setPersistedSettings(normalized);
        setSettingsDraft((current) => ({ ...current, ...normalizedPatch }));
        showSuccess(successMessage);
        return normalized;
      } catch (error) {
        showError(publicErrorMessage(error, "Não foi possível salvar as configurações."));
        return null;
      } finally {
        setIsSaving(false);
      }
    };

    const queuedSave = saveQueueRef.current.catch(() => null).then(runSave);
    saveQueueRef.current = queuedSave.catch(() => null);
    return queuedSave;
  };

  const scheduleSettingsAutoSave = (field, value, { delay, canSave, successMessage }) => {
    clearSettingsAutoSaveTimer(field);
    if (!canSave || isLoading || isReleasingDevice) return;

    const config = normalizeSettings({
      ...persistedSettingsRef.current,
      [field]: value,
    });
    const normalizedValue = config[field] ?? "";
    const currentValue = persistedSettingsRef.current[field] ?? "";
    if (String(normalizedValue) === String(currentValue)) return;

    autoSaveTimersRef.current[field] = setTimeout(() => {
      delete autoSaveTimersRef.current[field];
      saveSettingsPatch({ [field]: normalizedValue }, successMessage);
    }, delay);
  };

  const updateNumericSetting = (field, value, successMessage) => {
    const nextValue = normalizeFourDigits(value);
    updateSettingsDraft(field, nextValue);
    scheduleSettingsAutoSave(field, nextValue, {
      delay: NUMERIC_SETTINGS_SAVE_DELAY_MS,
      canSave: /^\d{4}$/.test(nextValue),
      successMessage,
    });
  };

  const updateProductsSetting = (value) => {
    const nextValue = String(value ?? "");
    const valueToSave = nextValue.trim();
    updateSettingsDraft("produtos", nextValue);
    scheduleSettingsAutoSave("produtos", valueToSave, {
      delay: TEXT_SETTINGS_SAVE_DELAY_MS,
      canSave: Boolean(valueToSave),
      successMessage: "Produtos salvo.",
    });
  };

  const saveAfterActionSettings = async (action) => {
    const actionSettings = action.settings || [];
    const patch = {};

    for (const setting of actionSettings) {
      const value = String(settingsDraft[setting.field] ?? "").trim();
      if (!value) {
        showError(`Informe ${setting.label.toLowerCase()}.`);
        return;
      }
      patch[setting.field] = value;
    }

    await saveSettingsPatch(patch, action.settingsSavedMessage);
  };

  const restoreEmptyAfterActionSetting = (setting, value) => {
    if (String(value ?? "").trim()) return;

    updateSettingsDraft(
      setting.field,
      persistedSettingsRef.current[setting.field] ?? DEFAULT_SETTINGS[setting.field]
    );
  };

  const cancelShortcutRecording = async () => {
    const field = recordingShortcutField;
    if (field) {
      setShortcutDraft((config) => ({
        ...config,
        [field]: persistedSettingsRef.current[field] || "",
      }));
    }
    setRecordingShortcutField("");
    setIsShortcutRecordingTransition(true);
    try {
      await invokeCommand(commandNames.setAfterShortcutRecording, { recording: false });
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível reativar os atalhos do After Effects."));
    } finally {
      setIsShortcutRecordingTransition(false);
    }
  };

  const startShortcutRecording = async (field) => {
    if (isShortcutRecordingTransition) return;

    if (recordingShortcutField === field) {
      await cancelShortcutRecording();
      return;
    }

    setIsShortcutRecordingTransition(true);
    try {
      await invokeCommand(commandNames.setAfterShortcutRecording, { recording: true });
      setShortcutDraft((config) => ({
        ...config,
        [field]: persistedSettingsRef.current[field] || config[field] || "",
      }));
      setRecordingShortcutField(field);
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível pausar os atalhos do After Effects."));
    } finally {
      setIsShortcutRecordingTransition(false);
    }
  };

  const saveShortcut = async (
    field,
    shortcut,
    successMessage = "Atalho salvo.",
    operation = "record"
  ) => {
    const previousShortcut = persistedSettingsRef.current[field] ?? "";
    const nextConfig = normalizeSettings({
      ...persistedSettingsRef.current,
      [field]: shortcut,
    });

    setShortcutDraft((config) => ({ ...config, [field]: shortcut }));
    setRecordingShortcutField("");
    setSavingShortcutField(field);
    setSavingShortcutOperation(operation);

    try {
      const saved = await invokeCommand(commandNames.saveAppConfig, {
        config: nextConfig,
      });
      const normalized = normalizeSettings(saved);
      persistedSettingsRef.current = normalized;
      setPersistedSettings(normalized);
      setShortcutDraft(normalized);
      showSuccess(successMessage);
    } catch (error) {
      setShortcutDraft((config) => ({ ...config, [field]: previousShortcut }));
      showError(publicErrorMessage(error, "Não foi possível salvar o atalho."));
    } finally {
      try {
        await invokeCommand(commandNames.setAfterShortcutRecording, { recording: false });
      } catch (error) {
        showError(publicErrorMessage(error, "Não foi possível reativar os atalhos do After Effects."));
      }
      setSavingShortcutField("");
      setSavingShortcutOperation("");
    }
  };

  const saveShortcutSet = async (shortcutValues, successMessage, operation) => {
    if (recordingShortcutField || isShortcutRecordingTransition || savingShortcutField) return;

    const previousSettings = persistedSettingsRef.current;
    const nextConfig = normalizeSettings({
      ...previousSettings,
      ...shortcutValues,
    });

    setShortcutDraft(nextConfig);
    setSavingShortcutField("all");
    setSavingShortcutOperation(operation);
    try {
      const saved = await invokeCommand(commandNames.saveAppConfig, {
        config: nextConfig,
      });
      const normalized = normalizeSettings(saved);
      persistedSettingsRef.current = normalized;
      setPersistedSettings(normalized);
      setShortcutDraft(normalized);
      showSuccess(successMessage);
    } catch (error) {
      setShortcutDraft(previousSettings);
      showError(publicErrorMessage(error, "Não foi possível atualizar os atalhos."));
    } finally {
      setSavingShortcutField("");
      setSavingShortcutOperation("");
    }
  };

  const restoreDefaultShortcuts = () => {
    const defaults = Object.fromEntries(
      AFTER_EFFECTS_SHORTCUT_FIELDS.map((field) => [field, DEFAULT_SETTINGS[field]])
    );
    return saveShortcutSet(defaults, "Atalhos originais restaurados.", "restore-all");
  };

  const clearAllShortcuts = () => {
    const cleared = Object.fromEntries(
      AFTER_EFFECTS_SHORTCUT_FIELDS.map((field) => [field, ""])
    );
    return saveShortcutSet(cleared, "Atalhos globais desativados.", "clear-all");
  };

  useEffect(() => {
    if (!recordingShortcutField) return undefined;

    const pressedKeys = new Set();
    let pendingShortcut = "";

    const handleShortcutKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      pressedKeys.add(String(event.code || event.key || ""));

      if (event.key === "Escape") {
        pendingShortcut = "";
        cancelShortcutRecording();
        return;
      }

      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;

      pendingShortcut = shortcut;
      setShortcutDraft((config) => ({
        ...config,
        [recordingShortcutField]: shortcut,
      }));
    };

    const handleShortcutKeyUp = (event) => {
      event.preventDefault();
      event.stopPropagation();
      pressedKeys.delete(String(event.code || event.key || ""));

      if (!pendingShortcut || pressedKeys.size > 0) return;
      const shortcut = pendingShortcut;
      pendingShortcut = "";
      saveShortcut(recordingShortcutField, shortcut);
    };

    const handleWindowBlur = () => {
      pendingShortcut = "";
      cancelShortcutRecording();
    };

    window.addEventListener("keydown", handleShortcutKeyDown, { capture: true });
    window.addEventListener("keyup", handleShortcutKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleShortcutKeyDown, { capture: true });
      window.removeEventListener("keyup", handleShortcutKeyUp, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [recordingShortcutField]);

  const chooseFolder = async (field, title) => {
    setChoosingField(field);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string") {
        const nextPath = path.trim();
        if (!nextPath) return;

        updateSettingsDraft(field, nextPath);
        await saveSettingsPatch(
          { [field]: nextPath },
          field === "drive" ? "Drive Carrefour salvo." : "Fotos Flow salvo."
        );
      }
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível selecionar a pasta."));
    } finally {
      setChoosingField("");
    }
  };

  const openAuthorSite = async () => {
    const result = await invokeAction(
      commandNames.openAuthorSite,
      {},
      "Não foi possível abrir o site."
    );

    if (!result.ok) showError(result.message);
  };

  const requestReleaseDeviceAndExit = () => {
    if (!auth?.organizationId || !auth?.currentMemberId) {
      showError("Sua sessão está incompleta. Entre novamente para liberar este computador.");
      return;
    }

    setIsReleaseConfirmOpen(true);
  };

  const releaseDeviceAndExit = async () => {
    if (!auth?.organizationId || !auth?.currentMemberId) {
      showError("Sua sessão está incompleta. Entre novamente para liberar este computador.");
      return;
    }

    setIsReleaseConfirmOpen(false);
    setIsReleasingDevice(true);
    try {
      await releaseCurrentDevice();
      await invokeCommand(commandNames.exitApp);
    } catch (error) {
      showError(releaseDeviceErrorMessage(error));
      setIsReleasingDevice(false);
    }
  };

  useEffect(() => {
    if (!isReleaseConfirmOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape" && !isReleasingDevice) {
        setIsReleaseConfirmOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isReleaseConfirmOpen, isReleasingDevice]);

  const busy = isLoading
    || isReleasingDevice
    || isShortcutRecordingTransition
    || Boolean(choosingField)
    || Boolean(savingShortcutField);
  const generalActionBusy = busy || isSaving;
  const shortcutsBusy = busy || isSaving;
  const shortcutSetBusy = shortcutsBusy || Boolean(recordingShortcutField);
  const currentYear = String(new Date().getFullYear());

  return (
    <main className="settings-window settings-window--form" aria-label="Configurações">
      <section className="settings-panel">
        <div className="settings-panel__tabs-row">
          <nav className="settings-tabs" role="tablist" aria-label="Configuracoes">
            <button
              type="button"
              className={`settings-tab ${activeSettingsTab === SETTINGS_TABS.GENERAL ? "settings-tab--active" : ""}`}
              onClick={() => {
                cancelShortcutRecording();
                setActiveSettingsTab(SETTINGS_TABS.GENERAL);
              }}
              role="tab"
              aria-selected={activeSettingsTab === SETTINGS_TABS.GENERAL}
            >
              Ambiente
            </button>
            <button
              type="button"
              className={`settings-tab ${activeSettingsTab === SETTINGS_TABS.AFTER_SHORTCUTS ? "settings-tab--active" : ""}`}
              onClick={() => {
                cancelShortcutRecording();
                setActiveSettingsTab(SETTINGS_TABS.AFTER_SHORTCUTS);
              }}
              role="tab"
              aria-selected={activeSettingsTab === SETTINGS_TABS.AFTER_SHORTCUTS}
            >
              Atalhos After
            </button>
            <button
              type="button"
              className={`settings-tab ${activeSettingsTab === SETTINGS_TABS.EXTENSION ? "settings-tab--active" : ""}`}
              onClick={() => {
                cancelShortcutRecording();
                setActiveSettingsTab(SETTINGS_TABS.EXTENSION);
              }}
              role="tab"
              aria-selected={activeSettingsTab === SETTINGS_TABS.EXTENSION}
            >
              Extensão
            </button>
            <button
              type="button"
              className={`settings-tab ${activeSettingsTab === SETTINGS_TABS.DIAGNOSTICS ? "settings-tab--active" : ""}`}
              onClick={() => {
                cancelShortcutRecording();
                setActiveSettingsTab(SETTINGS_TABS.DIAGNOSTICS);
              }}
              role="tab"
              aria-selected={activeSettingsTab === SETTINGS_TABS.DIAGNOSTICS}
            >
              Diagnóstico
            </button>
          </nav>
          {appInfo.version && <span className="settings-version">v{appInfo.version}</span>}
        </div>

        <form className="settings-form settings-form--window" onSubmit={(event) => event.preventDefault()}>
          {activeSettingsTab === SETTINGS_TABS.GENERAL && (
            <section className="settings-tab-panel" role="tabpanel">
          <label className="settings-field settings-field--drive">
            <span>Carrefour Drive</span>
            <div className="settings-drive-row settings-path-row">
              <input
                className="input settings-drive-input"
                type="text"
                value={settingsDraft.drive}
                readOnly
                title={settingsDraft.drive}
                disabled={isLoading}
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => chooseFolder("drive", "Selecionar Carrefour Drive")}
                disabled={busy}
              >
                {choosingField === "drive" ? "..." : "Selecionar"}
              </button>
            </div>
          </label>

          <label className="settings-field settings-field--drive">
            <span>Fotos Flow</span>
            <div className="settings-drive-row settings-path-row">
              <input
                className="input settings-drive-input"
                type="text"
                value={settingsDraft.produtosPath}
                readOnly
                title={settingsDraft.produtosPath}
                disabled={isLoading}
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => chooseFolder("produtosPath", "Selecionar Fotos Flow")}
                disabled={busy}
              >
                {choosingField === "produtosPath" ? "..." : "Selecionar"}
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span>Vers&atilde;o After Effects</span>
            <AppDropdown
              className="settings-version-dropdown"
              value={settingsDraft.aeVersion}
              onChange={(version) => updateNumericSetting("aeVersion", version, "Versão do After Effects salva.")}
              disabled={generalActionBusy || installedAfterEffectsVersions.length === 0}
              options={installedAfterEffectsVersions.length > 0
                ? installedAfterEffectsVersions.map((version) => ({
                    value: version,
                    label: version,
                  }))
                : [{
                    value: settingsDraft.aeVersion,
                    label: "Nenhuma versão encontrada",
                    disabled: true,
                  }]}
              ariaLabel="Versão do After Effects"
            />
          </label>

          <label className="settings-field">
            <span>Produtos</span>
            <input
              className="input settings-short-input"
              type="text"
              value={settingsDraft.produtos}
              onChange={(event) => updateProductsSetting(event.target.value)}
              placeholder="PRODUTOS"
              autoComplete="off"
              disabled={isLoading || isReleasingDevice}
            />
          </label>

          <label className="settings-field">
            <span>Projetos Ano</span>
            <input
              className="input settings-short-input"
              type="text"
              value={settingsDraft.produtosYear}
              onChange={(event) => updateNumericSetting("produtosYear", event.target.value, "Projetos Ano salvo.")}
              placeholder={currentYear}
              autoComplete="off"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              disabled={isLoading || isReleasingDevice}
            />
          </label>

            </section>
          )}

          {activeSettingsTab === SETTINGS_TABS.AFTER_SHORTCUTS && (
          <section className="settings-after-shortcuts settings-tab-panel" aria-label="Atalhos After" role="tabpanel">
            <header className="settings-after-shortcuts__header">
              <div>
                <h2>Atalhos globais do After Effects</h2>
                <p>Campos sem atalho não ocupam combinações globais no Windows. Os nomes ao lado valem para as ações locais.</p>
              </div>
              <div className="settings-after-shortcuts__actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={restoreDefaultShortcuts}
                  disabled={shortcutSetBusy}
                >
                  {savingShortcutOperation === "restore-all" ? "Restaurando..." : "Restaurar atalhos"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline settings-shortcuts-clear"
                  onClick={clearAllShortcuts}
                  disabled={shortcutSetBusy}
                >
                  {savingShortcutOperation === "clear-all" ? "Limpando..." : "Limpar todos"}
                </button>
              </div>
            </header>
            {AFTER_EFFECTS_SHORTCUT_ACTIONS.map((action) => {
              const isRecording = recordingShortcutField === action.field;
              const isSavingShortcut = savingShortcutField === action.field;
              const shortcutValue = shortcutDraft[action.field] || "";
              const rowActionDisabled = shortcutsBusy || Boolean(recordingShortcutField);
              const actionSettings = action.settings || [];
              const actionSettingsChanged = actionSettings.some((setting) => (
                String(settingsDraft[setting.field] ?? "").trim()
                  !== String(persistedSettings[setting.field] ?? "").trim()
              ));
              const labelId = `after-action-label-${action.field}`;
              return (
                <div
                  className="settings-field settings-after-action-row"
                  key={action.field}
                  role="group"
                  aria-labelledby={labelId}
                >
                  <span id={labelId}>{action.label}</span>
                  <div className="settings-after-action-controls">
                    <div className="settings-shortcut-row">
                      <input
                        className="input settings-short-input"
                        type="text"
                        value={shortcutDraft[action.field]}
                        placeholder="Sem atalho"
                        title={`Padrão: ${action.placeholder}`}
                        aria-label={`Atalho para ${action.label}`}
                        autoComplete="off"
                        readOnly
                        disabled={shortcutsBusy || (Boolean(recordingShortcutField) && !isRecording)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => saveShortcut(
                          action.field,
                          DEFAULT_SETTINGS[action.field],
                          "Atalho original restaurado.",
                          "restore"
                        )}
                        disabled={rowActionDisabled || shortcutValue === DEFAULT_SETTINGS[action.field]}
                      >
                        {isSavingShortcut && savingShortcutOperation === "restore" ? "Restaurando..." : "Padrão"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline settings-shortcuts-clear"
                        onClick={() => saveShortcut(
                          action.field,
                          "",
                          "Atalho global desativado.",
                          "clear"
                        )}
                        disabled={rowActionDisabled || !shortcutValue}
                      >
                        {isSavingShortcut && savingShortcutOperation === "clear" ? "Limpando..." : "Limpar"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => startShortcutRecording(action.field)}
                        disabled={shortcutsBusy || (Boolean(recordingShortcutField) && !isRecording)}
                        aria-pressed={isRecording}
                      >
                        {isSavingShortcut && savingShortcutOperation === "record"
                          ? "Salvando..."
                          : isRecording ? "Cancelar" : "Gravar"}
                      </button>
                    </div>
                    {actionSettings.length > 0 && (
                      <div className="settings-after-action-options">
                        {actionSettings.map((setting) => (
                          <label className="settings-after-action-option" key={setting.field}>
                            <span>{setting.label}</span>
                            <input
                              className="input"
                              type="text"
                              value={settingsDraft[setting.field]}
                              onChange={(event) => updateSettingsDraft(
                                setting.field,
                                event.target.value.slice(0, 100)
                              )}
                              onBlur={(event) => restoreEmptyAfterActionSetting(
                                setting,
                                event.currentTarget.value
                              )}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                saveAfterActionSettings(action);
                              }}
                              placeholder={setting.placeholder}
                              title={`Padrão: ${setting.placeholder}`}
                              autoComplete="off"
                              spellCheck={false}
                              maxLength={100}
                              disabled={shortcutsBusy || Boolean(recordingShortcutField)}
                            />
                          </label>
                        ))}
                        <button
                          type="button"
                          className="btn btn-outline settings-after-action-save"
                          onClick={() => saveAfterActionSettings(action)}
                          disabled={shortcutsBusy || Boolean(recordingShortcutField) || !actionSettingsChanged}
                        >
                          {isSaving ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
          )}

          {activeSettingsTab === SETTINGS_TABS.EXTENSION && (
            <ExtensionSettingsPanel showError={showError} showSuccess={showSuccess} />
          )}

          {activeSettingsTab === SETTINGS_TABS.DIAGNOSTICS && (
            <DiagnosticsSettingsPanel showError={showError} showSuccess={showSuccess} />
          )}

          <footer className="settings-actions settings-actions--window">
            <div className="settings-credit">
              {appInfo.authorName && (
                <>
                  <span>Desenvolvido por:</span>
                  <button type="button" className="settings-credit__link" onClick={openAuthorSite}>
                    {appInfo.authorName}
                  </button>
                </>
              )}
            </div>
            {activeSettingsTab === SETTINGS_TABS.GENERAL && (
              <button
                type="button"
                className="btn btn-outline settings-release-button"
                onClick={requestReleaseDeviceAndExit}
                disabled={generalActionBusy || !auth?.organizationId || !auth?.currentMemberId}
              >
                {isReleasingDevice ? "Liberando..." : "Liberar e sair"}
              </button>
            )}
          </footer>
        </form>

        {isReleaseConfirmOpen && (
          <div className="settings-confirm-backdrop" role="presentation">
            <section
              className="settings-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settingsReleaseTitle"
            >
              <header className="settings-confirm-header">
                <h2 id="settingsReleaseTitle">Liberar este acesso?</h2>
              </header>
              <p>
                Este dispositivo será liberado. A sessão local será apagada e o Arizona App será fechado.
              </p>
              <div className="settings-confirm-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsReleaseConfirmOpen(false)}
                  disabled={isReleasingDevice}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-outline settings-release-button"
                  onClick={releaseDeviceAndExit}
                  disabled={isReleasingDevice}
                >
                  {isReleasingDevice ? "Liberando..." : "Liberar e sair"}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function DiagnosticsSettingsPanel({ showError, showSuccess }) {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");

  const refreshStatus = async () => {
    try {
      const nextStatus = await invokeCommand(commandNames.diagnosticsStatus);
      setStatus(normalizeDiagnosticsStatus(nextStatus));
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível consultar os diagnósticos locais."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const changeDirectory = async (directory) => {
    setBusyAction("directory");
    try {
      const nextStatus = normalizeDiagnosticsStatus(
        await invokeCommand(commandNames.diagnosticsSetDirectory, { directory })
      );
      setStatus(nextStatus);
      const moved = nextStatus.movedFiles;
      if (nextStatus.warnings.length > 0) {
        showError(nextStatus.warnings.join(" "));
      } else {
        showSuccess(
          moved === 1
            ? "Pasta alterada e 1 arquivo de diagnóstico foi movido."
            : `Pasta alterada e ${moved} arquivos de diagnóstico foram movidos.`
        );
      }
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível alterar a pasta dos diagnósticos."));
    } finally {
      setBusyAction("");
    }
  };

  const chooseDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecionar pasta dos diagnósticos",
        defaultPath: status?.directory || undefined,
      });
      const directory = Array.isArray(selected) ? selected[0] : selected;
      if (typeof directory === "string" && directory.trim()) {
        await changeDirectory(directory.trim());
      }
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível selecionar a pasta."));
    }
  };

  const openDirectory = async () => {
    setBusyAction("open");
    try {
      await invokeCommand(commandNames.diagnosticsOpenDirectory);
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível abrir a pasta dos diagnósticos."));
    } finally {
      setBusyAction("");
    }
  };

  const exportDiagnostics = async () => {
    try {
      const destination = await save({
        title: "Exportar diagnóstico do Arizona",
        defaultPath: `Arizona-diagnostico-${localDateStamp()}.zip`,
        filters: [{ name: "Arquivo ZIP", extensions: ["zip"] }],
      });
      if (typeof destination !== "string" || !destination.trim()) return;

      setBusyAction("export");
      const result = await invokeCommand(commandNames.diagnosticsExport, {
        destination: destination.trim(),
      });
      showSuccess(
        Number(result?.fileCount) === 1
          ? "Diagnóstico exportado com 1 arquivo."
          : `Diagnóstico exportado com ${Number(result?.fileCount) || 0} arquivos.`
      );
      await refreshStatus();
    } catch (error) {
      showError(
        "Não foi possível exportar o diagnóstico. Verifique a pasta dos registros, o destino escolhido e tente novamente."
      );
    } finally {
      setBusyAction("");
    }
  };

  const busy = isLoading || Boolean(busyAction);
  const fileCount = Number(status?.fileCount) || 0;

  return (
    <section className="settings-tab-panel settings-diagnostics" role="tabpanel" aria-label="Diagnóstico local">
      <div className="settings-diagnostics-card">
        <header>
          <div>
            <h2>Registros locais do Arizona</h2>
            <p>
              O aplicativo e a extensão registram apenas informações técnicas neste computador.
              Nada é enviado automaticamente.
            </p>
          </div>
          <span className="settings-diagnostics-retention">
            {status?.retentionDays || 14} dias
          </span>
        </header>

        <label className="settings-field settings-diagnostics-path">
          <span>Pasta dos registros</span>
          <div className="settings-path-row settings-path-row--clearable">
            <input
              className="input settings-drive-input"
              type="text"
              value={status?.directory || "Carregando..."}
              title={status?.directory || ""}
              readOnly
              disabled={isLoading}
            />
            <button type="button" className="btn btn-outline" onClick={chooseDirectory} disabled={busy}>
              {busyAction === "directory" ? "Movendo..." : "Escolher"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => changeDirectory(null)}
              disabled={busy || (!status?.isCustom && status?.warnings?.length === 0)}
            >
              Padrão
            </button>
          </div>
        </label>

        <dl className="settings-diagnostics-summary">
          <div>
            <dt>Arquivos atuais</dt>
            <dd>{fileCount}</dd>
          </div>
          <div>
            <dt>Espaço utilizado</dt>
            <dd>{formatFileSize(status?.totalSizeBytes)}</dd>
          </div>
          <div>
            <dt>Limpeza automática</dt>
            <dd>após {status?.retentionDays || 14} dias</dd>
          </div>
        </dl>

        <p className="settings-diagnostics-note">
          E-mails, credenciais, recibos de licença e códigos de ativação são removidos dos registros.
          Ao ocorrer um erro, o arquivo inclui uma trilha curta das ações anteriores para facilitar o suporte.
        </p>

        {status?.warnings?.length > 0 && (
          <div className="settings-diagnostics-warning" role="status">
            {status.warnings.map((message) => <p key={message}>{message}</p>)}
            {status.usingFallback && status.activeDirectory && (
              <p>Destino temporário: {status.activeDirectory}</p>
            )}
          </div>
        )}

        <div className="settings-diagnostics-actions">
          <button type="button" className="btn btn-outline" onClick={openDirectory} disabled={busy}>
            {busyAction === "open" ? "Abrindo..." : "Abrir pasta"}
          </button>
          <button type="button" className="btn btn-primary" onClick={exportDiagnostics} disabled={busy}>
            {busyAction === "export" ? "Exportando..." : "Exportar diagnóstico"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ExtensionSettingsPanel({ showError, showSuccess }) {
  const [extensionStatus, setExtensionStatus] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isDebugEnabled, setIsDebugEnabled] = useState(false);
  const [isDebugKnown, setIsDebugKnown] = useState(false);
  const [isTogglingDebug, setIsTogglingDebug] = useState(false);
  const [selectedZxp, setSelectedZxp] = useState(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isInstallConfirmOpen, setIsInstallConfirmOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const dropHandlerRef = useRef(() => {});

  const isDevLink = Boolean(extensionStatus?.isDevLink);
  const installedVersion = extensionStatus?.installed ? extensionStatus.version || "" : "";
  const isReinstall = Boolean(
    selectedZxp?.version && installedVersion && selectedZxp.version === installedVersion
  );
  const installLabel = isReinstall ? "Reinstalar" : "Instalar";
  // The dev link only blocks until it is explicitly replaced; installing then
  // removes the shortcut itself and never the build folder it points at.
  const installBlocked = isLoadingStatus;

  const refreshExtensionStatus = async ({ silent = false } = {}) => {
    if (!silent) setIsLoadingStatus(true);
    try {
      const status = await invokeCommand(commandNames.cepExtensionStatus);
      setExtensionStatus(normalizeCepExtensionStatus(status));
    } catch (error) {
      showError(cepErrorMessage(error, "Não foi possível consultar a extensão instalada."));
    } finally {
      if (!silent) setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    Promise.allSettled([
      invokeCommand(commandNames.cepExtensionStatus),
      invokeCommand(commandNames.cepDebugModeStatus),
    ]).then(([statusResult, debugResult]) => {
      if (!mounted) return;

      if (statusResult.status === "fulfilled") {
        setExtensionStatus(normalizeCepExtensionStatus(statusResult.value));
      } else {
        showError(cepErrorMessage(statusResult.reason, "Não foi possível consultar a extensão instalada."));
      }

      if (debugResult.status === "fulfilled") {
        setIsDebugEnabled(Boolean(debugResult.value?.enabled));
        setIsDebugKnown(true);
      }

      setIsLoadingStatus(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const selectZxpFile = async (path) => {
    const filePath = String(path || "").trim();
    if (!filePath.toLowerCase().endsWith(".zxp")) {
      showError("Selecione um arquivo de instalação válido do painel.");
      return;
    }
    setIsInspecting(true);
    setSelectedZxp(null);
    try {
      const inspection = await invokeCommand(commandNames.inspectCepZxp, { path: filePath });
      setSelectedZxp({
        path: filePath,
        bundleId: String(inspection?.bundleId || "").trim(),
        version: String(inspection?.version || "").trim(),
        trusted: Boolean(inspection?.trusted),
      });
    } catch (error) {
      showError(cepErrorMessage(error, "Não foi possível ler o arquivo de instalação do painel."));
    } finally {
      setIsInspecting(false);
    }
  };

  dropHandlerRef.current = (paths) => {
    if (isInspecting || isInstalling) return;
    if (installBlocked) return;
    if (paths.length !== 1 || !String(paths[0] || "").toLowerCase().endsWith(".zxp")) {
      showError("Arraste apenas um arquivo de instalação do painel.");
      return;
    }
    selectZxpFile(paths[0]);
  };

  useEffect(() => {
    let mounted = true;
    let unlistenDragDrop = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event?.payload;
        if (!payload) return;

        if (payload.type === "enter" || payload.type === "over") {
          setIsDragActive(true);
          return;
        }

        setIsDragActive(false);
        if (payload.type === "drop") {
          dropHandlerRef.current(Array.isArray(payload.paths) ? payload.paths : []);
        }
      })
      .then((unlisten) => {
        if (!mounted) {
          unlisten();
          return;
        }
        unlistenDragDrop = unlisten;
      })
      .catch(() => {});

    return () => {
      mounted = false;
      if (unlistenDragDrop) unlistenDragDrop();
    };
  }, []);

  const chooseZxpFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: "Selecionar arquivo de instalação do painel (.zxp)",
        filters: [{ name: "Painel Arizona", extensions: ["zxp"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string" && path.trim()) {
        await selectZxpFile(path);
      }
    } catch (error) {
      showError(publicErrorMessage(error, "Não foi possível selecionar o arquivo."));
    }
  };

  const installSelectedZxp = async () => {
    if (!selectedZxp?.path || isInstalling) return;

    setIsInstallConfirmOpen(false);
    setIsInstalling(true);
    try {
      const result = await invokeCommand(commandNames.installCepZxp, {
        path: selectedZxp.path,
        replaceDevLink: isDevLink,
      });
      const version = String(result?.version || selectedZxp.version || "").trim();
      showSuccess(
        version
          ? `Extensão v${version} instalada. Reabra o After Effects para carregar a nova versão.`
          : "Extensão instalada. Reabra o After Effects para carregar a nova versão."
      );
      setSelectedZxp(null);
      await refreshExtensionStatus({ silent: true });
    } catch (error) {
      showError(cepErrorMessage(error, "A instalação falhou."));
    } finally {
      setIsInstalling(false);
    }
  };

  const toggleDebugMode = async () => {
    if (isTogglingDebug || !isDebugKnown) return;

    const nextEnabled = !isDebugEnabled;
    setIsTogglingDebug(true);
    try {
      const result = await invokeCommand(commandNames.setCepDebugMode, { enabled: nextEnabled });
      const enabled = Boolean(result?.enabled);
      setIsDebugEnabled(enabled);
      showSuccess(enabled ? "Modo de diagnóstico do painel ativado." : "Modo de diagnóstico do painel desativado.");
    } catch (error) {
      showError(cepErrorMessage(error, "Não foi possível alterar o modo de diagnóstico do painel."));
    } finally {
      setIsTogglingDebug(false);
    }
  };

  useEffect(() => {
    if (!isInstallConfirmOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape" && !isInstalling) {
        setIsInstallConfirmOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isInstallConfirmOpen, isInstalling]);

  return (
    <section className="settings-tab-panel settings-extension" role="tabpanel" aria-label="Extensão do After Effects">
      <div className="settings-ext-card">
        <header className="settings-ext-card__header">
          <h2>Extensão Arizona (After Effects)</h2>
          <div className="settings-ext-card__header-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => refreshExtensionStatus()}
              disabled={isLoadingStatus || isInstalling}
            >
              {isLoadingStatus ? "..." : "Atualizar"}
            </button>
          </div>
        </header>
        <dl className="settings-ext-status">
          <div>
            <dt>Status</dt>
            <dd>
              {isLoadingStatus
                ? "Verificando..."
                : extensionStatus?.installed
                  ? "Instalada"
                  : "Não instalada"}
            </dd>
          </div>
          <div>
            <dt>Versão</dt>
            <dd>{installedVersion ? `v${installedVersion}` : "—"}</dd>
          </div>
        </dl>
        {isDevLink && (
          <p className="settings-ext-note">
            {CEP_DEV_LINK_MESSAGE} Instalar um .zxp aqui substitui esse atalho pela versão do
            arquivo; a pasta de build para onde ele aponta não é apagada.
          </p>
        )}
      </div>

      <div
        className={`settings-ext-dropzone ${isDragActive && !installBlocked ? "settings-ext-dropzone--active" : ""} ${installBlocked ? "settings-ext-dropzone--disabled" : ""}`}
      >
        <p>Arraste o arquivo .zxp aqui</p>
        <button
          type="button"
          className="btn btn-outline"
          onClick={chooseZxpFile}
          disabled={installBlocked || isInspecting || isInstalling}
        >
          {isInspecting ? "Lendo arquivo..." : "Escolher arquivo…"}
        </button>
      </div>

      {selectedZxp && (
        <div className="settings-ext-card settings-ext-selected">
          <div className="settings-ext-selected__info">
            <strong title={selectedZxp.path}>{fileNameFromPath(selectedZxp.path)}</strong>
            <span
              className={`settings-ext-badge ${selectedZxp.trusted ? "settings-ext-badge--signed" : "settings-ext-badge--unsigned"}`}
            >
              {selectedZxp.trusted ? "Assinado pela Arizona" : "Publicador não confiável"}
            </span>
          </div>
          <dl className="settings-ext-status">
            <div title={selectedZxp.bundleId}>
              <dt>Bundle</dt>
              <dd>{selectedZxp.bundleId || "—"}</dd>
            </div>
            <div>
              <dt>Versão do arquivo</dt>
              <dd>{selectedZxp.version ? `v${selectedZxp.version}` : "—"}</dd>
            </div>
            <div>
              <dt>Versão instalada</dt>
              <dd>{installedVersion ? `v${installedVersion}` : "Não instalada"}</dd>
            </div>
          </dl>
          <div className="settings-ext-selected__actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setSelectedZxp(null)}
              disabled={isInstalling}
            >
              Remover
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsInstallConfirmOpen(true)}
              disabled={installBlocked || isInstalling}
            >
              {isInstalling ? "Instalando..." : installLabel}
            </button>
          </div>
        </div>
      )}

      <div className="settings-ext-debug">
        <div className="settings-ext-debug__text">
          <span>Modo de diagnóstico do painel (After Effects)</span>
          <p className="settings-ext-hint">
            Ligue apenas se o painel Arizona não aparecer no After Effects. Requer reiniciar o After
            Effects e afrouxa a verificação de assinatura das extensões.
          </p>
        </div>
        <button
          type="button"
          className={`settings-ext-switch ${isDebugEnabled ? "settings-ext-switch--on" : ""}`}
          role="switch"
          aria-checked={isDebugEnabled}
          aria-label="Modo de diagnóstico do painel (After Effects)"
          onClick={toggleDebugMode}
          disabled={isTogglingDebug || !isDebugKnown}
        >
          <span className="settings-ext-switch__thumb" aria-hidden="true"></span>
        </button>
      </div>

      {isInstallConfirmOpen && selectedZxp && (
        <div className="settings-confirm-backdrop" role="presentation">
          <section
            className="settings-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settingsExtensionInstallTitle"
          >
            <header className="settings-confirm-header">
              <h2 id="settingsExtensionInstallTitle">{installLabel} a extensão?</h2>
            </header>
            <p>
              Feche o After Effects antes de continuar. A versão
              {selectedZxp.version ? ` v${selectedZxp.version}` : " selecionada"} substituirá a
              instalação atual da extensão Arizona.
            </p>
            {isDevLink && (
              <p className="settings-ext-note">
                Esta máquina usa um atalho para a sua build local. Ele será removido e a pasta
                passará a conter a versão do arquivo. A pasta de build não é apagada — para voltar
                ao modo de desenvolvimento, rode o build da extensão novamente.
              </p>
            )}
            <div className="settings-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setIsInstallConfirmOpen(false)}
                disabled={isInstalling}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={installSelectedZxp}
                disabled={isInstalling}
              >
                {isInstalling ? "Instalando..." : installLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function ProductsImportView({ report }) {
  if (!report) {
    return (
      <main className="products-log-view">
        <section className="products-log-empty">Nenhum relatório de produtos encontrado.</section>
      </main>
    );
  }

  const allNotFound = [
    ...report.notFoundFiles,
    ...report.groups.flatMap((group) => group.notFoundFiles),
  ];
  const allExisting = [
    ...report.existingFiles,
    ...report.groups.flatMap((group) => group.existingFiles),
  ];
  const durationText = formatDuration(report.durationMillis);

  return (
    <main className="products-log-view" aria-label="Relatório de produtos">
      <header className="products-log-header">
        <div className="products-log-title">
          <h1>Jobão {report.jobaoCod}</h1>
        </div>
        <dl className="products-log-summary">
          <div>
            <dt>Processados</dt>
            <dd>{report.totalProcessed}</dd>
          </div>
          <div>
            <dt>Importados</dt>
            <dd>{report.totalImported}</dd>
          </div>
          <div>
            <dt>Já existiam</dt>
            <dd>{report.totalExisting}</dd>
          </div>
          <div>
            <dt>Não encontrados</dt>
            <dd>{report.totalNotFound}</dd>
          </div>
          <div>
            <dt>Grupos</dt>
            <dd>{report.groups.length}</dd>
          </div>
          <div>
            <dt>Tempo</dt>
            <dd>{durationText}</dd>
          </div>
        </dl>
      </header>

      <section className="products-log-paths" aria-label="Caminhos">
        <div title={report.sourcePath}>
          <span>Origem</span>
          <strong>{report.sourcePath}</strong>
        </div>
        <div title={report.productPath}>
          <span>Destino</span>
          <strong>{report.productPath}</strong>
        </div>
      </section>

      <section className="products-log-content">
        <ProductsLogSection title="Resumo geral" compact>
          <ProductsLogLine text={`Total de códigos processados: ${report.totalProcessed}`} />
          <ProductsLogLine text={`Importados: ${report.totalImported}`} />
          <ProductsLogLine text={`Já existiam: ${report.totalExisting}`} />
          <ProductsLogLine text={`Não encontrados: ${report.totalNotFound}`} />
          <ProductsLogLine text={`Grupos detectados: ${report.groups.length}`} />
          <ProductsLogLine text={`Tempo total: ${durationText}`} />
        </ProductsLogSection>

        <ProductsLogSection title="Produtos não encontrados">
          {allNotFound.length === 0 && <ProductsLogLine text="Nenhum produto não encontrado." muted />}
          {allNotFound.map((file, index) => (
            <ProductsLogLine key={`${file}-${index}`} mark="fail" text={file} />
          ))}
        </ProductsLogSection>

        <ProductsLogSection title="Copiados nesta tentativa">
          {report.importedFiles.length === 0 && (
            <ProductsLogLine text="Nenhum produto solto importado nesta tentativa." muted />
          )}
          {report.importedFiles.map((file, index) => (
            <ProductsLogLine key={`${file}-${index}`} mark="ok" text={file} />
          ))}
          {report.notFoundFiles.map((file, index) => (
            <ProductsLogLine key={`${file}-${index}`} mark="fail" text={file} />
          ))}
        </ProductsLogSection>

        {allExisting.length > 0 && (
          <ProductsLogSection title="Produtos já existentes">
            {allExisting.map((file, index) => (
              <ProductsLogLine key={`${file}-${index}`} mark="skip" text={file} />
            ))}
          </ProductsLogSection>
        )}

        {report.groups.length > 0 && (
          <ProductsLogSection title="Grupos">
            {report.groups.map((group) => (
              <div className="products-log-group" key={group.folderName}>
                <strong>{group.folderName}</strong>
                {group.importedFiles.length === 0 && group.existingFiles.length === 0 && group.notFoundFiles.length === 0 && (
                  <ProductsLogLine text="Grupo vazio." muted />
                )}
                {[
                  ...group.importedFiles.map((file) => ({ file, mark: "ok" })),
                  ...group.existingFiles.map((file) => ({ file, mark: "skip" })),
                  ...group.notFoundFiles.map((file) => ({ file, mark: "fail" })),
                ].map((item, index, items) => (
                  <ProductsLogLine
                    key={`${group.folderName}-${item.file}-${index}`}
                    prefix={index < items.length - 1 ? " ┣ " : " ┗ "}
                    mark={item.mark}
                    text={item.file}
                  />
                ))}
              </div>
            ))}
          </ProductsLogSection>
        )}
      </section>
    </main>
  );
}

function ProductsLogSection({ title, children, compact = false }) {
  return (
    <section className={`products-log-section ${compact ? "products-log-section--compact" : ""}`}>
      <h2>{title}</h2>
      <div className="products-log-lines">{children}</div>
    </section>
  );
}

function ProductsLogLine({ mark, prefix = "", text, muted = false }) {
  const markText = mark === "ok" ? "✓" : mark === "fail" ? "✕" : mark === "skip" ? "•" : "";

  return (
    <div className={`products-log-line ${muted ? "products-log-line--muted" : ""}`}>
      <span className="products-log-prefix">{prefix}</span>
      {markText && <span className={`products-log-mark products-log-mark--${mark}`}>{markText}</span>}
      <span>{text}</span>
    </div>
  );
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
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const mediaKind = state.mediaKind === "audio" ? "audio" : "video";
  const mediaPath = state.mediaPath;
  const mediaTitle = state.mediaTitle || fileNameFromPath(mediaPath) || "Mídia";
  const mediaSrc = useMemo(() => pathToMediaSrc(mediaPath), [mediaPath]);
  const isLoading = state.mediaLoading
    || (Boolean(mediaSrc) && !mediaError && (!isMediaReady || isBuffering));
  const loadingMessage = state.mediaLoading
    ? mediaTitle
    : `Carregando ${mediaKind === "audio" ? "áudio" : "vídeo"}...`;
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
    setIsMediaReady(false);
    setIsBuffering(Boolean(mediaPath));
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
    if (mediaKind === "video" && mediaSrc && isMediaReady && !isBuffering) {
      scheduleControlsHide();
    } else {
      clearControlsHideTimer();
      setControlsVisible(true);
    }

    return clearControlsHideTimer;
  }, [mediaKind, mediaSrc, isMediaReady, isBuffering]);

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

  const markMediaReady = () => {
    setIsMediaReady(true);
    setIsBuffering(false);
    syncMediaState();
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
    onLoadStart: () => {
      setIsMediaReady(false);
      setIsBuffering(true);
    },
    onLoadedMetadata: syncMediaState,
    onLoadedData: markMediaReady,
    onCanPlay: () => {
      markMediaReady();
      attemptAutoplay();
    },
    onDurationChange: syncMediaState,
    onTimeUpdate: syncMediaState,
    onPlay: syncMediaState,
    onPlaying: () => {
      setIsBuffering(false);
      syncMediaState();
    },
    onPause: syncMediaState,
    onEnded: syncMediaState,
    onWaiting: () => setIsBuffering(true),
    onStalled: () => setIsBuffering(true),
    onSeeking: () => setIsBuffering(true),
    onSeeked: () => setIsBuffering(false),
    onError: () => {
      setIsBuffering(false);
      openNativeMediaFallback();
    },
  };

  return (
    <main className={`media-view media-view--${mediaKind}`} aria-label={mediaTitle}>
      <section className="media-stage" onPointerMove={mediaKind === "video" ? showControls : undefined}>
        {!mediaSrc && !state.mediaLoading && !state.mediaError && (
          <div className="media-empty">Mídia não encontrada.</div>
        )}
        {state.mediaError && (
          <div className="media-load-error" role="alert">{state.mediaError}</div>
        )}
        {isLoading && (
          <div className="media-loading" role="status" aria-live="polite">
            <span className="media-loading__spinner" aria-hidden="true"></span>
            <strong>{loadingMessage}</strong>
            <span>Isso pode levar alguns segundos se o arquivo estiver somente on-line.</span>
          </div>
        )}
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
          disabled={!mediaSrc || !isMediaReady}
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
  return DEFAULT_SECONDARY_STATE;
}

function normalizeSecondaryState(payload) {
  const rawView = String(payload?.view || "").trim();
  const view = normalizeView(rawView);
  const jobaoCod = String(payload?.jobaoCod || payload?.jobao_cod || "").trim();
  const mediaPath = String(payload?.mediaPath || payload?.media_path || "").trim();
  const mediaTitle = String(payload?.mediaTitle || payload?.media_title || "").trim();
  const mediaLoading = Boolean(payload?.mediaLoading ?? payload?.media_loading);
  const rawMediaError = String(payload?.mediaError || payload?.media_error || "").trim();
  const mediaError = rawMediaError
    ? publicErrorMessage(rawMediaError, "Não foi possível carregar esta mídia.")
    : "";
  const roteiroDocument = normalizeRoteiroDocument(payload?.roteiroDocument || payload?.roteiro_document);
  const rawMediaKind = String(payload?.mediaKind || payload?.media_kind || "").trim().toLowerCase();
  const mediaKind = rawMediaKind === "audio" ? "audio" : "video";
  const productReport = normalizeProductReport(payload?.productReport || payload?.product_report);
  const adminAuth = normalizeAdminAuth(payload?.adminAuth || payload?.admin_auth);
  const sessionAuth = normalizeSessionAuth(payload?.sessionAuth || payload?.session_auth);

  return {
    view,
    jobaoCod,
    mediaPath,
    mediaKind,
    mediaTitle,
    mediaLoading,
    mediaError,
    roteiroDocument,
    productReport,
    adminAuth,
    sessionAuth,
  };
}

function normalizeView(value) {
  if (value === "duplicate-identical") return "duplicate";
  if (value === "midia") return "media";
  if (value === "script") return "roteiro";
  if (value === "produtos" || value === "products-log" || value === "product-log") return "products";
  if (value === "config" || value === "configuracoes") return "settings";
  if (["duplicate", "history", "places", "media", "roteiro", "products", "settings", "admin"].includes(value)) return value;
  return DEFAULT_SECONDARY_STATE.view;
}

function secondaryWindowTitle(state) {
  if (state.view === "media") {
    return state.mediaTitle || fileNameFromPath(state.mediaPath) || "Mídia";
  }

  if (state.view === "products" && state.productReport?.jobaoCod) {
    return `Jobão ${state.productReport.jobaoCod}`;
  }

  if (state.view === "roteiro") {
    const document = state.roteiroDocument;
    if (document?.jobaoCod && document?.jobinhoCod && document?.praca) {
      return `${document.jobaoCod} - ${document.jobinhoCod} - ${document.praca}`;
    }
    return "Roteiro";
  }

  if (state.view === "duplicate") return "Cópia de produtos idênticos";
  if (state.view === "history") return "Histórico";
  if (state.view === "places") return "Praças CRF";
  if (state.view === "products") return "Produtos importados";
  if (state.view === "admin") return "Gestão";
  if (state.view === "settings") return "Configurações";
  return "Arizona";
}

function normalizeRoteiroDocument(value) {
  if (!value || typeof value !== "object") return null;

  const content = String(value.content || "");
  if (!content.trim()) return null;
  return {
    fileName: String(value.fileName || value.file_name || "Roteiro.docx").trim(),
    jobaoCod: String(value.jobaoCod || value.jobao_cod || "").trim(),
    jobinhoCod: String(value.jobinhoCod || value.jobinho_cod || "").trim(),
    praca: String(value.praca || "").trim(),
    modifiedAt: String(value.modifiedAt || value.modified_at || "").trim(),
    content,
  };
}

function normalizeAdminAuth(value) {
  if (!value || typeof value !== "object") return null;

  return {
    organizationId: String(value.organizationId || value.organization_id || "").trim(),
    currentMemberId: String(value.currentMemberId || value.current_member_id || "").trim(),
    email: String(value.email || "").trim(),
    role: String(value.role || "").trim(),
  };
}

function normalizeSessionAuth(value) {
  if (!value || typeof value !== "object") return null;

  return {
    organizationId: String(value.organizationId || value.organization_id || "").trim(),
    currentMemberId: String(value.currentMemberId || value.current_member_id || "").trim(),
    email: String(value.email || "").trim(),
    role: String(value.role || "").trim(),
  };
}

function normalizeDiagnosticsStatus(value) {
  return {
    directory: String(value?.directory || "").trim(),
    activeDirectory: String(value?.activeDirectory || value?.directory || "").trim(),
    defaultDirectory: String(value?.defaultDirectory || "").trim(),
    isCustom: Boolean(value?.isCustom),
    usingFallback: Boolean(value?.usingFallback),
    retentionDays: Math.max(1, Number(value?.retentionDays) || 14),
    fileCount: Math.max(0, Number(value?.fileCount) || 0),
    totalSizeBytes: Math.max(0, Number(value?.totalSizeBytes) || 0),
    movedFiles: Math.max(0, Number(value?.movedFiles) || 0),
    warnings: Array.isArray(value?.warnings)
      ? value.warnings
        .map((message) => publicErrorMessage(
          message,
          "Alguns registros antigos não puderam ser movidos. Os novos registros continuarão sendo salvos na pasta ativa.",
        ))
        .filter(Boolean)
      : [],
  };
}

function formatFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function localDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeAppInfo(info) {
  return {
    version: String(info?.version || "").trim(),
    authorName: String(info?.authorName || "").trim(),
    authorUrl: String(info?.authorUrl || "").trim(),
  };
}

function normalizeCepExtensionStatus(status) {
  return {
    installed: Boolean(status?.installed),
    version: String(status?.version || "").trim(),
    path: String(status?.path || "").trim(),
    isDevLink: Boolean(status?.isDevLink),
  };
}

function cepErrorMessage(error, fallback = "Operação não concluída.") {
  const text = String(error?.message || error || "");
  const match = text.match(/^([a-z0-9_]+):\s*(.*)$/i);
  const code = match?.[1] || "";

  if (code === "after_effects_running") return "Feche o After Effects antes de instalar.";
  if (code === "cep_dev_link") return CEP_DEV_LINK_MESSAGE;
  if (code === "cep_zxp_invalid") return "Este arquivo não é a extensão Arizona.";
  if (code === "cep_zxp_untrusted") return "Este arquivo não foi assinado pela Arizona.";
  if (code === "cep_zxp_signature_invalid") {
    return "A assinatura deste arquivo é inválida ou o conteúdo foi alterado.";
  }
  if (code === "cep_zxp_unreadable") return "Não foi possível ler o arquivo. Verifique se ele ainda existe.";
  if (code === "cep_install_failed") return "A instalação falhou e nada foi alterado.";
  return publicErrorMessage(error, fallback);
}

function shortcutFromKeyboardEvent(event) {
  const mainKey = shortcutMainKey(event);
  if (!mainKey) return "";

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Super");
  parts.push(mainKey);
  return parts.join("+");
}

function shortcutMainKey(event) {
  const code = String(event.code || "");
  const key = String(event.key || "");

  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();

  const codeAliases = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Home: "Home",
    Insert: "Insert",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Space: "Space",
    Tab: "Tab",
    NumpadAdd: "NumpadAdd",
    NumpadDecimal: "NumpadDecimal",
    NumpadDivide: "NumpadDivide",
    NumpadEnter: "NumpadEnter",
    NumpadEqual: "NumpadEqual",
    NumpadMultiply: "NumpadMultiply",
    NumpadSubtract: "NumpadSubtract",
  };
  const keyAliases = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Home: "Home",
    Insert: "Insert",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Tab: "Tab",
  };

  if (codeAliases[code]) return codeAliases[code];
  if (keyAliases[key]) return keyAliases[key];
  if (key.length === 1 && key.trim()) return key.toUpperCase();
  return "";
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
    return "Este vídeo não pode ser reproduzido dentro do Arizona App. Abra-o no visualizador do Windows.";
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
