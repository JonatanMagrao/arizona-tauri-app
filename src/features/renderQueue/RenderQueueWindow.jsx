import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAutoHideToast } from "../../hooks/useAutoHideToast";
import { commandNames, invokeAction, invokeCommand } from "../../services/tauriCommands";
import { isHumanFriendlyPublicMessage, publicErrorMessage } from "../../utils/publicErrors";
import { renderTimingLabel } from "./renderTiming";
import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import minimizeIcon from "../../assets/icones/minimize.svg";
import "./RenderQueueWindow.css";

const STATUS_REFRESH_INTERVAL_MS = 10000;
const SUBMISSION_ATTEMPT_STORAGE_KEY = "arizona.renderQueue.pendingSubmission.v1";
const SUBMISSION_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_JOB_STATES = new Set([
  "waiting_for_worker",
  "waiting_for_sync",
  "queued",
  "claimed",
  "preparing",
  "waiting_for_after",
  "rendering",
  "rendering_proxy",
  "rendering_mov",
  "rendering_mp4",
  "publishing",
  "cancelling",
  "retry_wait",
  "conflict",
]);
const TERMINAL_JOB_STATES = new Set(["completed", "cancelled", "failed"]);

const QUEUE_STATUS_MESSAGES = Object.freeze({
  after_effects_open: "Este trabalho foi interrompido por uma versão anterior do Arizona na máquina escolhida. Atualize o app nessa máquina antes de tentar novamente.",
  drive_unavailable: "A pasta compartilhada não está acessível nesta máquina.",
  project_not_synced: "O projeto ainda não chegou por completo à máquina escolhida.",
  project_missing: "O projeto não foi encontrado na pasta compartilhada da máquina escolhida.",
  project_hash_mismatch: "O projeto recebido ficou diferente do arquivo enviado. Aguarde a sincronização terminar e envie o projeto novamente.",
  sync_timeout: "O projeto não terminou de sincronizar dentro do prazo. Verifique a pasta compartilhada e envie o projeto novamente.",
  recipe_unavailable: "Esta máquina ainda não está preparada para criar os arquivos deste trabalho.",
  aerender_unavailable: "O recurso de renderização do After Effects não foi encontrado nesta máquina.",
  aerender_failed: "O After Effects não conseguiu concluir a renderização.",
  output_missing: "A renderização terminou, mas um dos arquivos esperados não foi encontrado.",
  output_conflict: "Os arquivos de resultado mudaram desde o envio. Se este trabalho ainda estiver aguardando, cancele-o; depois envie o projeto novamente para confirmar a substituição.",
  existing_output_changed: "Os arquivos de resultado mudaram desde o envio. Se este trabalho ainda estiver aguardando, cancele-o; depois envie o projeto novamente para confirmar a substituição.",
  cancelled_by_requester: "A renderização foi cancelada pela máquina que enviou o projeto.",
  cancelled_by_worker: "A renderização foi interrompida na máquina responsável.",
  lease_lost: "A conexão com este trabalho foi interrompida. Consulte o estado atual antes de tentar novamente.",
  machine_unavailable: "A máquina escolhida não está disponível neste momento.",
  worker_not_responding: "O Arizona não está respondendo nesta máquina.",
  unexpected_failure: "Não foi possível concluir esta renderização. Tente novamente ou escolha outra máquina.",
});

const EMPTY_STATUS = Object.freeze({
  thisMachine: {
    enabled: false,
    availability: "disabled",
    readiness: "unknown",
    name: "Esta máquina",
    currentJob: null,
    warnings: [],
  },
  machines: [],
  sentJobs: [],
  receivedJobs: [],
  notices: [],
  prefill: { jobaoCod: "", jobinhoCod: "" },
});

