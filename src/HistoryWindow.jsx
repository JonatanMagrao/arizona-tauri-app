import { useEffect, useMemo, useState } from "react";
import AppDropdown from "./AppDropdown";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import folderIcon from "./assets/icones/folder.svg";
import aeIcon from "./assets/icones/aeft_icon.svg";
import refreshIcon from "./assets/icones/history.svg";
import videoIconMP4 from "./assets/icones/video_mp4.svg";
import videoIconMOV from "./assets/icones/video_mov.svg";
import chevronIcon from "./assets/icones/chevron.svg";

const HISTORY_TYPES = Object.freeze({
  PROJECTS: "projects",
  COPIES: "copies",
  PRODUCT_IMPORTS: "productImports",
});

const HISTORY_META = Object.freeze({
  [HISTORY_TYPES.PROJECTS]: {
    label: "Projetos",
    empty: "Nenhum projeto aberto ainda.",
    table: "Historico de projetos",
    search: "Pesquisar por jobao, jobinho ou regiao",
    column: "Projeto",
    epochKey: "openedAtEpoch",
  },
  [HISTORY_TYPES.COPIES]: {
    label: "Copias MP4",
    empty: "Nenhuma copia registrada ainda.",
    table: "Historico de copias",
    search: "Pesquisar por jobao, matriz ou copia",
    column: "Copia",
    epochKey: "copiedAtEpoch",
  },
  [HISTORY_TYPES.PRODUCT_IMPORTS]: {
    label: "Produtos",
    empty: "Nenhuma importacao de produtos registrada ainda.",
    table: "Historico de importacoes de produtos",
    search: "Pesquisar por jobao, arquivo ou pasta",
    column: "Importacao",
    epochKey: "importedAtEpoch",
  },
});

