import { useEffect, useMemo, useRef, useState } from "react";
import { commandNames, invokeAction, invokeCommand } from "../../services/tauriCommands";
import refreshIcon from "../../assets/icones/history.svg";

const REGION_TOAST_MS = 2600;

function DuplicateIdenticalModal({
  initialJobaoCod = "",
  onClose,
  showError,
  showSuccess,
  standalone = false,
  closeOnSuccess = true,
}) {
  const [jobaoDraft, setJobaoDraft] = useState(onlyDigits(initialJobaoCod));
  const [items, setItems] = useState([]);
  const [copyRows, setCopyRows] = useState([createCopyRow()]);
  const [message, setMessage] = useState({ text: "", variant: "info" });
  const [regionToast, setRegionToast] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isUpdatingJson, setIsUpdatingJson] = useState(false);
  const [isImportingJson, setIsImportingJson] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const regionToastTimerRef = useRef(0);
  const regionInputRefs = useRef([]);
  const nameInputRefs = useRef([]);
  const pendingFocusRef = useRef(null);
  const undoStackRef = useRef([]);

  const sourceByRegion = useMemo(() => buildSourceByRegion(items), [items]);
  const existingNames = useMemo(() => new Set(items.map((item) => item.fileName.toLowerCase())), [items]);
  const hasItems = items.length > 0;
  const copyRowStatuses = useMemo(
    () => copyRows.map((row) => copyRegionStatus(row, sourceByRegion, hasItems)),
    [copyRows, hasItems, sourceByRegion]
  );
  const copyErrors = useMemo(
    () => buildCopyErrors(copyRows, sourceByRegion, existingNames),
    [copyRows, existingNames, sourceByRegion]
  );
  const hasCopyErrors = copyErrors.some((error) => error.region || error.name);
  const hasAnyCopyRow = copyRows.some((row) => row.region.trim() || row.name.trim());
  const isJsonBusy = isExportingJson || isUpdatingJson || isImportingJson;
  const canDuplicate = hasItems && hasAnyCopyRow && !isDuplicating && !isJsonBusy;
  const canUseJson = hasItems && !isLoading && !isDuplicating && !isJsonBusy;

  const setStatus = (text, variant = "info") => setMessage({ text, variant });
  const clearStatus = () => setMessage({ text: "", variant: "info" });

  useEffect(() => {
    return () => {
      if (regionToastTimerRef.current) {
        window.clearTimeout(regionToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) return undefined;

    pendingFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const refs = pendingFocus.field === "name" ? nameInputRefs : regionInputRefs;
      const input = refs.current[pendingFocus.index];
      if (!input || input.disabled) return;

      input.focus();
      input.select?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [copyRows.length]);

  const showRegionMissingToast = (region) => {
    const normalizedRegion = normalizeRegion(region);
    if (!normalizedRegion) return;

    setRegionToast(`A região "${normalizedRegion}" não existe neste projeto.`);

    if (regionToastTimerRef.current) {
      window.clearTimeout(regionToastTimerRef.current);
    }

    regionToastTimerRef.current = window.setTimeout(() => {
      setRegionToast("");
      regionToastTimerRef.current = 0;
    }, REGION_TOAST_MS);
  };

  const queryItems = async ({ openFolder = false } = {}) => {
    const jobaoCod = jobaoDraft.trim();

    if (!jobaoCod) {
      setStatus("Informe o código do Jobão.", "error");
      return;
    }

    setIsLoading(true);
    clearStatus();
    setRegionToast("");
    setSubmitted(false);

    try {
      const rows = await invokeCommand(commandNames.listIdenticalMp4Items, { jobaoCod });
      const nextItems = Array.isArray(rows) ? rows : [];

      setItems(nextItems);
      setCopyRows((currentRows) => (currentRows.length ? currentRows : [createCopyRow()]));

      if (!nextItems.length) {
        setStatus("Nenhum MP4 encontrado.", "error");
      } else {
        clearStatus();
        if (openFolder) {
          const openResult = await invokeAction(
            commandNames.openOut,
            { jobaoCod, option: "mp4" },
            "Não foi possível abrir a pasta MP4."
          );
          if (!openResult.ok) showError?.(openResult.message);
        }
      }
    } catch (err) {
      setItems([]);
      setStatus(String(err || "Não foi possível listar os MP4."), "error");
    } finally {
      setIsLoading(false);
    }
  };

  const loadItems = async (event) => {
    event.preventDefault();
    await queryItems({ openFolder: true });
  };

  const refreshItems = async () => {
    await queryItems();
  };

  const generateNamesJson = async () => {
    const jobaoCod = jobaoDraft.trim();

    if (!jobaoCod) {
      setStatus("Informe o código do Jobão.", "error");
      return;
    }

    setIsExportingJson(true);
    clearStatus();
    setRegionToast("");
    setSubmitted(false);

    try {
      const result = await invokeCommand(commandNames.exportIdenticalMp4NamesJson, { jobaoCod });
      const count = Number(result?.count) || 0;
      const successMessage =
        count === 1
          ? "JSON gerado na pasta CLAQUETES com 1 nome."
          : `JSON gerado na pasta CLAQUETES com ${count} nomes.`;

      setStatus(successMessage, "success");
      showSuccess?.(successMessage);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught || "Não foi possível gerar o JSON.");
      setStatus(error, "error");
      showError?.(error);
    } finally {
      setIsExportingJson(false);
    }
  };

  const updateNamesJson = async () => {
    const jobaoCod = jobaoDraft.trim();

    if (!jobaoCod) {
      setStatus("Informe o código do Jobão.", "error");
      return;
    }

    setIsUpdatingJson(true);
    clearStatus();
    setRegionToast("");
    setSubmitted(false);

    try {
      const result = await invokeCommand(commandNames.updateIdenticalMp4NamesJson, { jobaoCod });
      const addedCount = Number(result?.addedCount) || 0;
      const totalCount = Number(result?.count) || 0;
      const successMessage =
        addedCount === 0
          ? `JSON já estava atualizado com ${totalCount} nomes.`
          : addedCount === 1
            ? `JSON atualizado com 1 nome novo. Total: ${totalCount}.`
            : `JSON atualizado com ${addedCount} nomes novos. Total: ${totalCount}.`;

      setStatus(successMessage, "success");
      showSuccess?.(successMessage);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught || "Não foi possível atualizar o JSON.");
      setStatus(error, "error");
      showError?.(error);
    } finally {
      setIsUpdatingJson(false);
    }
  };

  const importNamesJson = async () => {
    const jobaoCod = jobaoDraft.trim();

    if (!jobaoCod) {
      setStatus("Informe o código do Jobão.", "error");
      return;
    }

    setIsImportingJson(true);
    clearStatus();
    setRegionToast("");
    setSubmitted(false);

    try {
      const result = await invokeCommand(commandNames.importIdenticalMp4NamesJson, { jobaoCod });
      const names = Array.isArray(result?.names)
        ? result.names.map((name) => String(name || "").trim()).filter(Boolean)
        : [];

      if (!names.length) {
        throw new Error("Nenhum nome encontrado no JSON.");
      }

      pushRowsUndo(copyRows);
      pendingFocusRef.current = { index: 0, field: "region" };
      setCopyRows(names.map((name) => ({ region: "", name })));

      const successMessage =
        names.length === 1
          ? "1 nome importado. Preencha a região."
          : `${names.length} nomes importados. Preencha as regiões.`;

      setStatus(successMessage, "success");
      showSuccess?.(successMessage);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught || "Não foi possível importar o JSON.");
      setStatus(error, "error");
      showError?.(error);
    } finally {
      setIsImportingJson(false);
    }
  };

  const resetJobaoState = () => {
    undoStackRef.current = [];
    setItems([]);
    setCopyRows([createCopyRow()]);
    setRegionToast("");
    clearStatus();
    setSubmitted(false);
  };

  const resetDuplicateState = () => {
    undoStackRef.current = [];
    setJobaoDraft("");
    setItems([]);
    setCopyRows([createCopyRow()]);
    setRegionToast("");
    clearStatus();
    setSubmitted(false);
  };

  const closeAndReset = () => {
    resetDuplicateState();
    if (onClose) onClose();
  };

  const updateJobaoDraft = (value) => {
    setJobaoDraft(onlyDigits(value));
    resetJobaoState();
  };

  const updateCopyRegion = (index, value) => {
    const nextRegion = onlyText(value).toUpperCase();
    setCopyRows((rows) =>
      rows.map((row, idx) => (idx === index ? { ...row, region: nextRegion } : row))
    );
    setSubmitted(false);
  };

  const validateCopyRegion = (index) => {
    const row = copyRows[index];
    if (!row?.region.trim() || !hasItems) return;

    if (!sourceByRegion.has(normalizeRegion(row.region))) {
      showRegionMissingToast(row.region);
    }
  };

  const updateCopyName = (index, value) => {
    setCopyRows((rows) =>
      rows.map((row, idx) => (idx === index ? { ...row, name: value } : row))
    );
    setSubmitted(false);
  };

  const pushRowsUndo = (rows) => {
    undoStackRef.current = [...undoStackRef.current.slice(-19), cloneCopyRows(rows)];
  };

  const undoCopyRows = () => {
    const previousRows = undoStackRef.current.pop();
    if (!previousRows) return false;

    pendingFocusRef.current = { index: Math.max(0, previousRows.length - 1), field: "name" };
    setCopyRows(previousRows);
    setSubmitted(false);
    clearStatus();
    return true;
  };

  const addCopyField = () => {
    pushRowsUndo(copyRows);
    pendingFocusRef.current = { index: copyRows.length, field: "region" };
    setCopyRows((rows) => [...rows, createCopyRow()]);
    setSubmitted(false);
  };

  const removeCopyField = (index) => {
    pushRowsUndo(copyRows);
    setCopyRows((rows) => rows.filter((_, idx) => idx !== index));
    setSubmitted(false);
  };

  const getCopyInputTargets = () => {
    const targets = [];

    for (let index = 0; index < copyRows.length; index += 1) {
      const regionInput = regionInputRefs.current[index];
      const nameInput = nameInputRefs.current[index];
      if (regionInput && !regionInput.disabled) targets.push(regionInput);
      if (nameInput && !nameInput.disabled) targets.push(nameInput);
    }

    return targets;
  };

  const handleCopyInputKeyDown = (event, index) => {
    if (event.key === "Tab") {
      const targets = getCopyInputTargets();
      if (targets.length === 0) return;
      if (targets.length === 1) {
        event.preventDefault();
        targets[0].focus();
        return;
      }

      const firstTarget = targets[0];
      const lastTarget = targets[targets.length - 1];
      if (!event.shiftKey && event.currentTarget === lastTarget) {
        event.preventDefault();
        firstTarget.focus();
      } else if (event.shiftKey && event.currentTarget === firstTarget) {
        event.preventDefault();
        lastTarget.focus();
      }
      return;
    }

    if (event.key !== "Enter") return;

    event.preventDefault();
    const row = copyRows[index];
    const normalizedRegion = normalizeRegion(row?.region);
    const rowStatus = copyRowStatuses[index];

    if (rowStatus !== "valid") {
      if (normalizedRegion) showRegionMissingToast(normalizedRegion);
      return;
    }

    if (event.currentTarget === regionInputRefs.current[index]) {
      nameInputRefs.current[index]?.focus();
      return;
    }

    if (!row?.name.trim()) return;

    pushRowsUndo(copyRows);
    pendingFocusRef.current = { index: copyRows.length, field: "name" };
    setCopyRows((rows) => [...rows, { region: normalizedRegion, name: "" }]);
    setSubmitted(false);
  };

  const handleModalKeyDown = (event) => {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    if (!isCtrlOrMeta) return;
    if (event.repeat) return;

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (canDuplicate && !isDuplicating) duplicateSelected();
      return;
    }

    if (event.key?.toLowerCase() === "z") {
      if (!undoStackRef.current.length) return;

      event.preventDefault();
      event.stopPropagation();
      undoCopyRows();
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleModalKeyDown, true);
    return () => window.removeEventListener("keydown", handleModalKeyDown, true);
  }, [handleModalKeyDown]);

  const duplicateSelected = async () => {
    setSubmitted(true);
    clearStatus();

    if (!hasItems) {
      setStatus("Busque um Jobão antes de duplicar.", "error");
      return;
    }

    if (!hasAnyCopyRow) {
      setStatus("Adicione ao menos uma linha de cópia.", "error");
      return;
    }

    if (hasCopyErrors) {
      const unknownRegionIndex = copyErrors.findIndex((error) => error.region.includes("não existe"));
      if (unknownRegionIndex >= 0) {
        showRegionMissingToast(copyRows[unknownRegionIndex].region);
        return;
      }

      setStatus(copyErrorsMessage(copyErrors), "error");
      return;
    }

    const groupedCopies = groupCopiesBySource(copyRows, sourceByRegion);
    setIsDuplicating(true);

    try {
      let createdCount = 0;

      for (const [sourceFileName, names] of groupedCopies.entries()) {
        const result = await invokeAction(
          commandNames.duplicateIdenticalMp4,
          {
            jobaoCod: jobaoDraft.trim(),
            sourceFileName,
            copyNames: names,
          },
          "Não foi possível duplicar o MP4."
        );

        if (!result.ok) {
          throw new Error(result.message || "Não foi possível duplicar o MP4.");
        }

        createdCount += names.length;
      }

      const successMessage = createdCount === 1 ? "1 cópia criada." : `${createdCount} cópias criadas.`;
      showSuccess(successMessage);
      setStatus(successMessage, "success");
      undoStackRef.current = [];
      setCopyRows([createCopyRow()]);
      setSubmitted(false);

      if (closeOnSuccess && onClose) onClose();
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "Não foi possível duplicar o MP4.";
      setStatus(error, "error");
      showError?.(error);
    } finally {
      setIsDuplicating(false);
    }
  };

  const hasMessage = Boolean(message.text);

  const content = (
      <section
        className={`duplicate-modal${standalone ? " duplicate-modal--standalone" : ""}`}
        role="dialog"
        aria-modal={!standalone}
        aria-labelledby="duplicate-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {!standalone && (
          <header className="duplicate-modal__header">
            <h2 id="duplicate-title">Cópia de produtos idênticos</h2>
            {onClose && (
              <button
                type="button"
                className="modal-icon-btn"
                onClick={closeAndReset}
                aria-label="Fechar"
                title="Fechar"
                tabIndex={-1}
              >
                x
              </button>
            )}
          </header>
        )}

        <form className="duplicate-search" onSubmit={loadItems}>
          <label className="duplicate-jobao-field">
            <span>Jobão</span>
            <input
              className="input input-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={jobaoDraft}
              onChange={(event) => updateJobaoDraft(event.target.value)}
              placeholder="Ex: 895"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={isLoading || isDuplicating || isJsonBusy}
              tabIndex={hasItems ? -1 : undefined}
              autoFocus
            />
          </label>

          <button
            type="submit"
            className="btn btn-outline duplicate-search-btn"
            disabled={!jobaoDraft.trim() || isLoading || isDuplicating || isJsonBusy}
            tabIndex={-1}
          >
            {isLoading ? "..." : "Buscar"}
          </button>
          <button
            type="button"
            className="duplicate-refresh-btn"
            onClick={refreshItems}
            disabled={!jobaoDraft.trim() || !items.length || isLoading || isDuplicating || isJsonBusy}
            aria-label="Atualizar lista"
            title="Atualizar lista sem abrir a pasta"
            tabIndex={-1}
          >
            <img src={refreshIcon} alt="" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-outline duplicate-json-btn"
            onClick={generateNamesJson}
            disabled={!canUseJson}
            title="Gerar JSON na pasta CLAQUETES com os nomes MP4"
            tabIndex={-1}
          >
            {isExportingJson ? "..." : "Gerar JSON"}
          </button>
          <button
            type="button"
            className="btn btn-outline duplicate-json-btn"
            onClick={updateNamesJson}
            disabled={!canUseJson}
            title="Adicionar ao JSON em CLAQUETES os MP4 que ainda não estão nele"
            tabIndex={-1}
          >
            {isUpdatingJson ? "..." : "Atualizar JSON"}
          </button>
          <button
            type="button"
            className="btn btn-outline duplicate-json-btn"
            onClick={importNamesJson}
            disabled={!canUseJson}
            title="Importar nomes do JSON na pasta CLAQUETES"
            tabIndex={-1}
          >
            {isImportingJson ? "..." : "Importar JSON"}
          </button>
        </form>

        <div
          className={`duplicate-message duplicate-message--${message.variant}${hasMessage ? "" : " duplicate-message--empty"}`}
          role={hasMessage ? "alert" : undefined}
          aria-hidden={!hasMessage}
        >
          {message.text}
        </div>

        <div className="duplicate-content">
          {hasItems && (
            <div className="duplicate-copy-list">
              {copyRows.map((row, index) => {
                const error = submitted ? copyErrors[index] : {};
                const rowStatus = copyRowStatuses[index];
                const isUnknownRegion = rowStatus === "invalid";
                const isKnownRegion = rowStatus === "valid";
                const regionClassName = [
                  "input",
                  "duplicate-copy-region-input",
                  error.region || isUnknownRegion ? "input--error" : "",
                  !error.region && isKnownRegion ? "input--success" : "",
                ].filter(Boolean).join(" ");
                const nameClassName = [
                  "input",
                  error.name || isUnknownRegion ? "input--error" : "",
                ].filter(Boolean).join(" ");
                const nameDisabled = isDuplicating || isImportingJson || !isKnownRegion;
                const invalidRegionTitle = "A região não existe neste projeto.";
                return (
                  <div className="duplicate-copy-field" key={index}>
                    <span>{index + 1}</span>
                    <input
                      ref={(element) => {
                        regionInputRefs.current[index] = element;
                      }}
                      className={regionClassName}
                      type="text"
                      value={row.region}
                      onChange={(event) => updateCopyRegion(index, event.target.value)}
                      onBlur={() => validateCopyRegion(index)}
                      onKeyDown={(event) => handleCopyInputKeyDown(event, index)}
                      placeholder="REGIÃO"
                      autoComplete="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="characters"
                      disabled={isDuplicating || isImportingJson}
                      title={error.region || (isUnknownRegion ? invalidRegionTitle : "Região")}
                    />
                    <input
                      ref={(element) => {
                        nameInputRefs.current[index] = element;
                      }}
                      className={nameClassName}
                      type="text"
                      value={row.name}
                      onChange={(event) => updateCopyName(index, event.target.value)}
                      onKeyDown={(event) => handleCopyInputKeyDown(event, index)}
                      placeholder="Novo nome"
                      autoComplete="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      disabled={nameDisabled}
                      title={isUnknownRegion ? invalidRegionTitle : error.name || "Novo nome"}
                    />
                    <button
                      type="button"
                      className="duplicate-mini-btn"
                      onClick={() => removeCopyField(index)}
                      disabled={copyRows.length === 1 || isDuplicating || isImportingJson}
                      aria-label="Remover linha"
                      title="Remover"
                      tabIndex={-1}
                    >
                      x
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="duplicate-add-btn"
                onClick={addCopyField}
                disabled={isDuplicating || isImportingJson}
                aria-label="Adicionar linha"
                title="Adicionar"
                tabIndex={-1}
              >
                +
              </button>
            </div>
          )}
        </div>

        {regionToast && (
          <div className="duplicate-floating-toast duplicate-floating-toast--error" role="alert">
            {regionToast}
          </div>
        )}

        <footer className="duplicate-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={closeAndReset}
            disabled={isDuplicating || isJsonBusy}
            tabIndex={-1}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={duplicateSelected}
            disabled={!canDuplicate}
            tabIndex={-1}
          >
            {isDuplicating ? "Duplicando..." : "Duplicar"}
          </button>
        </footer>
      </section>
  );

  if (standalone) return content;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeAndReset}>
      {content}
    </div>
  );
}

