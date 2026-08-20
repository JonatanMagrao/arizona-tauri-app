import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRenderDuration,
  renderExecutionTiming,
  renderQueueWaitMillis,
  renderTimingLabel,
  timestampMillis,
} from "./renderTiming.js";

test("formats render durations without hiding hours", () => {
  assert.equal(formatRenderDuration(0), "0s");
  assert.equal(formatRenderDuration(65_000), "1min 5s");
  assert.equal(formatRenderDuration(3_665_000), "1h 1min 5s");
});

test("measures a completed render from aerender startup to finish", () => {
  const job = {
    status: "completed",
    startedAt: "2026-08-18T12:00:00.000Z",
    finishedAt: "2026-08-18T12:08:30.000Z",
  };

  assert.deepEqual(renderExecutionTiming(job), {
    startedAt: timestampMillis(job.startedAt),
    finishedAt: timestampMillis(job.finishedAt),
    live: false,
    durationMillis: 510_000,
  });
  assert.equal(renderTimingLabel(job), "Concluído em 8min 30s");
});

test("updates live timing and keeps queue wait separate", () => {
  const job = {
    status: "rendering",
    createdAt: "2026-08-18T11:58:00.000Z",
    startedAt: "2026-08-18T12:00:00.000Z",
  };
  const now = timestampMillis("2026-08-18T12:02:05.000Z");

  assert.equal(renderExecutionTiming(job, now)?.durationMillis, 125_000);
  assert.equal(renderQueueWaitMillis(job, now), 120_000);
  assert.equal(renderTimingLabel(job, now), "Em execução há 2min 5s");
});

test("describes terminal jobs that never started aerender", () => {
  assert.equal(renderTimingLabel({ status: "failed" }), "Falhou antes de iniciar o render");
  assert.equal(renderTimingLabel({ status: "cancelled" }), "Cancelado antes de iniciar o render");
  assert.equal(
    renderTimingLabel({
      status: "failed",
      createdAt: "2026-08-18T12:00:00.000Z",
      finishedAt: "2026-08-18T12:01:05.000Z",
    }),
    "Falhou após 1min 5s, antes de iniciar o render"
  );
  assert.equal(
    renderQueueWaitMillis({
      status: "cancelled",
      createdAt: "2026-08-18T12:00:00.000Z",
      cancelledAt: "2026-08-18T12:00:30.000Z",
    }),
    30_000
  );
});

test("does not invent execution time from incomplete terminal timestamps", () => {
  assert.equal(
    renderTimingLabel({
      status: "completed",
      createdAt: "2026-08-18T12:00:00.000Z",
      finishedAt: "2026-08-18T12:05:00.000Z",
    }),
    "Concluído; tempo de render indisponível"
  );
  assert.equal(
    renderTimingLabel({
      status: "failed",
      startedAt: "2026-08-18T12:00:00.000Z",
    }),
    "Falhou; tempo final indisponível"
  );
  assert.equal(
    renderQueueWaitMillis({
      status: "cancelled",
      createdAt: "2026-08-18T12:00:00.000Z",
    }),
    null
  );
});
