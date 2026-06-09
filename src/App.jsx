import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import JobPanel from "./panels/JobPanel";
import LinksPanel from "./panels/LinksPanel";
import CopyPanel from "./panels/CopyPanel";
import "./App.css";
import previewImg from "./assets/hierarquia_pracas.jpg";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ÍCONES (svg como imagem)
import pastaIcon from "./assets/icones/project.svg";
import linkIcon from "./assets/icones/link.svg";
import imageIcon from "./assets/icones/hierarchy.svg";
import copyIcon from "./assets/icones/folder.svg"; // você pode trocar por outro ícone depois

const TABS = { JOBS: "jobs", LINKS: "links", IMAGE: "image", COPY: "copy" };

function App() {
  const [activeTab, setActiveTab] = useState(TABS.JOBS);

  // estados
  const [jobaoCod, setJobaoCod] = useState("");
  const [jobinhoCod, setJobinhoCod] = useState("");
  const [outOption, setOutOption] = useState("mp4");
  const [isOpeningOut, setIsOpeningOut] = useState(false);
  const [copyCode, setCopyCode] = useState("");


  // ==== Loading simples para importação ====
  const [isImporting, setIsImporting] = useState(false);

  // ==== Toast (erro no rodapé) ====
  const [toast, setToast] = useState({ open: false, message: "", variant: "error" });
  const hideTimerRef = useRef(null);

  const hideToast = () => {
    setToast(t => ({ ...t, open: false }));
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };
  const showError = (msg) => {
    setToast({ open: true, message: msg, variant: "error" });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(hideToast, 5000); // 5s
  };
  useEffect(() => () => hideToast(), []); // limpa timer ao desmontar

  // Helper: chama Python e mostra toast se vier erro ou exception
  const run = async (fnName, args, fallbackMsg) => {
    try {
      const res = await invoke(fnName, args);
      if (res && res.ok === false) showError(res.message || fallbackMsg);
      // quando ok==true, não faz nada
    } catch (e) {
      showError(fallbackMsg || "Falha ao executar ação.");
    }
  };

  // ações
  const openLogFile = async () => run("open_log_file", {}, "Não foi possível abrir o arquivo de log.");
  const projectName = async () => run("project_name", { jobaoCod, jobinhoCod }, "Não foi possível recuperar o nome do projeto.");
  const openJobao = async () => run("open_jobao", { jobaoCod }, `Não foi possível abrir o Jobão "${jobaoCod}".`);
  const openJobinho = async () => run("open_jobinho", { jobaoCod, jobinhoCod }, `Não foi possível abrir o Jobinho "${jobinhoCod}".`);
  const abrirAE = async () => run("abrir_ae", { jobaoCod, jobinhoCod }, `Não foi possível abrir o projeto ${jobinhoCod} no After Effects.`);
  const openVideo = async (jobaoCod, jobinhoCod, mediaType) => run("open_video", { jobaoCod, jobinhoCod, mediaType }, `Não foi possível abrir o vídeo do projeto "${jobinhoCod}"`);
  const openRoteiro = async () => run("open_roteiro", { jobaoCod, jobinhoCod }, `Não foi possível abrir o roteiro do projeto "${jobinhoCod}"`);
  const openOut = async (opt) => {
    if (isOpeningOut) return;                 // evita chamadas sobrepostas
    setIsOpeningOut(true);
    const chosen = opt ?? outOption;          // usa o param se vier, senão o estado atual
    try {
      await run("open_out", { jobaoCod, option: chosen }, "Não foi possível abrir a pasta OUT/RENDER.");
    } finally {
      setIsOpeningOut(false);
    }
  };

  const openVisto = async () => run("open_visto", {}, "Falha ao abrir o Visto.");
  const openPip = async () => run("open_pip", {}, "Falha ao abrir o Pip.");
  const openBitrix = async () => run("open_bitrix", {}, "Falha ao abrir o Bitrix.");
  const openClaro = async () => run("open_claro", {}, "Falha ao abrir o Claro.");
  const openLinks = async () => run("open_links", {}, "Falha ao abrir os links.");

  // ação de copiar arquivos — COM LOADING
  const importProducts = async () => {
    setIsImporting(true);
    try {
      const res = await invoke("import_products", { jobaoCod: copyCode });
      if (res && res.ok === false) {
        showError(res.message || "Não foi possível copiar os arquivos.");
      }
    } catch (e) {
      showError("Não foi possível copiar os arquivos.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleOnTop = async (onTop) => {
    await getCurrentWindow().setAlwaysOnTop(onTop);
  }

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

        {/* COPY (nova aba) */}
        <button
          className={`icon-tab ${activeTab === TABS.COPY ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.COPY)}
          tabIndex="-1"
          title="Copiar Arquivos"
          aria-label="Copiar Arquivos"
        >
          <img src={copyIcon} alt="Copiar Arquivos" />
        </button>

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
          className={`icon-tab ${activeTab === TABS.IMAGE ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.IMAGE)}
          tabIndex="-1"
          title="Praças CRF"
          aria-label="Praças CRF"
        >
          <img src={imageIcon} alt="Praças CRF" />
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
            openRoteiro={openRoteiro}
            projectName={projectName}
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

        {activeTab === TABS.IMAGE && (
          <div className="card">
            <img
              src={previewImg}
              alt="Preview"
              style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: "10px" }}
            />
          </div>
        )}

        {activeTab === TABS.COPY && (
          <CopyPanel
            copyCode={copyCode}
            setCopyCode={setCopyCode}
            importProducts={importProducts}
            isImporting={isImporting}
            openLogFile={openLogFile}
          />
        )}
      </main>

      {/* ===== Overlay de loading ===== */}
      {isImporting && (
        <div className="overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="loader">Copiando arquivos...</div>
        </div>
      )}

      {/* ===== Toast no rodapé ===== */}
      {toast.open && (
        <div
          className={`toast ${toast.variant === "error" ? "toast--error" : ""}`}
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

export default App;
