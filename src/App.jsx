import { useEffect, useRef, useState } from "react";
import GlobalTooltip from "./GlobalTooltip";
import JobPanel from "./panels/JobPanel";
import LinksPanel from "./panels/LinksPanel";
import SecondaryWindow from "./SecondaryWindow";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

import appLogo from "../src-tauri/icons/arizona_icon.ico";
import closeIcon from "./assets/icones/close.svg";
import copyIcon from "./assets/icones/file_copy.svg";
import pastaIcon from "./assets/icones/project.svg";
import imageIcon from "./assets/icones/hierarchy.svg";
import historyIcon from "./assets/icones/history.svg";
import keepIcon from "./assets/icones/keep.svg";
import keepOffIcon from "./assets/icones/keep_off.svg";
import minimizeIcon from "./assets/icones/minimize.svg";
import settingsIcon from "./assets/icones/settings.svg";
import toolsIcon from "./assets/icones/tools.svg";

const TABS = { JOBS: "jobs", LINKS: "links" };
const DEFAULT_SETTINGS = {
  aeVersion: "2024",
  drive: "I:\\Drives compartilhados\\Phx CRF Copa",
  produtos: "PRODUTOS",
  produtosYear: "",
  produtosPath: "I:\\Drives compartilhados\\Phx CRF Copa\\CARREFOUR\\ASSETS\\_FOTOS FLOW",
};

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

function normalizeSettings(config) {
  const next = { ...DEFAULT_SETTINGS, ...(config || {}) };
  return {
    ...next,
    produtosYear: normalizeProductsYear(next.produtosYear),
    produtosPath: String(next.produtosPath ?? "").trim(),
  };
}

function normalizeProductsYear(value) {
  const text = String(value ?? "").trim();
  if (text.toLowerCase() === "auto") return "";
  return text.replace(/\D/g, "").slice(0, 4);
}

function randomMainCtaPhrase() {
  return MAIN_CTA_PHRASES[Math.floor(Math.random() * MAIN_CTA_PHRASES.length)];
}

