// panels/JobPanel.jsx
import searchIcon from "../assets/icones/folder.svg";
import aeIcon from "../assets/icones/aeft_icon.svg";
import copyIcon from "../assets/icones/file_copy.svg";
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
      //! abrirAE();
      alert("abrir ae")
    }
  };

  const handlers = {
    mp4: () => openOut("mp4"),
    mov: () => openOut("mov"),
    roteiro: () => openOut("roteiro"),
    print: () => openOut("print"),
    copia: () => openOut("copia"),
    produtos: () => openOut("produtos"),
    claquete: () => openOut("claquetes"),
    audio: () => openOut("audio"),
  };

  return (
    // sobrescreve a CSS variable --icon-size só dentro deste card
    <div className="card" style={{ '--icon-size': `${ICON_SIZE}px` }}>
      {/* Linha Jobão */}
      <div className="form-row">
        <label className="label" htmlFor="jobao">Cod Jobão</label>
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
          title="Abri pasta do Jobão"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <span aria-hidden="true"></span>
      </div>

      {/* Linha Jobinho */}
      <div className="form-row">
        <label className="label" htmlFor="jobinho">Cod Jobinho</label>
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
          title="Abrir pasta do Jobinho"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <button
          tabIndex="-1"
          className="btn btn-secondary"
          onClick={abrirAE}
          disabled={!jobaoCod.trim() || !jobinhoCod.trim()}
          aria-label="Abrir AE"
          title="Abrir AE"
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
              onClick={handlers[id]}
              disabled={!jobaoCod.trim()}
              title={`Abrir ${label}`}
              aria-label={`Abrir ${label}`}
              tabIndex="-1"
            >
              <img src={icon} alt="" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

export default JobPanel;
