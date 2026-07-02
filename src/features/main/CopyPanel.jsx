import fileCopy from "../../assets/icones/file_copy.svg";

const ICON_SIZE = 32;

function CopyPanel({ copyCode, setCopyCode, importProducts, isImporting, footer }) {
  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || !copyCode.trim() || isImporting) return;
    event.preventDefault();
    importProducts();
  };

  return (
    <div className="card" style={{ '--icon-size': `${ICON_SIZE}px` }}>
      <div className="form-row">
        <label className="label" htmlFor="copycode">Cód Jobão</label>
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
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn"
          onClick={importProducts}
          disabled={!copyCode.trim() || isImporting}
          aria-label="Copiar arquivos"
          title={isImporting ? "Copiando..." : "Copiar arquivos"}
        >
          {isImporting ? "..." : <img src={fileCopy} alt="" aria-hidden="true" />}
        </button>
        <span aria-hidden="true"></span>
      </div>

      {footer}
    </div>
  );
}

export default CopyPanel;
