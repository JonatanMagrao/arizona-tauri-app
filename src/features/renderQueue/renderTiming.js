const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function renderFinishedMillis(job) {
  return timestampMillis(
    job?.finishedAt
      ?? job?.timestamps?.finishedAt
      ?? job?.cancelledAt
      ?? job?.timestamps?.cancelledAt
  );
}

export function timestampMillis(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatRenderDuration(durationMillis) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMillis || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}min`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function renderExecutionTiming(job, nowMillis = Date.now()) {
  const startedAt = timestampMillis(job?.startedAt ?? job?.timestamps?.startedAt);
  if (startedAt === null) return null;

  const finishedAt = renderFinishedMillis(job);
  const status = String(job?.status || "").trim().toLowerCase();
  if (finishedAt === null && TERMINAL_STATES.has(status)) return null;
  const live = finishedAt === null && !TERMINAL_STATES.has(status);
  const endAt = finishedAt ?? Number(nowMillis);

  return {
    startedAt,
    finishedAt,
    live,
    durationMillis: Math.max(0, endAt - startedAt),
  };
}

export function renderQueueWaitMillis(job, nowMillis = Date.now()) {
  const createdAt = timestampMillis(job?.createdAt ?? job?.timestamps?.createdAt);
  if (createdAt === null) return null;
  const startedAt = timestampMillis(job?.startedAt ?? job?.timestamps?.startedAt);
  const status = String(job?.status || "").trim().toLowerCase();
  const terminalEndAt = TERMINAL_STATES.has(status) ? renderFinishedMillis(job) : null;
  if (startedAt === null && TERMINAL_STATES.has(status) && terminalEndAt === null) return null;
  const endAt = startedAt ?? terminalEndAt ?? Number(nowMillis);
  return Math.max(0, endAt - createdAt);
}

export function renderTimingLabel(job, nowMillis = Date.now()) {
  const timing = renderExecutionTiming(job, nowMillis);
  const status = String(job?.status || "").trim().toLowerCase();
  const startedAt = timestampMillis(job?.startedAt ?? job?.timestamps?.startedAt);

  if (!timing) {
    const waiting = renderQueueWaitMillis(job, nowMillis);
    if (status === "completed") return "Concluído; tempo de render indisponível";
    if (status === "failed") {
      if (startedAt !== null) return "Falhou; tempo final indisponível";
      return waiting === null
        ? "Falhou antes de iniciar o render"
        : `Falhou após ${formatRenderDuration(waiting)}, antes de iniciar o render`;
    }
    if (status === "cancelled") {
      if (startedAt !== null) return "Cancelado; tempo final indisponível";
      return waiting === null
        ? "Cancelado antes de iniciar o render"
        : `Cancelado após ${formatRenderDuration(waiting)}, antes de iniciar o render`;
    }
    return waiting === null ? "" : `Aguardando há ${formatRenderDuration(waiting)}`;
  }

  const duration = formatRenderDuration(timing.durationMillis);
  if (status === "completed") return `Concluído em ${duration}`;
  if (status === "failed") return `Falhou após ${duration}`;
  if (status === "cancelled") return `Cancelado após ${duration}`;
  return `Em execução há ${duration}`;
}
