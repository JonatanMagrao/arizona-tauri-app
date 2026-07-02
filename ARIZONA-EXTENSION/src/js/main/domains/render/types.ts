export type RenderJobStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export interface AerenderOutputPlan {
  id: string;
  label: string;
  compName: string;
  outputPath: string;
  outputModuleTemplate: string;
  frameRate: number;
  durationSeconds: number;
  startFrame: number;
  totalFrames: number;
}

export interface PrepareAerenderRenderPlanResult {
  ok: boolean;
  message: string;
  projectPath: string;
  projectName: string;
  aerenderPath: string;
  outputs: AerenderOutputPlan[];
}

export interface RenderJobState extends AerenderOutputPlan {
  status: RenderJobStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  outputSizeBytes: number | null;
  progressPercent: number;
  currentFrame: number | null;
  lastLog: string;
  error: string;
}
