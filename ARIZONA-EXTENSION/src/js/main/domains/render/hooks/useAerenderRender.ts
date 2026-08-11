import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicErrorMessage } from "../../../utils/errors";
import {
  createDiagnosticOperationId,
  recordDiagnosticFailure,
  recordLocalDiagnostic,
} from "../../../services/localDiagnostics";
import type {
  AerenderOutputPlan,
  PrepareAerenderRenderPlanResult,
  RenderJobState,
} from "../types";
import {
  AerenderCancelledError,
  type AerenderRunHandle,
  startAerenderJob,
} from "../services/aerenderService";
import { prepareAerenderRenderPlan } from "../services/renderPlanService";

type RenderPanelStatus =
  | "idle"
  | "preparing"
  | "running"
  | "done"
  | "error"
  | "cancelled";

interface RenderPanelState {
  status: RenderPanelStatus;
  message: string;
  projectName: string;
  projectPath: string;
  settingsLoading: boolean;
  settingsError: string;
  outputSettings: AerenderOutputPlan[];
  totalStartedAt: number | null;
  totalFinishedAt: number | null;
  prepareDurationMs: number | null;
  jobs: RenderJobState[];
}

const createInitialState = (): RenderPanelState => ({
  status: "idle",
  message: "Pronto para exportar.",
  projectName: "",
  projectPath: "",
  settingsLoading: false,
  settingsError: "",
  outputSettings: [],
  totalStartedAt: null,
  totalFinishedAt: null,
  prepareDurationMs: null,
  jobs: [],
});

const createJobs = (
  plan: PrepareAerenderRenderPlanResult
): RenderJobState[] =>
  plan.outputs.map((output) => ({
    ...output,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    outputSizeBytes: null,
    progressPercent: 0,
    currentFrame: null,
    lastLog: "",
    error: "",
  }));

const updateJob = (
  jobs: RenderJobState[],
  id: string,
  update: Partial<RenderJobState>
): RenderJobState[] =>
  jobs.map((job) => (job.id === id ? { ...job, ...update } : job));

const applyOutputSettings = (
  plan: PrepareAerenderRenderPlanResult,
  settings: AerenderOutputPlan[]
): PrepareAerenderRenderPlanResult => ({
  ...plan,
  outputs: plan.outputs.map((output) => {
    const saved = settings.find((item) => item.id === output.id);
    return saved ? { ...output, outputPath: saved.outputPath } : output;
  }),
});

