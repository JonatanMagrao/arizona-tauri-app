import { useEffect, useState } from "react";
import { commandNames, invokeAction, invokeCommand } from "./lib/tauriCommands";
import folderIcon from "./assets/icones/folder.svg";
import aeIcon from "./assets/icones/aeft_icon.svg";
import refreshIcon from "./assets/icones/history.svg";
import videoIconMP4 from "./assets/icones/video_mp4.svg";
import videoIconMOV from "./assets/icones/video_mov.svg";

function HistoryWindow({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerms, setSearchTerms] = useState([]);

  const visibleEntries = filterEntries(entries, searchTerms);
  const countLabel = searchTerms.length
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

    try {
      if (refresh) await loadHistory();
    } catch (err) {
      setMessage(String(err || "Não foi possível executar a ação."));
    }
  };

  const clearHistory = async () => {
    const confirmed = window.confirm("Apagar todo o histórico?");
    if (!confirmed) return;
    await runAction(commandNames.historyClear, {}, true);
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

  const applySearch = (event) => {
    event.preventDefault();
    const terms = parseSearchTerms(searchDraft);
    setSearchTerms(terms);
    setSearchDraft(terms.join(", "));
    setSearchOpen(false);
  };

  const clearSearch = () => {
    setSearchDraft("");
    setSearchTerms([]);
    setSearchOpen(false);
  };

  return (
    <div className="history-window">
      <header className="history-header">
        <div>
          <h1>
            Histórico
            <span>{countLabel}</span>
          </h1>
        </div>
        <div className="history-header__actions">
          <button
            type="button"
            className={`btn btn-outline history-search-btn ${searchTerms.length ? "history-search-btn--active" : ""}`}
            onClick={() => setSearchOpen(true)}
          >
            Pesquisar
          </button>
          <button
            type="button"
            className="btn btn-outline history-clear-btn"
            onClick={clearHistory}
            disabled={!entries.length}
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

      {message && (
        <div className="history-message" role="alert">
          {message}
        </div>
      )}

      <main className="history-content">
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
              <div role="columnheader">Data</div>
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

      {searchOpen && (
        <div className="history-search-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <form
            className="history-search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-search-title"
            onSubmit={applySearch}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="history-search-modal__header">
              <h2 id="history-search-title">Pesquisar</h2>
              <button
                type="button"
                className="modal-icon-btn"
                onClick={() => setSearchOpen(false)}
                aria-label="Fechar pesquisa"
                title="Fechar"
              >
                ×
              </button>
            </header>

            <label className="history-search-field">
              <span>Jobão, Jobinho</span>
              <input
                className="input"
                type="text"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="1207 ou 21091 ou 1207, 21091"
                autoFocus
              />
            </label>

            <footer className="history-search-actions">
              <button type="button" className="btn btn-outline" onClick={clearSearch}>
                Limpar busca
              </button>
              <button type="submit" className="btn btn-primary">
                Pesquisar
              </button>
            </footer>
          </form>
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

function parseSearchTerms(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function filterEntries(entries, terms) {
  if (!terms.length) return entries;
  if (terms.length === 1) {
    const [term] = terms;
    return entries.filter(
      (entry) => normalizeCode(entry.jobaoCod) === term || normalizeCode(entry.jobinhoCod) === term
    );
  }

  const [jobao, jobinho] = terms;
  return entries.filter(
    (entry) => normalizeCode(entry.jobaoCod) === jobao && normalizeCode(entry.jobinhoCod) === jobinho
  );
}

function normalizeCode(value) {
  return String(value ?? "").trim();
}

export default HistoryWindow;
