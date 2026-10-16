import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { initBolt } from "../lib/utils/bolt";
import { OffersPanel } from "./domains/ofertas/components/OffersPanel";
import { useProductImageLibrary } from "./domains/ofertas/productImages/hooks/useProductImageLibrary";
import { useProductImagePreviews } from "./domains/ofertas/productImages/hooks/useProductImagePreviews";
import { RoteiroPanel } from "./domains/roteiro/components/RoteiroPanel";
import { createRoteiroDocumentCache } from "./domains/roteiro/services/roteiroDocumentCache";
import { useArizonaBridgeLicense } from "./hooks/useArizonaBridgeLicense";
import { useHostTheme } from "./hooks/useHostTheme";
import { useProjectIdentity } from "./hooks/useProjectIdentity";
import { useProjectOpening } from "./hooks/useProjectOpening";
import { getPublicErrorMessage } from "./utils/errors";
import { tooltipProps } from "./utils/tooltips";
import { TooltipLayer } from "./components/TooltipLayer";
import {
  createDiagnosticOperationId,
  recordDiagnosticFailure,
  recordLocalDiagnostic,
} from "./services/localDiagnostics";
import "./main.scss";

type ActiveView = "offers" | "roteiro";

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
  const accessMessage = licenseAccessMessage(reasonCode);

  return (
    <div className="app arizona-carrefour" style={appStyle}>
      <section className="license-lock" role="alert">
        <p>
          <strong>Painel indisponível.</strong>
          <span>{accessMessage}</span>
        </p>
      </section>
    </div>
  );
};

interface LicensedAppProps {
  bgColor: string;
}

const LicensedApp = ({ bgColor }: LicensedAppProps) => {
  const projectActivityRef = useRef({ opening: false, busy: false });
  const { projectKey, projectName, refreshProjectIdentity } =
    useProjectIdentity({
      canObserve: () =>
        !projectActivityRef.current.opening && !projectActivityRef.current.busy,
    });
  const [activeView, setActiveView] = useState<ActiveView>("offers");
  const [projectRevision, setProjectRevision] = useState(0);
  const reloadProject = useCallback(async () => {
    await refreshProjectIdentity(true);
    // Reopening the same file must also discard the old snapshots/previews.
    setProjectRevision((current) => current + 1);
  }, [refreshProjectIdentity]);
  const { isOpeningProject, openProject } = useProjectOpening(reloadProject);
  const handleOpenProject = useCallback(async () => {
    if (projectActivityRef.current.opening || projectActivityRef.current.busy) return;
    // Pause before the modal-opening hook yields to React or the host bridge.
    projectActivityRef.current.opening = true;
    try {
      await openProject();
    } finally {
      projectActivityRef.current.opening = false;
    }
  }, [openProject]);
  const handleProjectBusyChange = useCallback((busy: boolean) => {
    projectActivityRef.current.busy = busy;
  }, []);

  return (
    <ProjectPanel
      key={`${projectKey || "no-project"}-${projectRevision}`}
      bgColor={bgColor}
      projectKey={projectKey}
      projectName={projectName}
      refreshProjectIdentity={refreshProjectIdentity}
      activeView={activeView}
      setActiveView={setActiveView}
      isOpeningProject={isOpeningProject}
      onOpenProject={handleOpenProject}
      onBusyChange={handleProjectBusyChange}
    />
  );
};

interface ProjectPanelProps extends LicensedAppProps {
  projectKey: string;
  projectName: string;
  refreshProjectIdentity: () => Promise<string>;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  isOpeningProject: boolean;
  onOpenProject: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}

