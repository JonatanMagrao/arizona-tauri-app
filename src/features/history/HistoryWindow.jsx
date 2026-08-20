import { useEffect, useMemo, useRef, useState } from "react";
import AppDropdown from "../../components/AppDropdown";
import { commandNames, invokeAction, invokeCommand } from "../../services/tauriCommands";
import { formatDuration } from "../../utils/formatters";
import { numberOrZero, parseProductImportReport } from "../../utils/productReport";
import {
  formatRenderDuration,
  renderQueueWaitMillis,
  renderTimingLabel,
  timestampMillis,
} from "../renderQueue/renderTiming";
import {
  compareHistoryIds,
  mergeRenderHistoryEntries,
  readRenderHistoryPage,
  reconcilePolledRenderHistory,
  renderDirectionForDevice,
} from "../renderQueue/renderHistoryData";
import folderIcon from "../../assets/icones/folder.svg";
import aeIcon from "../../assets/icones/aeft_icon.svg";
import refreshIcon from "../../assets/icones/history.svg";
import videoIconMP4 from "../../assets/icones/video_mp4.svg";
import videoIconMOV from "../../assets/icones/video_mov.svg";
import chevronIcon from "../../assets/icones/chevron.svg";

const HISTORY_TYPES = Object.freeze({
  PROJECTS: "projects",
  COPIES: "copies",
  PRODUCT_IMPORTS: "productImports",
  RENDERS: "renders",
});

const AE_OPEN_COOLDOWN_MS = 8000;
const RENDER_HISTORY_PAGE_SIZE = 50;
const TERMINAL_RENDER_STATES = new Set(["completed", "failed", "cancelled"]);

const HISTORY_META = Object.freeze({
  [HISTORY_TYPES.PROJECTS]: {
    label: "Projetos",
    empty: "Nenhum projeto aberto ainda.",
    table: "Histórico de projetos",
    search: "Pesquisar por jobão, jobinho ou região",
    column: "Projeto",
    epochKey: "openedAtEpoch",
  },
  [HISTORY_TYPES.COPIES]: {
    label: "Cópias MP4",
    empty: "Nenhuma cópia registrada ainda.",
    table: "Histórico de cópias",
    search: "Pesquisar por jobão, matriz ou cópia",
    column: "Cópia",
    epochKey: "copiedAtEpoch",
  },
  [HISTORY_TYPES.PRODUCT_IMPORTS]: {
    label: "Produtos",
    empty: "Nenhuma importação de produtos registrada ainda.",
    table: "Histórico de importações de produtos",
    search: "Pesquisar por jobão, arquivo ou pasta",
    column: "Importação",
    epochKey: "importedAtEpoch",
  },
  [HISTORY_TYPES.RENDERS]: {
    label: "Renders",
    empty: "Nenhum render distribuído registrado ainda.",
    table: "Histórico de renders distribuídos",
    search: "Pesquisar por projeto, jobão, jobinho, pessoa ou máquina",
    column: "Render",
    detailColumn: "Tempos",
    epochKey: "createdAtEpoch",
  },
});

