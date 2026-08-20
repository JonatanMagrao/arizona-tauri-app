export const RENDER_RECIPE = "arizona-render-v1" as const;
export const RENDER_PROTOCOL_VERSION = 1 as const;

export const WORKER_AVAILABILITIES = ["available", "degraded", "unavailable"] as const;
export type WorkerAvailability = typeof WORKER_AVAILABILITIES[number];

export const WORKER_STATUS_CODES = [
  "after_effects_open",
  "drive_unavailable",
  "recipe_unavailable",
  "aerender_unavailable",
  "project_not_synced",
  "project_hash_mismatch",
  "output_conflict",
  "publication_recovery_pending",
] as const;
export type WorkerStatusCode = typeof WORKER_STATUS_CODES[number];

export const PRECLAIM_STAGES = ["waiting_for_worker", "waiting_for_sync", "ready"] as const;
export const ACTIVE_STAGES = [
  "preparing",
  "rendering_proxy",
  "rendering_mp4",
  "publishing",
] as const;
export const RENDER_STAGES = [...PRECLAIM_STAGES, ...ACTIVE_STAGES] as const;
export type RenderStage = typeof RENDER_STAGES[number];

export const FINISH_OUTCOMES = ["completed", "failed", "cancelled"] as const;
export type FinishOutcome = typeof FINISH_OUTCOMES[number];

export const RENDER_ERROR_CODES = [
  "after_effects_open",
  "drive_unavailable",
  "project_not_synced",
  "project_missing",
  "project_hash_mismatch",
  "sync_timeout",
  "recipe_unavailable",
  "aerender_unavailable",
  "aerender_failed",
  "output_conflict",
  "output_missing",
  "cancelled_by_requester",
  "cancelled_by_worker",
  "lease_lost",
  "machine_unavailable",
  "unexpected_failure",
] as const;
export type RenderErrorCode = typeof RENDER_ERROR_CODES[number];

export type RenderOutput = {
  kind: "mov" | "mp4";
  comp: "EXPORT" | "EXPORT_MP4";
  template: "PROXY" | "MP4";
  destinationRelativePath: string;
  replaceExisting: boolean;
  existingFingerprint?: string;
};

export type RenderResultOutput = {
  kind: "mov" | "mp4";
  destinationRelativePath: string;
  sizeBytes: number;
  sha256: string;
};

export class RenderContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RenderContractError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], code: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new RenderContractError(code);
  }
}

function cleanSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/u.test(cleaned)) return "";
  return cleaned;
}

export function requiredText(value: unknown, maxLength: number, code: string): string {
  const cleaned = cleanSingleLine(value, maxLength);
  if (!cleaned) throw new RenderContractError(code);
  return cleaned;
}

export function optionalText(value: unknown, maxLength: number, code: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = cleanSingleLine(value, maxLength);
  if (!cleaned) throw new RenderContractError(code);
  return cleaned;
}

export function renderHistoryCursorTimestamp(value: unknown, code: string): string {
  const cleaned = requiredText(value, 64, code);
  const match = /^([2-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(cleaned);
  if (!match || !Number.isFinite(Date.parse(cleaned))) throw new RenderContractError(code);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) throw new RenderContractError(code);
  return cleaned;
}

export function uuidValue(value: unknown, code: string): string {
  const cleaned = requiredText(value, 36, code).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(cleaned)) {
    throw new RenderContractError(code);
  }
  return cleaned;
}

export function optionalUuid(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return uuidValue(value, code);
}

export function sha256Value(value: unknown, code: string): string {
  const cleaned = requiredText(value, 64, code).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(cleaned)) throw new RenderContractError(code);
  return cleaned;
}

export function positiveSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RenderContractError(code);
  }
  return value;
}

export function optionalPositiveSafeInteger(value: unknown, code: string): number | null {
  if (value === undefined || value === null) return null;
  return positiveSafeInteger(value, code);
}

export function progressValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new RenderContractError("invalid_progress_percent");
  }
  return value;
}

