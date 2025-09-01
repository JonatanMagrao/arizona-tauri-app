// panels/CopyPanel.jsx
import fileCopy from "../assets/icones/file_copy.svg";

const ICON_SIZE = 32;

function CopyPanel({ copyCode, setCopyCode, importProducts }) {
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
        />
        <button
          className="btn"
          onClick={importProducts}
          disabled={!copyCode.trim()}
          aria-label="Copiar produtos"
          title="Copiar produtos"
        >
          <img src={fileCopy} alt="" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default CopyPanel;
