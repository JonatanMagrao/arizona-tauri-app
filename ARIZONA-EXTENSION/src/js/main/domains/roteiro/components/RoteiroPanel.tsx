import { useEffect } from "react";
import { useRoteiro } from "../hooks/useRoteiro";
import {
  buildLineSegments,
  mapLinesToOffers,
} from "../utils/textSegments";
import "./RoteiroPanel.scss";

type OfferStatus = "correct" | "wrong" | "neutral";

interface RoteiroPanelProps {
  onOpenOfferInOffers?: (offerLayerIndex: number) => void;
}

const formatOfferNumber = (offerIndex: number): string => {
  const number = offerIndex + 1;
  return number < 10 ? `0${number}` : String(number);
};

export const RoteiroPanel = ({ onOpenOfferInOffers }: RoteiroPanelProps) => {
  const {
    fileName,
    content,
    offerValidationInfos,
    loading,
    audioUpdating,
    markerAdjusting,
    renderQueueLoading,
    offerActionLoading,
    error,
    load,
    updateAudio,
    adjustMarkers,
    queueRender,
    fixOfferValue,
    openOfferPrecomp,
    toast,
    dismissToast,
  } = useRoteiro();

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="roteiro-panel roteiro-panel--state">
        <p>Carregando roteiro...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="roteiro-panel roteiro-panel--state">
        <p className="roteiro-panel__error">{error}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="roteiro-panel roteiro-panel--state">
        <p>Nenhum roteiro encontrado.</p>
        <button type="button" onClick={() => void load()}>
          Atualizar
        </button>
      </div>
    );
  }

  const lines = content.split("\n");
  const lineOfferIndices = mapLinesToOffers(lines);
  const marketLine = lines.find((line, lineIdx) => {
    return line.trim() !== "" && lineOfferIndices[lineIdx] === -1;
  });
  const offerRows = lines
    .map((line, lineIdx) => ({
      line,
      lineIdx,
      offerIndex: lineOfferIndices[lineIdx],
    }))
    .filter(({ line, offerIndex }) => line.trim() !== "" && offerIndex >= 0);

  return (
    <div className="roteiro-panel">
      <div className="roteiro-panel__header">
        <span className="roteiro-panel__filename" title={fileName}>
          {fileName}
        </span>
        <div className="roteiro-panel__actions">
          <button
            type="button"
            className="roteiro-panel__audio"
            onClick={() => void updateAudio()}
            disabled={audioUpdating}
            title="Atualizar audio"
          >
            {audioUpdating ? "..." : "Audio"}
          </button>
          <button
            type="button"
            className="roteiro-panel__refresh"
            onClick={() => void load()}
            title="Atualizar roteiro"
          >
          ↺
          </button>
        </div>
      </div>

      <div className="roteiro-panel__content">
        {marketLine && <div className="roteiro-market">{marketLine}</div>}

        <div className="roteiro-offers">
          {offerRows.map(({ line, lineIdx, offerIndex }) => {
            const info = offerValidationInfos[offerIndex];
            const segments = buildLineSegments(line, info);
            const hasWrong = segments.some((seg) => seg.match === "wrong");
            const hasCorrect = segments.some((seg) => seg.match === "correct");
            const status: OfferStatus = hasWrong
              ? "wrong"
              : hasCorrect
                ? "correct"
                : "neutral";

            return (
              <div
                key={lineIdx}
                className={[
                  "roteiro-offer",
                  `roteiro-offer--${status}`,
                  info?.offerLayerIndex && onOpenOfferInOffers
                    ? "roteiro-offer--openable"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={
                  info?.offerLayerIndex && onOpenOfferInOffers
                    ? "Clique duas vezes para editar esta oferta"
                    : undefined
                }
                onDoubleClick={(event) => {
                  if (!info?.offerLayerIndex || !onOpenOfferInOffers) return;
                  if ((event.target as HTMLElement).closest("button")) return;

                  onOpenOfferInOffers(info.offerLayerIndex);
                }}
              >
                <div className="roteiro-offer__rail" aria-hidden="true" />
                <div className="roteiro-offer__body">
                  <div className="roteiro-offer__meta">
                    <span className="roteiro-offer__number">
                      {info?.offerLayerIndex ? (
                        <button
                          type="button"
                          onClick={() => void openOfferPrecomp(info)}
                          disabled={offerActionLoading}
                          title="Abrir precomp"
                        >
                          {formatOfferNumber(offerIndex)}
                        </button>
                      ) : (
                        formatOfferNumber(offerIndex)
                      )}
                    </span>
                    {info?.mechanicType && (
                      <span className="roteiro-offer__rule">
                        {info.mechanicType}
                      </span>
                    )}
                  </div>
                  <div className="roteiro-line">
                    {segments.map((seg, segIdx) => {
                      if (!seg.match) return seg.text || " ";

                      const className = [
                        "roteiro-price",
                        `roteiro-price--${seg.match}`,
                        seg.action ? "roteiro-price--button" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      if (seg.action) {
                        return (
                          <button
                            type="button"
                            key={segIdx}
                            className={className}
                            disabled={offerActionLoading}
                            onClick={() =>
                              seg.action === "fix"
                                ? void fixOfferValue(
                                    info,
                                    seg.fieldKey,
                                    seg.value
                                  )
                                : void openOfferPrecomp(info)
                            }
                            title={
                              seg.action === "fix"
                                ? "Corrigir no After"
                                : "Abrir precomp"
                            }
                          >
                            {seg.text}
                          </button>
                        );
                      }

                      return (
                        <span key={segIdx} className={className}>
                          {seg.text}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="roteiro-marker-button"
        onClick={() => void adjustMarkers()}
        disabled={markerAdjusting}
        title="Mover markers 2 a 6 para o fim da precomp"
      >
        {markerAdjusting ? "..." : "Ajuste Marker"}
      </button>

      <button
        type="button"
        className="roteiro-render-button"
        onClick={() => void queueRender()}
        disabled={renderQueueLoading}
        title="Adicionar MOV e MP4 na fila de render"
      >
        {renderQueueLoading ? "..." : "Render"}
      </button>

      {toast && (
        <div className={`roteiro-toast roteiro-toast--${toast.variant}`}>
          <span className="roteiro-toast__text">{toast.text}</span>
          <button
            type="button"
            className="roteiro-toast__close"
            onClick={dismissToast}
            title="Fechar"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};
