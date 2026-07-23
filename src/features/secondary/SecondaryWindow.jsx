import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import AdminWindow from "../admin/AdminWindow";
import DuplicateIdenticalModal from "../duplicates/DuplicateIdenticalModal";
import HistoryWindow from "../history/HistoryWindow";
import AppDropdown from "../../components/AppDropdown";
import previewImg from "../../assets/hierarquia_pracas.jpg";
import { useAutoHideToast } from "../../hooks/useAutoHideToast";
import { commandNames, invokeAction, invokeCommand } from "../../services/tauriCommands";
import { formatDuration } from "../../utils/formatters";
import { normalizeProductReport } from "../../utils/productReport";
import {
  DEFAULT_SETTINGS,
  normalizeFourDigits,
  normalizeSettings,
} from "../../utils/settings";
import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import closeFullscreenIcon from "../../assets/icones/close_fullscreen.svg";
import openInFullIcon from "../../assets/icones/open_in_full.svg";
import { adminErrorMessage, releaseCurrentDevice } from "../../services/adminApi";

const DEFAULT_SECONDARY_STATE = {
  view: "places",
  jobaoCod: "",
  mediaPath: "",
  mediaKind: "video",
  mediaTitle: "",
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
    label: "Aplicar Jump",
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
    field: "renderShortcut",
    label: "Render",
    placeholder: "Ctrl+NumpadEnter",
  },
]);

