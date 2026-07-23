import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import GlobalTooltip from "../components/GlobalTooltip";
import CopyPanel from "../features/main/CopyPanel";
import JobPanel from "../features/main/JobPanel";
import LinksPanel from "../features/main/LinksPanel";
import LoginWindow from "../features/auth/LoginWindow";
import SecondaryWindow from "../features/secondary/SecondaryWindow";
import { useAutoHideToast } from "../hooks/useAutoHideToast";
import { authErrorMessage, authToSession, validateActiveSession } from "../services/auth";
import { commandNames, invokeAction, invokeCommand } from "../services/tauriCommands";
import { DEFAULT_SETTINGS, normalizeSettings } from "../utils/settings";
import { currentWindowLabel, isSecondaryWindowRoute } from "../utils/windowRouting";
import "../styles/App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

import appLogo from "../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../assets/icones/close.svg";
import copyIcon from "../assets/icones/file_copy.svg";
import equalIcon from "../assets/icones/equal.svg";
import pastaIcon from "../assets/icones/project.svg";
import imageIcon from "../assets/icones/hierarchy.svg";
import historyIcon from "../assets/icones/history.svg";
import keepIcon from "../assets/icones/keep.svg";
import keepOffIcon from "../assets/icones/keep_off.svg";
import minimizeIcon from "../assets/icones/minimize.svg";
import adminPanelIcon from "../assets/icones/admin_panel.svg";
import settingsIcon from "../assets/icones/settings.svg";
import toolsIcon from "../assets/icones/tools.svg";

const TABS = { JOBS: "jobs", LINKS: "links", COPY: "copy" };
const AUTH_REFRESH_INTERVAL_MS = 30000;
const TOOLS_POPOVER_GAP_PX = 10;
const TOOLS_POPOVER_MARGIN_PX = 6;
const AFTER_EFFECTS_SHORTCUT_NOTICE_THROTTLE_MS = 30000;
const AE_OPEN_COOLDOWN_MS = 8000;

const MAIN_CTA_PHRASES = Object.freeze([
  "Por que fazer isso na mão?",
  "Imagine o resto do fluxo automatizado.",
  "Pequenas mágicas para times criativos.",
  "Criado por quem odeia retrabalho.",
  "Pequenas ideias, grandes atalhos.",
  "O nerd por trás dos botões.",
  "Clique e conheça o nerd.",
  "Isso aqui era trabalho manual.",
  "Transformando rotina em botão.",
  "Criativo também automatiza.",
  "Fluxos melhores começam pequenos.",
  "Automatizar também é criar.",
  "Ideias úteis, bugs ocasionais.",
  "Mais clareza. Menos repetição.",
  "Fluxo leve, time mais rápido.",
  "Pequenas mágicas operacionais.",
  "O nerd viu um padrão aqui.",
  "Criatividade também mora no processo.",
  "Clique e culpe o nerd.",
  "A rotina ganhou um upgrade.",
  "Mais leve que planilha aberta.",
  "Automação com tempero criativo.",
  "Isso antes dava trabalho.",
  "Menos “cadê o arquivo?”",
  "O fluxo ficou menos dramático.",
  "Feito para dias corridos.",
  "O processo ganhou superpoderes.",
  "A planilha sentiu um arrepio.",
  "O manual ficou com ciúmes.",
  "O nerd resolveu um incômodo.",
  "Trabalho manual em extinção.",
  "Automação com alma criativa.",
]);

function randomMainCtaPhrase() {
  return MAIN_CTA_PHRASES[Math.floor(Math.random() * MAIN_CTA_PHRASES.length)];
}

function App() {
  const windowLabel = currentWindowLabel();

  if (windowLabel === "main") {
    return (
      <>
        <LoginWindow />
        <GlobalTooltip />
      </>
    );
  }

  if (windowLabel === "app") {
    return (
      <>
        <AuthenticatedAppWindow />
        <GlobalTooltip />
      </>
    );
  }

  if (windowLabel === "secondary" || isSecondaryWindowRoute()) {
    return (
      <>
        <SecondaryWindow />
        <GlobalTooltip />
      </>
    );
  }

  return (
    <>
      <MainApp />
      <GlobalTooltip />
    </>
  );
}

