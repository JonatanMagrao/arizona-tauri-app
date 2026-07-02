import { useCallback, useEffect, useRef, useState } from "react";
import { getMessage } from "../../../utils/errors";
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
      message: "Carregando caminhos...",
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
      const message = getMessage(caught);
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
    setState((current) => ({
      ...current,
      message: "Cancelando render...",
    }));
  }, []);

  const startRender = useCallback(async () => {
    const totalStartedAt = Date.now();
    cancelRequestedRef.current = false;
    currentRunRef.current = null;

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

      const plan = applyOutputSettings(preparedPlan, state.outputSettings);

      if (cancelRequestedRef.current) {
        setState((current) => ({
          ...current,
          status: "cancelled",
          message: "Render cancelado.",
          totalFinishedAt: Date.now(),
          prepareDurationMs,
        }));
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
            throw caught;
          }

          const message = getMessage(caught);
          setState((current) => ({
            ...current,
            jobs: updateJob(current.jobs, output.id, {
              status: "error",
              finishedAt: Date.now(),
              durationMs: Date.now() - jobStartedAt,
              error: message,
            }),
          }));
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
        return;
      }

      setState((current) => ({
        ...current,
        status: "done",
        message: "Render concluido.",
        totalFinishedAt: Date.now(),
      }));
    } catch (caught) {
      const wasCancelled =
        caught instanceof AerenderCancelledError || cancelRequestedRef.current;

      setState((current) => ({
        ...current,
        status: wasCancelled ? "cancelled" : "error",
        message: wasCancelled ? "Render cancelado." : getMessage(caught),
        totalFinishedAt: Date.now(),
      }));
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