function copyErrorsMessage(copyErrors) {
  const existingCount = copyErrors.filter((error) => error.name === "Arquivo já existe.").length;
  if (existingCount === 1) return "Esse projeto já existe na pasta MP4.";
  if (existingCount > 1) return "Esses projetos já existem na pasta MP4.";

  if (copyErrors.some((error) => error.name === "Nome repetido.")) {
    return "Há nomes repetidos nas linhas de cópia.";
  }

  if (copyErrors.some((error) => error.name === "Preencha este nome.")) {
    return "Preencha o novo nome antes de duplicar.";
  }

  return "Revise as regiões das linhas de cópia.";
}

function buildCopyErrors(copyRows, sourceByRegion, existingNames) {
  const counts = new Map();
  const normalized = copyRows.map((row) => {
    const source = sourceByRegion.get(normalizeRegion(row.region));
    return normalizeTargetName(row.name, source?.extension || "mp4");
  });

  for (const name of normalized) {
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return copyRows.map((row, index) => {
    const region = normalizeRegion(row.region);
    const trimmed = row.name.trim();
    const normalizedName = normalized[index];
    const error = { region: "", name: "" };

    if (!region) {
      error.region = "Informe a região.";
    } else if (!sourceByRegion.has(region)) {
      error.region = "A região não existe neste projeto.";
    }

    if (!trimmed) error.name = "Preencha este nome.";
    else if (counts.get(normalizedName) > 1) error.name = "Nome repetido.";
    else if (existingNames.has(normalizedName)) error.name = "Arquivo já existe.";

    return error;
  });
}

function groupCopiesBySource(copyRows, sourceByRegion) {
  const grouped = new Map();

  for (const row of copyRows) {
    const source = sourceByRegion.get(normalizeRegion(row.region));
    if (!source) continue;

    const names = grouped.get(source.fileName) || [];
    names.push(row.name.trim());
    grouped.set(source.fileName, names);
  }

  return grouped;
}

function buildSourceByRegion(items) {
  const sourceByRegion = new Map();

  for (const item of items) {
    const region = regionFromFileName(item.fileName);
    if (region && !sourceByRegion.has(region)) {
      sourceByRegion.set(region, item);
    }
  }

  return sourceByRegion;
}

function copyRegionStatus(row, sourceByRegion, hasItems) {
  const region = normalizeRegion(row.region);
  if (!hasItems || !region) return "idle";
  return sourceByRegion.has(region) ? "valid" : "invalid";
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

function normalizeRegion(value) {
  return onlyText(value).replace(/\s+/g, "").toUpperCase();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function onlyText(value) {
  return String(value || "").replace(/[^\p{L}\s]/gu, "");
}

function regionFromFileName(fileName) {
  const parts = String(fileName || "").split("_");
  return normalizeRegion(parts[1] || "");
}

function createCopyRow() {
  return { region: "", name: "" };
}

function cloneCopyRows(rows) {
  return rows.map((row) => ({ ...row }));
}

export default DuplicateIdenticalModal;