export function relativePath(value: unknown, extension: ".aep" | ".mov" | ".mp4", code: string): string {
  const raw = requiredText(value, 1024, code).replaceAll("\\", "/");
  if (
    raw.startsWith("/")
    || /^[a-z]:/iu.test(raw)
    || /[:*?"<>|]/u.test(raw)
    || raw.includes("//")
    || raw.split("/").some((part) => (
      !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ")
    ))
    || !raw.toLowerCase().endsWith(extension)
  ) {
    throw new RenderContractError(code);
  }
  return raw;
}

export function recipeValue(value: unknown): typeof RENDER_RECIPE {
  if (value !== RENDER_RECIPE) throw new RenderContractError("unsupported_render_recipe");
  return RENDER_RECIPE;
}

export function workerAvailabilityValue(
  value: unknown,
  fallback: WorkerAvailability,
): WorkerAvailability {
  if (value === undefined || value === null || value === "") return fallback;
  if (!WORKER_AVAILABILITIES.includes(value as WorkerAvailability)) {
    throw new RenderContractError("invalid_worker_availability");
  }
  return value as WorkerAvailability;
}

export function workerStatusCodeValue(value: unknown): WorkerStatusCode | null {
  if (value === undefined || value === null || value === "") return null;
  if (!WORKER_STATUS_CODES.includes(value as WorkerStatusCode)) {
    throw new RenderContractError("invalid_worker_status_code");
  }
  return value as WorkerStatusCode;
}

export function statusMessageValue(value: unknown): string | null {
  return optionalText(value, 240, "invalid_status_message");
}

export function stageValue(value: unknown): RenderStage {
  if (!RENDER_STAGES.includes(value as RenderStage)) {
    throw new RenderContractError("invalid_render_stage");
  }
  return value as RenderStage;
}

export function finishOutcomeValue(value: unknown): FinishOutcome {
  if (!FINISH_OUTCOMES.includes(value as FinishOutcome)) {
    throw new RenderContractError("invalid_finish_outcome");
  }
  return value as FinishOutcome;
}

export function renderErrorCodeValue(value: unknown, required: boolean): RenderErrorCode | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new RenderContractError("missing_render_error_code");
    return null;
  }
  if (!RENDER_ERROR_CODES.includes(value as RenderErrorCode)) {
    throw new RenderContractError("invalid_render_error_code");
  }
  return value as RenderErrorCode;
}

export function renderOutputsValue(value: unknown): RenderOutput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new RenderContractError("invalid_render_outputs");
  }

  const parsed = value.map((item): RenderOutput => {
    if (!isRecord(item)) throw new RenderContractError("invalid_render_outputs");
    assertOnlyKeys(
      item,
      ["kind", "comp", "template", "destinationRelativePath", "replaceExisting", "existingFingerprint"],
      "invalid_render_outputs",
    );
    if (item.kind !== "mov" && item.kind !== "mp4") {
      throw new RenderContractError("invalid_render_outputs");
    }
    if (typeof item.replaceExisting !== "boolean") {
      throw new RenderContractError("invalid_render_outputs");
    }
    const expected = item.kind === "mov"
      ? { comp: "EXPORT" as const, template: "PROXY" as const, extension: ".mov" as const }
      : { comp: "EXPORT_MP4" as const, template: "MP4" as const, extension: ".mp4" as const };
    if (item.comp !== expected.comp || item.template !== expected.template) {
      throw new RenderContractError("invalid_render_outputs");
    }
    const existingFingerprint = optionalText(
      item.existingFingerprint,
      256,
      "invalid_render_outputs",
    );
    return {
      kind: item.kind,
      comp: expected.comp,
      template: expected.template,
      destinationRelativePath: relativePath(
        item.destinationRelativePath,
        expected.extension,
        "invalid_render_outputs",
      ),
      replaceExisting: item.replaceExisting,
      ...(existingFingerprint ? { existingFingerprint } : {}),
    };
  });

  if (new Set(parsed.map((item) => item.kind)).size !== parsed.length) {
    throw new RenderContractError("invalid_render_outputs");
  }
  if (new Set(parsed.map((item) => item.destinationRelativePath.toLowerCase())).size !== parsed.length) {
    throw new RenderContractError("invalid_render_outputs");
  }
  return parsed.sort((left) => left.kind === "mov" ? -1 : 1);
}

export function renderResultOutputsValue(value: unknown): RenderResultOutput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new RenderContractError("invalid_result_outputs");
  }
  const parsed = value.map((item): RenderResultOutput => {
    if (!isRecord(item)) throw new RenderContractError("invalid_result_outputs");
    assertOnlyKeys(
      item,
      ["kind", "destinationRelativePath", "sizeBytes", "sha256"],
      "invalid_result_outputs",
    );
    if (item.kind !== "mov" && item.kind !== "mp4") {
      throw new RenderContractError("invalid_result_outputs");
    }
    return {
      kind: item.kind,
      destinationRelativePath: relativePath(
        item.destinationRelativePath,
        item.kind === "mov" ? ".mov" : ".mp4",
        "invalid_result_outputs",
      ),
      sizeBytes: positiveSafeInteger(item.sizeBytes, "invalid_result_outputs"),
      sha256: sha256Value(item.sha256, "invalid_result_outputs"),
    };
  });
  if (new Set(parsed.map((item) => item.kind)).size !== parsed.length) {
    throw new RenderContractError("invalid_result_outputs");
  }
  if (new Set(parsed.map((item) => item.destinationRelativePath.toLowerCase())).size !== parsed.length) {
    throw new RenderContractError("invalid_result_outputs");
  }
  return parsed.sort((left) => left.kind === "mov" ? -1 : 1);
}