function HistoryWindow({ onClose }) {
  const [projectEntries, setProjectEntries] = useState([]);
  const [copyEntries, setCopyEntries] = useState([]);
  const [productImportEntries, setProductImportEntries] = useState([]);
  const [renderEntries, setRenderEntries] = useState([]);
  const [renderHistoryTotal, setRenderHistoryTotal] = useState(0);
  const [renderHistoryCursor, setRenderHistoryCursor] = useState(null);
  const [renderHistoryHasMore, setRenderHistoryHasMore] = useState(false);
  const [renderHistoryError, setRenderHistoryError] = useState("");
  const [activeType, setActiveType] = useState(HISTORY_TYPES.PROJECTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isRefreshingRenders, setIsRefreshingRenders] = useState(false);
  const [isLoadingMoreRenders, setIsLoadingMoreRenders] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateSort, setDateSort] = useState("desc");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const aeOpenCooldownTimerRef = useRef(null);
  const isOpeningAERef = useRef(false);
  const renderHistoryInFlightRef = useRef(false);
  const renderEntriesRef = useRef([]);
  const renderHistoryCursorRef = useRef(null);

  const isProjectsType = activeType === HISTORY_TYPES.PROJECTS;
  const isCopiesType = activeType === HISTORY_TYPES.COPIES;
  const isRendersType = activeType === HISTORY_TYPES.RENDERS;
  const hasActiveRenderEntries = renderEntries.some(
    (entry) => !TERMINAL_RENDER_STATES.has(entry.status)
  );
  const meta = HISTORY_META[activeType] || HISTORY_META[HISTORY_TYPES.PROJECTS];
  const activeEntries = activeEntriesForType(activeType, {
    projects: projectEntries,
    copies: copyEntries,
    productImports: productImportEntries,
    renders: renderEntries,
  });
  const visibleEntries = useMemo(() => {
    const filtered = filterEntries(activeType, activeEntries, searchQuery);
    return sortEntries(filtered, dateSort, meta.epochKey);
  }, [activeEntries, activeType, searchQuery, dateSort, meta.epochKey]);
  const hasSearch = Boolean(searchQuery.trim());
  const countLabel = isRendersType
    ? hasSearch
      ? `${visibleEntries.length} de ${renderEntries.length} carregados`
      : renderEntries.length < renderHistoryTotal
        ? `${renderEntries.length} de ${renderHistoryTotal} registros`
        : `${renderHistoryTotal} registros`
    : hasSearch
      ? `${visibleEntries.length} de ${activeEntries.length} registros`
      : `${activeEntries.length} registros`;

  const loadHistory = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const [projectsResult, copiesResult, productImportsResult, renderResult] = await Promise.allSettled([
        invokeCommand(commandNames.historyList),
        invokeCommand(commandNames.historyCopyList),
        invokeCommand(commandNames.historyProductImportList),
        invokeCommand(commandNames.renderQueueHistory, { limit: RENDER_HISTORY_PAGE_SIZE }),
      ]);

      if (projectsResult.status === "fulfilled") {
        setProjectEntries(Array.isArray(projectsResult.value) ? projectsResult.value : []);
      }
      if (copiesResult.status === "fulfilled") {
        setCopyEntries(Array.isArray(copiesResult.value) ? copiesResult.value : []);
      }
      if (productImportsResult.status === "fulfilled") {
        setProductImportEntries(
          Array.isArray(productImportsResult.value) ? productImportsResult.value : []
        );
      }
      const localHistoryFailed = [projectsResult, copiesResult, productImportsResult]
        .some((result) => result.status === "rejected");
      if (localHistoryFailed) {
        setMessage("Não foi possível carregar parte do histórico local agora.");
      }

      if (renderResult.status === "fulfilled") {
        const renderPage = normalizeRenderHistory(renderResult.value);
        renderEntriesRef.current = renderPage.entries;
        setRenderEntries(renderPage.entries);
        setRenderHistoryTotal(renderPage.total);
        renderHistoryCursorRef.current = renderPage.nextCursor;
        setRenderHistoryCursor(renderPage.nextCursor);
        setRenderHistoryHasMore(renderPage.hasMore);
        setRenderHistoryError("");
      } else {
        setRenderHistoryError("Não foi possível carregar os renders agora.");
      }
    } catch (err) {
      setMessage(String(err || "Não foi possível carregar o histórico."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (!isRendersType || !hasActiveRenderEntries) return undefined;
    setClockNow(Date.now());
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(clockTimer);
  }, [hasActiveRenderEntries, isRendersType]);

  useEffect(() => {
    renderEntriesRef.current = renderEntries;
  }, [renderEntries]);

  useEffect(() => {
    renderHistoryCursorRef.current = renderHistoryCursor;
  }, [renderHistoryCursor]);

  useEffect(() => {
    if (!isRendersType || !hasActiveRenderEntries) return undefined;
    let disposed = false;
    const refreshTimer = window.setInterval(async () => {
      if (renderHistoryInFlightRef.current) return;
      renderHistoryInFlightRef.current = true;
      try {
        const response = await invokeCommand(commandNames.renderQueueHistory, {
          limit: RENDER_HISTORY_PAGE_SIZE,
        });
        const page = normalizeRenderHistory(response);
        if (disposed) return;
        const reconciled = reconcilePolledRenderHistory({
          currentEntries: renderEntriesRef.current,
          currentCursor: renderHistoryCursorRef.current,
          incomingEntries: page.entries,
          incomingCursor: page.nextCursor,
          total: page.total,
        });
        renderEntriesRef.current = reconciled.entries;
        renderHistoryCursorRef.current = reconciled.cursor;
        setRenderEntries(reconciled.entries);
        setRenderHistoryCursor(reconciled.cursor);
        setRenderHistoryHasMore(reconciled.hasMore);
        setRenderHistoryTotal(page.total);
        setRenderHistoryError("");
      } catch {
        if (!disposed) setRenderHistoryError("Não foi possível atualizar os renders agora.");
      } finally {
        renderHistoryInFlightRef.current = false;
      }
    }, 30000);
    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
    };
  }, [hasActiveRenderEntries, isRendersType]);

  const loadMoreRenders = async () => {
    if (!renderHistoryCursor || renderHistoryInFlightRef.current) return;
    renderHistoryInFlightRef.current = true;
    setIsLoadingMoreRenders(true);
    setRenderHistoryError("");
    try {
      const response = await invokeCommand(commandNames.renderQueueHistory, {
        limit: RENDER_HISTORY_PAGE_SIZE,
        beforeCreatedAt: renderHistoryCursor.beforeCreatedAt,
        beforeId: renderHistoryCursor.beforeId,
      });
      const page = normalizeRenderHistory(response);
      const merged = mergeRenderHistoryEntries(renderEntriesRef.current, page.entries);
      renderEntriesRef.current = merged;
      setRenderEntries(merged);
      setRenderHistoryTotal(page.total);
      renderHistoryCursorRef.current = page.nextCursor;
      setRenderHistoryCursor(page.nextCursor);
      setRenderHistoryHasMore(page.hasMore && Boolean(page.nextCursor));
    } catch {
      setRenderHistoryError("Não foi possível carregar mais renders agora.");
    } finally {
      renderHistoryInFlightRef.current = false;
      setIsLoadingMoreRenders(false);
    }
  };

  const refreshRenderHistory = async () => {
    if (renderHistoryInFlightRef.current) return;
    renderHistoryInFlightRef.current = true;
    setIsRefreshingRenders(true);
    setRenderHistoryError("");
    try {
      const response = await invokeCommand(commandNames.renderQueueHistory, {
        limit: RENDER_HISTORY_PAGE_SIZE,
      });
      const page = normalizeRenderHistory(response);
      renderEntriesRef.current = page.entries;
      setRenderEntries(page.entries);
      setRenderHistoryTotal(page.total);
      renderHistoryCursorRef.current = page.nextCursor;
      setRenderHistoryCursor(page.nextCursor);
      setRenderHistoryHasMore(page.hasMore);
    } catch {
      setRenderHistoryError("Não foi possível atualizar os renders agora.");
    } finally {
      renderHistoryInFlightRef.current = false;
      setIsRefreshingRenders(false);
    }
  };

  useEffect(() => {
    return () => {
      if (aeOpenCooldownTimerRef.current) {
        clearTimeout(aeOpenCooldownTimerRef.current);
      }
    };
  }, []);

  const runAction = async (fnName, args, refresh = false) => {
    setMessage("");
    const result = await invokeAction(fnName, args, "Não foi possível executar a ação.");
    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    if (result.response?.message) setMessage(result.response.message);

    try {
      if (refresh) await loadHistory();
    } catch (err) {
      setMessage(String(err || "Não foi possível executar a ação."));
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
      "Não foi possível atualizar os paths."
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

  const openAfterProject = async (entry) => {
    if (isOpeningAERef.current) return;

    isOpeningAERef.current = true;

    if (aeOpenCooldownTimerRef.current) {
      clearTimeout(aeOpenCooldownTimerRef.current);
      aeOpenCooldownTimerRef.current = null;
    }

    try {
      await runAction(commandNames.historyOpenAfterProject, { id: entry.id }, true);
    } finally {
      aeOpenCooldownTimerRef.current = setTimeout(() => {
        isOpeningAERef.current = false;
        aeOpenCooldownTimerRef.current = null;
      }, AE_OPEN_COOLDOWN_MS);
    }
  };

  const handleAfterClick = (event, entry) => {
    if (event.shiftKey) {
      void openAfterProject(entry);
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
      label: `Cópias MP4 (${copyEntries.length})`,
    },
    {
      value: HISTORY_TYPES.PRODUCT_IMPORTS,
      label: `Produtos (${productImportEntries.length})`,
    },
    {
      value: HISTORY_TYPES.RENDERS,
      label: `Renders (${renderHistoryTotal})`,
    },
  ], [copyEntries.length, productImportEntries.length, projectEntries.length, renderHistoryTotal]);

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
            ariaLabel="Tipo de histórico"
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
            aria-label="Pesquisar histórico"
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
          {isRendersType && (
            <button
              type="button"
              className="btn btn-outline history-refresh-all-btn"
              onClick={refreshRenderHistory}
              disabled={isLoading || isRefreshingRenders || isLoadingMoreRenders}
            >
              {isLoading || isRefreshingRenders ? "Atualizando..." : "Atualizar"}
            </button>
          )}
          {!isRendersType && (
            <button
              type="button"
              className="btn btn-outline history-clear-btn"
              onClick={requestClearHistory}
              disabled={!activeEntries.length || isRefreshingAll}
            >
              Apagar histórico
            </button>
          )}
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
        {(message || (isRendersType ? renderHistoryError : "")) && (
          <div className="history-message" role="alert">
            {message || renderHistoryError}
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
            className={`history-table ${isCopiesType ? "history-table--copies" : ""} ${activeType === HISTORY_TYPES.PRODUCT_IMPORTS ? "history-table--products" : ""} ${isRendersType ? "history-table--renders" : ""}`}
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
              <div role="columnheader">{meta.detailColumn || "Ações"}</div>
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

            {activeType === HISTORY_TYPES.RENDERS &&
              visibleEntries.map((entry) => (
                <RenderHistoryRow entry={entry} key={entry.id} nowMillis={clockNow} />
              ))}
          </div>
        )}

        {!isLoading && isRendersType && renderHistoryHasMore && (
          <div className="history-render-pagination">
            <span>{renderEntries.length} de {renderHistoryTotal} registros carregados</span>
            <button
              type="button"
              className="btn btn-outline"
              onClick={loadMoreRenders}
              disabled={isLoadingMoreRenders || !renderHistoryCursor}
            >
              {isLoadingMoreRenders ? "Carregando..." : "Carregar mais"}
            </button>
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
              <h2 id="history-confirm-title">Apagar histórico?</h2>
            </header>

            <p>Essa ação remove os registros salvos nesta lista e não pode ser desfeita.</p>

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
          label="Abrir pasta do Jobão"
          onClick={() => onOpenJobao(entry)}
          title={pathTitle("Jobão", entry.jobaoPath)}
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
          title={pathTitle("MP4", entry.mp4Path, "Shift+clique: abrir vídeo")}
          unavailable={!entry.mp4Path}
        />
        <IconButton
          icon={videoIconMOV}
          label="Abrir MOV"
          onClick={(event) => onMediaClick(event, entry, "mov")}
          title={pathTitle("MOV", entry.movPath, "Shift+clique: abrir vídeo")}
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
          label="Abrir cópia MP4"
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
          <strong>Jobão {entry.jobaoCod || report?.jobaoCod}</strong>
          <div className="history-product-summary">
            <span>{total} processados</span>
            <span>{imported} copiados</span>
            <span>{existing} existentes</span>
            <span>{notFound} não encontrados</span>
            <span>{groups} grupos</span>
            <span>{duration}</span>
          </div>
        </div>
        <div className="history-product-paths">
          <span title={sourcePath}>Origem: {sourcePath || "Origem indisponível"}</span>
          <span title={productPath}>Destino: {productPath || "Destino indisponível"}</span>
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
        <div className="history-product-snapshot-empty">Snapshot indisponível.</div>
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
        <SnapshotList title="Já existiam" items={existing} mark="skip" />
        <SnapshotList title="Não encontrados" items={notFound} mark="fail" />
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

function RenderHistoryRow({ entry, nowMillis }) {
  const waitMillis = renderQueueWaitMillis(entry, nowMillis);
  const timingLabel = renderTimingLabel(entry, nowMillis);
  const relationship = renderRelationshipLabel(entry);

  return (
    <article className="history-row history-row--render" role="row">
      <div className="history-date" role="cell">
        {formatDate(entry.createdAt)}
      </div>

      <div className="history-project history-render" role="cell">
        <div className="history-render__topline">
          <strong title={entry.title}>{entry.title}</strong>
          <span className={`history-render__direction history-render__direction--${entry.direction}`}>
            {renderDirectionLabel(entry.direction)}
          </span>
          <span className={`history-render__status history-render__status--${renderStatusTone(entry.status)}`}>
            {renderHistoryStatusLabel(entry.status)}
          </span>
        </div>
        <div className="history-render__metadata">
          <span>{relationship}</span>
          {entry.jobaoCod && <span>Jobão {entry.jobaoCod}</span>}
          {entry.jobinhoCod && <span>Jobinho {entry.jobinhoCod}</span>}
          {entry.region && <span>Região {entry.region}</span>}
          {entry.formats.length > 0 && <span>{entry.formats.join(" + ")}</span>}
          {entry.attemptCount > 1 && <span>{entry.attemptCount} tentativas</span>}
        </div>
      </div>

      <div className="history-render__times" role="cell">
        <strong title={entry.startedAt
          ? "Do início do primeiro aerender até a finalização dos arquivos"
          : "Desde a entrada na fila até o estado atual"}
        >
          {timingLabel || "Tempo indisponível"}
        </strong>
        {entry.startedAt && waitMillis !== null && (
          <span>Espera: {formatRenderDuration(waitMillis)}</span>
        )}
        {entry.startedAt && <span>Início: {formatDate(entry.startedAt)}</span>}
        {entry.finishedAt && <span>Fim: {formatDate(entry.finishedAt)}</span>}
      </div>
    </article>
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

function pathTitle(label, value, hint) {
  const path = value || "Path não disponível";
  return hint ? `${label}: ${path}\n${hint}` : `${label}: ${path}`;
}

function projectLabel(entry) {
  const base = `${entry.jobaoCod} - ${entry.jobinhoCod}`;
  return entry.region ? `${base} - ${entry.region}` : base;
}

function activeEntriesForType(type, entries) {
  if (type === HISTORY_TYPES.COPIES) return entries.copies;
  if (type === HISTORY_TYPES.PRODUCT_IMPORTS) return entries.productImports;
  if (type === HISTORY_TYPES.RENDERS) return entries.renders;
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
    const diff = first - second || compareHistoryIds(a.id, b.id);
    return direction === "desc" ? -diff : diff;
  });
}

function filterEntries(type, entries, query) {
  if (type === HISTORY_TYPES.COPIES) return filterCopyEntries(entries, query);
  if (type === HISTORY_TYPES.PRODUCT_IMPORTS) return filterProductImportEntries(entries, query);
  if (type === HISTORY_TYPES.RENDERS) return filterRenderEntries(entries, query);
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

function filterRenderEntries(entries, query) {
  const terms = parseSearchTerms(query);
  if (!terms.length) return entries;

  return entries.filter((entry) => {
    const searchableText = normalizeSearchText([
      entry.title,
      entry.jobaoCod,
      entry.jobinhoCod,
      entry.region,
      entry.requesterName,
      entry.targetName,
      entry.formats.join(" "),
      renderDirectionLabel(entry.direction),
      renderRelationshipLabel(entry),
      renderHistoryStatusLabel(entry.status),
      formatDate(entry.createdAt),
    ].filter(Boolean).join(" "));

    return terms.every((term) => searchableText.includes(term));
  });
}

function normalizeRenderHistory(rawStatus) {
  const page = readRenderHistoryPage(rawStatus);
  return {
    ...page,
    entries: page.jobs
      .map((job) => normalizeRenderHistoryEntry(
        job,
        renderDirectionForDevice(job, page.localDeviceId, page.localMemberId)
      ))
      .filter((entry) => entry.id),
  };
}

function normalizeRenderHistoryEntry(rawJob, direction) {
  const job = rawJob && typeof rawJob === "object" ? rawJob : {};
  const manifest = firstHistoryObject(job.manifest, job.renderManifest, job.render_manifest);
  const timestamps = firstHistoryObject(job.timestamps, job.times, job.timing);
  const baseStatus = historyText(job.status, job.state, job.outcome, "queued").toLowerCase();
  const stage = historyText(job.stage).toLowerCase();
  const status = ["completed", "failed", "cancelled"].includes(baseStatus)
    ? baseStatus
    : stage && stage !== "ready" ? stage : baseStatus;
  const outputs = firstHistoryArray(job.outputs, manifest.outputs, job.resultOutputs, job.result_outputs);
  const createdAt = historyText(job.createdAt, job.created_at, timestamps.createdAt, timestamps.created_at);

  return {
    id: historyText(job.id, job.jobId, job.job_id),
    title: historyText(job.projectName, job.project_name, job.title, "Projeto sem nome"),
    direction,
    status,
    jobaoCod: historyText(job.jobaoCod, job.jobao_cod, manifest.jobaoCod, manifest.jobao_cod),
    jobinhoCod: historyText(job.jobinhoCod, job.jobinho_cod, manifest.jobinhoCod, manifest.jobinho_cod),
    region: historyText(job.projectRegion, job.project_region, manifest.projectRegion, manifest.project_region),
    requesterName: historyText(
      job.requesterLabel,
      job.requester_label,
      job.requesterMemberLabel,
      job.requester_member_label
    ),
    targetName: historyText(
      job.targetMemberLabel,
      job.target_member_label,
      job.targetLabel,
      job.target_label,
      job.targetDeviceLabel,
      job.target_device_label
    ),
    requesterDeviceId: historyText(job.requesterDeviceId, job.requester_device_id),
    targetDeviceId: historyText(
      job.targetWorkerDeviceId,
      job.target_worker_device_id,
      job.targetDeviceId,
      job.target_device_id
    ),
    formats: [...new Set(outputs.map(renderOutputLabel).filter(Boolean))],
    attemptCount: Math.max(0, Number(job.attemptCount ?? job.attempt_count ?? 0) || 0),
    createdAt,
    createdAtEpoch: timestampMillis(createdAt) || 0,
    startedAt: historyText(job.startedAt, job.started_at, timestamps.startedAt, timestamps.started_at),
    finishedAt: historyText(job.finishedAt, job.finished_at, timestamps.finishedAt, timestamps.finished_at),
    cancelledAt: historyText(job.cancelledAt, job.cancelled_at, timestamps.cancelledAt, timestamps.cancelled_at),
  };
}

function firstHistoryArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function firstHistoryObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function historyText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function renderOutputLabel(output) {
  const value = typeof output === "string"
    ? output
    : historyText(output?.kind, output?.type, output?.format, output?.label);
  if (/mov/i.test(value)) return "MOV";
  if (/mp4/i.test(value)) return "MP4";
  return value ? value.toUpperCase() : "";
}

function renderDirectionLabel(direction) {
  if (direction === "received") return "Executado aqui";
  if (direction === "both") return "Enviado e executado aqui";
  if (direction === "account_sent") return "Enviado em outro computador";
  return "Enviado";
}

function renderRelationshipLabel(entry) {
  if (entry.direction === "received") {
    return entry.requesterName
      ? `Esta máquina renderizou para ${entry.requesterName}`
      : "Esta máquina foi usada para renderizar";
  }
  if (entry.direction === "both") return "Solicitado e renderizado nesta máquina";
  const requesterContext = entry.direction === "account_sent"
    ? "Solicitado pela sua conta"
    : "Solicitado";
  if (!entry.targetName) return `${requesterContext} para outra máquina`;
  return /^máquina\s+(?:de|do|da)\s+/i.test(entry.targetName)
    ? `${requesterContext} para ${entry.targetName}`
    : `${requesterContext} para a máquina de ${entry.targetName}`;
}

function renderHistoryStatusLabel(status) {
  return ({
    waiting_for_worker: "Aguardando máquina",
    waiting_for_sync: "Sincronizando projeto",
    queued: "Na fila",
    claimed: "Preparando",
    preparing: "Preparando",
    rendering: "Renderizando",
    rendering_proxy: "Renderizando MOV",
    rendering_mov: "Renderizando MOV",
    rendering_mp4: "Renderizando MP4",
    publishing: "Finalizando arquivos",
    completed: "Concluído",
    failed: "Falhou",
    cancelled: "Cancelado",
  })[status] || "Atualizando";
}

function renderStatusTone(status) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "muted";
  if (["rendering", "rendering_proxy", "rendering_mov", "rendering_mp4", "publishing"].includes(status)) {
    return "active";
  }
  return "waiting";
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

export default HistoryWindow;