function HistoryWindow({ onClose }) {
  const [projectEntries, setProjectEntries] = useState([]);
  const [copyEntries, setCopyEntries] = useState([]);
  const [productImportEntries, setProductImportEntries] = useState([]);
  const [activeType, setActiveType] = useState(HISTORY_TYPES.PROJECTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateSort, setDateSort] = useState("desc");

  const isProjectsType = activeType === HISTORY_TYPES.PROJECTS;
  const isCopiesType = activeType === HISTORY_TYPES.COPIES;
  const meta = HISTORY_META[activeType] || HISTORY_META[HISTORY_TYPES.PROJECTS];
  const activeEntries = activeEntriesForType(activeType, {
    projects: projectEntries,
    copies: copyEntries,
    productImports: productImportEntries,
  });
  const visibleEntries = useMemo(() => {
    const filtered = filterEntries(activeType, activeEntries, searchQuery);
    return sortEntries(filtered, dateSort, meta.epochKey);
  }, [activeEntries, activeType, searchQuery, dateSort, meta.epochKey]);
  const hasSearch = Boolean(searchQuery.trim());
  const countLabel = hasSearch
    ? `${visibleEntries.length} de ${activeEntries.length} registros`
    : `${activeEntries.length} registros`;

  const loadHistory = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const [projects, copies, productImports] = await Promise.all([
        invokeCommand(commandNames.historyList),
        invokeCommand(commandNames.historyCopyList),
        invokeCommand(commandNames.historyProductImportList),
      ]);
      setProjectEntries(Array.isArray(projects) ? projects : []);
      setCopyEntries(Array.isArray(copies) ? copies : []);
      setProductImportEntries(Array.isArray(productImports) ? productImports : []);
    } catch (err) {
      setMessage(String(err || "Nao foi possivel carregar o historico."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const runAction = async (fnName, args, refresh = false) => {
    setMessage("");
    const result = await invokeAction(fnName, args, "Nao foi possivel executar a acao.");
    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    if (result.response?.message) setMessage(result.response.message);

    try {
      if (refresh) await loadHistory();
    } catch (err) {
      setMessage(String(err || "Nao foi possivel executar a acao."));
    }
  };

  const clearHistory = async () => {
    setIsConfirmingClear(false);
    await runAction(clearCommandForType(activeType), {}, true);
  };

  const refreshAllEntries = async () => {
    setIsRefreshingAll(true);
    setMessage("");
    const result = await invokeAction(
      commandNames.historyRefreshAllEntries,
      {},
      "Nao foi possivel atualizar os paths."
    );
    setIsRefreshingAll(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    await loadHistory();
  };

  const openJobao = (entry) => {
    runAction(commandNames.historyOpenJobaoFolder, { id: entry.id });
  };

  const handleAfterClick = (event, entry) => {
    if (event.shiftKey) {
      runAction(commandNames.historyOpenAfterProject, { id: entry.id }, true);
      return;
    }

    runAction(commandNames.historyRevealAfterProject, { id: entry.id });
  };

  const handleProjectMediaClick = (event, entry, mediaType) => {
    if (event.shiftKey) {
      runAction(commandNames.historyOpenMedia, { id: entry.id, mediaType });
      return;
    }

    runAction(commandNames.historyRevealMedia, { id: entry.id, mediaType });
  };

  const openCopyFolder = (entry) => {
    runAction(commandNames.historyCopyOpenFolder, { id: entry.id });
  };

  const handleCopyMediaClick = (event, entry) => {
    if (event.shiftKey) {
      runAction(commandNames.historyCopyRevealMedia, { id: entry.id });
      return;
    }

    runAction(commandNames.historyCopyOpenMedia, { id: entry.id });
  };

  const refreshEntry = (entry) => {
    runAction(commandNames.historyRefreshEntry, { id: entry.id }, true);
  };

  const toggleDateSort = () => {
    setDateSort((current) => (current === "desc" ? "asc" : "desc"));
  };

  const historyTypeOptions = useMemo(() => [
    {
      value: HISTORY_TYPES.PROJECTS,
      label: `Projetos (${projectEntries.length})`,
    },
    {
      value: HISTORY_TYPES.COPIES,
      label: `Copias MP4 (${copyEntries.length})`,
    },
    {
      value: HISTORY_TYPES.PRODUCT_IMPORTS,
      label: `Produtos (${productImportEntries.length})`,
    },
  ], [copyEntries.length, productImportEntries.length, projectEntries.length]);

  const changeHistoryType = (nextType) => {
    setActiveType(nextType);
    setMessage("");
    setIsConfirmingClear(false);
  };

  const requestClearHistory = () => {
    setIsConfirmingClear(true);
  };

  const cancelClearHistory = () => {
    setIsConfirmingClear(false);
  };

  return (
    <div className="history-window">
      <header className="history-header">
        <div className="history-type-menu">
          <AppDropdown
            className="history-type-select"
            value={activeType}
            onChange={changeHistoryType}
            options={historyTypeOptions}
            ariaLabel="Tipo de historico"
          />
        </div>

        <div className="history-count" aria-live="polite">{countLabel}</div>

        <div className="history-search-bar">
          <input
            className="input history-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={meta.search}
            aria-label="Pesquisar historico"
            autoComplete="off"
            spellCheck={false}
          />
          {hasSearch && (
            <button
              type="button"
              className="history-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Limpar pesquisa"
              title="Limpar pesquisa"
            >
              x
            </button>
          )}
        </div>

        <div className="history-header__actions">
          {isProjectsType && (
            <button
              type="button"
              className="btn btn-outline history-refresh-all-btn"
              onClick={refreshAllEntries}
              disabled={!projectEntries.length || isRefreshingAll}
            >
              {isRefreshingAll ? "Atualizando..." : "Atualizar MP4/MOV"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline history-clear-btn"
            onClick={requestClearHistory}
            disabled={!activeEntries.length || isRefreshingAll}
          >
            Apagar historico
          </button>
          {onClose && (
            <button
              type="button"
              className="modal-icon-btn"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar"
            >
              x
            </button>
          )}
        </div>
      </header>

      <main className="history-content">
        {message && (
          <div className="history-message" role="alert">
            {message}
          </div>
        )}

        {isLoading && <div className="history-empty">Carregando...</div>}

        {!isLoading && activeEntries.length === 0 && (
          <div className="history-empty">{meta.empty}</div>
        )}

        {!isLoading && activeEntries.length > 0 && visibleEntries.length === 0 && (
          <div className="history-empty">Nenhum registro encontrado.</div>
        )}

        {!isLoading && visibleEntries.length > 0 && (
          <div
            className={`history-table ${isCopiesType ? "history-table--copies" : ""} ${activeType === HISTORY_TYPES.PRODUCT_IMPORTS ? "history-table--products" : ""}`}
            role="table"
            aria-label={meta.table}
          >
            <div className="history-row history-row--head" role="row">
              <div role="columnheader">
                <button
                  type="button"
                  className="history-sort-btn"
                  onClick={toggleDateSort}
                  title="Ordenar por data"
                >
                  Data
                  <img
                    className={`history-sort-icon ${dateSort === "desc" ? "history-sort-icon--desc" : ""}`}
                    src={chevronIcon}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div role="columnheader">{meta.column}</div>
              <div role="columnheader">Acoes</div>
            </div>

            {activeType === HISTORY_TYPES.PROJECTS &&
              visibleEntries.map((entry) => (
                <ProjectHistoryRow
                  entry={entry}
                  key={entry.id}
                  onAfterClick={handleAfterClick}
                  onMediaClick={handleProjectMediaClick}
                  onOpenJobao={openJobao}
                  onRefresh={refreshEntry}
                />
              ))}

            {activeType === HISTORY_TYPES.COPIES &&
              visibleEntries.map((entry) => (
                <CopyHistoryRow
                  entry={entry}
                  key={entry.id}
                  onMediaClick={handleCopyMediaClick}
                  onOpenFolder={openCopyFolder}
                />
              ))}

            {activeType === HISTORY_TYPES.PRODUCT_IMPORTS &&
              visibleEntries.map((entry) => (
                <ProductImportHistoryRow entry={entry} key={entry.id} />
              ))}
          </div>
        )}
      </main>

      {isConfirmingClear && (
        <div className="history-confirm-backdrop" role="presentation" onMouseDown={cancelClearHistory}>
          <section
            className="history-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="history-confirm-header">
              <h2 id="history-confirm-title">Apagar historico?</h2>
            </header>

            <p>Essa acao remove os registros salvos nesta lista e nao pode ser desfeita.</p>

            <footer className="history-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={cancelClearHistory}
                disabled={isRefreshingAll}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn history-clear-confirm-btn"
                onClick={clearHistory}
                disabled={!activeEntries.length || isRefreshingAll}
              >
                Confirmar apagar
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function ProjectHistoryRow({ entry, onAfterClick, onMediaClick, onOpenJobao, onRefresh }) {
  return (
    <article className="history-row" role="row">
      <div className="history-date" role="cell">
        {formatDate(entry.openedAt)}
      </div>

      <div className="history-project" role="cell">
        <strong>{projectLabel(entry)}</strong>
      </div>

      <div className="history-actions" role="cell">
        <IconButton
          icon={folderIcon}
          label="Abrir pasta do Jobao"
          onClick={() => onOpenJobao(entry)}
          title={pathTitle("Jobao", entry.jobaoPath)}
          unavailable={!entry.jobaoPath}
        />
        <IconButton
          icon={aeIcon}
          label="Abrir pasta do projeto AE"
          onClick={(event) => onAfterClick(event, entry)}
          title={pathTitle("AE", entry.aeProjectPath, "Shift+clique: abrir no After")}
          unavailable={!entry.aeProjectPath}
        />
        <IconButton
          icon={videoIconMP4}
          label="Abrir MP4"
          onClick={(event) => onMediaClick(event, entry, "mp4")}
          title={pathTitle("MP4", entry.mp4Path, "Shift+clique: abrir video")}
          unavailable={!entry.mp4Path}
        />
        <IconButton
          icon={videoIconMOV}
          label="Abrir MOV"
          onClick={(event) => onMediaClick(event, entry, "mov")}
          title={pathTitle("MOV", entry.movPath, "Shift+clique: abrir video")}
          unavailable={!entry.movPath}
        />
        <IconButton
          icon={refreshIcon}
          label="Atualizar MP4 e MOV"
          onClick={() => onRefresh(entry)}
          title="Atualizar paths MP4/MOV"
          unavailable={!entry.jobaoPath || !entry.aeProjectPath}
        />
      </div>
    </article>
  );
}

function CopyHistoryRow({ entry, onMediaClick, onOpenFolder }) {
  return (
    <article className="history-row" role="row">
      <div className="history-date" role="cell">
        {formatDate(entry.copiedAt)}
      </div>

      <div className="history-project history-copy" role="cell">
        <strong title={entry.targetFileName}>{entry.targetFileName}</strong>
        <span title={entry.sourceFileName}>de {entry.sourceFileName}</span>
      </div>

      <div className="history-actions" role="cell">
        <IconButton
          icon={folderIcon}
          label="Abrir pasta MP4"
          onClick={() => onOpenFolder(entry)}
          title={pathTitle("Pasta MP4", entry.folderPath)}
          unavailable={!entry.folderPath}
        />
        <IconButton
          icon={videoIconMP4}
          label="Abrir copia MP4"
          onClick={(event) => onMediaClick(event, entry)}
          title={pathTitle("MP4", entry.targetPath, "Shift+clique: mostrar no Explorer")}
          unavailable={!entry.targetPath}
        />
      </div>
    </article>
  );
}

function ProductImportHistoryRow({ entry }) {
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const report = parseProductImportReport(entry.reportJson);
  const imported = numberOrZero(entry.totalImported ?? report?.totalImported);
  const existing = numberOrZero(entry.totalExisting ?? report?.totalExisting);
  const notFound = numberOrZero(entry.totalNotFound ?? report?.totalNotFound);
  const total = numberOrZero(entry.totalProcessed ?? report?.totalProcessed);
  const groups = numberOrZero(entry.totalGroups ?? report?.groups?.length);
  const duration = formatDuration(entry.durationMillis ?? report?.durationMillis);
  const sourcePath = entry.sourcePath || report?.sourcePath || "";
  const productPath = entry.productPath || report?.productPath || "";

  return (
    <article className="history-row history-row--product-import" role="row">
      <div className="history-date" role="cell">
        {formatDate(entry.importedAt)}
      </div>

      <div className="history-project history-product-import" role="cell">
        <div className="history-product-topline">
          <strong>Jobao {entry.jobaoCod || report?.jobaoCod}</strong>
          <div className="history-product-summary">
            <span>{total} processados</span>
            <span>{imported} copiados</span>
            <span>{existing} existentes</span>
            <span>{notFound} nao encontrados</span>
            <span>{groups} grupos</span>
            <span>{duration}</span>
          </div>
        </div>
        <div className="history-product-paths">
          <span title={sourcePath}>Origem: {sourcePath || "Path indisponivel"}</span>
          <span title={productPath}>Destino: {productPath || "Path indisponivel"}</span>
        </div>
        {isSnapshotOpen && <ProductImportSnapshot report={report} />}
      </div>

      <div className="history-actions history-actions--muted" role="cell">
        <button
          type="button"
          className={`history-snapshot-toggle ${isSnapshotOpen ? "history-snapshot-toggle--active" : ""}`}
          onClick={() => setIsSnapshotOpen((current) => !current)}
          aria-expanded={isSnapshotOpen}
        >
          Snapshot
        </button>
      </div>
    </article>
  );
}

function ProductImportSnapshot({ report }) {
  if (!report) {
    return (
      <div className="history-product-snapshot">
        <div className="history-product-snapshot-empty">Snapshot indisponivel.</div>
      </div>
    );
  }

  const imported = [
    ...report.importedFiles,
    ...report.groups.flatMap((group) => group.importedFiles),
  ];
  const existing = [
    ...report.existingFiles,
    ...report.groups.flatMap((group) => group.existingFiles),
  ];
  const notFound = [
    ...report.notFoundFiles,
    ...report.groups.flatMap((group) => group.notFoundFiles),
  ];

  return (
    <div className="history-product-snapshot">
      <div className="history-product-snapshot-body">
        <SnapshotList title="Copiados" items={imported} mark="ok" />
        <SnapshotList title="Ja existiam" items={existing} mark="skip" />
        <SnapshotList title="Nao encontrados" items={notFound} mark="fail" />
        {report.groups.length > 0 && (
          <div className="history-product-snapshot-grouped">
            <h3>Grupos</h3>
            {report.groups.map((group) => (
              <div className="history-product-snapshot-group" key={group.folderName}>
                <strong>{group.folderName}</strong>
                <SnapshotList
                  items={[
                    ...group.importedFiles.map((file) => ({ file, mark: "ok" })),
                    ...group.existingFiles.map((file) => ({ file, mark: "skip" })),
                    ...group.notFoundFiles.map((file) => ({ file, mark: "fail" })),
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotList({ title, items, mark }) {
  if (!items.length) return null;

  return (
    <div className="history-product-snapshot-list">
      {title && <h3>{title}</h3>}
      <div className="history-product-snapshot-lines">
        {items.map((item, index) => {
          const line = typeof item === "string" ? { file: item, mark } : item;
          return (
            <span className="history-product-snapshot-line" key={`${line.file}-${index}`}>
              <span className={`history-product-snapshot-mark history-product-snapshot-mark--${line.mark}`}>
                {line.mark === "ok" ? "+" : line.mark === "fail" ? "x" : "-"}
              </span>
              <span>{line.file}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function IconButton({ icon, label, onClick, title, unavailable }) {
  const handleClick = (event) => {
    if (unavailable) return;
    onClick(event);
  };

  return (
    <button
      type="button"
      className={`history-action-btn ${unavailable ? "history-action-btn--unavailable" : ""}`}
      onClick={handleClick}
      title={title || label}
      aria-label={label}
      aria-disabled={unavailable || undefined}
    >
      <img src={icon} alt="" aria-hidden="true" />
    </button>
  );
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(durationMillis) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMillis || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function pathTitle(label, value, hint) {
  const path = value || "Path nao disponivel";
  return hint ? `${label}: ${path}\n${hint}` : `${label}: ${path}`;
}

function projectLabel(entry) {
  const base = `${entry.jobaoCod} - ${entry.jobinhoCod}`;
  return entry.region ? `${base} - ${entry.region}` : base;
}

function activeEntriesForType(type, entries) {
  if (type === HISTORY_TYPES.COPIES) return entries.copies;
  if (type === HISTORY_TYPES.PRODUCT_IMPORTS) return entries.productImports;
  return entries.projects;
}

function clearCommandForType(type) {
  if (type === HISTORY_TYPES.COPIES) return commandNames.historyCopyClear;
  if (type === HISTORY_TYPES.PRODUCT_IMPORTS) return commandNames.historyProductImportClear;
  return commandNames.historyClear;
}

function sortEntries(entries, direction, epochKey) {
  return [...entries].sort((a, b) => {
    const first = Number(a[epochKey] || 0);
    const second = Number(b[epochKey] || 0);
    const diff = first - second || Number(a.id || 0) - Number(b.id || 0);
    return direction === "desc" ? -diff : diff;
  });
}

function filterEntries(type, entries, query) {
  if (type === HISTORY_TYPES.COPIES) return filterCopyEntries(entries, query);
  if (type === HISTORY_TYPES.PRODUCT_IMPORTS) return filterProductImportEntries(entries, query);
  return filterProjectEntries(entries, query);
}

function filterProjectEntries(entries, query) {
  const terms = parseSearchTerms(query);
  if (!terms.length) return entries;

  return entries.filter((entry) => {
    const searchableText = normalizeSearchText(
      [
        entry.jobaoCod,
        entry.jobinhoCod,
        entry.region,
        projectLabel(entry),
        formatDate(entry.openedAt),
      ].filter(Boolean).join(" ")
    );

    return terms.every((term) => searchableText.includes(term));
  });
}

function filterCopyEntries(entries, query) {
  const terms = parseSearchTerms(query);
  if (!terms.length) return entries;

  return entries.filter((entry) => {
    const searchableText = normalizeSearchText(
      [
        entry.jobaoCod,
        entry.sourceFileName,
        entry.targetFileName,
        entry.folderPath,
        formatDate(entry.copiedAt),
      ].filter(Boolean).join(" ")
    );

    return terms.every((term) => searchableText.includes(term));
  });
}

function filterProductImportEntries(entries, query) {
  const terms = parseSearchTerms(query);
  if (!terms.length) return entries;

  return entries.filter((entry) => {
    const searchableText = normalizeSearchText(
      [
        entry.jobaoCod,
        entry.productPath,
        entry.sourcePath,
        entry.reportJson,
        formatDate(entry.importedAt),
      ].filter(Boolean).join(" ")
    );

    return terms.every((term) => searchableText.includes(term));
  });
}

function parseProductImportReport(value) {
  if (!value) return null;

  try {
    return normalizeProductReport(JSON.parse(value));
  } catch (error) {
    return null;
  }
}

function normalizeProductReport(value) {
  if (!value || typeof value !== "object") return null;

  const groups = toArray(value.groups).map((group) => ({
    folderName: String(group?.folderName || group?.folder_name || "").trim(),
    importedFiles: toArray(group?.importedFiles || group?.imported_files).map(String),
    existingFiles: toArray(group?.existingFiles || group?.existing_files).map(String),
    notFoundFiles: toArray(group?.notFoundFiles || group?.not_found_files).map(String),
  }));

  return {
    jobaoCod: String(value.jobaoCod || value.jobao_cod || "").trim(),
    productPath: String(value.productPath || value.product_path || "").trim(),
    sourcePath: String(value.sourcePath || value.source_path || "").trim(),
    importedFiles: toArray(value.importedFiles || value.imported_files).map(String),
    existingFiles: toArray(value.existingFiles || value.existing_files).map(String),
    notFoundFiles: toArray(value.notFoundFiles || value.not_found_files).map(String),
    groups,
    totalProcessed: numberOrZero(value.totalProcessed ?? value.total_processed),
    totalImported: numberOrZero(value.totalImported ?? value.total_imported),
    totalExisting: numberOrZero(value.totalExisting ?? value.total_existing),
    totalNotFound: numberOrZero(value.totalNotFound ?? value.total_not_found),
    durationMillis: numberOrZero(value.durationMillis ?? value.duration_millis),
  };
}

function parseSearchTerms(value) {
  return normalizeSearchText(value)
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export default HistoryWindow;