export const useAerenderRender = () => {
  const [state, setState] = useState<RenderPanelState>(createInitialState);
  const [now, setNow] = useState(() => Date.now());
  const currentRunRef = useRef<AerenderRunHandle | null>(null);
  const cancelRequestedRef = useRef(false);
  const operationIdRef = useRef("");

  const isBusy = state.status === "preparing" || state.status === "running";

  useEffect(() => {
    if (!isBusy) return;

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isBusy]);

  const loadRenderPlan = useCallback(async () => {
    setState((current) => ({
      ...current,
      settingsLoading: true,
      settingsError: "",
      message: "Preparando as opções de saída...",
    }));

    try {
      const plan = await prepareAerenderRenderPlan(false);

      if (!plan.ok) {
        throw new Error(plan.message || "Nao foi possivel carregar o render.");
      }

      setState((current) => ({
        ...current,
        settingsLoading: false,
        message: "Pronto para exportar.",
        projectName: plan.projectName,
        projectPath: plan.projectPath,
        outputSettings: plan.outputs,
      }));
    } catch (caught) {
      const message = getPublicErrorMessage(
        caught,
        "Não foi possível preparar as opções de render deste projeto.",
      );
      recordDiagnosticFailure(
        "render",
        "carregar_plano",
        "Não foi possível carregar as configurações de render do projeto.",
        caught,
        { code: "render_plan_load_failed", runtime: "extendscript" }
      );
      setState((current) => ({
        ...current,
        settingsLoading: false,
        settingsError: message,
        message,
      }));
    }
  }, []);

  useEffect(() => {
    void loadRenderPlan();
  }, [loadRenderPlan]);

  const setOutputPath = useCallback((id: string, outputPath: string) => {
    setState((current) => ({
      ...current,
      outputSettings: current.outputSettings.map((output) =>
        output.id === id ? { ...output, outputPath } : output
      ),
    }));
  }, []);

  const cancelRender = useCallback(() => {
    cancelRequestedRef.current = true;
    currentRunRef.current?.cancel();
    recordLocalDiagnostic({
      component: "render",
      action: "cancelar",
      status: "requested",
      operationId: operationIdRef.current || undefined,
      message: "O usuário pediu para cancelar a exportação.",
    });
    setState((current) => ({
      ...current,
      message: "Cancelando render...",
    }));
  }, []);

  const startRender = useCallback(async () => {
    const totalStartedAt = Date.now();
    const operationId = createDiagnosticOperationId("aerender");
    operationIdRef.current = operationId;
    cancelRequestedRef.current = false;
    currentRunRef.current = null;
    recordLocalDiagnostic({
      component: "render",
      action: "exportar",
      status: "started",
      operationId,
      message: "Renderização dos arquivos iniciada.",
      details: { outputCount: state.outputSettings.length },
    });

    setState((current) => ({
      ...current,
      status: "preparing",
      message: "Preparando projeto...",
      totalStartedAt,
      totalFinishedAt: null,
      prepareDurationMs: null,
      jobs: [],
    }));

    try {
      const prepareStartedAt = Date.now();
      const preparedPlan = await prepareAerenderRenderPlan(true);
      const prepareDurationMs = Date.now() - prepareStartedAt;

      if (!preparedPlan.ok) {
        throw new Error(
          preparedPlan.message || "Nao foi possivel preparar o render."
        );
      }

      recordLocalDiagnostic({
        component: "render",
        action: "preparar_plano",
        status: "completed",
        runtime: "extendscript",
        operationId,
        message: "Projeto salvo e plano de render preparado.",
        details: {
          durationMs: prepareDurationMs,
          outputCount: preparedPlan.outputs.length,
        },
      });

      const plan = applyOutputSettings(preparedPlan, state.outputSettings);

      if (cancelRequestedRef.current) {
        setState((current) => ({
          ...current,
          status: "cancelled",
          message: "Render cancelado.",
          totalFinishedAt: Date.now(),
          prepareDurationMs,
        }));
        recordLocalDiagnostic({
          component: "render",
          action: "exportar",
          status: "cancelled",
          operationId,
          message: "Render cancelado antes de iniciar os arquivos.",
          details: { durationMs: Date.now() - totalStartedAt },
        });
        return;
      }

      setState((current) => ({
        ...current,
        status: "running",
        message: "Exportando...",
        projectName: plan.projectName,
        projectPath: plan.projectPath,
        outputSettings: plan.outputs,
        prepareDurationMs,
        jobs: createJobs(plan),
      }));

      for (const output of plan.outputs) {
        if (cancelRequestedRef.current) {
          break;
        }

        const jobStartedAt = Date.now();
        recordLocalDiagnostic({
          component: "render",
          action: "renderizar_saida",
          status: "started",
          operationId,
          message: "Render de uma saída iniciado.",
          details: { outputId: output.id },
        });
        setState((current) => ({
          ...current,
          jobs: updateJob(current.jobs, output.id, {
            status: "running",
            startedAt: jobStartedAt,
            finishedAt: null,
            durationMs: null,
            progressPercent: 0,
            currentFrame: null,
            error: "",
            lastLog: "",
          }),
        }));

        try {
          const handle = startAerenderJob({
            aerenderPath: plan.aerenderPath,
            projectPath: plan.projectPath,
            output,
            onProgress: ({ lastLog, progressPercent, currentFrame }) => {
              setState((current) => ({
                ...current,
                jobs: updateJob(
                  current.jobs,
                  output.id,
                  progressPercent === null
                    ? { lastLog, currentFrame }
                    : { lastLog, progressPercent, currentFrame }
                ),
              }));
            },
          });

          currentRunRef.current = handle;
          const result = await handle.promise;
          currentRunRef.current = null;

          setState((current) => ({
            ...current,
            jobs: updateJob(current.jobs, output.id, {
              status: "done",
              finishedAt: Date.now(),
              durationMs: result.durationMs,
              exitCode: result.exitCode,
              outputSizeBytes: result.outputSizeBytes,
              progressPercent: result.progressPercent,
              currentFrame: result.currentFrame,
              lastLog: result.lastLog,
            }),
          }));
          recordLocalDiagnostic({
            component: "render",
            action: "renderizar_saida",
            status: "completed",
            operationId,
            message: "Uma saída foi renderizada e validada.",
            details: {
              outputId: output.id,
              durationMs: result.durationMs,
              outputSizeBytes: result.outputSizeBytes,
              exitCode: result.exitCode,
            },
          });
        } catch (caught) {
          currentRunRef.current = null;

          if (caught instanceof AerenderCancelledError) {
            setState((current) => ({
              ...current,
              jobs: updateJob(current.jobs, output.id, {
                status: "cancelled",
                finishedAt: Date.now(),
                durationMs: Date.now() - jobStartedAt,
              }),
            }));
            recordLocalDiagnostic({
              component: "render",
              action: "renderizar_saida",
              status: "cancelled",
              operationId,
              message: "O render da saída atual foi cancelado.",
              details: {
                outputId: output.id,
                durationMs: Date.now() - jobStartedAt,
              },
            });
            throw caught;
          }

          const message = getPublicErrorMessage(
            caught,
            `Não foi possível gerar ${output.label}.`,
          );
          setState((current) => ({
            ...current,
            jobs: updateJob(current.jobs, output.id, {
              status: "error",
              finishedAt: Date.now(),
              durationMs: Date.now() - jobStartedAt,
              error: message,
            }),
          }));
          recordDiagnosticFailure(
            "render",
            "renderizar_saida",
            "O Arizona não conseguiu concluir uma das saídas.",
            caught,
            {
              code: "aerender_output_failed",
              operationId,
              details: {
                outputId: output.id,
                durationMs: Date.now() - jobStartedAt,
              },
            }
          );
          throw caught;
        }
      }

      if (cancelRequestedRef.current) {
        setState((current) => ({
          ...current,
          status: "cancelled",
          message: "Render cancelado.",
          totalFinishedAt: Date.now(),
          jobs: current.jobs.map((job) =>
            job.status === "pending" ? { ...job, status: "cancelled" } : job
          ),
        }));
        recordLocalDiagnostic({
          component: "render",
          action: "exportar",
          status: "cancelled",
          operationId,
          message: "A exportação foi cancelada pelo usuário.",
          details: { durationMs: Date.now() - totalStartedAt },
        });
        return;
      }

      setState((current) => ({
        ...current,
        status: "done",
        message: "Render concluido.",
        totalFinishedAt: Date.now(),
      }));
      recordLocalDiagnostic({
        component: "render",
        action: "exportar",
        status: "completed",
        operationId,
        message: "Todas as saídas foram renderizadas.",
        details: {
          durationMs: Date.now() - totalStartedAt,
          outputCount: plan.outputs.length,
        },
      });
    } catch (caught) {
      const wasCancelled =
        caught instanceof AerenderCancelledError || cancelRequestedRef.current;

      setState((current) => ({
        ...current,
        status: wasCancelled ? "cancelled" : "error",
        message: wasCancelled
          ? "Render cancelado."
          : getPublicErrorMessage(
              caught,
              "Não foi possível concluir a exportação dos arquivos.",
            ),
        totalFinishedAt: Date.now(),
      }));
      if (wasCancelled) {
        recordLocalDiagnostic({
          component: "render",
          action: "exportar",
          status: "cancelled",
          operationId,
          message: "A exportação foi cancelada pelo usuário.",
          details: { durationMs: Date.now() - totalStartedAt },
        });
      } else {
        recordDiagnosticFailure(
          "render",
          "exportar",
          "A exportação dos arquivos foi interrompida antes de terminar.",
          caught,
          {
            code: "aerender_flow_failed",
            operationId,
            details: { durationMs: Date.now() - totalStartedAt },
          }
        );
      }
    } finally {
      operationIdRef.current = "";
    }
  }, [state.outputSettings]);

  return {
    ...state,
    now,
    isBusy,
    loadRenderPlan,
    setOutputPath,
    startRender,
    cancelRender,
  };
};