function App() {
  if (isSecondaryWindow()) {
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

function MainApp() {
  const [activeTab, setActiveTab] = useState(TABS.JOBS);
  const [jobaoCod, setJobaoCod] = useState("");
  const [jobinhoCod, setJobinhoCod] = useState("");
  const [outOption, setOutOption] = useState("mp4");
  const [isOpeningOut, setIsOpeningOut] = useState(false);
  const [appConfig, setAppConfig] = useState(DEFAULT_SETTINGS);
  const [isImporting, setIsImporting] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [mainCtaPhrase] = useState(randomMainCtaPhrase);
  const [projectTitle, setProjectTitle] = useState("");
  const [toast, setToast] = useState({ open: false, message: "", variant: "error" });
  const hideTimerRef = useRef(null);
  const projectTitleRef = useRef({ key: "", title: "" });
  const toolsMenuRef = useRef(null);
  const toolsCloseTimerRef = useRef(null);

  const hideToast = () => {
    setToast((current) => ({ ...current, open: false }));
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const showToast = (message, variant = "error") => {
    setToast({ open: true, message, variant });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(hideToast, 5000);
  };

  const showError = (msg) => showToast(msg, "error");

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
    hideToast();
    cancelToolsClose();
  }, []);

  useEffect(() => {
    let mounted = true;
    invokeCommand(commandNames.loadAppConfig)
      .then((config) => {
        if (mounted) setAppConfig(normalizeSettings(config));
      })
      .catch((e) => showError(String(e || "Nao foi possivel carregar as configuracoes.")));

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

  const run = async (fnName, args, fallbackMsg) => {
    const result = await invokeAction(fnName, args, fallbackMsg);
    if (!result.ok) {
      showError(result.message);
      return null;
    }

    return result.response;
  };

  const openMainCta = async () => {
    await run(commandNames.openAuthorSite, {}, "Nao foi possivel abrir o site.");
  };

  const setProjectWindowTitle = async (projectTitle) => {
    if (!projectTitle) return;
    setProjectTitle(projectTitle);
    try {
      await getCurrentWindow().setTitle(projectTitle);
    } catch (e) {
      // Falha no titulo nao deve bloquear o fluxo principal.
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
        // Lookup silencioso: enquanto o usuario digita, falhar e esperado.
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

  const projectName = async () => run(commandNames.projectName, { jobaoCod, jobinhoCod }, "Nao foi possivel recuperar o nome do projeto.");
  const openJobao = async () => run(commandNames.openJobao, { jobaoCod }, `Nao foi possivel abrir o Jobao "${jobaoCod}".`);
  const openJobinho = async () => run(commandNames.openJobinho, { jobaoCod, jobinhoCod }, `Nao foi possivel abrir o Jobinho "${jobinhoCod}".`);
  const abrirAE = async () => {
    const res = await run(commandNames.abrirAe, { jobaoCod, jobinhoCod }, `Nao foi possivel abrir o projeto ${jobinhoCod} no After Effects.`);
    if (res?.ok) {
      projectTitleRef.current = {
        key: `${appConfig.drive || ""}::${jobaoCod.trim()}::${jobinhoCod.trim()}`,
        title: res.message || "",
      };
      await setProjectWindowTitle(res.message);
    }
  };
  const openVideo = async (jobao, jobinho, mediaType) => run(commandNames.openVideo, { jobaoCod: jobao, jobinhoCod: jobinho, mediaType }, `Nao foi possivel abrir o video do projeto "${jobinho}"`);
  const openAudio = async (jobao, jobinho) => run(commandNames.openAudio, { jobaoCod: jobao, jobinhoCod: jobinho }, `Nao foi possivel abrir o audio do projeto "${jobinho}"`);
  const revealVideo = async (jobao, jobinho, mediaType) => run(commandNames.revealVideo, { jobaoCod: jobao, jobinhoCod: jobinho, mediaType }, `Nao foi possivel localizar o video do projeto "${jobinho}"`);
  const openRoteiro = async () => run(commandNames.openRoteiro, { jobaoCod, jobinhoCod }, `Nao foi possivel abrir o roteiro do projeto "${jobinhoCod}"`);
  const openOut = async (opt) => {
    if (isOpeningOut) return;
    setIsOpeningOut(true);
    const chosen = opt ?? outOption;
    try {
      await run(commandNames.openOut, { jobaoCod, option: chosen }, "Nao foi possivel abrir a pasta OUT/RENDER.");
    } finally {
      setIsOpeningOut(false);
    }
  };

  const openVisto = async () => run(commandNames.openVisto, {}, "Falha ao abrir o Visto.");
  const openPip = async () => run(commandNames.openPip, {}, "Falha ao abrir o Pip.");
  const openBitrix = async () => run(commandNames.openBitrix, {}, "Falha ao abrir o Bitrix.");
  const openClaro = async () => run(commandNames.openClaro, {}, "Falha ao abrir o Claro.");
  const openLinks = async () => run(commandNames.openLinks, {}, "Falha ao abrir os links.");

  const importProducts = async () => {
    const targetJobao = jobaoCod.trim();
    if (!targetJobao || isImporting) return;

    setIsImporting(true);
    try {
      await run(commandNames.importProducts, { jobaoCod: targetJobao }, "Nao foi possivel copiar os arquivos.");
    } catch (e) {
      showError("Nao foi possivel copiar os arquivos.");
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
      showError("Nao foi possivel alterar o modo sempre no topo.");
    }
  };

  const closeMainWindow = async () => {
    await getCurrentWindow().close();
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
      "Nao foi possivel abrir a janela."
    );
  };

  const openPlaces = async () => openSecondaryView("places");
  const openHistory = async () => openSecondaryView("history");
  const openSettings = async () => openSecondaryView("settings");

  const openDuplicateIdentical = async () => {
    const jobao = jobaoCod.trim();
    if (!jobao) return;

    await openSecondaryView("duplicate", { jobaoCod: jobao });
  };

  const titlebarLabel = projectTitle || "Arizona App";

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
        <aside className="iconbar" aria-label="Paineis">
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
              className={`icon-tab ${isToolsOpen ? "icon-tab--active" : ""}`}
              onClick={() => {
                hideGlobalTooltip();
                setIsToolsOpen((open) => !open);
              }}
              tabIndex="-1"
              title="Utilitarios"
              aria-label="Utilitarios"
              aria-haspopup="menu"
              aria-expanded={isToolsOpen}
            >
              <img src={toolsIcon} alt="Utilitarios" />
            </button>

            {isToolsOpen && (
              <div
                className="iconbar-popover"
                role="menu"
                aria-label="Utilitarios"
                data-tooltip-scope="utilities"
              >
                <button
                  className="iconbar-popover__item"
                  onClick={() => {
                    closeToolsMenu();
                    importProducts();
                  }}
                  disabled={!jobaoCod.trim() || isImporting}
                  role="menuitem"
                  tabIndex="-1"
                >
                  <img src={copyIcon} alt="" aria-hidden="true" />
                  <span>Copiar arquivos</span>
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
                  <span>Pracas CRF</span>
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
                  <span>Historico</span>
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-tab"
            onClick={openSettings}
            tabIndex="-1"
            title="Configuracoes"
            aria-label="Configuracoes"
          >
            <img src={settingsIcon} alt="Configuracoes" />
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
              openOut={openOut}
              outOption={outOption}
              setOutOption={setOutOption}
              isOpeningOut={isOpeningOut}
              openVideo={openVideo}
              openAudio={openAudio}
              revealVideo={revealVideo}
              openRoteiro={openRoteiro}
              projectName={projectName}
              openDuplicateIdentical={openDuplicateIdentical}
            />
          )}

          {activeTab === TABS.LINKS && (
            <LinksPanel
              openVisto={openVisto}
              openPip={openPip}
              openBitrix={openBitrix}
              openClaro={openClaro}
              openLinks={openLinks}
            />
          )}

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

function isSecondaryWindow() {
  try {
    if (getCurrentWindow().label === "secondary") return true;
  } catch (error) {
    // Fora do Tauri, mantemos a query como fallback para abrir a tela no browser.
  }

  try {
    const view = new URLSearchParams(window.location.search).get("view");
    return [
      "secondary",
      "duplicate",
      "duplicate-identical",
      "history",
      "places",
      "media",
      "midia",
      "products",
      "produtos",
      "products-log",
      "settings",
      "config",
      "configuracoes",
    ].includes(view);
  } catch (error) {
    return false;
  }
}

export default App;
