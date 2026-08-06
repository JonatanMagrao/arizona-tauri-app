import { useMemo, useState } from "react";
import { commandNames, invokeAction } from "../../services/tauriCommands";
import { getRoteiroHighlightRanges } from "./roteiroHighlights";
import "./RoteiroViewer.css";

export default function RoteiroViewer({ document, showError }) {
  const [busyAction, setBusyAction] = useState("");
  const offers = useMemo(
    () => String(document?.content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(1),
    [document?.content]
  );

  const runDocumentAction = async (action, commandName) => {
    if (!document || busyAction) return;
    setBusyAction(action);
    const result = await invokeAction(
      commandName,
      { jobaoCod: document.jobaoCod, jobinhoCod: document.jobinhoCod },
      action === "word" ? "Não foi possível abrir o documento no aplicativo padrão." : "Não foi possível atualizar o roteiro."
    );
    if (!result.ok) showError(result.message);
    setBusyAction("");
  };

  if (!document) {
    return (
      <main className="roteiro-reader roteiro-reader--empty">
        <div className="roteiro-reader__empty-card">
          <strong>Roteiro indisponível</strong>
          <span>Não foi possível carregar o conteúdo deste documento.</span>
        </div>
      </main>
    );
  }

  return (
    <main className="roteiro-reader">
      <header className="roteiro-reader__toolbar">
        <div className="roteiro-reader__identity">
          <span className="roteiro-reader__eyebrow">Leitura de roteiro</span>
          <strong title={document.fileName}>{document.fileName}</strong>
          <span className="roteiro-reader__metadata">
            Jobão {document.jobaoCod} · Jobinho {document.jobinhoCod} · Praça {document.praca}
            {document.modifiedAt ? ` · atualizado ${formatModifiedAt(document.modifiedAt)}` : ""}
          </span>
        </div>

        <div className="roteiro-reader__actions">
          <button
            type="button"
            className="roteiro-reader__button roteiro-reader__button--quiet"
            disabled={Boolean(busyAction)}
            onClick={() => runDocumentAction("refresh", commandNames.viewRoteiro)}
          >
            {busyAction === "refresh" ? "Atualizando…" : "Atualizar"}
          </button>
          <button
            type="button"
            className="roteiro-reader__button roteiro-reader__button--primary"
            disabled={Boolean(busyAction)}
            onClick={() => runDocumentAction("word", commandNames.openRoteiroInWord)}
          >
            {busyAction === "word" ? "Abrindo…" : "Abrir documento"}
          </button>
        </div>
      </header>

      <section className="roteiro-reader__offers" aria-label="Ofertas do roteiro">
        <div className="roteiro-reader__offers-heading">
          <div>
            <span>Ofertas</span>
            <strong>{offers.length}</strong>
          </div>
          <small>Preços, percentuais e mecânicas são destacados apenas para facilitar a leitura; não há validação pelo After Effects.</small>
        </div>

        {offers.length > 0 ? (
          <ol className="roteiro-reader__offer-list">
            {offers.map((text, index) => (
              <li className="roteiro-reader__offer" key={`${index}-${text}`}>
                <span className="roteiro-reader__offer-number">{String(index + 1).padStart(2, "0")}</span>
                <p>{highlightValues(text)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="roteiro-reader__no-results">
            Nenhuma oferta foi encontrada após o cabeçalho.
          </div>
        )}
      </section>
    </main>
  );
}

function highlightValues(text) {
  const value = String(text);
  const ranges = getRoteiroHighlightRanges(value);
  if (!ranges.length) return value;

  const parts = [];
  let cursor = 0;
  ranges.forEach(({ start, end }, index) => {
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(
      <mark className="roteiro-reader__value" key={`${index}-${start}-${end}`}>
        {value.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function formatModifiedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