const SETTINGS_TABS = Object.freeze({
  GENERAL: "general",
  AFTER_SHORTCUTS: "afterShortcuts",
});

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

    if (!result.ok) showToast(result.message, "error");
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
  const useSingleTitle = isSettingsTitlebar || isDuplicateTitlebar;

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

  const startWindowDrag = (event) => {
    if (event.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

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
    <header className="secondary-titlebar" aria-label="Barra da janela">
      <div
        className="secondary-titlebar__brand"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
      >
        <img className="secondary-titlebar__logo" src={appLogo} alt="" aria-hidden="true" />
        <span>{useSingleTitle ? title : "Arizona App"}</span>
      </div>
      <div
        className="secondary-titlebar__drag"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
      >
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
      .catch((error) => showError(String(error || "Não foi possível carregar as configurações.")))
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
        showError(String(error || "Não foi possível salvar as configurações."));
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
      showError(String(error || "Nao foi possivel restaurar os atalhos do After."));
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
      showError(String(error || "Nao foi possivel suspender os atalhos do After."));
    } finally {
      setIsShortcutRecordingTransition(false);
    }
  };

  const saveShortcut = async (field, shortcut) => {
    const previousShortcut = persistedSettingsRef.current[field] || shortcutDraft[field] || "";
    const nextConfig = normalizeSettings({
      ...persistedSettingsRef.current,
      [field]: shortcut,
    });

    setShortcutDraft((config) => ({ ...config, [field]: shortcut }));
    setRecordingShortcutField("");
    setSavingShortcutField(field);

    try {
      const saved = await invokeCommand(commandNames.saveAppConfig, {
        config: nextConfig,
      });
      const normalized = normalizeSettings(saved);
      persistedSettingsRef.current = normalized;
      setPersistedSettings(normalized);
      setShortcutDraft(normalized);
      showSuccess("Atalho salvo.");
    } catch (error) {
      setShortcutDraft((config) => ({ ...config, [field]: previousShortcut }));
      showError(String(error || "NÃ£o foi possÃ­vel salvar o atalho."));
    } finally {
      try {
        await invokeCommand(commandNames.setAfterShortcutRecording, { recording: false });
      } catch (error) {
        showError(String(error || "Nao foi possivel restaurar os atalhos do After."));
      }
      setSavingShortcutField("");
    }
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
      showError(String(error || "Não foi possível selecionar a pasta."));
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
    if (!auth?.accessToken || !auth?.organizationId || !auth?.currentMemberId) {
      showError("Sessao incompleta. Entre novamente para liberar este dispositivo.");
      return;
    }

    setIsReleaseConfirmOpen(true);
  };

  const releaseDeviceAndExit = async () => {
    if (!auth?.accessToken || !auth?.organizationId || !auth?.currentMemberId) {
      showError("Sessao incompleta. Entre novamente para liberar este dispositivo.");
      return;
    }

    setIsReleaseConfirmOpen(false);
    setIsReleasingDevice(true);
    try {
      await releaseCurrentDevice(auth);
      await invokeCommand(commandNames.clearSecureAuth);
      await invokeCommand(commandNames.exitApp);
    } catch (error) {
      showError(adminErrorMessage(error));
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
  const shortcutsBusy = busy;
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
            <h2>Mover layers para markers</h2>
            {AFTER_EFFECTS_SHORTCUT_ACTIONS.map((action) => {
              const isRecording = recordingShortcutField === action.field;
              const isSavingShortcut = savingShortcutField === action.field;
              return (
                <label className="settings-field" key={action.field}>
                  <span>{action.label}</span>
                  <div className="settings-shortcut-row">
                    <input
                      className="input settings-short-input"
                      type="text"
                      value={shortcutDraft[action.field]}
                      placeholder={action.placeholder}
                      autoComplete="off"
                      readOnly
                      disabled={shortcutsBusy || (Boolean(recordingShortcutField) && !isRecording)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => startShortcutRecording(action.field)}
                      disabled={shortcutsBusy || (Boolean(recordingShortcutField) && !isRecording)}
                      aria-pressed={isRecording}
                    >
                      {isSavingShortcut ? "Salvando..." : isRecording ? "Cancelar" : "Gravar"}
                    </button>
                  </div>
                </label>
              );
            })}
          </section>
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
                disabled={generalActionBusy || !auth?.accessToken || !auth?.organizationId || !auth?.currentMemberId}
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
      productReport: null,
      adminAuth: null,
      sessionAuth: null,
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
  const productReport = normalizeProductReport(payload?.productReport || payload?.product_report);
  const adminAuth = normalizeAdminAuth(payload?.adminAuth || payload?.admin_auth);
  const sessionAuth = normalizeSessionAuth(payload?.sessionAuth || payload?.session_auth);

  return {
    view,
    jobaoCod,
    mediaPath,
    mediaKind,
    mediaTitle,
    productReport,
    adminAuth,
    sessionAuth,
  };
}

function normalizeView(value) {
  if (value === "duplicate-identical") return "duplicate";
  if (value === "midia") return "media";
  if (value === "produtos" || value === "products-log" || value === "product-log") return "products";
  if (value === "config" || value === "configuracoes") return "settings";
  if (["duplicate", "history", "places", "media", "products", "settings", "admin"].includes(value)) return value;
  return DEFAULT_SECONDARY_STATE.view;
}

function secondaryWindowTitle(state) {
  if (state.view === "media") {
    return state.mediaTitle || fileNameFromPath(state.mediaPath) || "Mídia";
  }

  if (state.view === "products" && state.productReport?.jobaoCod) {
    return `Jobão ${state.productReport.jobaoCod}`;
  }

  if (state.view === "duplicate") return "Cópia de produtos idênticos";
  if (state.view === "history") return "Histórico";
  if (state.view === "places") return "Praças CRF";
  if (state.view === "products") return "Produtos importados";
  if (state.view === "admin") return "Gestão";
  if (state.view === "settings") return "Configurações";
  return "Arizona";
}

function normalizeAdminAuth(value) {
  if (!value || typeof value !== "object") return null;

  return {
    accessToken: String(value.accessToken || value.access_token || "").trim(),
    organizationId: String(value.organizationId || value.organization_id || "").trim(),
    currentMemberId: String(value.currentMemberId || value.current_member_id || "").trim(),
    email: String(value.email || "").trim(),
    role: String(value.role || "").trim(),
  };
}

function normalizeSessionAuth(value) {
  if (!value || typeof value !== "object") return null;

  return {
    accessToken: String(value.accessToken || value.access_token || "").trim(),
    organizationId: String(value.organizationId || value.organization_id || "").trim(),
    currentMemberId: String(value.currentMemberId || value.current_member_id || "").trim(),
    email: String(value.email || "").trim(),
    role: String(value.role || "").trim(),
  };
}

function normalizeAppInfo(info) {
  return {
    version: String(info?.version || "").trim(),
    authorName: String(info?.authorName || "").trim(),
    authorUrl: String(info?.authorUrl || "").trim(),
  };
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
