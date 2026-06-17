import { useEffect, useMemo, useState } from "react";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import folderIcon from "./assets/icones/folder.svg";
import aeIcon from "./assets/icones/aeft_icon.svg";
import refreshIcon from "./assets/icones/history.svg";
import videoIconMP4 from "./assets/icones/video_mp4.svg";
import videoIconMOV from "./assets/icones/video_mov.svg";
import chevronIcon from "./assets/icones/chevron.svg";

function HistoryWindow({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateSort, setDateSort] = useState("desc");

  const visibleEntries = useMemo(
    () => sortEntries(filterEntries(entries, searchQuery), dateSort),
    [entries, searchQuery, dateSort]
  );
  const hasSearch = Boolean(searchQuery.trim());
  const countLabel = hasSearch
    ? `${visibleEntries.length} de ${entries.length} registros`
    : `${entries.length} registros`;

  const loadHistory = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const rows = await invokeCommand(commandNames.historyList);
      setEntries(Array.isArray(rows) ? rows : []);
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
    await runAction(commandNames.historyClear, {}, true);
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

  const handleMediaClick = (event, entry, mediaType) => {
    if (event.shiftKey) {
      runAction(commandNames.historyOpenMedia, { id: entry.id, mediaType });
      return;
    }

    runAction(commandNames.historyRevealMedia, { id: entry.id, mediaType });
  };

  const refreshEntry = (entry) => {
    runAction(commandNames.historyRefreshEntry, { id: entry.id }, true);
  };

  const toggleDateSort = () => {
    setDateSort((current) => (current === "desc" ? "asc" : "desc"));
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
        <div className="history-count" aria-live="polite">{countLabel}</div>

        <div className="history-search-bar">
          <input
            className="input history-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Pesquisar por jobão, jobinho ou região"
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
          <button
            type="button"
            className="btn btn-outline history-refresh-all-btn"
            onClick={refreshAllEntries}
            disabled={!entries.length || isRefreshingAll}
          >
            {isRefreshingAll ? "Atualizando..." : "Atualizar MP4/MOV"}
          </button>
          <button
            type="button"
            className="btn btn-outline history-clear-btn"
            onClick={requestClearHistory}
            disabled={!entries.length || isRefreshingAll}
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

        {!isLoading && entries.length === 0 && (
          <div className="history-empty">Nenhum projeto aberto ainda.</div>
        )}

        {!isLoading && entries.length > 0 && visibleEntries.length === 0 && (
          <div className="history-empty">Nenhum registro encontrado.</div>
        )}

        {!isLoading && visibleEntries.length > 0 && (
          <div className="history-table" role="table" aria-label="Histórico de projetos">
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
              <div role="columnheader">Projeto</div>
              <div role="columnheader">Ações</div>
            </div>

            {visibleEntries.map((entry) => (
              <article className="history-row" role="row" key={entry.id}>
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
                    onClick={() => openJobao(entry)}
                    title={pathTitle("Jobão", entry.jobaoPath)}
                    unavailable={!entry.jobaoPath}
                  />
                  <IconButton
                    icon={aeIcon}
                    label="Abrir pasta do projeto AE"
                    onClick={(event) => handleAfterClick(event, entry)}
                    title={pathTitle("AE", entry.aeProjectPath, "Shift+clique: abrir no After")}
                    unavailable={!entry.aeProjectPath}
                  />
                  <IconButton
                    icon={videoIconMP4}
                    label="Abrir MP4"
                    onClick={(event) => handleMediaClick(event, entry, "mp4")}
                    title={pathTitle("MP4", entry.mp4Path, "Shift+clique: abrir vídeo")}
                    unavailable={!entry.mp4Path}
                  />
                  <IconButton
                    icon={videoIconMOV}
                    label="Abrir MOV"
                    onClick={(event) => handleMediaClick(event, entry, "mov")}
                    title={pathTitle("MOV", entry.movPath, "Shift+clique: abrir vídeo")}
                    unavailable={!entry.movPath}
                  />
                  <IconButton
                    icon={refreshIcon}
                    label="Atualizar MP4 e MOV"
                    onClick={() => refreshEntry(entry)}
                    title="Atualizar paths MP4/MOV"
                    unavailable={!entry.jobaoPath || !entry.aeProjectPath}
                  />
                </div>
              </article>
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

            <p>Essa ação remove todos os registros salvos do histórico e não pode ser desfeita.</p>

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
                disabled={!entries.length || isRefreshingAll}
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

function sortEntries(entries, direction) {
  return [...entries].sort((a, b) => {
    const first = Number(a.openedAtEpoch || 0);
    const second = Number(b.openedAtEpoch || 0);
    const diff = first - second || Number(a.id || 0) - Number(b.id || 0);
    return direction === "desc" ? -diff : diff;
  });
}

function filterEntries(entries, query) {
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
