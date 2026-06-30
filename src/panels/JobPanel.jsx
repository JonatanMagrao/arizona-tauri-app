// panels/JobPanel.jsx
import searchIcon from "../assets/icones/folder.svg";
import aeIcon from "../assets/icones/aeft_icon.svg";
import copyIcon from "../assets/icones/file_copy.svg";
import equalIcon from "../assets/icones/equal.svg";
import roteiroIcon from "../assets/icones/roteiro.svg";
import printIcon from "../assets/icones/print.svg";
import videoIconMP4 from "../assets/icones/video_mp4.svg";
import videoIconMOV from "../assets/icones/video_mov.svg";
import productIcon from "../assets/icones/product.svg";
import claqueteIcon from "../assets/icones/claquete.svg";
import audioIcon from "../assets/icones/audio.svg";

const ICON_SIZE = 32; // altere aqui que todos os ícones do formulário mudam

function JobPanel({
  jobaoCod,
  setJobaoCod,
  jobinhoCod,
  setJobinhoCod,
  openJobao,
  openJobinho,
  abrirAE,
  openOut,
  outOption,
  setOutOption,
  isOpeningOut,
  openVideo,
  openAudio,
  revealVideo,
  openRoteiro,
  openDuplicateIdentical,
  footer
}) {

  const handleJobaoKeyDown = (e) => {
    if (e.key === "Enter" && jobaoCod.trim()) {
      e.preventDefault();
      openJobao();
    }
  }

  const handleJobinhoKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && jobaoCod.trim() && jobinhoCod.trim()) {
      e.preventDefault();
      openJobinho();
    }
    // Para a combinação de teclas Ctrl + Enter
    if (e.key === "Enter" && e.shiftKey && jobaoCod.trim() && jobinhoCod.trim()) {
      e.preventDefault();
      abrirAE();
      // alert("abrir ae")
    }
  };

  const openMedia = (mediaType) => {
    if (jobinhoCod.trim()) return revealVideo(jobaoCod, jobinhoCod, mediaType);
    return openOut(mediaType);
  };

  const handlers = {
    mp4: () => openMedia("mp4"),
    mov: () => openMedia("mov"),
    roteiro: () => openOut("roteiro"),
    print: () => openOut("print"),
    copia: () => openOut("copia"),
    produtos: () => openOut("produtos"),
    claquete: () => openOut("claquetes"),
    audio: () => openOut("audio"),
  };

  // (Opcional) ações alternativas para Shift + Clique, por id
  const handlersShift = {
    // Exemplo:
    mp4: () => openVideo(jobaoCod, jobinhoCod, "mp4"),
    mov: () => openVideo(jobaoCod, jobinhoCod, "mov"),
    roteiro: () => openRoteiro(jobaoCod, jobinhoCod),
    audio: () => {
      if (jobinhoCod.trim()) return openAudio(jobaoCod, jobinhoCod);
      return openOut("audio");
    }
  };

  // whitelist para Shift+Clique único
  const SHIFT_SINGLE_ALLOWED = new Set(["mp4", "mov", "roteiro", "audio"]);
  const ENABLE_SINGLE_CLICK = true; // mude para true p/ voltar a 1-clique

  // double click = comportamento normal (abre pasta)
  const handleUtilDoubleClick = (e, id) => {
    if (!jobaoCod.trim()) return;
    handlers[id]?.(); // duplo clique = ação normal
  };

  // single click só dispara se Shift estiver pressionado E o id estiver permitido
  const handleUtilClick = (e, id) => {
    if (!jobaoCod.trim()) return;
    if (ENABLE_SINGLE_CLICK && !e.shiftKey) return handlers[id]?.();
    if (!e.shiftKey || !SHIFT_SINGLE_ALLOWED.has(id)) return;
    const fn = handlersShift[id] || handlers[id];
    fn && fn();
  };

  return (
    // sobrescreve a CSS variable --icon-size só dentro deste card
    <div className="card" style={{ '--icon-size': `${ICON_SIZE}px` }}>
      {/* Linha Jobão */}
      <div className="form-row">
        <label className="label" htmlFor="jobao">Cód Jobão</label>
        <input
          id="jobao"
          className="input input-code"
          type="text"
          value={jobaoCod}
          onChange={(e) => setJobaoCod(e.target.value)}
          placeholder="Ex: 895"

          onKeyDown={handleJobaoKeyDown}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          tabIndex="-1"
          className="btn"
          onClick={openJobao}
          disabled={!jobaoCod.trim()}
          aria-label="Buscar Jobão"
          title="Abrir pasta do Jobão (Enter)"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <button
          tabIndex="-1"
          className="btn btn-secondary"
          onClick={openDuplicateIdentical}
          disabled={!jobaoCod.trim()}
          aria-label="Produtos idênticos"
          title="Produtos idênticos"
        >
          <img src={equalIcon} alt="" aria-hidden="true" />
        </button>
        <span aria-hidden="true"></span>
      </div>

      {/* Linha Jobinho */}
      <div className="form-row">
        <label className="label" htmlFor="jobinho">Cód Jobinho</label>
        <input
          id="jobinho"
          className="input input-code"
          type="text"
          value={jobinhoCod}
          onChange={(e) => setJobinhoCod(e.target.value)}
          placeholder="Ex: 15181"

          onKeyDown={handleJobinhoKeyDown}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          tabIndex="-1"
          className="btn"
          onClick={openJobinho}
          disabled={!jobaoCod.trim() || !jobinhoCod.trim()}
          aria-label="Buscar Jobinho"
          title="Abrir pasta do Jobinho (Enter)"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <button
          tabIndex="-1"
          className="btn btn-secondary"
          onClick={abrirAE}
          disabled={!jobaoCod.trim() || !jobinhoCod.trim()}
          aria-label="Abrir AE"
          title="Abrir AE (Shift + Enter)"
        >
          <img src={aeIcon} alt="" aria-hidden="true" />
        </button>
      </div>

      {/* Linha Pastas utilitárias – só botões */}
      <div className="form-row form-row--util">
        <div className="util-row" role="toolbar" aria-label="Pastas utilitárias">

          {[
            { id: "mp4", icon: videoIconMP4, label: "MP4" },
            { id: "mov", icon: videoIconMOV, label: "MOV" },
            { id: "roteiro", icon: roteiroIcon, label: "Roteiro" },
            { id: "audio", icon: audioIcon, label: "Áudio" },
            { id: "print", icon: printIcon, label: "Print" },
            { id: "copia", icon: copyIcon, label: "Cópia" },
            { id: "produtos", icon: productIcon, label: "Produtos" },
            { id: "claquete", icon: claqueteIcon, label: "Claquete" },
          ].map(({ id, icon, label }) => (
            <button
              key={id}
              type="button"
              className="util-square"
              onClick={(e) => handleUtilClick(e, id)}              // Shift+clique (whitelist)
              onDoubleClick={(e) => handleUtilDoubleClick(e, id)}  // duplo clique = padrão
              disabled={!jobaoCod.trim()}
              title={`Abrir ${label} (Duplo clique) — Shift+Clique: ação rápida${SHIFT_SINGLE_ALLOWED.has(id) ? "" : " (não disponível)"}`}
              aria-label={`Abrir ${label}`}
              tabIndex="-1"
            >
              <img src={icon} alt="" aria-hidden="true" />
            </button>
          ))}

        </div>
      </div>

      {footer}
    </div>
  );
}

export default JobPanel;
