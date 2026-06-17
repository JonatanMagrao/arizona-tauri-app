import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import JobPanel from "./panels/JobPanel";
import LinksPanel from "./panels/LinksPanel";
import CopyPanel from "./panels/CopyPanel";
import SecondaryWindow from "./SecondaryWindow";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ÍCONES (svg como imagem)
import pastaIcon from "./assets/icones/project.svg";
import linkIcon from "./assets/icones/link.svg";
import imageIcon from "./assets/icones/hierarchy.svg";
import copyIcon from "./assets/icones/folder.svg"; // você pode trocar por outro ícone depois
import historyIcon from "./assets/icones/history.svg";
import settingsIcon from "./assets/icones/settings.svg";

const TABS = { JOBS: "jobs", LINKS: "links", COPY: "copy" };
const DEFAULT_SETTINGS = {
  aeVersion: "2024",
  drive: "I:\\Drives compartilhados",
  produtos: "PRODUTOS",
};

function App() {
  if (isSecondaryWindow()) return <SecondaryWindow />;

  return <MainApp />;
}

function MainApp() {
  const [activeTab, setActiveTab] = useState(TABS.JOBS);

  // estados
  const [jobaoCod, setJobaoCod] = useState("");
  const [jobinhoCod, setJobinhoCod] = useState("");
  const [outOption, setOutOption] = useState("mp4");
  const [isOpeningOut, setIsOpeningOut] = useState(false);
  const [copyCode, setCopyCode] = useState("");
  const [appConfig, setAppConfig] = useState(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isChoosingDrive, setIsChoosingDrive] = useState(false);


  // ==== Loading simples para importação ====
  const [isImporting, setIsImporting] = useState(false);

  // ==== Toast (erro no rodapé) ====
  const [toast, setToast] = useState({ open: false, message: "", variant: "error" });
  const hideTimerRef = useRef(null);
  const projectTitleRef = useRef({ key: "", title: "" });

  const hideToast = () => {
    setToast(t => ({ ...t, open: false }));
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };
  const showToast = (message, variant = "error") => {
    setToast({ open: true, message, variant });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(hideToast, 5000); // 5s
  };
  const showError = (msg) => showToast(msg, "error");
  const showSuccess = (msg) => showToast(msg, "success");
  useEffect(() => () => hideToast(), []); // limpa timer ao desmontar

  useEffect(() => {
    let mounted = true;
    invokeCommand(commandNames.loadAppConfig)
      .then((config) => {
        if (!mounted) return;
        setAppConfig(config);
        setSettingsDraft(config);
      })
      .catch((e) => showError(String(e || "Não foi possível carregar as configurações.")));

    return () => {
      mounted = false;
    };
  }, []);

  // Helper: chama Rust e mostra toast se vier erro ou exception
  const run = async (fnName, args, fallbackMsg) => {
    const result = await invokeAction(fnName, args, fallbackMsg);
    if (!result.ok) {
      showError(result.message);
      return null;
    }

    return result.response;
  };

  const setProjectWindowTitle = async (projectTitle) => {
    if (!projectTitle) return;
    try {
      await getCurrentWindow().setTitle(projectTitle);
    } catch (e) {
      // O After abriu; falha no título não deve bloquear o fluxo principal.
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
      getCurrentWindow().setTitle("Arizona App").catch(() => {});
      return () => {};
    }

    if (projectTitleRef.current.key === lookupKey && projectTitleRef.current.title) {
      return () => {};
    }

    projectTitleRef.current = { key: lookupKey, title: "" };
    getCurrentWindow().setTitle("Arizona App").catch(() => {});

    const resolveProjectTitle = async () => {
      if (cancelled) return;

      try {
        const res = await invokeCommand(commandNames.projectName, { jobaoCod: jobao, jobinhoCod: jobinho });
        if (cancelled) return;

        if (res?.ok && res.message) {
          projectTitleRef.current = { key: lookupKey, title: res.message };
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

  // ações
  const openLogFile = async () => run(commandNames.openLogFile, {}, "Não foi possível abrir o arquivo de log.");
  const projectName = async () => run(commandNames.projectName, { jobaoCod, jobinhoCod }, "Não foi possível recuperar o nome do projeto.");
  const openJobao = async () => run(commandNames.openJobao, { jobaoCod }, `Não foi possível abrir o Jobão "${jobaoCod}".`);
  const openJobinho = async () => run(commandNames.openJobinho, { jobaoCod, jobinhoCod }, `Não foi possível abrir o Jobinho "${jobinhoCod}".`);
  const abrirAE = async () => {
    const res = await run(commandNames.abrirAe, { jobaoCod, jobinhoCod }, `Não foi possível abrir o projeto ${jobinhoCod} no After Effects.`);
    if (res?.ok) {
      projectTitleRef.current = {
        key: `${appConfig.drive || ""}::${jobaoCod.trim()}::${jobinhoCod.trim()}`,
        title: res.message || "",
      };
      await setProjectWindowTitle(res.message);
    }
  };
  const openVideo = async (jobaoCod, jobinhoCod, mediaType) => run(commandNames.openVideo, { jobaoCod, jobinhoCod, mediaType }, `Não foi possível abrir o vídeo do projeto "${jobinhoCod}"`);
  const openAudio = async (jobaoCod, jobinhoCod) => run(commandNames.openAudio, { jobaoCod, jobinhoCod }, `Não foi possível abrir o áudio do projeto "${jobinhoCod}"`);
  const revealVideo = async (jobaoCod, jobinhoCod, mediaType) => run(commandNames.revealVideo, { jobaoCod, jobinhoCod, mediaType }, `Não foi possível localizar o vídeo do projeto "${jobinhoCod}"`);
  const openRoteiro = async () => run(commandNames.openRoteiro, { jobaoCod, jobinhoCod }, `Não foi possível abrir o roteiro do projeto "${jobinhoCod}"`);
  const openOut = async (opt) => {
    if (isOpeningOut) return;                 // evita chamadas sobrepostas
    setIsOpeningOut(true);
    const chosen = opt ?? outOption;          // usa o param se vier, senão o estado atual
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

  // ação de copiar arquivos — COM LOADING
  const importProducts = async () => {
    setIsImporting(true);
    try {
      await run(commandNames.importProducts, { jobaoCod: copyCode }, "Não foi possível copiar os arquivos.");
    } catch (e) {
      showError("Não foi possível copiar os arquivos.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleOnTop = async (onTop) => {
    await getCurrentWindow().setAlwaysOnTop(onTop);
  }

  const openSettings = () => {
    setSettingsDraft(appConfig);
    setSettingsOpen(true);
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

  const openDuplicateIdentical = async () => {
    const jobao = jobaoCod.trim();
    if (!jobao) return;

    await openSecondaryView("duplicate", { jobaoCod: jobao });
  };

  const updateSettingsDraft = (field, value) => {
    setSettingsDraft((config) => ({ ...config, [field]: value }));
  };

  const chooseDriveFolder = async () => {
    setIsChoosingDrive(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecionar drive ou pasta base",
      });
      if (typeof selected === "string") updateSettingsDraft("drive", selected);
    } catch (e) {
      showError(String(e || "Não foi possível selecionar o drive."));
    } finally {
      setIsChoosingDrive(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const saved = await invokeCommand(commandNames.saveAppConfig, { config: settingsDraft });
      setAppConfig(saved);
      setSettingsDraft(saved);
      setSettingsOpen(false);
      showSuccess("Configurações salvas.");
    } catch (err) {
      showError(String(err || "Não foi possível salvar as configurações."));
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="layout layout--with-leftbar">
      <aside className="iconbar" aria-label="Painéis">
        {/* JOBÃO & JOBINHO */}
        <button
          className={`icon-tab ${activeTab === TABS.JOBS ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.JOBS)}
          tabIndex="-1"
          title="Projetos"
          aria-label="Projetos"
        >
          <img src={pastaIcon} alt="Projetos" />
        </button>

        {/* COPY (nova aba)
        <button
          className={`icon-tab ${activeTab === TABS.COPY ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.COPY)}
          tabIndex="-1"
          title="Copiar Arquivos"
          aria-label="Copiar Arquivos"
        >
          <img src={copyIcon} alt="Copiar Arquivos" />
        </button>
        */}

        {/* LINKS */}
        {/* <button
          className={`icon-tab ${activeTab === TABS.LINKS ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.LINKS)}
          title="Abrir Links"
          aria-label="Abrir Links"
        >
          <img src={linkIcon} alt="Abrir Links" />
        </button> */}

        {/* IMAGEM */}
        <button
          className="icon-tab"
          onClick={openPlaces}
          tabIndex="-1"
          title="Praças CRF"
          aria-label="Praças CRF"
        >
          <img src={imageIcon} alt="Praças CRF" />
        </button>
        <button
          className="icon-tab"
          onClick={openHistory}
          tabIndex="-1"
          title="Histórico"
          aria-label="Histórico"
        >
          <img src={historyIcon} alt="Histórico" />
        </button>
        <button
          className="icon-tab"
          onClick={openSettings}
          tabIndex="-1"
          title="Configurações"
          aria-label="Configurações"
        >
          <img src={settingsIcon} alt="Configurações" />
        </button>
        <div>
          <input
            type="checkbox"
            title="Manter sempre no topo"
            onChange={(e) => handleOnTop(e.target.checked)}
          />
        </div>
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

        {/* COPY (nova aba)
        {activeTab === TABS.COPY && (
          <CopyPanel
            copyCode={copyCode}
            setCopyCode={setCopyCode}
            importProducts={importProducts}
            isImporting={isImporting}
            openLogFile={openLogFile}
          />
        )}
        */}
      </main>

      {/* ===== Overlay de loading ===== */}
      {isImporting && (
        <div className="overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="loader">Copiando arquivos...</div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="settings-modal__header">
              <h2 id="settings-title">Configurações</h2>
              <button
                type="button"
                className="modal-icon-btn"
                onClick={() => setSettingsOpen(false)}
                aria-label="Fechar"
                title="Fechar"
              >
                ×
              </button>
            </header>

            <form className="settings-form" onSubmit={saveSettings}>
              <label className="settings-field settings-field--drive">
                <span>Drive</span>
                <div className="settings-drive-row">
                  <input
                    className="input settings-drive-input"
                    type="text"
                    value={settingsDraft.drive}
                    readOnly
                    title={settingsDraft.drive}
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={chooseDriveFolder}
                    disabled={isChoosingDrive || isSavingSettings}
                  >
                    {isChoosingDrive ? "..." : "Selecionar"}
                  </button>
                </div>
              </label>

              <label className="settings-field">
                <span>After Effects</span>
                <input
                  className="input settings-short-input"
                  type="text"
                  value={settingsDraft.aeVersion}
                  onChange={(e) => updateSettingsDraft("aeVersion", e.target.value)}
                  placeholder="2024"
                  autoComplete="off"
                />
              </label>

              <label className="settings-field">
                <span>Produtos</span>
                <input
                  className="input settings-short-input"
                  type="text"
                  value={settingsDraft.produtos}
                  onChange={(e) => updateSettingsDraft("produtos", e.target.value)}
                  placeholder="PRODUTOS"
                  autoComplete="off"
                />
              </label>

              <footer className="settings-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setSettingsOpen(false)}
                  disabled={isSavingSettings}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSavingSettings}>
                  {isSavingSettings ? "Salvando..." : "Salvar"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* ===== Toast no rodapé ===== */}
      {toast.open && (
        <div
          className={`toast ${toast.variant === "error" ? "toast--error" : toast.variant === "success" ? "toast--success" : ""}`}
          role="alert"
          aria-live="polite"
        >
          <span className="toast__text">{toast.message}</span>
          <button className="toast__close" onClick={hideToast} aria-label="Fechar">×</button>
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
    return ["secondary", "duplicate", "duplicate-identical", "history", "places", "media", "midia"].includes(view);
  } catch (error) {
    return false;
  }
}

export default App;
