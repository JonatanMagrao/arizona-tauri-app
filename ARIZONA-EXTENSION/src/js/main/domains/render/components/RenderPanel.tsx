import { useAerenderRender } from "../hooks/useAerenderRender";
import { chooseRenderOutputPath } from "../services/outputPathDialog";
import type {
  AerenderOutputPlan,
  RenderJobState,
  RenderJobStatus,
} from "../types";
import "./RenderPanel.scss";

const formatDuration = (ms: number | null): string => {
  if (ms === null) return "--";

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return "";

  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  return `${mb.toFixed(1)} MB`;
};

const formatProgress = (value: number): string =>
  `${Math.max(0, Math.min(100, Math.round(value)))}%`;

const statusLabel: Record<RenderJobStatus, string> = {
  pending: "Fila",
  running: "Exportando",
  done: "Concluido",
  error: "Erro",
  cancelled: "Cancelado",
};

const getJobDuration = (job: RenderJobState, now: number): number | null => {
  if (job.durationMs !== null) return job.durationMs;
  if (job.status === "running" && job.startedAt !== null) {
    return now - job.startedAt;
  }
  return null;
};

interface RenderJobRowProps {
  job: RenderJobState;
  now: number;
}

const RenderJobRow = ({ job, now }: RenderJobRowProps) => {
  const duration = getJobDuration(job, now);
  const detail = job.error || job.lastLog || job.outputPath;
  const progressPercent = job.status === "done" ? 100 : job.progressPercent;
  const frameLabel =
    job.currentFrame === null
      ? `${job.totalFrames} frames`
      : `${job.currentFrame}/${job.totalFrames}`;

  return (
    <div className={`render-panel__job render-panel__job--${job.status}`}>
      <div className="render-panel__job-main">
        <span className="render-panel__job-label">{job.label}</span>
        <span className="render-panel__job-comp" title={job.compName}>
          {job.compName}
        </span>
        <span className="render-panel__job-time">
          {formatDuration(duration)}
        </span>
        <span className="render-panel__job-status">
          {statusLabel[job.status]}
        </span>
      </div>
      <div className="render-panel__progress-row">
        <div
          className="render-panel__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
        >
          <div
            className="render-panel__progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
        </div>
        <span className="render-panel__progress-label">
          {formatProgress(progressPercent)}
        </span>
        <span className="render-panel__frame-label">{frameLabel}</span>
      </div>
      <div className="render-panel__job-detail" title={detail}>
        {detail}
      </div>
      {job.outputSizeBytes !== null ? (
        <div className="render-panel__job-size">
          {formatBytes(job.outputSizeBytes)}
        </div>
      ) : null}
    </div>
  );
};

interface RenderOutputSettingProps {
  output: AerenderOutputPlan;
  disabled: boolean;
  onChange: (id: string, outputPath: string) => void;
  onChoose: (output: AerenderOutputPlan) => void;
}

const RenderOutputSetting = ({
  output,
  disabled,
  onChange,
  onChoose,
}: RenderOutputSettingProps) => (
  <div className="render-panel__setting">
    <label className="render-panel__setting-label" htmlFor={`render-${output.id}`}>
      {output.label}
    </label>
    <input
      id={`render-${output.id}`}
      className="render-panel__path-input"
      value={output.outputPath}
      disabled={disabled}
      onChange={(event) => onChange(output.id, event.currentTarget.value)}
    />
    <button
      type="button"
      className="render-panel__choose-button"
      disabled={disabled}
      onClick={() => onChoose(output)}
      title={`Escolher saida ${output.label}`}
    >
      ...
    </button>
  </div>
);

export const RenderPanel = () => {
  const {
    status,
    message,
    projectName,
    settingsLoading,
    settingsError,
    outputSettings,
    totalStartedAt,
    totalFinishedAt,
    prepareDurationMs,
    jobs,
    now,
    isBusy,
    loadRenderPlan,
    setOutputPath,
    startRender,
    cancelRender,
  } = useAerenderRender();

  const totalDuration =
    totalStartedAt === null
      ? null
      : (totalFinishedAt ?? now) - totalStartedAt;

  const canExport = !isBusy && !settingsLoading && outputSettings.length > 0;

  const handleChoosePath = (output: AerenderOutputPlan) => {
    const selectedPath = chooseRenderOutputPath(output);
    if (selectedPath) {
      setOutputPath(output.id, selectedPath);
    }
  };

  return (
    <div className={`render-panel render-panel--${status}`}>
      <div className="render-panel__header">
        <div className="render-panel__title-group">
          <span className="render-panel__title">Render</span>
          <span className="render-panel__message">{message}</span>
        </div>
        <div className="render-panel__actions">
          {isBusy ? (
            <button
              type="button"
              className="render-panel__button render-panel__button--secondary"
              onClick={cancelRender}
            >
              Cancelar
            </button>
          ) : null}
          <button
            type="button"
            className="render-panel__button"
            onClick={() => void startRender()}
            disabled={!canExport}
          >
            Exportar
          </button>
        </div>
      </div>

      <div className="render-panel__summary">
        <div className="render-panel__metric">
          <span>Total</span>
          <strong>{formatDuration(totalDuration)}</strong>
        </div>
        <div className="render-panel__metric">
          <span>Preparacao</span>
          <strong>{formatDuration(prepareDurationMs)}</strong>
        </div>
        <div className="render-panel__project" title={projectName}>
          {projectName || "Projeto atual"}
        </div>
      </div>

      <div className="render-panel__settings">
        <div className="render-panel__settings-header">
          <span>Saida</span>
          <button
            type="button"
            className="render-panel__refresh-button"
            disabled={isBusy || settingsLoading}
            onClick={() => void loadRenderPlan()}
          >
            Padroes
          </button>
        </div>

        {settingsLoading ? (
          <div className="render-panel__settings-state">
            Carregando caminhos...
          </div>
        ) : settingsError ? (
          <div className="render-panel__settings-state render-panel__settings-state--error">
            {settingsError}
          </div>
        ) : (
          outputSettings.map((output) => (
            <RenderOutputSetting
              key={output.id}
              output={output}
              disabled={isBusy}
              onChange={setOutputPath}
              onChoose={handleChoosePath}
            />
          ))
        )}
      </div>

      <div className="render-panel__jobs">
        {jobs.length > 0 ? (
          jobs.map((job) => (
            <RenderJobRow key={job.id} job={job} now={now} />
          ))
        ) : (
          <div className="render-panel__empty">
            MOV e MP4 serao exportados em fila.
          </div>
        )}
      </div>
    </div>
  );
};
