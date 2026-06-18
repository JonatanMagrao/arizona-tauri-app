import { useEffect, useMemo, useState } from "react";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import folderIcon from "./assets/icones/folder.svg";
import aeIcon from "./assets/icones/aeft_icon.svg";
import refreshIcon from "./assets/icones/history.svg";
import videoIconMP4 from "./assets/icones/video_mp4.svg";
import videoIconMOV from "./assets/icones/video_mov.svg";
import chevronIcon from "./assets/icones/chevron.svg";

const HISTORY_TABS = Object.freeze({
  PROJECTS: "projects",
  COPIES: "copies",
});

function HistoryWindow({ onClose }) {
  const [projectEntries, setProjectEntries] = useState([]);
  const [copyEntries, setCopyEntries] = useState([]);
  const [activeTab, setActiveTab] = useState(HISTORY_TABS.PROJECTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateSort, setDateSort] = useState("desc");

  const isProjectsTab = activeTab === HISTORY_TABS.PROJECTS;
  const activeEntries = isProjectsTab ? projectEntries : copyEntries;
  const visibleEntries = useMemo(() => {
    const filtered = isProjectsTab
      ? filterProjectEntries(projectEntries, searchQuery)
      : filterCopyEntries(copyEntries, searchQuery);
    return sortEntries(filtered, dateSort, isProjectsTab ? "openedAtEpoch" : "copiedAtEpoch");
  }, [projectEntries, copyEntries, searchQuery, dateSort, isProjectsTab]);
  const hasSearch = Boolean(searchQuery.trim());
  const countLabel = hasSearch
    ? `${visibleEntries.length} de ${activeEntries.length} registros`
    : `${activeEntries.length} registros`;
  const emptyLabel = isProjectsTab
    ? "Nenhum projeto aberto ainda."
    : "Nenhuma cópia registrada ainda.";
  const tableLabel = isProjectsTab
    ? "Histórico de projetos"
    : "Histórico de cópias";
  const searchPlaceholder = isProjectsTab
    ? "Pesquisar por jobão, jobinho ou região"
    : "Pesquisar por jobão, matriz ou cópia";

  const loadHistory = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const [projects, copies] = await Promise.all([
        invokeCommand(commandNames.historyList),
        invokeCommand(commandNames.historyCopyList),
      ]);
      setProjectEntries(Array.isArray(projects) ? projects : []);
      setCopyEntries(Array.isArray(copies) ? copies : []);
    } catch (err) {
      setMessage(String(err || "Não foi possível carregar o histórico."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
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
    await runAction(
      isProjectsTab ? commandNames.historyClear : commandNames.historyCopyClear,
      {},
      true
    );
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

  const changeTab = (tab) => {
    setActiveTab(tab);
    setMessage("");
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
        <div className="history-tabs" role="tablist" aria-label="Tipo de histórico">
          <TabButton
            active={activeTab === HISTORY_TABS.PROJECTS}
            count={projectEntries.length}
            id={HISTORY_TABS.PROJECTS}
            label="Projetos"
            onClick={changeTab}
          />
          <TabButton
            active={activeTab === HISTORY_TABS.COPIES}
            count={copyEntries.length}
            id={HISTORY_TABS.COPIES}
            label="Cópias"
            onClick={changeTab}
          />
        </div>

        <div className="history-count" aria-live="polite">{countLabel}</div>

        <div className="history-search-bar">
          <input
            className="input history-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={searchPlaceholder}
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
          {isProjectsTab && (
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
            Apagar histórico
          </button>
          {onClose && (
            <button
              type="button"
              className="modal-icon-btn"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar"
            >
              ×
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
          <div className="history-empty">{emptyLabel}</div>
        )}

        {!isLoading && activeEntries.length > 0 && visibleEntries.length === 0 && (
          <div className="history-empty">Nenhum registro encontrado.</div>
        )}

        {!isLoading && visibleEntries.length > 0 && (
          <div
            className={`history-table ${isProjectsTab ? "" : "history-table--copies"}`}
            role="table"
            aria-label={tableLabel}
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
              <div role="columnheader">{isProjectsTab ? "Projeto" : "Cópia"}</div>
              <div role="columnheader">Ações</div>
            </div>

            {isProjectsTab
              ? visibleEntries.map((entry) => (
                  <ProjectHistoryRow
                    entry={entry}
                    key={entry.id}
                    onAfterClick={handleAfterClick}
                    onMediaClick={handleProjectMediaClick}
                    onOpenJobao={openJobao}
                    onRefresh={refreshEntry}
                  />
                ))
              : visibleEntries.map((entry) => (
                  <CopyHistoryRow
                    entry={entry}
                    key={entry.id}
                    onMediaClick={handleCopyMediaClick}
                    onOpenFolder={openCopyFolder}
                  />
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
              <h2 id="history-confirm-title">Apagar histórico?</h2>
            </header>

            <p>Essa ação remove os registros salvos nesta aba e não pode ser desfeita.</p>

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

function TabButton({ active, count, id, label, onClick }) {
  return (
    <button
      type="button"
      className={`history-tab ${active ? "history-tab--active" : ""}`}
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
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

function sortEntries(entries, direction, epochKey) {
  return [...entries].sort((a, b) => {
    const first = Number(a[epochKey] || 0);
    const second = Number(b[epochKey] || 0);
    const diff = first - second || Number(a.id || 0) - Number(b.id || 0);
    return direction === "desc" ? -diff : diff;
  });
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