function RenderQueueWindow() {
  const initialPrefill = useMemo(readInitialPrefill, []);
  const [queueStatus, setQueueStatus] = useState(EMPTY_STATUS);
  const [outputFormats, setOutputFormats] = useState(["mov", "mp4"]);
  const [jobaoCod, setJobaoCod] = useState(initialPrefill.jobaoCod);
  const [jobinhoCod, setJobinhoCod] = useState(initialPrefill.jobinhoCod);
  const [candidates, setCandidates] = useState([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isStatusStale, setIsStatusStale] = useState(false);
  const [isChangingAvailability, setIsChangingAvailability] = useState(false);
  const [isFindingProject, setIsFindingProject] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const [overwriteRequest, setOverwriteRequest] = useState(null);
  const [reassignJob, setReassignJob] = useState(null);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const { toast, showToast, hideToast } = useAutoHideToast(6000);
  const mountedRef = useRef(false);
  const queueStatusRef = useRef(EMPTY_STATUS);
  const panelOpenRef = useRef(true);
  const visibilityRevisionRef = useRef(0);
  const closeRequestInFlightRef = useRef(false);
  const statusInFlightRef = useRef(false);
  const draftTouchedRef = useRef(Boolean(initialPrefill.jobaoCod || initialPrefill.jobinhoCod));
  const initialLookupDoneRef = useRef(false);
  const statusPrefillLookupRef = useRef("");
  const submissionAttemptRef = useRef(null);
  const projectLookupInFlightRef = useRef(false);

  const applyStatus = useCallback((rawStatus) => {
    const normalized = normalizeQueueStatus(rawStatus);
    queueStatusRef.current = normalized;
    setQueueStatus(normalized);
    setIsStatusStale(false);

    if (!draftTouchedRef.current) {
      const incomingJobao = normalized.prefill.jobaoCod;
      const incomingJobinho = normalized.prefill.jobinhoCod;
      if (incomingJobao || incomingJobinho) {
        setJobaoCod(incomingJobao);
        setJobinhoCod(incomingJobinho);
      }
    }

    setSelectedMachineId((current) => {
      if (current && normalized.machines.some((machine) => machine.id === current && machine.accepting)) {
        return current;
      }
      return normalized.machines.find((machine) => machine.accepting)?.id || "";
    });
    return normalized;
  }, []);

  const refreshStatus = useCallback(async ({ silent = false } = {}) => {
    if (silent && !panelOpenRef.current) return null;
    if (statusInFlightRef.current) return null;
    statusInFlightRef.current = true;
    if (!silent) setIsLoadingStatus(true);

    try {
      const response = await invokeCommand(commandNames.renderQueueStatus);
      if (response?.ok === false) throw response;
      if (!mountedRef.current) return null;
      return applyStatus(response);
    } catch (error) {
      if (!mountedRef.current) return null;
      setIsStatusStale(true);
      if (!silent) {
        showToast(publicErrorMessage(
          error,
          "Não foi possível carregar a fila agora. Tente novamente em alguns instantes."
        ), "error");
      }
      return null;
    } finally {
      statusInFlightRef.current = false;
      if (mountedRef.current && !silent) setIsLoadingStatus(false);
    }
  }, [applyStatus, showToast]);

  const findProjects = useCallback(async (codes = {}) => {
    const nextJobao = cleanCode(codes.jobaoCod ?? jobaoCod);
    const nextJobinho = cleanCode(codes.jobinhoCod ?? jobinhoCod);
    if (!nextJobao || !nextJobinho || projectLookupInFlightRef.current) return [];

    projectLookupInFlightRef.current = true;
    setIsFindingProject(true);
    setCandidates([]);
    setSelectedProjectPath("");
    try {
      const response = await invokeCommand(commandNames.renderQueueProjectCandidates, {
        jobaoCod: nextJobao,
        jobinhoCod: nextJobinho,
      });
      if (response?.ok === false) throw response;
      const nextCandidates = normalizeProjectCandidates(response);
      if (!mountedRef.current) return [];
      setCandidates(nextCandidates);
      if (nextCandidates.length === 1) {
        setSelectedProjectPath(nextCandidates[0].relativePath);
      }
      if (nextCandidates.length === 0) {
        showToast("Nenhum projeto do After Effects foi encontrado para esses códigos.", "error");
      }
      return nextCandidates;
    } catch (error) {
      if (mountedRef.current) {
        showToast(publicErrorMessage(
          error,
          "Não foi possível localizar o projeto. Confira os códigos e tente novamente."
        ), "error");
      }
      return [];
    } finally {
      projectLookupInFlightRef.current = false;
      if (mountedRef.current) setIsFindingProject(false);
    }
  }, [jobaoCod, jobinhoCod, showToast]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus();
    const refreshTimer = window.setInterval(() => {
      if (panelOpenRef.current) void refreshStatus({ silent: true });
    }, STATUS_REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(refreshTimer);
    };
  }, [refreshStatus]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    if (initialLookupDoneRef.current) return;
    if (!initialPrefill.jobaoCod || !initialPrefill.jobinhoCod) return;
    initialLookupDoneRef.current = true;
    void findProjects(initialPrefill);
  }, [findProjects, initialPrefill]);

  useEffect(() => {
    if (draftTouchedRef.current) return;
    const normalizedJobao = cleanCode(jobaoCod);
    const normalizedJobinho = cleanCode(jobinhoCod);
    if (!normalizedJobao || !normalizedJobinho) return;
    const lookupKey = `${normalizedJobao}::${normalizedJobinho}`;
    if (statusPrefillLookupRef.current === lookupKey) return;
    statusPrefillLookupRef.current = lookupKey;
    void findProjects({ jobaoCod: normalizedJobao, jobinhoCod: normalizedJobinho });
  }, [findProjects, jobaoCod, jobinhoCod]);

  const applyPrefill = useCallback((rawPrefill) => {
    visibilityRevisionRef.current += 1;
    panelOpenRef.current = true;
    void refreshStatus({ silent: true });
    const prefill = normalizePrefill(rawPrefill);
    draftTouchedRef.current = true;
    setJobaoCod(prefill.jobaoCod);
    setJobinhoCod(prefill.jobinhoCod);
    setCandidates([]);
    setSelectedProjectPath("");
    if (prefill.jobaoCod && prefill.jobinhoCod) {
      void findProjects(prefill);
    }
  }, [findProjects, refreshStatus]);

  const closeWindow = useCallback(async () => {
    if (closeRequestInFlightRef.current) return;
    closeRequestInFlightRef.current = true;
    try {
      visibilityRevisionRef.current += 1;
      panelOpenRef.current = false;
      const result = await invokeAction(
        commandNames.renderQueueCloseWindow,
        {},
        "Não foi possível fechar a janela da fila."
      );
      if (!result.ok) {
        panelOpenRef.current = true;
        showToast(result.message, "error");
      }
    } finally {
      window.setTimeout(() => {
        closeRequestInFlightRef.current = false;
      }, 120);
    }
  }, [showToast]);

  const minimizeWindow = () => {
    getCurrentWindow().minimize().catch(() => {});
  };

  useEffect(() => {
    let disposed = false;
    let unlistenClose = null;
    let unlistenPrefill = null;
    let unlistenChanged = null;
    let unlistenNativeClose = null;
    let unlistenShown = null;
    const handlePrefill = (event) => applyPrefill(event.detail);
    const handleShown = () => {
      visibilityRevisionRef.current += 1;
      panelOpenRef.current = true;
      void refreshStatus({ silent: true });
    };
    window.addEventListener("arizona-render-queue:set-project", handlePrefill);

    const visibilityRevision = visibilityRevisionRef.current;
    getCurrentWindow()
      .isVisible()
      .then((visible) => {
        if (!disposed && visibilityRevisionRef.current === visibilityRevision) {
          panelOpenRef.current = visible;
        }
      })
      .catch(() => {});

    listen("arizona-render-queue:set-project", (event) => applyPrefill(event.payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenPrefill = unlisten;
      })
      .catch(() => {});
    listen("arizona-render-queue:shown", handleShown)
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenShown = unlisten;
      })
      .catch(() => {});
    listen("arizona-render-queue:changed", () => {
      if (panelOpenRef.current) void refreshStatus({ silent: true });
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenChanged = unlisten;
      })
      .catch(() => {});
    listen("arizona-render-queue:close-requested", () => {
      void closeWindow();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenNativeClose = unlisten;
      })
      .catch(() => {});

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await closeWindow();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      window.removeEventListener("arizona-render-queue:set-project", handlePrefill);
      if (unlistenClose) unlistenClose();
      if (unlistenPrefill) unlistenPrefill();
      if (unlistenChanged) unlistenChanged();
      if (unlistenNativeClose) unlistenNativeClose();
      if (unlistenShown) unlistenShown();
    };
  }, [applyPrefill, closeWindow, refreshStatus]);

  const updateCode = (setter) => (event) => {
    draftTouchedRef.current = true;
    setter(event.target.value);
    setCandidates([]);
    setSelectedProjectPath("");
  };

  const setAvailable = async () => {
    if (isChangingAvailability) return;
    const enabled = !queueStatus.thisMachine.enabled;
    const hasReceivedWork = hasActiveReceivedJobs(queueStatus);
    setIsChangingAvailability(true);
    try {
      const response = await invokeCommand(commandNames.renderQueueSetAvailable, { enabled });
      if (response?.ok === false) throw response;
      applyStatus(response);
      await refreshStatus({ silent: true });
      showToast(
        enabled
          ? "Esta máquina agora pode receber novos trabalhos."
          : queueStatus.thisMachine.currentJob
            ? "Esta máquina terminará o trabalho atual e não receberá novos."
            : hasReceivedWork
              ? "Esta máquina não receberá novos trabalhos. Reative a disponibilidade para concluir os que já estão na fila ou cancele-os."
            : "Esta máquina não receberá novos trabalhos.",
        "success"
      );
    } catch (error) {
      showToast(publicErrorMessage(
        error,
        enabled
          ? "Não foi possível disponibilizar esta máquina agora."
          : "Não foi possível alterar a disponibilidade desta máquina."
      ), "error");
    } finally {
      if (mountedRef.current) setIsChangingAvailability(false);
    }
  };

  const selectedCandidate = candidates.find((candidate) => candidate.relativePath === selectedProjectPath) || null;
  const acceptingMachines = queueStatus.machines.filter((machine) => machine.accepting);
  const selectedMachine = acceptingMachines.find((machine) => machine.id === selectedMachineId) || null;
  const needsProjectChoice = candidates.length > 1 && !selectedCandidate;
  const canStartDraft = Boolean(
    cleanCode(jobaoCod)
    && cleanCode(jobinhoCod)
    && outputFormats.length > 0
    && !needsProjectChoice
    && !isFindingProject
    && !isSubmitting
  );

  const performSubmit = async (
    replaceExisting,
    targetMachine = selectedMachine,
    requestedFormats = outputFormats,
    candidateOverride = selectedCandidate
  ) => {
    const normalizedFormats = normalizeOutputFormats(requestedFormats);
    const candidate = candidateOverride;
    if (!candidate || !targetMachine || normalizedFormats.length === 0 || isSubmitting) return;
    const cleanedJobao = cleanCode(jobaoCod);
    const cleanedJobinho = cleanCode(jobinhoCod);
    const submission = getOrCreateSubmissionAttempt(JSON.stringify([
      cleanedJobao,
      cleanedJobinho,
      candidate.relativePath,
      targetMachine.id,
      normalizedFormats,
      Boolean(replaceExisting),
    ]), submissionAttemptRef.current);
    submissionAttemptRef.current = submission;
    setIsSubmitting(true);
    try {
      const response = await invokeCommand(commandNames.renderQueueSubmit, {
        jobaoCod: cleanedJobao,
        jobinhoCod: cleanedJobinho,
        projectRelativePath: candidate.relativePath,
        targetDeviceId: targetMachine.id,
        replaceExisting: Boolean(replaceExisting),
        submissionId: submission.id,
        outputFormats: normalizedFormats,
      });

      const conflicts = normalizeExistingOutputs(response, candidate)
        .filter((output) => normalizedFormats.includes(output.toLowerCase()));
      if (response?.ok === false) {
        if (isOverwriteConflict(response) || conflicts.length > 0) {
          clearSubmissionAttempt(submission);
          submissionAttemptRef.current = null;
          setOverwriteRequest({
            outputs: conflicts.length ? conflicts : selectedOutputLabels(normalizedFormats),
            targetMachine,
            outputFormats: normalizedFormats,
            candidate,
          });
          return;
        }
        showToast(publicErrorMessage(
          response,
          "Não foi possível enviar este projeto para a fila."
        ), "error");
        return;
      }

      setOverwriteRequest(null);
      clearSubmissionAttempt(submission);
      submissionAttemptRef.current = null;
      showToast("Projeto enviado para a máquina escolhida.", "success");
      await refreshStatus({ silent: true });
    } catch (error) {
      if (isOverwriteConflict(error)) {
        clearSubmissionAttempt(submission);
        submissionAttemptRef.current = null;
        setOverwriteRequest({
          outputs: selectedOutputLabels(normalizedFormats),
          targetMachine,
          outputFormats: normalizedFormats,
          candidate,
        });
        return;
      }
      showToast(publicErrorMessage(
        error,
        "Não foi possível enviar este projeto para a fila."
      ), "error");
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  const requestSubmit = async (targetMachine) => {
    if (!canStartDraft || !targetMachine?.accepting) return;
    setSelectedMachineId(targetMachine.id);
    const normalizedFormats = normalizeOutputFormats(outputFormats);
    let candidate = selectedCandidate;

    if (!candidate) {
      const foundCandidates = await findProjects();
      if (foundCandidates.length !== 1) {
        if (foundCandidates.length > 1) {
          showToast("Encontramos mais de um projeto. Escolha um deles para continuar.");
        }
        return;
      }
      candidate = foundCandidates[0];
    }

    const existingOutputs = normalizeExistingOutputs(candidate)
      .filter((output) => normalizedFormats.includes(output.toLowerCase()));
    if (existingOutputs.length > 0) {
      setOverwriteRequest({
        outputs: existingOutputs,
        targetMachine,
        outputFormats: normalizedFormats,
        candidate,
      });
      return;
    }
    await performSubmit(false, targetMachine, normalizedFormats, candidate);
  };

  const toggleOutputFormat = (format) => {
    setOutputFormats((current) => {
      if (current.includes(format)) {
        return current.length === 1 ? current : current.filter((item) => item !== format);
      }
      return normalizeOutputFormats([...current, format]);
    });
  };

  const cancelJob = async (job) => {
    if (!job?.id || busyJobId) return;
    if (!window.confirm(`Cancelar a renderização de “${job.title}”? As partes ainda não concluídas serão descartadas.`)) {
      return;
    }

    setBusyJobId(job.id);
    const result = await invokeAction(
      commandNames.renderQueueCancel,
      { jobId: job.id },
      "Não foi possível cancelar esta renderização."
    );
    if (!result.ok) {
      showToast(result.message, "error");
    } else {
      showToast("Cancelamento solicitado. As máquinas relacionadas serão avisadas.", "success");
      await refreshStatus({ silent: true });
    }
    if (mountedRef.current) setBusyJobId("");
  };

  const openReassign = (job) => {
    const firstAlternative = acceptingMachines.find((machine) => machine.id !== job.targetDeviceId);
    setReassignJob(job);
    setReassignTargetId(firstAlternative?.id || "");
  };

  const confirmReassign = async () => {
    if (!reassignJob?.id || !reassignTargetId || busyJobId) return;
    setBusyJobId(reassignJob.id);
    const result = await invokeAction(
      commandNames.renderQueueReassign,
      { jobId: reassignJob.id, targetDeviceId: reassignTargetId },
      "Não foi possível trocar a máquina deste trabalho."
    );
    if (!result.ok) {
      showToast(result.message, "error");
    } else {
      setReassignJob(null);
      showToast("Máquina alterada. As pessoas envolvidas serão avisadas.", "success");
      await refreshStatus({ silent: true });
    }
    if (mountedRef.current) setBusyJobId("");
  };

  const showReceiverView = shouldKeepReceiverViewOpen(queueStatus);
  const activeReceivedJobs = queueStatus.receivedJobs.filter((job) => !TERMINAL_JOB_STATES.has(job.status));
  const activeSentJobs = queueStatus.sentJobs.filter((job) => !TERMINAL_JOB_STATES.has(job.status));
  const visibleSentJobs = uniqueJobs([
    ...activeSentJobs,
    ...queueStatus.sentJobs.slice(0, 5),
  ]);

  return (
    <div className="render-queue-window">
      <header className="secondary-titlebar" aria-label="Barra da janela">
        <div className="secondary-titlebar__brand">
          <img className="secondary-titlebar__logo" src={appLogo} alt="" aria-hidden="true" />
          <span>Arizona App</span>
        </div>
        <div className="secondary-titlebar__drag"><span>Fila de renderização</span></div>
        <div className="secondary-titlebar__controls">
          <button
            type="button"
            className="titlebar-icon-btn titlebar-icon-btn--minimize"
            onClick={minimizeWindow}
            tabIndex="-1"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <img src={minimizeIcon} alt="" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="titlebar-icon-btn titlebar-icon-btn--close"
            onClick={closeWindow}
            tabIndex="-1"
            title="Fechar"
            aria-label="Fechar"
          >
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="render-queue-content">
        <div className="render-queue-mode-bar">
          <div className="render-queue-mode-copy">
            <strong>Receber renders</strong>
            <span>{availabilityToggleLabel(queueStatus.thisMachine)}</span>
          </div>
          <button
            type="button"
            className={`render-switch ${queueStatus.thisMachine.enabled ? "render-switch--on" : ""}`}
            role="switch"
            aria-checked={queueStatus.thisMachine.enabled}
            aria-label="Receber renders nesta máquina"
            onClick={setAvailable}
            disabled={isChangingAvailability || isLoadingStatus}
          >
            <span aria-hidden="true"></span>
          </button>
        </div>

        {isStatusStale && (
          <div className="render-sync-notice" role="status">
            Não foi possível atualizar agora. A última informação recebida continua visível.
            <button type="button" onClick={() => refreshStatus()}>Tentar novamente</button>
          </div>
        )}

        {queueStatus.notices.map((notice, index) => (
          <Notice key={notice.id || `notice-${index}`} notice={notice} />
        ))}

        {!showReceiverView && (
          <div
            id="render-send-panel"
            className="render-tab-panel render-send-panel"
          >
            <section className="render-card render-submit-card" aria-labelledby="render-submit-title">
              <div className="render-card__heading">
                <div>
                  <span className="render-eyebrow">Novo envio</span>
                  <h1 id="render-submit-title">Escolha quem fará o render</h1>
                </div>
              </div>

              <p className="render-helper">
                Preencha os códigos na linha da máquina desejada. O Arizona localizará a última versão salva e fará o envio.
              </p>

              {candidates.length > 1 && (
                <fieldset className="render-choice-list render-project-list render-project-list--compact">
                  <legend>Encontramos mais de um projeto. Qual deles deseja enviar?</legend>
                  {candidates.map((candidate) => (
                    <label className="render-choice" key={candidate.relativePath}>
                      <input
                        type="radio"
                        name="render-project"
                        value={candidate.relativePath}
                        checked={selectedProjectPath === candidate.relativePath}
                        onChange={() => setSelectedProjectPath(candidate.relativePath)}
                      />
                      <span>
                        <strong>{candidate.name}</strong>
                        {candidate.region && <small>Região {candidate.region}</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="render-available-block" aria-labelledby="render-available-title">
              <div className="render-card__heading render-card__heading--jobs">
                <div>
                  <span className="render-eyebrow">Disponíveis agora</span>
                  <h2 id="render-available-title">Quem pode renderizar</h2>
                </div>
                <span className="render-job-count">{acceptingMachines.length}</span>
              </div>

              {acceptingMachines.length === 0 ? (
                <div className="render-empty">Nenhuma outra máquina está disponível agora.</div>
              ) : (
                <div className="render-machine-rows">
                  {acceptingMachines.map((machine) => (
                    <article className="render-machine-row" key={machine.id}>
                      <div className="render-machine-row__identity">
                        <strong>{machine.name}</strong>
                        <span>{machineQueueLabel(machine)}</span>
                        {machine.message && <small>{machine.message}</small>}
                      </div>
                      <label className="render-machine-row__field render-machine-row__field--jobao">
                        <span>Cód. Jobão</span>
                        <input
                          className="input"
                          value={jobaoCod}
                          onChange={updateCode(setJobaoCod)}
                          placeholder="Ex: 895"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <label className="render-machine-row__field render-machine-row__field--jobinho">
                        <span>Cód. Jobinho</span>
                        <input
                          className="input"
                          value={jobinhoCod}
                          onChange={updateCode(setJobinhoCod)}
                          placeholder="Ex: 15181"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <div className="render-machine-row__formats">
                        <OutputFormatSelector formats={outputFormats} onToggle={toggleOutputFormat} />
                      </div>
                      <div className="render-machine-row__state">
                        <StatusBadge state={machine.availability} compact />
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary render-machine-row__start"
                        onClick={() => void requestSubmit(machine)}
                        disabled={!canStartDraft}
                        title={needsProjectChoice ? "Escolha um dos projetos encontrados para continuar" : "Localizar o projeto e iniciar o render"}
                      >
                        {isFindingProject && selectedMachineId === machine.id
                          ? "Localizando..."
                          : isSubmitting && selectedMachineId === machine.id
                            ? "Enviando..."
                            : "Iniciar render"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
              </div>
            </section>

            <JobList
              title="Enviados"
              eyebrow="Seus pedidos"
              emptyMessage="Nenhum projeto enviado nesta conta."
              jobs={visibleSentJobs}
              busyJobId={busyJobId}
              onCancel={cancelJob}
              onReassign={openReassign}
              nowMillis={clockNow}
            />
          </div>
        )}

        {showReceiverView && (
          <div
            id="render-receive-panel"
            className="render-tab-panel render-receive-panel"
          >
            <section className="render-machine-card" aria-labelledby="render-machine-title">
              <div className="render-section-heading">
                <div>
                  <span className="render-eyebrow">Esta máquina</span>
                  <h1 id="render-machine-title">{queueStatus.thisMachine.name}</h1>
                </div>
                <StatusBadge state={queueStatus.thisMachine.availability} />
              </div>

              <div className="render-machine-summary" aria-live="polite">
                <span>{machineAvailabilityMessage(queueStatus.thisMachine)}</span>
              </div>

              {queueStatus.thisMachine.warnings.map((warning, index) => (
                <Notice key={warning.id || `machine-warning-${index}`} notice={warning} />
              ))}
            </section>

            {queueStatus.thisMachine.enabled || hasActiveReceivedJobs(queueStatus) ? (
              <>
              {!queueStatus.thisMachine.enabled && activeReceivedJobs.length > 0 && (
                <Notice notice={{
                  tone: "warning",
                  message: "O recebimento está pausado. Reative a disponibilidade para concluir esta fila ou cancele os trabalhos que não serão processados.",
                }} />
              )}
              <JobList
                title="Fila recebida"
                eyebrow="Trabalhos nesta máquina"
                emptyMessage="Esta máquina está disponível e aguardando um novo trabalho."
                jobs={activeReceivedJobs}
                busyJobId={busyJobId}
                onCancel={cancelJob}
                nowMillis={clockNow}
              />
              </>
            ) : (
              <section className="render-card render-receive-empty" aria-label="Recebimento desativado">
                <strong>Recebimento desativado</strong>
                <p>Ative o botão acima quando puder deixar o Arizona aberto nesta tela até o fim dos trabalhos.</p>
              </section>
            )}
          </div>
        )}
      </main>

      {overwriteRequest && (
        <ConfirmDialog
          title="Substituir resultados existentes?"
          description="Os resultados abaixo já existem. Confirme somente se deseja criar novos arquivos no lugar deles."
          confirmLabel={isSubmitting ? "Enviando..." : "Substituir e enviar"}
          onCancel={() => setOverwriteRequest(null)}
          onConfirm={() => performSubmit(
            true,
            overwriteRequest.targetMachine,
            overwriteRequest.outputFormats,
            overwriteRequest.candidate
          )}
          disabled={isSubmitting}
        >
          <ul className="render-confirm-list">
            {overwriteRequest.outputs.map((output) => <li key={output}>{output}</li>)}
          </ul>
        </ConfirmDialog>
      )}

      {reassignJob && (
        <ConfirmDialog
          title="Trocar a máquina?"
          description={`Escolha quem continuará o trabalho “${reassignJob.title}”. Ele não será movido automaticamente.`}
          confirmLabel={busyJobId ? "Alterando..." : "Trocar máquina"}
          onCancel={() => setReassignJob(null)}
          onConfirm={confirmReassign}
          disabled={!reassignTargetId || Boolean(busyJobId)}
        >
          <div className="render-reassign-options" role="radiogroup" aria-label="Nova máquina">
            {acceptingMachines
              .filter((machine) => machine.id !== reassignJob.targetDeviceId)
              .map((machine) => (
                <label className="render-choice" key={machine.id}>
                  <input
                    type="radio"
                    name="render-reassign-machine"
                    value={machine.id}
                    checked={reassignTargetId === machine.id}
                    onChange={() => setReassignTargetId(machine.id)}
                  />
                  <span>
                    <strong>{machine.name}</strong>
                    <small>{machineQueueLabel(machine)}</small>
                    {machine.message && <small className="render-machine-choice__warning">{machine.message}</small>}
                  </span>
                </label>
              ))}
            {!acceptingMachines.some((machine) => machine.id !== reassignJob.targetDeviceId) && (
              <p className="render-empty-small">Nenhuma outra máquina pode receber este trabalho agora.</p>
            )}
          </div>
        </ConfirmDialog>
      )}

      {toast.open && (
        <div
          className={`toast ${toast.variant === "error" ? "toast--error" : toast.variant === "success" ? "toast--success" : ""}`}
          role="alert"
          aria-live="polite"
        >
          <span className="toast__text">{toast.message}</span>
          <button className="toast__close" onClick={hideToast} aria-label="Fechar">x</button>
        </div>
      )}
    </div>
  );
}

function JobList({ title, eyebrow, emptyMessage, jobs, busyJobId, onCancel, onReassign, nowMillis }) {
  const headingId = `render-${String(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-title`;

  return (
    <section className="render-card render-jobs-card" aria-labelledby={headingId}>
      <div className="render-card__heading render-card__heading--jobs">
        <div>
          <span className="render-eyebrow">{eyebrow}</span>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span className="render-job-count">{jobs.length}</span>
      </div>

      {jobs.length === 0 ? (
        <div className="render-empty">{emptyMessage}</div>
      ) : (
        <div className="render-job-list">
          {jobs.map((job) => {
            const timingLabel = renderTimingLabel(job, nowMillis);
            return (
            <article className="render-job" key={job.id}>
              <div className="render-job__identity">
                <strong>{job.title}</strong>
                <div className="render-job__metadata">
                  <span>{job.machineLabel}</span>
                  {job.jobaoCod && <span>Jobão {job.jobaoCod}</span>}
                  {job.jobinhoCod && <span>Jobinho {job.jobinhoCod}</span>}
                  {job.region && <span>Região {job.region}</span>}
                </div>
              </div>

              <div className="render-job__formats">
                <OutputFormats formats={job.formats} compact />
              </div>
              <div className="render-job__badge">
                <StatusBadge state={job.status} />
              </div>

              <div className="render-job__progress-area">
                <div className="render-job__status">
                  <span>{jobStatusLabel(job)}</span>
                  {job.position > 0 && <span>Posição {job.position}</span>}
                </div>

                {timingLabel && (
                  <div className="render-job__timing" title={job.startedAt
                    ? "Tempo desde o início do aerender até a finalização dos arquivos"
                    : "Tempo desde a entrada na fila"}
                  >
                    {timingLabel}
                  </div>
                )}

                {job.progress !== null && (isProgressState(job.status) || ACTIVE_JOB_STATES.has(job.status)) && (
                  <div
                    className="render-progress"
                    role="progressbar"
                    aria-label={`Progresso de ${job.title}`}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={job.progress}
                  >
                    <span style={{ width: `${job.progress}%` }}></span>
                    <small>{job.progress}%</small>
                  </div>
                )}
              </div>

              {(job.canCancel || (onReassign && job.canReassign)) && (
                <div className="render-job__actions">
                  {onReassign && job.canReassign && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => onReassign(job)}
                      disabled={Boolean(busyJobId)}
                    >
                      Trocar máquina
                    </button>
                  )}
                  {job.canCancel && (
                    <button
                      type="button"
                      className="btn render-danger-btn"
                      onClick={() => onCancel(job)}
                      disabled={Boolean(busyJobId)}
                    >
                      {busyJobId === job.id ? "Aguarde..." : "Cancelar"}
                    </button>
                  )}
                </div>
              )}

              {job.message && <p className="render-job__message">{job.message}</p>}
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OutputFormats({ formats, compact = false }) {
  if (!Array.isArray(formats) || formats.length === 0) return null;
  return (
    <span className={`render-formats ${compact ? "render-formats--compact" : ""}`} aria-label={`Formatos: ${formats.join(" e ")}`}>
      {formats.map((format) => <span key={format}>{format}</span>)}
    </span>
  );
}

function OutputFormatSelector({ formats, onToggle }) {
  return (
    <div className="render-format-selector" role="group" aria-label="Formatos para criar">
      {[
        ["mov", "MOV"],
        ["mp4", "MP4"],
      ].map(([value, label]) => {
        const selected = formats.includes(value);
        return (
          <button
            key={value}
            type="button"
            className={selected ? "render-format-option render-format-option--selected" : "render-format-option"}
            aria-pressed={selected}
            onClick={() => onToggle(value)}
            disabled={selected && formats.length === 1}
            title={selected && formats.length === 1 ? "Pelo menos um formato precisa ficar selecionado" : `${selected ? "Não criar" : "Criar"} ${label}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ state, compact = false }) {
  const normalized = normalizeState(state);
  return (
    <span className={`render-status-badge render-status-badge--${statusTone(normalized)} ${compact ? "render-status-badge--compact" : ""}`}>
      {shortStatusLabel(normalized)}
    </span>
  );
}

function Notice({ notice }) {
  return (
    <div className={`render-notice render-notice--${notice.tone || "info"}`} role={notice.tone === "danger" ? "alert" : "status"}>
      {notice.message}
    </div>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm, disabled, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const primaryAction = dialog?.querySelector("[data-dialog-primary]");
    primaryAction?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !disabled) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") trapDialogFocus(event, dialog);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [disabled, onCancel]);

  return (
    <div
      className="render-dialog-backdrop"
      role="presentation"
      onMouseDown={() => { if (!disabled) onCancel(); }}
    >
      <section
        ref={dialogRef}
        className="render-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="render-dialog-title"
        aria-describedby="render-dialog-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="render-dialog-title">{title}</h2>
        <p id="render-dialog-description">{description}</p>
        {children}
        <div className="render-dialog__actions">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={disabled}>Voltar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={disabled} data-dialog-primary>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function trapDialogFocus(event, dialog) {
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function normalizeQueueStatus(rawStatus) {
  const payload = objectPayload(rawStatus);
  const machineRaw = firstObject(
    payload.thisMachine,
    payload.this_machine,
    payload.localMachine,
    payload.local_machine,
    payload.localWorker,
    payload.local_worker,
    payload.worker,
    payload.machine
  );
  const currentJobRaw = firstObject(
    machineRaw.currentJob,
    machineRaw.current_job,
    payload.currentJob,
    payload.current_job
  );
  const hasCurrentJob = Object.keys(currentJobRaw).length > 0;
  const preflightRaw = firstObject(machineRaw.preflight, machineRaw.checks, payload.preflight);
  const enabled = firstBoolean(
    machineRaw.enabled,
    machineRaw.isAvailable,
    machineRaw.is_available,
    machineRaw.availableForRender,
    machineRaw.available_for_render,
    payload.enabled,
    payload.available
  ) ?? false;
  const availability = normalizeState(firstText(
    machineRaw.availability,
    machineRaw.state,
    payload.availability,
    enabled ? (hasCurrentJob ? "busy" : "available") : "disabled"
  ));
  const readiness = normalizeState(firstText(
    machineRaw.readiness,
    preflightRaw.state,
    preflightRaw.status,
    machineRaw.health,
    payload.readiness,
    "unknown"
  ));
  const receivedMachineWarnings = normalizeNotices(
    firstArray(machineRaw.warnings, machineRaw.notices, machineRaw.alerts, preflightRaw.warnings, preflightRaw.notices)
  );
  const readinessWarning = readinessWarningNotice(readiness);
  const machineStatusCode = firstText(machineRaw.statusCode, machineRaw.status_code);
  const rawMachineStatusMessage = firstText(machineRaw.statusMessage, machineRaw.status_message);
  const machineStatusMessage = machineStatusCode || rawMachineStatusMessage
    ? queueStatusMessage(
        machineStatusCode,
        rawMachineStatusMessage,
        "Esta máquina precisa de atenção antes de receber um novo trabalho."
      )
    : "";
  const statusWarning = machineStatusCode || machineStatusMessage
    ? {
        id: machineStatusCode || "machine-status",
        message: machineStatusMessage,
        tone: machineStatusCode
          ? "warning"
          : normalizeNoticeTone(firstText(machineRaw.availability, machineRaw.state, readiness)),
      }
    : null;
  const machineWarnings = uniqueNotices([
    ...receivedMachineWarnings,
    ...(readinessWarning ? [readinessWarning] : []),
    ...(statusWarning ? [statusWarning] : []),
  ]);
  const localMachineId = firstText(machineRaw.id, machineRaw.deviceId, machineRaw.device_id);
  const jobsPayload = firstObject(payload.jobs, payload.jobLists, payload.job_lists);

  return {
    thisMachine: {
      id: localMachineId,
      name: machineDisplayName(firstText(
        machineRaw.memberName,
        machineRaw.member_name,
        machineRaw.userName,
        machineRaw.user_name,
        machineRaw.ownerName,
        machineRaw.owner_name
      ), "Esta máquina"),
      enabled,
      availability,
      readiness,
      currentJob: hasCurrentJob ? normalizeJob(currentJobRaw, "received") : null,
      warnings: machineWarnings,
    },
    machines: firstArray(
      payload.machines,
      payload.workers,
      payload.availableWorkers,
      payload.available_workers,
      payload.availableMachines,
      payload.available_machines,
      payload.eligibleWorkers,
      payload.eligible_workers,
      payload.targetMachines,
      payload.target_machines
    ).map(normalizeMachine).filter((machine) => machine.id && machine.id !== localMachineId),
    sentJobs: firstArray(
      payload.sentJobs,
      payload.sent_jobs,
      payload.outgoing,
      payload.requestedJobs,
      payload.requested_jobs,
      payload.jobsSent,
      payload.jobs_sent,
      jobsPayload.sent,
      jobsPayload.outgoing,
      payload.sent
    ).map((job) => normalizeJob(job, "sent")).filter((job) => job.id),
    receivedJobs: firstArray(
      payload.receivedJobs,
      payload.received_jobs,
      payload.incoming,
      payload.assignedJobs,
      payload.assigned_jobs,
      payload.jobsReceived,
      payload.jobs_received,
      jobsPayload.received,
      jobsPayload.incoming,
      payload.received
    ).map((job) => normalizeJob(job, "received")).filter((job) => job.id),
    notices: normalizeNotices(firstArray(payload.notices, payload.alerts, payload.warnings, payload.messages)),
    prefill: normalizePrefill(firstObject(
      payload.prefill,
      payload.draft,
      payload.selection,
      payload.openRequest,
      payload.open_request,
      payload
    )),
  };
}

function normalizeMachine(rawMachine) {
  const machine = rawMachine && typeof rawMachine === "object" ? rawMachine : {};
  const availability = normalizeState(firstText(
    machine.availability,
    machine.state,
    machine.status,
    firstBoolean(machine.busy, machine.isBusy, machine.is_busy) ? "busy" : "",
    "disabled"
  ));
  const explicitAccepting = firstBoolean(
    machine.accepting,
    machine.acceptingJobs,
    machine.accepting_jobs,
    machine.acceptsJobs,
    machine.accepts_jobs,
    machine.canReceive,
    machine.can_receive,
    machine.enabled
  );
  const statusCode = firstText(machine.statusCode, machine.status_code);
  const rawStatusMessage = firstText(machine.statusMessage, machine.status_message);
  const message = statusCode || rawStatusMessage
    ? queueStatusMessage(
        statusCode,
        rawStatusMessage,
        "Esta máquina precisa de atenção antes de receber um novo trabalho."
      )
    : "";
  return {
    id: firstText(machine.id, machine.deviceId, machine.device_id, machine.workerDeviceId, machine.worker_device_id),
    name: machineDisplayName(firstText(
      machine.memberName,
      machine.member_name,
      machine.userName,
      machine.user_name,
      machine.ownerName,
      machine.owner_name
    ), "Outra máquina"),
    availability,
    accepting: explicitAccepting ?? ["available", "busy"].includes(availability),
    statusCode,
    message,
    queueLength: clampInteger(firstNumber(
      machine.queueDepth,
      machine.queue_depth,
      machine.queueLength,
      machine.queue_length,
      machine.queuedJobs,
      machine.queued_jobs,
      machine.queueCount,
      machine.queue_count,
      machine.queuedCount,
      machine.queued_count,
      0
    ), 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeJob(rawJob, direction) {
  const job = rawJob && typeof rawJob === "object" ? rawJob : {};
  const manifest = firstObject(job.manifest, job.renderManifest, job.render_manifest);
  const baseStatus = normalizeState(firstText(job.status, job.state, job.outcome, "queued"));
  const stage = normalizeState(firstText(job.stage));
  const cancelRequested = firstBoolean(job.cancelRequested, job.cancel_requested) ?? false;
  const hasOutputConflict = firstBoolean(job.outputConflict, job.output_conflict) ?? false;
  const status = TERMINAL_JOB_STATES.has(baseStatus)
    ? baseStatus
    : cancelRequested
      ? "cancelling"
    : hasOutputConflict
      ? "conflict"
      : stage && stage !== "unknown" && stage !== "ready"
      ? stage
      : baseStatus;
  const publicMessage = firstText(
    job.publicMessage,
    job.public_message,
    job.displayMessage,
    job.display_message,
    job.userMessage,
    job.user_message,
    job.statusMessage,
    job.status_message
  );
  const statusCode = firstText(
    job.lastErrorCode,
    job.last_error_code,
    job.statusCode,
    job.status_code,
    job.outputConflictCode,
    job.output_conflict_code,
    hasOutputConflict ? "output_conflict" : ""
  );
  const title = firstText(
    job.title,
    job.projectName,
    job.project_name,
    projectCodesLabel(job),
    "Projeto sem nome"
  );
  const active = ACTIVE_JOB_STATES.has(status) && !TERMINAL_JOB_STATES.has(status);
  const relatedMemberName = direction === "sent"
    ? firstText(
        job.targetMemberLabel,
        job.target_member_label,
        job.targetMemberName,
        job.target_member_name,
        job.workerMemberName,
        job.worker_member_name
      )
    : firstText(
        job.requesterLabel,
        job.requester_label,
        job.requesterMemberName,
        job.requester_member_name,
        job.requestedByName,
        job.requested_by_name
      );
  const formats = [...new Set(firstNonEmptyArray(
    job.outputs,
    manifest.outputs,
    job.resultOutputs,
    job.result_outputs
  ).map(outputDisplayName).filter(Boolean))];
  const timestamps = firstObject(job.timestamps, job.times, job.timing);
  return {
    id: firstText(job.id, job.jobId, job.job_id),
    title,
    status,
    progress: normalizeProgress(firstNumber(job.progress, job.progressPercent, job.progress_percent)),
    position: clampInteger(firstNumber(job.position, job.queuePosition, job.queue_position, 0), 0, Number.MAX_SAFE_INTEGER),
    message: publicMessage || statusCode
      ? queueStatusMessage(statusCode, publicMessage, "Há um aviso sobre esta renderização.")
      : "",
    machineLabel: direction === "sent"
      ? machineDisplayName(relatedMemberName, "Outra máquina")
      : relatedMemberName ? `Solicitado por ${relatedMemberName}` : "Solicitado por outro usuário",
    jobaoCod: firstText(job.jobaoCod, job.jobao_cod, job.jobao, manifest.jobaoCod, manifest.jobao_cod),
    jobinhoCod: firstText(job.jobinhoCod, job.jobinho_cod, job.jobinho, manifest.jobinhoCod, manifest.jobinho_cod),
    region: firstText(
      job.projectRegion,
      job.project_region,
      job.region,
      job.regiao,
      job.praca,
      manifest.projectRegion,
      manifest.project_region,
      manifest.region,
      manifest.regiao,
      manifest.praca
    ),
    formats,
    direction,
    createdAt: firstText(job.createdAt, job.created_at, timestamps.createdAt, timestamps.created_at),
    updatedAt: firstText(job.updatedAt, job.updated_at, timestamps.updatedAt, timestamps.updated_at),
    claimedAt: firstText(job.claimedAt, job.claimed_at, timestamps.claimedAt, timestamps.claimed_at),
    startedAt: firstText(job.startedAt, job.started_at, timestamps.startedAt, timestamps.started_at),
    finishedAt: firstText(job.finishedAt, job.finished_at, timestamps.finishedAt, timestamps.finished_at),
    cancelledAt: firstText(job.cancelledAt, job.cancelled_at, timestamps.cancelledAt, timestamps.cancelled_at),
    targetDeviceId: firstText(job.targetDeviceId, job.target_device_id, job.workerDeviceId, job.worker_device_id),
    canCancel: !cancelRequested && (firstBoolean(job.canCancel, job.can_cancel) ?? active),
    canReassign: firstBoolean(job.canReassign, job.can_reassign) ?? (
      direction === "sent"
      && ["waiting_for_worker", "waiting_for_sync", "queued", "retry_wait", "conflict"].includes(status)
    ),
  };
}

function uniqueJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    if (!job?.id || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

function normalizeProjectCandidates(rawCandidates) {
  const payload = objectPayload(rawCandidates);
  const sharedExistingOutputs = normalizeExistingOutputs(payload);
  const list = Array.isArray(rawCandidates)
    ? rawCandidates
    : firstArray(rawCandidates?.data, payload.candidates, payload.projectCandidates, payload.project_candidates, payload.projects, payload.items);
  return list.map((rawCandidate) => {
    if (typeof rawCandidate === "string") {
      return {
        relativePath: rawCandidate,
        name: fileNameFromPath(rawCandidate),
        region: "",
        existingOutputs: sharedExistingOutputs,
      };
    }
    const candidate = rawCandidate && typeof rawCandidate === "object" ? rawCandidate : {};
    const relativePath = firstText(
      candidate.relativePath,
      candidate.relative_path,
      candidate.projectRelativePath,
      candidate.project_relative_path,
      candidate.path
    );
    return {
      relativePath,
      name: firstText(candidate.name, candidate.fileName, candidate.file_name, candidate.projectName, candidate.project_name, fileNameFromPath(relativePath)),
      region: firstText(candidate.projectRegion, candidate.project_region, candidate.region, candidate.regiao, candidate.praca),
      existingOutputs: normalizeExistingOutputs(candidate).length
        ? normalizeExistingOutputs(candidate)
        : sharedExistingOutputs,
    };
  }).filter((candidate) => candidate.relativePath);
}

function normalizeExistingOutputs(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const values = firstArray(
      source.existingOutputs,
      source.existing_outputs,
      source.conflictingOutputs,
      source.conflicting_outputs,
      source.outputsToReplace,
      source.outputs_to_replace,
      source.conflicts
    );
    if (values.length) {
      return [...new Set(values.map(outputDisplayName).filter(Boolean))];
    }
    if (source.outputsExist === true || source.outputs_exist === true || source.hasExistingOutputs === true || source.has_existing_outputs === true) {
      return ["MOV e/ou MP4"];
    }
  }
  return [];
}

function normalizeNotices(rawNotices) {
  return rawNotices.map((notice, index) => {
    if (typeof notice === "string") {
      return {
        id: `notice-${index}`,
        message: safePublicText(notice, "Há um aviso sobre esta máquina."),
        tone: "info",
      };
    }
    const item = notice && typeof notice === "object" ? notice : {};
    return {
      id: firstText(item.id, item.code, `notice-${index}`),
      message: safePublicText(
        firstText(item.publicMessage, item.public_message, item.displayMessage, item.display_message, item.message, item.text),
        "Há um aviso sobre esta máquina."
      ),
      tone: normalizeNoticeTone(firstText(item.tone, item.level, item.severity, item.kind)),
    };
  }).filter((notice) => notice.message);
}

function uniqueNotices(notices) {
  const seen = new Set();
  return notices.filter((notice) => {
    if (!notice?.message) return false;
    const key = `${notice.id || ""}:${notice.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function queueStatusMessage(code, candidate, fallback = "Há um aviso sobre esta renderização.") {
  const normalizedCode = normalizeState(code);
  const mappedMessage = QUEUE_STATUS_MESSAGES[normalizedCode];
  if (mappedMessage) return mappedMessage;
  return safePublicText(candidate, fallback);
}

function safePublicText(value, fallback) {
  const text = String(value || "").trim();
  return isHumanFriendlyPublicMessage(text) ? text : fallback;
}

function normalizePrefill(rawPrefill) {
  const value = rawPrefill && typeof rawPrefill === "object" ? rawPrefill : {};
  return {
    jobaoCod: cleanCode(firstText(value.jobaoCod, value.jobao_cod, value.jobao, value.jobaoCode)),
    jobinhoCod: cleanCode(firstText(value.jobinhoCod, value.jobinho_cod, value.jobinho, value.jobinhoCode)),
  };
}

function readInitialPrefill() {
  const globalPrefill = normalizePrefill(
    window.__ARIZONA_RENDER_QUEUE_STATE__?.prefill
      || window.__ARIZONA_RENDER_QUEUE_STATE__
      || window.__ARIZONA_RENDER_QUEUE_PREFILL__
  );
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      jobaoCod: cleanCode(params.get("jobaoCod") || params.get("jobao") || globalPrefill.jobaoCod),
      jobinhoCod: cleanCode(params.get("jobinhoCod") || params.get("jobinho") || globalPrefill.jobinhoCod),
    };
  } catch {
    return globalPrefill;
  }
}

function objectPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) return raw.data;
  if (raw.queue && typeof raw.queue === "object" && !Array.isArray(raw.queue)) return raw.queue;
  return raw;
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0) || [];
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  }
  return null;
}

function normalizeState(value) {
  return String(value || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeNoticeTone(value) {
  const tone = normalizeState(value);
  if (["error", "danger", "failed", "unavailable"].includes(tone)) return "danger";
  if (["warning", "warn", "degraded"].includes(tone)) return "warning";
  if (["success", "ok", "ready", "available"].includes(tone)) return "success";
  return "info";
}

function readinessWarningNotice(readiness) {
  const message = QUEUE_STATUS_MESSAGES[readiness];
  return message ? { id: readiness, message, tone: "warning" } : null;
}

function normalizeProgress(value) {
  if (value === null || value === undefined) return null;
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return clampInteger(normalized, 0, 100);
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(Number(value))) return min;
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}

function cleanCode(value) {
  return String(value || "").trim();
}

function normalizeOutputFormats(values) {
  const requested = new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => value === "mov" || value === "mp4")
  );
  return ["mov", "mp4"].filter((format) => requested.has(format));
}

function selectedOutputLabels(values) {
  return normalizeOutputFormats(values).map((format) => format.toUpperCase());
}

function machineDisplayName(memberName, fallback) {
  const name = String(memberName || "").trim();
  if (!name || /^usuário$/i.test(name)) return fallback;
  if (/^máquina\s+(?:de|do|da)\s+/i.test(name)) return name;
  return `Máquina de ${name}`;
}

function hasActiveReceivedJobs(status) {
  return status.receivedJobs.some((job) => !TERMINAL_JOB_STATES.has(job.status));
}

function shouldKeepReceiverViewOpen(status) {
  return Boolean(status.thisMachine.enabled || hasActiveReceivedJobs(status));
}

function fileNameFromPath(value) {
  const parts = String(value || "").split(/[\\/]/);
  return parts[parts.length - 1] || "Projeto do After Effects";
}

function projectCodesLabel(job) {
  const jobao = firstText(job.jobaoCod, job.jobao_cod, job.jobao);
  const jobinho = firstText(job.jobinhoCod, job.jobinho_cod, job.jobinho);
  if (jobao && jobinho) return `${jobao} · ${jobinho}`;
  return jobinho || jobao;
}

function outputDisplayName(output) {
  if (typeof output === "string") {
    const text = output.trim();
    if (/mov/i.test(text)) return "MOV";
    if (/mp4/i.test(text)) return "MP4";
    return fileNameFromPath(text);
  }
  if (!output || typeof output !== "object") return "";
  const kind = firstText(output.kind, output.type, output.format, output.label, output.fileName, output.file_name, output.path);
  if (/mov/i.test(kind)) return "MOV";
  if (/mp4/i.test(kind)) return "MP4";
  return kind;
}

function isOverwriteConflict(response) {
  const rawText = typeof response === "string" ? response : "";
  const code = normalizeState(firstText(
    response?.code,
    response?.errorCode,
    response?.error_code,
    rawText.match(/^([a-z0-9_]+):/i)?.[1]
  ));
  return ["outputs_exist", "output_exists", "overwrite_confirmation_required", "replace_confirmation_required", "conflict"].includes(code);
}

function availabilityToggleLabel(machine) {
  if (machine.availability === "draining") return "Parando após o trabalho atual";
  if (!machine.enabled) return "Indisponível para render";
  if (["unavailable", "failed", "degraded"].includes(machine.availability)) {
    return "Disponibilidade ativada";
  }
  return "Disponível para render";
}

function machineAvailabilityMessage(machine) {
  if (machine.availability === "draining") {
    return "Concluirá o trabalho atual, mas não aceitará outros.";
  }
  if (!machine.enabled) {
    return "Ative quando quiser que esta máquina receba trabalhos. O Arizona precisa permanecer aberto.";
  }
  if (["unavailable", "failed"].includes(machine.availability)
    || ["unavailable", "failed"].includes(machine.readiness)) {
    return "Esta máquina precisa de atenção antes de começar um trabalho.";
  }
  if (machine.availability === "degraded" || machine.readiness === "degraded") {
    return "A disponibilidade está ativada, mas há um aviso que pode atrasar o trabalho.";
  }
  if (machine.currentJob || machine.availability === "busy") {
    return "Há um trabalho em andamento. Os próximos ficarão aguardando nesta máquina.";
  }
  return "Pronta para receber trabalhos enquanto o Arizona permanecer aberto.";
}

function machineQueueLabel(machine) {
  const count = machine.queueLength;
  if (machine.availability === "busy") {
    return count > 0 ? `Renderizando · ${count} aguardando` : "Renderizando · sem espera";
  }
  if (!machine.accepting) {
    if (machine.availability === "offline") return "O Arizona está fechado ou sem conexão";
    if (machine.availability === "degraded") return "Precisa de atenção";
    return "Não pode receber trabalhos agora";
  }
  return count > 0 ? `${count} ${count === 1 ? "trabalho aguardando" : "trabalhos aguardando"}` : "Disponível agora";
}

function shortStatusLabel(state) {
  const labels = {
    available: "Disponível",
    degraded: "Com aviso",
    unavailable: "Indisponível",
    busy: "Ocupada",
    draining: "Encerrando fila",
    disabled: "Indisponível",
    offline: "Desconectada",
    waiting_for_worker: "Aguardando",
    waiting_for_sync: "Sincronizando",
    queued: "Na fila",
    claimed: "Preparando",
    preparing: "Preparando",
    waiting_for_after: "Aguardando",
    rendering: "Renderizando",
    rendering_proxy: "Criando MOV",
    rendering_mov: "Criando MOV",
    rendering_mp4: "Criando MP4",
    publishing: "Finalizando",
    cancelling: "Cancelando",
    completed: "Concluído",
    cancelled: "Cancelado",
    retry_wait: "Nova tentativa",
    conflict: "Atenção",
    failed: "Não concluído",
  };
  return labels[state] || "Verificando";
}

function jobStatusLabel(job) {
  const requestedFiles = jobOutputPhrase(job);
  const completedFiles = job.formats.length === 1
    ? `${requestedFiles} concluído`
    : `${requestedFiles} concluídos`;
  const labels = {
    waiting_for_worker: "Aguardando a máquina escolhida",
    waiting_for_sync: "Aguardando o projeto chegar à outra máquina",
    queued: job.position > 0 ? `Aguardando na fila` : "Aguardando na fila",
    claimed: "A máquina está preparando o projeto",
    preparing: "Preparando o projeto",
    waiting_for_after: "Aguardando a máquina ficar pronta",
    rendering: `Criando ${requestedFiles}`,
    rendering_proxy: "Criando o arquivo MOV",
    rendering_mov: "Criando o arquivo MOV",
    rendering_mp4: "Criando o arquivo MP4",
    publishing: "Finalizando os arquivos",
    cancelling: "Interrompendo a renderização com segurança",
    completed: `${completedFiles[0].toUpperCase()}${completedFiles.slice(1)}`,
    cancelled: "Renderização cancelada",
    retry_wait: "Aguardando para tentar novamente nesta máquina",
    conflict: "Cancele e envie novamente para confirmar a substituição",
    failed: "Não foi possível concluir",
  };
  return labels[job.status] || "Atualizando a situação";
}

function jobOutputPhrase(job) {
  const formats = Array.isArray(job.formats) && job.formats.length > 0
    ? job.formats
    : ["MOV", "MP4"];
  if (formats.length === 1) return `o arquivo ${formats[0]}`;
  return `os arquivos ${formats.join(" e ")}`;
}

function statusTone(state) {
  if (["available", "completed"].includes(state)) return "success";
  if (["failed", "conflict"].includes(state)) return "danger";
  if (["unavailable"].includes(state)) return "danger";
  if (["busy", "rendering", "rendering_proxy", "rendering_mov", "rendering_mp4", "publishing", "claimed", "preparing"].includes(state)) return "active";
  if (["draining", "degraded", "waiting_for_after", "retry_wait", "cancelling"].includes(state)) return "warning";
  if (["cancelled", "disabled", "offline"].includes(state)) return "muted";
  return "waiting";
}

function isProgressState(state) {
  return ["claimed", "preparing", "rendering", "rendering_proxy", "rendering_mov", "rendering_mp4", "publishing"].includes(state);
}

function createSubmissionId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateSubmissionAttempt(signature, inMemoryAttempt) {
  const now = Date.now();
  if (
    inMemoryAttempt?.signature === signature
    && now - Number(inMemoryAttempt.createdAt) < SUBMISSION_ATTEMPT_TTL_MS
  ) {
    return inMemoryAttempt;
  }
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(SUBMISSION_ATTEMPT_STORAGE_KEY) || "null");
    if (
      stored?.signature === signature
      && typeof stored.id === "string"
      && now - Number(stored.createdAt) < SUBMISSION_ATTEMPT_TTL_MS
    ) {
      return stored;
    }
  } catch {
    // A fila continua segura dentro desta tentativa mesmo sem armazenamento web.
  }
  const attempt = { id: createSubmissionId(), signature, createdAt: now };
  try {
    globalThis.localStorage?.setItem(SUBMISSION_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // A referência em memória preserva a chave durante esta abertura da janela.
  }
  return attempt;
}

function clearSubmissionAttempt(attempt) {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(SUBMISSION_ATTEMPT_STORAGE_KEY) || "null");
    if (stored?.id === attempt?.id) {
      globalThis.localStorage?.removeItem(SUBMISSION_ATTEMPT_STORAGE_KEY);
    }
  } catch {
    // Não há ação necessária: a chave expira e o backend continua idempotente.
  }
}

export function hasActiveCurrentRender(rawStatus) {
  const payload = objectPayload(rawStatus);
  const machine = firstObject(
    payload.thisMachine,
    payload.this_machine,
    payload.localMachine,
    payload.local_machine,
    payload.localWorker,
    payload.local_worker,
    payload.worker,
    payload.machine
  );
  const explicitActive = firstBoolean(
    payload.currentJobActive,
    payload.current_job_active,
    payload.hasActiveRender,
    payload.has_active_render,
    machine.currentJobActive,
    machine.current_job_active,
    machine.isRendering,
    machine.is_rendering
  );
  if (explicitActive !== null) return explicitActive;

  const status = normalizeQueueStatus(rawStatus);
  const currentJob = status.thisMachine.currentJob;
  if (!currentJob) return false;
  return !TERMINAL_JOB_STATES.has(currentJob.status);
}

export default RenderQueueWindow;
