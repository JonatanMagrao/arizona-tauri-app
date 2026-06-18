// panels/CopyPanel.jsx
import fileCopy from "../assets/icones/file_copy.svg";

const ICON_SIZE = 32;

function CopyPanel({ copyCode, setCopyCode, importProducts, isImporting }) {
  return (
    <div className="card" style={{ '--icon-size': `${ICON_SIZE}px` }}>
      <div className="form-row">
        <label className="label" htmlFor="copycode">Cod Jobão</label>
        <input
          id="copycode"
          className="input input-code"
          type="text"
          value={copyCode}
          onChange={(e) => setCopyCode(e.target.value)}
          placeholder="Ex: 895"
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={isImporting}
        />
        <button
          className="btn"
          onClick={importProducts}
          disabled={!copyCode.trim() || isImporting}
          aria-label="Copiar produtos"
          title={isImporting ? "Copiando..." : "Copiar produtos"}
        >
          {isImporting ? "..." : <img src={fileCopy} alt="" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export default CopyPanel;
