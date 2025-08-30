// panels/JobPanel.jsx
import searchIcon from "../assets/icones/folder.svg";
import aeIcon from "../assets/icones/aeft_icon.svg";

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
}) {
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

          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          className="btn"
          onClick={openJobao}
          disabled={!jobaoCod.trim()}
          aria-label="Buscar Jobão"
          title="Buscar"
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
          
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          className="btn"
          onClick={openJobinho}
          disabled={!jobaoCod.trim() || !jobinhoCod.trim()}
          aria-label="Buscar Jobinho"
          title="Buscar"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <button
          className="btn btn-secondary"
          onClick={abrirAE}
          disabled={!jobaoCod.trim() || !jobinhoCod.trim()}
          aria-label="Abrir AE"
          title="Abrir AE"
        >
          <img src={aeIcon} alt="" aria-hidden="true" />
        </button>
      </div>

      {/* Linha Render */}
      <div className="form-row">
        <label className="label" htmlFor="render">Pastas utilitárias</label>
        <select
          id="render"
          name="render"
          className="input input-code"
          value={outOption}
          onChange={(e) => setOutOption(e.target.value)}
        >
          <option value="mp4">MP4</option>
          <option value="mov">MOV</option>
          <option value="roteiro">Roteiro</option>
          <option value="print">Print</option>
          <option value="copia">Cópia</option>
        </select>
        <button
          className="btn"
          onClick={openOut}
          disabled={!jobaoCod.trim()}
          aria-label="Buscar Pasta OUT"
          title="Buscar"
        >
          <img src={searchIcon} alt="" aria-hidden="true" />
        </button>
        <span aria-hidden="true"></span>
      </div>
    </div>
  );
}

export default JobPanel;
