import { useMemo, useState } from "react";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";

function DuplicateIdenticalModal({ initialJobaoCod, onClose, showError, showSuccess }) {
  const [jobaoDraft, setJobaoDraft] = useState(initialJobaoCod.trim());
  const [regionDraft, setRegionDraft] = useState("");
  const [items, setItems] = useState([]);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [copyNames, setCopyNames] = useState([""]);
  const [message, setMessage] = useState({ text: "", variant: "info" });
  const [showFileList, setShowFileList] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedItem = items.find((item) => item.fileName === selectedFileName) || null;
  const selectedExtension = selectedItem?.extension || "mp4";
  const existingNames = useMemo(() => new Set(items.map((item) => item.fileName.toLowerCase())), [items]);
  const copyErrors = useMemo(
    () => buildCopyErrors(copyNames, existingNames, selectedExtension),
    [copyNames, existingNames, selectedExtension]
  );
  const hasCopyErrors = copyErrors.some(Boolean);
  const hasAnyCopyName = copyNames.some((name) => name.trim());
  const canDuplicate = Boolean(selectedFileName) && hasAnyCopyName && !isDuplicating;

  const setStatus = (text, variant = "info") => setMessage({ text, variant });
  const clearStatus = () => setMessage({ text: "", variant: "info" });

  const loadItems = async (event) => {
    event.preventDefault();
    const jobaoCod = jobaoDraft.trim();
    const region = regionDraft.trim();

    if (!jobaoCod) {
      setStatus("Informe o codigo do Jobao.", "error");
      return;
    }

    setIsLoading(true);
    clearStatus();
    setItems([]);
    setSelectedFileName("");
    setShowFileList(false);
    setSubmitted(false);

    try {
      const rows = await invokeCommand(commandNames.listIdenticalMp4Items, { jobaoCod });
      const nextItems = Array.isArray(rows) ? rows : [];
      const normalizedRegion = normalizeSearchText(region);
      const matchedItem = normalizedRegion
        ? nextItems.find((item) => normalizeSearchText(item.fileName).includes(normalizedRegion))
        : null;

      setItems(nextItems);
      setSelectedFileName(matchedItem?.fileName || "");
      setShowFileList(!matchedItem && nextItems.length > 0);

      if (!nextItems.length) {
        setStatus("Nenhum MP4 encontrado.", "error");
      } else if (matchedItem) {
        setStatus(`Matriz encontrada: ${matchedItem.fileName}`, "success");
        const openResult = await invokeAction(
          commandNames.openOut,
          { jobaoCod, option: "mp4" },
          "Nao foi possivel abrir a pasta MP4."
        );
        if (!openResult.ok) showError(openResult.message);
      } else if (region) {
        setStatus(`Nenhum MP4 encontrado com "${region}". Escolha a matriz na lista.`, "warning");
      } else {
        setStatus("Escolha a matriz na lista.", "info");
      }
    } catch (err) {
      setStatus(String(err || "Nao foi possivel listar os MP4."), "error");
    } finally {
      setIsLoading(false);
    }
  };

  const resetSelection = () => {
    setItems([]);
    setSelectedFileName("");
    setShowFileList(false);
    clearStatus();
    setSubmitted(false);
  };

  const updateJobaoDraft = (value) => {
    setJobaoDraft(value);
    resetSelection();
  };

  const updateRegionDraft = (value) => {
    setRegionDraft(value.toUpperCase());
    setSelectedFileName("");
    setShowFileList(false);
    clearStatus();
    setSubmitted(false);
  };

  const changeMatrix = () => {
    setSelectedFileName("");
    setShowFileList(true);
    setStatus("Escolha a matriz na lista.", "info");
    setSubmitted(false);
  };

  const selectItem = (item) => {
    if (isDuplicating) return;
    setSelectedFileName(item.fileName);
    setShowFileList(false);
    setStatus(`Matriz selecionada: ${item.fileName}`, "success");
    setSubmitted(false);
  };

  const updateCopyName = (index, value) => {
    setCopyNames((names) => names.map((name, idx) => (idx === index ? value : name)));
    setSubmitted(false);
  };

  const addCopyField = () => {
    setCopyNames((names) => [...names, ""]);
    setSubmitted(false);
  };

  const removeCopyField = (index) => {
    setCopyNames((names) => names.filter((_, idx) => idx !== index));
    setSubmitted(false);
  };

  const duplicateSelected = async () => {
    setSubmitted(true);
    clearStatus();

    if (!selectedFileName) {
      setStatus("Selecione um MP4.", "error");
      return;
    }

    if (hasCopyErrors) {
      setStatus("Revise os nomes das copias.", "error");
      return;
    }

    setIsDuplicating(true);
    const result = await invokeAction(
      commandNames.duplicateIdenticalMp4,
      {
        jobaoCod: jobaoDraft.trim(),
        sourceFileName: selectedFileName,
        copyNames: copyNames.map((name) => name.trim()),
      },
      "Nao foi possivel duplicar o MP4."
    );
    setIsDuplicating(false);

    if (!result.ok) {
      const error = result.message || "Nao foi possivel duplicar o MP4.";
      setStatus(error, "error");
      showError(error);
      return;
    }

    showSuccess(result.response?.message || "Copias criadas.");
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="duplicate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="duplicate-modal__header">
          <h2 id="duplicate-title">Duplicar identicos</h2>
          <button
            type="button"
            className="modal-icon-btn"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar"
          >
            x
          </button>
        </header>

        <form className="duplicate-search" onSubmit={loadItems}>
          <label className="duplicate-jobao-field">
            <span>Jobao</span>
            <input
              className="input input-code"
              type="text"
              value={jobaoDraft}
              onChange={(event) => updateJobaoDraft(event.target.value)}
              placeholder="Ex: 895"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={isLoading || isDuplicating}
              autoFocus
            />
          </label>

          <label className="duplicate-region-field">
            <span>Regiao</span>
            <input
              className="input duplicate-region-input"
              type="text"
              value={regionDraft}
              onChange={(event) => updateRegionDraft(event.target.value)}
              placeholder="RJ"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="characters"
              disabled={isLoading || isDuplicating}
            />
          </label>

          <button
            type="submit"
            className="btn btn-outline duplicate-search-btn"
            disabled={!jobaoDraft.trim() || isLoading || isDuplicating}
          >
            {isLoading ? "..." : "Buscar"}
          </button>
        </form>

        {message.text && (
          <div className={`duplicate-message duplicate-message--${message.variant}`} role="alert">
            {message.text}
          </div>
        )}

        <div className="duplicate-content">
          {selectedItem && !showFileList && (
            <div className="duplicate-matrix">
              <span>Matriz</span>
              <strong title={selectedItem.fileName}>{selectedItem.fileName}</strong>
              {items.length > 1 && (
                <button
                  type="button"
                  className="duplicate-change-btn"
                  onClick={changeMatrix}
                  disabled={isDuplicating}
                >
                  Mudar matriz
                </button>
              )}
            </div>
          )}

          {showFileList && items.length > 0 && (
            <div className="duplicate-file-list" role="radiogroup" aria-label="MP4">
              {items.map((item) => (
                <label
                  key={item.fileName}
                  className={`duplicate-file-option ${
                    selectedFileName === item.fileName ? "duplicate-file-option--selected" : ""
                  }`}
                  title={item.fileName}
                  onClick={() => selectItem(item)}
                >
                  <input
                    type="radio"
                    name="duplicate-source"
                    value={item.fileName}
                    checked={selectedFileName === item.fileName}
                    onChange={() => selectItem(item)}
                    disabled={isDuplicating}
                  />
                  <span>{item.fileName}</span>
                </label>
              ))}
            </div>
          )}

          {selectedFileName && (
            <div className="duplicate-copy-list">
              {copyNames.map((name, index) => {
                const error = submitted ? copyErrors[index] : "";
                return (
                  <label className="duplicate-copy-field" key={index}>
                    <span>{index + 1}</span>
                    <input
                      className={`input ${error ? "input--error" : ""}`}
                      type="text"
                      value={name}
                      onChange={(event) => updateCopyName(index, event.target.value)}
                      placeholder="Novo nome"
                      autoComplete="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      disabled={isDuplicating}
                      title={error || "Novo nome"}
                    />
                    <button
                      type="button"
                      className="duplicate-mini-btn"
                      onClick={() => removeCopyField(index)}
                      disabled={copyNames.length === 1 || isDuplicating}
                      aria-label="Remover nome"
                      title="Remover"
                    >
                      x
                    </button>
                  </label>
                );
              })}

              <button
                type="button"
                className="duplicate-add-btn"
                onClick={addCopyField}
                disabled={isDuplicating}
                aria-label="Adicionar nome"
                title="Adicionar"
              >
                +
              </button>
            </div>
          )}
        </div>

        <footer className="duplicate-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={isDuplicating}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={duplicateSelected}
            disabled={!canDuplicate}
          >
            {isDuplicating ? "Duplicando..." : "Duplicar"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function buildCopyErrors(copyNames, existingNames, extension) {
  const counts = new Map();
  const normalized = copyNames.map((name) => normalizeTargetName(name, extension));

  for (const name of normalized) {
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return copyNames.map((name, index) => {
    const trimmed = name.trim();
    const normalizedName = normalized[index];
    if (!trimmed) return "Preencha este nome.";
    if (counts.get(normalizedName) > 1) return "Nome repetido.";
    if (existingNames.has(normalizedName)) return "Arquivo ja existe.";
    return "";
  });
}

function normalizeTargetName(value, extension) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  const normalizedExtension = String(extension || "").replace(/^\./, "").toLowerCase();
  if (!normalizedExtension) return trimmed;
  return trimmed.endsWith(`.${normalizedExtension}`)
    ? trimmed
    : `${trimmed}.${normalizedExtension}`;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

export default DuplicateIdenticalModal;