function AuthenticatedAppWindow() {
  const [authSession, setAuthSession] = useState(() => window.__ARIZONA_AUTH_SESSION__ || null);
  const applyAuthSession = useCallback((session) => {
    const nextSession = session || null;
    window.__ARIZONA_AUTH_SESSION__ = nextSession;
    setAuthSession(nextSession);
  }, []);

  useEffect(() => {
    const handleAuthChange = (event) => {
      applyAuthSession(event.detail || window.__ARIZONA_AUTH_SESSION__ || null);
    };

    window.addEventListener("arizona-auth:login", handleAuthChange);
    window.addEventListener("arizona-auth:update", handleAuthChange);
    return () => {
      window.removeEventListener("arizona-auth:login", handleAuthChange);
      window.removeEventListener("arizona-auth:update", handleAuthChange);
    };
  }, [applyAuthSession]);

  if (!authSession) {
    return <div className="app-locked" aria-hidden="true"></div>;
  }

  return <MainApp authSession={authSession} onAuthSessionChange={applyAuthSession} />;
}

function MainApp({ authSession, onAuthSessionChange = () => {} }) {
  const [activeTab, setActiveTab] = useState(TABS.JOBS);
  const [jobaoCod, setJobaoCod] = useState("");
  const [jobinhoCod, setJobinhoCod] = useState("");
  const [copyJobaoCod, setCopyJobaoCod] = useState("");
  const [outOption, setOutOption] = useState("mp4");
  const [isOpeningOut, setIsOpeningOut] = useState(false);
  const [isOpeningAE, setIsOpeningAE] = useState(false);
  const [appConfig, setAppConfig] = useState(DEFAULT_SETTINGS);
  const [isImporting, setIsImporting] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [toolsPopoverPosition, setToolsPopoverPosition] = useState(null);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [mainCtaPhrase] = useState(randomMainCtaPhrase);
  const [projectTitle, setProjectTitle] = useState("");
  const { toast, showToast, hideToast } = useAutoHideToast();
  const projectTitleRef = useRef({ key: "", title: "" });
  const toolsMenuRef = useRef(null);
  const toolsButtonRef = useRef(null);
  const toolsPopoverRef = useRef(null);
  const toolsCloseTimerRef = useRef(null);
  const aeOpenCooldownTimerRef = useRef(null);
  const isOpeningAERef = useRef(false);
  const lastAfterEffectsShortcutNoticeRef = useRef({ key: "", shownAt: 0 });
  const authSessionRef = useRef(authSession);
  const authRefreshInFlightRef = useRef(false);
  const authRefreshPromiseRef = useRef(null);
  const canAccessAdmin = authSession?.role === "admin";

  const showError = (msg) => showToast(msg, "error");

  useEffect(() => {
    const handleAfterEffectsShortcutError = (event) => {
      const code = String(event?.detail?.code || "after_effects_command_failed");
      const message = String(
        event?.detail?.message || "Atalho do After bloqueado. Valide a licença novamente no Arizona App."
      );

      const noticeKey = `${code}:${message}`;
      const now = Date.now();
      const lastNotice = lastAfterEffectsShortcutNoticeRef.current;
      if (
        lastNotice.key === noticeKey
        && now - lastNotice.shownAt < AFTER_EFFECTS_SHORTCUT_NOTICE_THROTTLE_MS
      ) {
        return;
      }

      lastAfterEffectsShortcutNoticeRef.current = { key: noticeKey, shownAt: now };
      showToast(message, "error");
    };

    window.addEventListener("arizona-after-effects:shortcut-error", handleAfterEffectsShortcutError);
    return () => window.removeEventListener("arizona-after-effects:shortcut-error", handleAfterEffectsShortcutError);
  }, [showToast]);

  useEffect(() => {
    authSessionRef.current = authSession;
  }, [authSession]);

  useEffect(() => {
    let mounted = true;

    const applyValidatedAuth = async (nextAuth) => {
      if (!nextAuth) return null;
      const nextSession = authToSession(nextAuth);
      const currentSession = authSessionRef.current;
      if (!authSessionChanged(currentSession, nextSession)) return currentSession || nextSession;

      await invokeCommand(commandNames.updateAuthSession, { session: nextSession }).catch(() => {});
      if (!mounted) return nextSession;

      const lostAdminAccess = currentSession?.role === "admin" && nextSession.role !== "admin";
      onAuthSessionChange(nextSession);
      authSessionRef.current = nextSession;

      if (lostAdminAccess) {
        closeToolsMenu();
        showToast("Seu acesso de gestão foi atualizado.", "error");
      }

      return nextSession;
    };

    const refreshAuth = async () => {
      const currentSession = authSessionRef.current;
      if (!currentSession?.accessToken || authRefreshInFlightRef.current) return;

      authRefreshInFlightRef.current = true;
      authRefreshPromiseRef.current = (async () => {
        const nextAuth = await validateActiveSession(currentSession, { appVersion: "" });
        if (!mounted) return null;
        return applyValidatedAuth(nextAuth);
      })();
      try {
        await authRefreshPromiseRef.current;
      } catch (error) {
        const code = String(error?.code || "");
        if (code === "daily_login_required" || code === "stored_session_invalid") {
          showToast(authErrorMessage(error), "error");
        }
      } finally {
        authRefreshPromiseRef.current = null;
        authRefreshInFlightRef.current = false;
      }
    };

    const handleFocus = () => refreshAuth();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAuth();
    };

    const interval = setInterval(refreshAuth, AUTH_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    refreshAuth();

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onAuthSessionChange]);

  const hideGlobalTooltip = () => {
    window.dispatchEvent(new Event("app:hide-tooltip"));
  };

  const cancelToolsClose = () => {
    if (toolsCloseTimerRef.current) {
      clearTimeout(toolsCloseTimerRef.current);
      toolsCloseTimerRef.current = null;
    }
  };

  const closeToolsMenu = () => {
    hideGlobalTooltip();
    cancelToolsClose();
    setIsToolsOpen(false);
  };

  const scheduleToolsClose = () => {
    cancelToolsClose();
    toolsCloseTimerRef.current = setTimeout(() => {
      setIsToolsOpen(false);
      toolsCloseTimerRef.current = null;
    }, 150);
  };

  useEffect(() => () => {
    cancelToolsClose();
  }, []);

  useEffect(() => {
    let mounted = true;
    invokeCommand(commandNames.loadAppConfig)
      .then((config) => {
        if (mounted) setAppConfig(normalizeSettings(config));
      })
      .catch((e) => showError(String(e || "Não foi possível carregar as configurações.")));

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      invokeCommand(commandNames.loadAppConfig)
        .then((config) => setAppConfig(normalizeSettings(config)))
        .catch(() => {});
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    if (!isToolsOpen) return undefined;

    const handleOutsidePointer = (event) => {
      if (toolsMenuRef.current?.contains(event.target)) return;
      closeToolsMenu();
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") closeToolsMenu();
    };

    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isToolsOpen]);

  useLayoutEffect(() => {
    if (!isToolsOpen) {
      setToolsPopoverPosition(null);
      return undefined;
    }

    const updateToolsPopoverPosition = () => {
      const button = toolsButtonRef.current;
      const popover = toolsPopoverRef.current;
      if (!button || !popover) return;

      const buttonRect = button.getBoundingClientRect();
      const popoverHeight = popover.offsetHeight;
      const popoverWidth = popover.offsetWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const maxTop = Math.max(
        TOOLS_POPOVER_MARGIN_PX,
        viewportHeight - popoverHeight - TOOLS_POPOVER_MARGIN_PX
      );
      const maxLeft = Math.max(
        TOOLS_POPOVER_MARGIN_PX,
        viewportWidth - popoverWidth - TOOLS_POPOVER_MARGIN_PX
      );
      const top = Math.min(Math.max(buttonRect.top, TOOLS_POPOVER_MARGIN_PX), maxTop);
      const left = Math.min(buttonRect.right + TOOLS_POPOVER_GAP_PX, maxLeft);
      const arrowTop = Math.min(
        Math.max(buttonRect.top + buttonRect.height / 2 - top, 14),
        Math.max(14, popoverHeight - 14)
      );

      setToolsPopoverPosition({ top, left, arrowTop });
    };

    updateToolsPopoverPosition();
    window.addEventListener("resize", updateToolsPopoverPosition);
    return () => window.removeEventListener("resize", updateToolsPopoverPosition);
  }, [isToolsOpen]);

  useEffect(() => {
    if (isToolsOpen) {
      document.body.dataset.tooltipScope = "utilities";
      return () => {
        delete document.body.dataset.tooltipScope;
      };
    }

    delete document.body.dataset.tooltipScope;
    return undefined;
  }, [isToolsOpen]);

  useEffect(() => {
    return () => {
      if (aeOpenCooldownTimerRef.current) {
        clearTimeout(aeOpenCooldownTimerRef.current);
      }
    };
  }, []);

  const run = async (fnName, args, fallbackMsg) => {
    const result = await invokeAction(fnName, args, fallbackMsg);
    if (!result.ok) {
      showError(result.message);
      return null;
    }

    return result.response;
  };

  const openMainCta = async () => {
    await run(commandNames.openAuthorSite, {}, "Não foi possível abrir o site.");
  };

  const setProjectWindowTitle = async (projectTitle) => {
    if (!projectTitle) return;
    setProjectTitle(projectTitle);
    try {
      await getCurrentWindow().setTitle(projectTitle);
    } catch (e) {
      // Falha no título não deve bloquear o fluxo principal.
    }
  };

  useEffect(() => {
    const jobao = jobaoCod.trim();
    const jobinho = jobinhoCod.trim();
    const configKey = appConfig.drive || "";
    const lookupKey = `${configKey}::${jobao}::${jobinho}`;
    let cancelled = false;
    let retryTimer = null;
    let startTimer = null;

    if (!jobao || !jobinho) {
      projectTitleRef.current = { key: "", title: "" };
      setProjectTitle("");
      getCurrentWindow().setTitle("Arizona App").catch(() => {});
      return () => {};
    }

    if (projectTitleRef.current.key === lookupKey && projectTitleRef.current.title) {
      setProjectTitle(projectTitleRef.current.title);
      return () => {};
    }

    projectTitleRef.current = { key: lookupKey, title: "" };
    setProjectTitle("");
    getCurrentWindow().setTitle("Arizona App").catch(() => {});

    const resolveProjectTitle = async () => {
      if (cancelled) return;

      try {
        const res = await invokeCommand(commandNames.projectName, { jobaoCod: jobao, jobinhoCod: jobinho });
        if (cancelled) return;

        if (res?.ok && res.message) {
          projectTitleRef.current = { key: lookupKey, title: res.message };
          setProjectTitle(res.message);
          await setProjectWindowTitle(res.message);
          return;
        }
      } catch (e) {
        // Lookup silencioso: enquanto o usuário digita, falhar é esperado.
      }

      if (!cancelled) retryTimer = setTimeout(resolveProjectTitle, 2000);
    };

    startTimer = setTimeout(resolveProjectTitle, 450);

    return () => {
      cancelled = true;
      if (startTimer) clearTimeout(startTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [jobaoCod, jobinhoCod, appConfig.drive]);

  const projectName = async () => run(commandNames.projectName, { jobaoCod, jobinhoCod }, "Não foi possível recuperar o nome do projeto.");
  const openJobao = async () => run(commandNames.openJobao, { jobaoCod }, `Não foi possível abrir o Jobão "${jobaoCod}".`);
  const openJobinho = async () => run(commandNames.openJobinho, { jobaoCod, jobinhoCod }, `Não foi possível abrir o Jobinho "${jobinhoCod}".`);
  const abrirAE = async () => {
    if (isOpeningAERef.current) return;

    isOpeningAERef.current = true;
    setIsOpeningAE(true);

    if (aeOpenCooldownTimerRef.current) {
      clearTimeout(aeOpenCooldownTimerRef.current);
      aeOpenCooldownTimerRef.current = null;
    }

    try {
      const res = await run(commandNames.abrirAe, { jobaoCod, jobinhoCod }, `Não foi possível abrir o projeto ${jobinhoCod} no After Effects.`);
      if (res?.ok) {
        projectTitleRef.current = {
          key: `${appConfig.drive || ""}::${jobaoCod.trim()}::${jobinhoCod.trim()}`,
          title: res.message || "",
        };
        await setProjectWindowTitle(res.message);
      }
    } finally {
      aeOpenCooldownTimerRef.current = setTimeout(() => {
        isOpeningAERef.current = false;
        aeOpenCooldownTimerRef.current = null;
        setIsOpeningAE(false);
      }, AE_OPEN_COOLDOWN_MS);
    }
  };
  const openVideo = async (jobao, jobinho, mediaType) => run(commandNames.openVideo, { jobaoCod: jobao, jobinhoCod: jobinho, mediaType }, `Não foi possível abrir o vídeo do projeto "${jobinho}"`);
  const openAudio = async (jobao, jobinho) => run(commandNames.openAudio, { jobaoCod: jobao, jobinhoCod: jobinho }, `Não foi possível abrir o áudio do projeto "${jobinho}"`);
  const revealVideo = async (jobao, jobinho, mediaType) => run(commandNames.revealVideo, { jobaoCod: jobao, jobinhoCod: jobinho, mediaType }, `Não foi possível localizar o vídeo do projeto "${jobinho}"`);
  const openRoteiro = async () => run(commandNames.openRoteiro, { jobaoCod, jobinhoCod }, `Não foi possível abrir o roteiro do projeto "${jobinhoCod}"`);
  const openOut = async (opt) => {
    if (isOpeningOut) return;
    setIsOpeningOut(true);
    const chosen = opt ?? outOption;
    try {
      await run(commandNames.openOut, { jobaoCod, option: chosen }, "Não foi possível abrir a pasta OUT/RENDER.");
    } finally {
      setIsOpeningOut(false);
    }
  };

  const openVisto = async () => run(commandNames.openVisto, {}, "Falha ao abrir o Visto.");
  const openPip = async () => run(commandNames.openPip, {}, "Falha ao abrir o Pip.");
  const openBitrix = async () => run(commandNames.openBitrix, {}, "Falha ao abrir o Bitrix.");
  const openClaro = async () => run(commandNames.openClaro, {}, "Falha ao abrir o Claro.");
  const openLinks = async () => run(commandNames.openLinks, {}, "Falha ao abrir os links.");

  const importProducts = async (jobaoCode = copyJobaoCod) => {
    const targetJobao = String(jobaoCode || "").trim();
    if (!targetJobao || isImporting) return;

    setIsImporting(true);
    try {
      await run(commandNames.importProducts, { jobaoCod: targetJobao }, "Não foi possível copiar os arquivos.");
    } catch (e) {
      showError("Não foi possível copiar os arquivos.");
    } finally {
      setIsImporting(false);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const nextAlwaysOnTop = !isAlwaysOnTop;

    try {
      await getCurrentWindow().setAlwaysOnTop(nextAlwaysOnTop);
      setIsAlwaysOnTop(nextAlwaysOnTop);
    } catch (e) {
      showError("Não foi possível alterar o modo sempre no topo.");
    }
  };

  const closeMainWindow = async () => {
    try {
      await invokeCommand(commandNames.exitApp);
    } catch (error) {
      await getCurrentWindow().close();
    }
  };

  const minimizeMainWindow = async () => {
    await getCurrentWindow().minimize();
  };

  const startWindowDrag = (event) => {
    if (event.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const openSecondaryView = async (view, args = {}) => {
    await run(
      commandNames.openSecondaryWindow,
      { view, ...args },
      "Não foi possível abrir a janela."
    );
  };

  const openPlaces = async () => openSecondaryView("places");
  const openHistory = async () => openSecondaryView("history");
  const openAdmin = async () => openSecondaryView("admin");
  const openSettings = async () => openSecondaryView("settings");

  const openDuplicateIdentical = async () => openSecondaryView("duplicate", { jobaoCod: "" });

  const titlebarLabel = projectTitle || "Arizona App";
  const mainCta = (
    <button
      type="button"
      className="main-cta"
      onClick={openMainCta}
      tabIndex="-1"
      title="Conheça o Nerd do After"
      aria-label={`${mainCtaPhrase} Conheça o Nerd do After`}
    >
      <span>{mainCtaPhrase}</span>
    </button>
  );

  return (
    <div className="app-shell">
      <header className="app-titlebar" aria-label="Barra da janela">
        <div
          className="app-titlebar__brand"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
          title={titlebarLabel}
        >
          <img className="app-titlebar__logo" src={appLogo} alt="" aria-hidden="true" />
          <span>{titlebarLabel}</span>
        </div>
        <div
          className="app-titlebar__drag"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
        />
        <div className="app-titlebar__controls">
          <button
            className={`titlebar-icon-btn titlebar-icon-btn--pin ${isAlwaysOnTop ? "titlebar-icon-btn--active" : ""}`}
            onClick={toggleAlwaysOnTop}
            tabIndex="-1"
            title={isAlwaysOnTop ? "Desativar sempre no topo" : "Manter sempre no topo"}
            aria-label={isAlwaysOnTop ? "Desativar sempre no topo" : "Manter sempre no topo"}
            aria-pressed={isAlwaysOnTop}
          >
            <img src={isAlwaysOnTop ? keepIcon : keepOffIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className="titlebar-icon-btn titlebar-icon-btn--minimize"
            onClick={minimizeMainWindow}
            tabIndex="-1"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <img src={minimizeIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className="titlebar-icon-btn titlebar-icon-btn--close"
            onClick={closeMainWindow}
            tabIndex="-1"
            title="Fechar"
            aria-label="Fechar"
          >
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="layout layout--with-leftbar">
        <aside className="iconbar" aria-label="Painéis">
          <button
            className={`icon-tab ${activeTab === TABS.JOBS ? "icon-tab--active" : ""}`}
            onClick={() => setActiveTab(TABS.JOBS)}
            tabIndex="-1"
            title="Projetos"
            aria-label="Projetos"
          >
            <img src={pastaIcon} alt="Projetos" />
          </button>

          <div
            className="iconbar-menu"
            ref={toolsMenuRef}
            onMouseEnter={cancelToolsClose}
            onMouseLeave={scheduleToolsClose}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closeToolsMenu();
            }}
          >
            <button
              ref={toolsButtonRef}
              className={`icon-tab ${isToolsOpen || activeTab === TABS.COPY ? "icon-tab--active" : ""}`}
              onClick={() => {
                hideGlobalTooltip();
                setIsToolsOpen((open) => !open);
              }}
              tabIndex="-1"
              title="Utilitários"
              aria-label="Utilitários"
              aria-haspopup="menu"
              aria-expanded={isToolsOpen}
            >
              <img src={toolsIcon} alt="Utilitários" />
            </button>

            {isToolsOpen && (
              <div
                ref={toolsPopoverRef}
                className="iconbar-popover"
                role="menu"
                aria-label="Utilitários"
                data-tooltip-scope="utilities"
                style={toolsPopoverPosition ? {
                  top: `${toolsPopoverPosition.top}px`,
                  left: `${toolsPopoverPosition.left}px`,
                  "--iconbar-popover-arrow-top": `${toolsPopoverPosition.arrowTop}px`,
                } : { visibility: "hidden" }}
              >
                <button
                  className="iconbar-popover__item"
                  onClick={() => {
                    closeToolsMenu();
                    setActiveTab(TABS.COPY);
                  }}
                  role="menuitem"
                  tabIndex="-1"
                >
                  <img src={copyIcon} alt="" aria-hidden="true" />
                  <span>Copiar arquivos</span>
                </button>
                <button
                  className="iconbar-popover__item"
                  onClick={() => {
                    closeToolsMenu();
                    openDuplicateIdentical();
                  }}
                  role="menuitem"
                  tabIndex="-1"
                >
                  <img src={equalIcon} alt="" aria-hidden="true" />
                  <span>Produtos idênticos</span>
                </button>
                <button
                  className="iconbar-popover__item"
                  onClick={() => {
                    setIsToolsOpen(false);
                    openPlaces();
                  }}
                  role="menuitem"
                  tabIndex="-1"
                >
                  <img src={imageIcon} alt="" aria-hidden="true" />
                  <span>Praças CRF</span>
                </button>
                <button
                  className="iconbar-popover__item"
                  onClick={() => {
                    setIsToolsOpen(false);
                    openHistory();
                  }}
                  role="menuitem"
                  tabIndex="-1"
                >
                  <img src={historyIcon} alt="" aria-hidden="true" />
                  <span>Histórico</span>
                </button>
              </div>
            )}
          </div>
          {canAccessAdmin && (
            <button
              className="icon-tab"
              onClick={openAdmin}
              tabIndex="-1"
              title="Gestão"
              aria-label="Gestão"
            >
              <img src={adminPanelIcon} alt="Gestão" />
            </button>
          )}
          <button
            className="icon-tab"
            onClick={openSettings}
            tabIndex="-1"
            title="Configurações"
            aria-label="Configurações"
          >
            <img src={settingsIcon} alt="Configurações" />
          </button>
        </aside>

        <main className="content">
          {activeTab === TABS.JOBS && (
            <JobPanel
              jobaoCod={jobaoCod}
              setJobaoCod={setJobaoCod}
              jobinhoCod={jobinhoCod}
              setJobinhoCod={setJobinhoCod}
              openJobao={openJobao}
              openJobinho={openJobinho}
              abrirAE={abrirAE}
              isOpeningAE={isOpeningAE}
              openOut={openOut}
              outOption={outOption}
              setOutOption={setOutOption}
              isOpeningOut={isOpeningOut}
              openVideo={openVideo}
              openAudio={openAudio}
              revealVideo={revealVideo}
              openRoteiro={openRoteiro}
              projectName={projectName}
              footer={mainCta}
            />
          )}

          {activeTab === TABS.COPY && (
            <CopyPanel
              copyCode={copyJobaoCod}
              setCopyCode={setCopyJobaoCod}
              importProducts={() => importProducts(copyJobaoCod)}
              isImporting={isImporting}
              footer={mainCta}
            />
          )}

          {activeTab === TABS.LINKS && (
            <LinksPanel
              openVisto={openVisto}
              openPip={openPip}
              openBitrix={openBitrix}
              openClaro={openClaro}
              openLinks={openLinks}
              footer={mainCta}
            />
          )}

        </main>
      </div>

      {isImporting && (
        <div className="overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="loader">Copiando arquivos...</div>
        </div>
      )}

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

function authSessionChanged(currentSession, nextSession) {
  if (!currentSession || !nextSession) return currentSession !== nextSession;
  return [
    "accessToken",
    "refreshToken",
    "cepLicenseReceipt",
    "email",
    "memberId",
    "role",
    "organizationId",
    "organizationName",
    "seatsAllowed",
    "expiresAt",
  ].some((key) => String(currentSession?.[key] ?? "") !== String(nextSession?.[key] ?? ""));
}

export default App;
