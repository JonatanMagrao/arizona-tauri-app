import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { initBolt } from "../lib/utils/bolt";
import { OffersPanel } from "./domains/ofertas/components/OffersPanel";
import { useProductImageLibrary } from "./domains/ofertas/productImages/hooks/useProductImageLibrary";
import { useProductImagePreviews } from "./domains/ofertas/productImages/hooks/useProductImagePreviews";
import { RenderPanel } from "./domains/render/components/RenderPanel";
import { RoteiroPanel } from "./domains/roteiro/components/RoteiroPanel";
import { useArizonaBridgeLicense } from "./hooks/useArizonaBridgeLicense";
import { useHostTheme } from "./hooks/useHostTheme";
import { useProjectIdentity } from "./hooks/useProjectIdentity";
import "./main.scss";

type ActiveView = "offers" | "roteiro" | "render";

export const App = () => {
  const bgColor = useHostTheme();
  const license = useArizonaBridgeLicense();
  const boltInitializedRef = useRef(!window.cep);
  const [boltReady, setBoltReady] = useState(!window.cep);

  useEffect(() => {
    if (!license.licensed || boltInitializedRef.current) return;

    initBolt();
    boltInitializedRef.current = true;
    setBoltReady(true);
  }, [license.licensed]);

  if (window.cep && (!license.licensed || !boltReady)) {
    return <LicenseGate bgColor={bgColor} reason={license.reason} />;
  }

  return <LicensedApp bgColor={bgColor} />;
};

interface LicenseGateProps {
  bgColor: string;
  reason?: string;
}

const LicenseGate = ({ bgColor, reason }: LicenseGateProps) => {
  const appStyle = { backgroundColor: bgColor } as CSSProperties;
  const reasonCode = (reason || "").trim();
  const showReason = reasonCode && reasonCode !== "receipt_pending";

  return (
    <div className="app arizona-carrefour" style={appStyle}>
      <section className="license-lock" role="alert">
        <p>
          <strong>Plugin bloqueado.</strong>
          <span>Valide a licença novamente no Arizona App.</span>
          {showReason ? (
            <span className="license-lock-reason">({reasonCode})</span>
          ) : null}
        </p>
      </section>
    </div>
  );
};

interface LicensedAppProps {
  bgColor: string;
}

const LicensedApp = ({ bgColor }: LicensedAppProps) => {
  const { projectKey, refreshProjectIdentity } = useProjectIdentity();
  const projectViewKey = projectKey || "no-project";
  const projectKeyRef = useRef(projectKey);
  const [activeView, setActiveView] = useState<ActiveView>("offers");
  const [requestedOfferLayerIndex, setRequestedOfferLayerIndex] = useState<
    number | undefined
  >(undefined);
  const [, setStatus] = useState("");

  const {
    images,
    hasNodeAccess,
    clearProductImagePreviewCache,
    scanProjectProductsDirectory,
    updateImage,
  } = useProductImageLibrary();
  const [isClearingPreviewCache, setIsClearingPreviewCache] = useState(false);
  const [previewCacheMessage, setPreviewCacheMessage] = useState(
    "Limpar cache de previews"
  );

  const appStyle = { backgroundColor: bgColor } as CSSProperties;

  useEffect(() => {
    projectKeyRef.current = projectKey;
  }, [projectKey]);

  useEffect(() => {
    void scanProjectProductsDirectory();
  }, [projectKey, scanProjectProductsDirectory]);

  const { loadImagePreview } = useProductImagePreviews({
    hasNodeAccess,
    updateImage,
  });

  const handleClearPreviewCache = async () => {
    if (!hasNodeAccess || isClearingPreviewCache) return;

    const shouldClear = window.confirm(
      "Apagar o cache de previews dos produtos?"
    );

    if (!shouldClear) return;

    setIsClearingPreviewCache(true);

    try {
      const result = await clearProductImagePreviewCache();
      const message =
        result.removedCount === 1
          ? "1 arquivo removido do cache"
          : result.removedCount + " arquivos removidos do cache";

      setPreviewCacheMessage(message);
      setStatus(message);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Nao foi possivel limpar o cache.";

      setPreviewCacheMessage(message);
      setStatus(message);
    } finally {
      setIsClearingPreviewCache(false);
    }
  };

  const selectActiveView = useCallback(
    async (view: ActiveView) => {
      await refreshProjectIdentity();
      setActiveView(view);
    },
    [refreshProjectIdentity]
  );

  const keepCurrentProjectForAction = useCallback(async () => {
    const currentProjectKey = projectKeyRef.current;
    const nextProjectKey = await refreshProjectIdentity();

    return nextProjectKey === currentProjectKey;
  }, [refreshProjectIdentity]);

  const openOfferFromRoteiro = async (offerLayerIndex: number) => {
    if (!(await keepCurrentProjectForAction())) return;

    setRequestedOfferLayerIndex(offerLayerIndex);
    setActiveView("offers");
  };

  return (
    <div
      className={
        activeView === "offers"
          ? "app arizona-carrefour is-offers-view"
          : "app arizona-carrefour"
      }
      style={appStyle}
    >
      <div className="panel-topbar">
        <div className="panel-tabs" role="tablist" aria-label="Visualizacao">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "offers"}
            className={activeView === "offers" ? "is-active" : ""}
            onClick={() => void selectActiveView("offers")}
          >
            Ofertas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "roteiro"}
            className={activeView === "roteiro" ? "is-active" : ""}
            onClick={() => void selectActiveView("roteiro")}
          >
            Roteiro
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "render"}
            className={activeView === "render" ? "is-active" : ""}
            onClick={() => void selectActiveView("render")}
          >
            Render
          </button>
        </div>

        <button
          type="button"
          className="panel-cache-button"
          aria-label="Limpar cache de previews"
          aria-busy={isClearingPreviewCache}
          disabled={!hasNodeAccess || isClearingPreviewCache}
          title={previewCacheMessage}
          onClick={() => void handleClearPreviewCache()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.13 5.07c-.6.24-1.16.56-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.31.61.22l2.49-1c.53.41 1.09.74 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.6-.24 1.16-.57 1.69-.98l2.49 1c.23.09.48 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
          </svg>
        </button>
      </div>

      <div className="arizona-carrefour-content">
        {activeView === "roteiro" ? (
          <div className="arizona-carrefour-roteiro">
            <RoteiroPanel
              key={`roteiro-${projectViewKey}`}
              onOpenOfferInOffers={openOfferFromRoteiro}
            />
          </div>
        ) : activeView === "render" ? (
          <div className="arizona-carrefour-render">
            <RenderPanel key={`render-${projectViewKey}`} />
          </div>
        ) : (
          <div className="arizona-carrefour-offers">
            <OffersPanel
              key={`offers-${projectViewKey}`}
              productImages={images}
              requestedOfferLayerIndex={requestedOfferLayerIndex}
              onLoadProductPreview={loadImagePreview}
              onRefreshProductImages={scanProjectProductsDirectory}
              onBeforeOfferNavigation={keepCurrentProjectForAction}
              onRequestedOfferLayerIndexHandled={() =>
                setRequestedOfferLayerIndex(undefined)
              }
              onStatus={setStatus}
            />
          </div>
        )}
      </div>
    </div>
  );
};