const ProjectPanel = ({
  bgColor,
  projectKey,
  projectName,
  refreshProjectIdentity,
  activeView,
  setActiveView,
  isOpeningProject,
  onOpenProject,
  onBusyChange,
}: ProjectPanelProps) => {
  const projectViewKey = projectKey || "no-project";
  const projectKeyRef = useRef(projectKey);
  const isOpeningProjectRef = useRef(isOpeningProject);
  isOpeningProjectRef.current = isOpeningProject;
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const handleEditorBusyChange = useCallback((busy: boolean) => {
    setIsProjectBusy(busy);
    onBusyChange(busy);
  }, [onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  // ProjectPanel survives tab changes, but its project/revision key replaces
  // this single-document cache when switching or reopening a project.
  const [roteiroDocumentCache] = useState(createRoteiroDocumentCache);
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
    "Limpar imagens temporárias"
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
      "Apagar as imagens temporárias dos produtos?"
    );

    if (!shouldClear) return;

    setIsClearingPreviewCache(true);
    const operationId = createDiagnosticOperationId("preview-cache");
    const startedAt = Date.now();
    recordLocalDiagnostic({
      component: "previews",
      action: "limpar_cache",
      status: "started",
      operationId,
      message: "Limpeza das imagens temporárias iniciada.",
    });

    try {
      const result = await clearProductImagePreviewCache();
      const message =
        result.removedCount === 1
          ? "1 arquivo temporário removido"
          : result.removedCount + " arquivos temporários removidos";

      setPreviewCacheMessage(message);
      setStatus(message);
      recordLocalDiagnostic({
        component: "previews",
        action: "limpar_cache",
        status: "completed",
        operationId,
        message: "Imagens temporárias removidas.",
        details: {
          durationMs: Date.now() - startedAt,
          removedCount: result.removedCount,
        },
      });
    } catch (caught) {
      const message = getPublicErrorMessage(
        caught,
        "Não foi possível limpar as imagens temporárias. Tente novamente.",
      );

      setPreviewCacheMessage(message);
      setStatus(message);
      recordDiagnosticFailure(
        "previews",
        "limpar_cache",
        "Não foi possível remover as imagens temporárias.",
        caught,
        {
          code: "preview_cache_clear_failed",
          operationId,
          details: { durationMs: Date.now() - startedAt },
        }
      );
    } finally {
      setIsClearingPreviewCache(false);
    }
  };

  const selectActiveView = useCallback(
    async (view: ActiveView) => {
      if (isOpeningProjectRef.current || isProjectBusy) return;
      await refreshProjectIdentity();
      if (isOpeningProjectRef.current) return;
      setActiveView(view);
    },
    [isProjectBusy, refreshProjectIdentity, setActiveView]
  );

  const keepCurrentProjectForAction = useCallback(async () => {
    if (isOpeningProjectRef.current) return false;
    const currentProjectKey = projectKeyRef.current;
    const nextProjectKey = await refreshProjectIdentity();

    return !isOpeningProjectRef.current && nextProjectKey === currentProjectKey;
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
      aria-busy={isOpeningProject}
    >
      <div className="panel-topbar">
        <div className="panel-tabs" role="tablist" aria-label="Visualização">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "offers"}
            className={activeView === "offers" ? "is-active" : ""}
            disabled={isOpeningProject || isProjectBusy}
            onClick={() => void selectActiveView("offers")}
          >
            Ofertas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "roteiro"}
            className={activeView === "roteiro" ? "is-active" : ""}
            disabled={isOpeningProject || isProjectBusy}
            onClick={() => void selectActiveView("roteiro")}
          >
            Roteiro
          </button>
        </div>

        <button
          type="button"
          className="panel-open-project-button"
          aria-label="Abrir outro projeto"
          aria-busy={isOpeningProject}
          disabled={!window.cep || isOpeningProject || isProjectBusy || isClearingPreviewCache}
          {...tooltipProps(isOpeningProject ? "Abrindo projeto..." : "Abrir outro projeto")}
          onClick={() => void onOpenProject()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16l3-11H5l-1 7V6h7l2 2h7V6h-8l-2-2Zm-3.3 7h13.7l-1.9 7H4.8l1.9-7Z" />
          </svg>
        </button>

        <button
          type="button"
          className="panel-cache-button"
          aria-label="Limpar imagens temporárias"
          aria-busy={isClearingPreviewCache}
          disabled={!hasNodeAccess || isClearingPreviewCache || isOpeningProject}
          {...tooltipProps(previewCacheMessage)}
          onClick={() => void handleClearPreviewCache()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.13 5.07c-.6.24-1.16.56-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.31.61.22l2.49-1c.53.41 1.09.74 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.6-.24 1.16-.57 1.69-.98l2.49 1c.23.09.48 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
          </svg>
        </button>
      </div>

      <div className="arizona-carrefour-content">
        {isOpeningProject ? (
          <div className="panel-project-opening" role="status">
            Abrindo projeto...
          </div>
        ) : activeView === "roteiro" ? (
          <div className="arizona-carrefour-roteiro">
            <RoteiroPanel
              key={`roteiro-${projectViewKey}`}
              documentCache={roteiroDocumentCache}
              onOpenOfferInOffers={openOfferFromRoteiro}
              onBusyChange={handleEditorBusyChange}
            />
          </div>
        ) : (
          <div className="arizona-carrefour-offers">
            <OffersPanel
              key={`offers-${projectViewKey}`}
              projectName={projectName}
              productImages={images}
              requestedOfferLayerIndex={requestedOfferLayerIndex}
              onLoadProductPreview={loadImagePreview}
              onRefreshProductImages={scanProjectProductsDirectory}
              onBeforeOfferNavigation={keepCurrentProjectForAction}
              onRequestedOfferLayerIndexHandled={() =>
                setRequestedOfferLayerIndex(undefined)
              }
              onStatus={setStatus}
              onBusyChange={handleEditorBusyChange}
            />
          </div>
        )}
      </div>
      <TooltipLayer />
    </div>
  );
};

const licenseAccessMessage = (reason: string) => {
  if (!reason || reason === "receipt_pending" || reason === "valid") {
    return "Estamos confirmando seu acesso. Aguarde um instante.";
  }
  if (reason === "receipt_missing") {
    return "Abra o Arizona App e entre novamente para liberar este painel.";
  }
  if (reason === "receipt_expired") {
    return "Sua confirmação de acesso expirou. Abra o Arizona App para renová-la.";
  }
  if (reason === "receipt_device_mismatch") {
    return "Este painel ainda não foi liberado neste computador. Abra o Arizona App para confirmar o acesso.";
  }
  if (reason === "not_licensed" || reason === "feature_missing") {
    return "Seu acesso a este painel não está disponível. Confirme sua licença no Arizona App.";
  }
  return "Não foi possível confirmar seu acesso. Abra o Arizona App e tente novamente.";
};
