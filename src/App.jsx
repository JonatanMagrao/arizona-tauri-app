import { useEffect, useRef, useState } from "react";
import { callFunction } from "tauri-plugin-python-api";
import JobPanel from "./panels/JobPanel";
import LinksPanel from "./panels/LinksPanel";
import "./App.css";
import previewImg from "./assets/hierarquia_pracas.jpg";

// ÍCONES (svg como imagem)
import pastaIcon from "./assets/icones/project.svg";
import linkIcon from "./assets/icones/link.svg";
import imageIcon from "./assets/icones/hierarchy.svg";

const TABS = { JOBS: "jobs", LINKS: "links", IMAGE: "image" };

function App() {
  const [activeTab, setActiveTab] = useState(TABS.JOBS);

  // estados
  const [jobaoCod, setJobaoCod] = useState("");
  const [jobinhoCod, setJobinhoCod] = useState("");
  const [outOption, setOutOption] = useState("mp4");

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
      const res = await callFunction(fnName, args);
      if (res && res.ok === false) showError(res.message || fallbackMsg);
      // quando ok==true, não faz nada
    } catch (e) {
      showError(fallbackMsg || "Falha ao executar ação.");
    }
  };

  // ações
  const openJobao   = async () => run("openJobao",   [jobaoCod],                 "Não foi possível abrir o Jobão.");
  const openJobinho = async () => run("openJobinho", [jobaoCod, jobinhoCod],     "Não foi possível abrir o Jobinho.");
  const abrirAE     = async () => run("abrirAE",     [jobaoCod, jobinhoCod],     "Não foi possível abrir o projeto no After Effects.");
  const openOut     = async () => run("openOut",     [jobaoCod, outOption],    "Não foi possível abrir a pasta OUT/RENDER.");

  const openVisto   = async () => run("openVisto",   [], "Falha ao abrir o Visto.");
  const openPip     = async () => run("openPip",     [], "Falha ao abrir o Pip.");
  const openBitrix  = async () => run("openBitrix",  [], "Falha ao abrir o Bitrix.");
  const openClaro   = async () => run("openClaro",   [], "Falha ao abrir o Claro.");
  const openLinks   = async () => run("openLinks",   [], "Falha ao abrir os links.");

  return (
    <div className="layout layout--with-leftbar">
      <aside className="iconbar" aria-label="Painéis">
        {/* JOBÃO & JOBINHO */}
        <button
          className={`icon-tab ${activeTab === TABS.JOBS ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.JOBS)}
          title="Projetos"
          aria-label="Projetos"
        >
          <img src={pastaIcon} alt="Projetos" />
        </button>

        {/* LINKS */}
        <button
          className={`icon-tab ${activeTab === TABS.LINKS ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.LINKS)}
          title="Abrir Links"
          aria-label="Abrir Links"
        >
          <img src={linkIcon} alt="Abrir Links" />
        </button>

        {/* IMAGEM */}
        <button
          className={`icon-tab ${activeTab === TABS.IMAGE ? "icon-tab--active" : ""}`}
          onClick={() => setActiveTab(TABS.IMAGE)}
          title="Praças CRF"
          aria-label="Praças CRF"
        >
          <img src={imageIcon} alt="Praças CRF" />
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
      </main>

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
