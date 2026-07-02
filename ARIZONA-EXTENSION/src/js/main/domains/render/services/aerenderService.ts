import {
  child_process,
  fs,
  path as nodePath,
} from "../../../../lib/cep/node";
import type { AerenderOutputPlan } from "../types";

export class AerenderCancelledError extends Error {
  constructor() {
    super("Render cancelado.");
    this.name = "AerenderCancelledError";
  }
}

export interface AerenderJobProgress {
  lastLog: string;
  progressPercent: number | null;
  currentFrame: number | null;
}

export interface AerenderJobResult {
  exitCode: number | null;
  durationMs: number;
  outputSizeBytes: number;
  lastLog: string;
  progressPercent: number;
  currentFrame: number;
}

export interface StartAerenderJobParams {
  aerenderPath: string;
  projectPath: string;
  output: AerenderOutputPlan;
  onProgress: (progress: AerenderJobProgress) => void;
}

export interface AerenderRunHandle {
  promise: Promise<AerenderJobResult>;
  cancel: () => void;
}

const AERENDER_EXE = "aerender.exe";

const isNodeProcessAvailable = (): boolean =>
  typeof child_process.spawn === "function";

const getLogLines = (value: string): string[] =>
  value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const timecodeToFrame = (value: string, frameRate: number): number | null => {
  const match = value.match(/(\d+):(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[4]);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    Number.isNaN(frames)
  ) {
    return null;
  }

  return Math.round((hours * 3600 + minutes * 60 + seconds) * frameRate) + frames;
};

const toProgress = (
  output: AerenderOutputPlan,
  rawFrame: number,
  totalFrames = output.totalFrames
): { progressPercent: number; currentFrame: number } => {
  const safeTotalFrames = Math.max(1, totalFrames);
  const relativeFrame =
    rawFrame >= output.startFrame ? rawFrame - output.startFrame : rawFrame;
  const currentFrame = clamp(Math.floor(relativeFrame) + 1, 0, safeTotalFrames);

  return {
    progressPercent: clamp((currentFrame / safeTotalFrames) * 100, 0, 99.5),
    currentFrame,
  };
};

const parseAerenderProgress = (
  line: string,
  output: AerenderOutputPlan
): { progressPercent: number; currentFrame: number } | null => {
  const fractionMatch = line.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    const current = Number(fractionMatch[1]);
    const total = Number(fractionMatch[2]);

    if (!Number.isNaN(current) && !Number.isNaN(total) && total > 0) {
      return {
        progressPercent: clamp((current / total) * 100, 0, 99.5),
        currentFrame: clamp(current, 0, total),
      };
    }
  }

  const timecodeFrame = timecodeToFrame(line, output.frameRate);
  if (timecodeFrame !== null) {
    return toProgress(output, timecodeFrame);
  }

  const frameMatch =
    line.match(/\bframe\s+(-?\d+)\b/i) ||
    line.match(/\bPROGRESS:\s*(-?\d+)\b/i);

  if (!frameMatch) return null;

  const rawFrame = Number(frameMatch[1]);
  if (Number.isNaN(rawFrame)) return null;

  return toProgress(output, rawFrame);
};

const findAerenderInAdobeFolders = (): string => {
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((root): root is string => Boolean(root));

  for (const root of roots) {
    const adobeFolder = nodePath.join(root, "Adobe");
    if (!fs.existsSync(adobeFolder)) continue;

    const apps = fs
      .readdirSync(adobeFolder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.toLowerCase().indexOf("adobe after effects") === 0
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const appName of apps) {
      const supportFilesCandidate = nodePath.join(
        adobeFolder,
        appName,
        "Support Files",
        AERENDER_EXE
      );
      if (fs.existsSync(supportFilesCandidate)) {
        return supportFilesCandidate;
      }

      const rootCandidate = nodePath.join(adobeFolder, appName, AERENDER_EXE);
      if (fs.existsSync(rootCandidate)) {
        return rootCandidate;
      }
    }
  }

  return "";
};

const resolveAerenderPath = (fromAfterEffects: string): string => {
  if (fromAfterEffects && fs.existsSync(fromAfterEffects)) {
    return fromAfterEffects;
  }

  const fromAdobeFolders = findAerenderInAdobeFolders();
  if (fromAdobeFolders) {
    return fromAdobeFolders;
  }

  return fromAfterEffects || "aerender";
};

const buildAerenderArgs = (
  projectPath: string,
  output: AerenderOutputPlan
): string[] => {
  const args = [
    "-v",
    "ERRORS_AND_PROGRESS",
    "-project",
    projectPath,
    "-comp",
    output.compName,
  ];

  if (output.outputModuleTemplate) {
    args.push("-OMtemplate", output.outputModuleTemplate);
  }

  args.push("-output", output.outputPath);
  return args;
};

const ensureOutputFolder = (outputPath: string): void => {
  const folder = nodePath.dirname(outputPath);
  if (!folder || fs.existsSync(folder)) return;

  fs.mkdirSync(folder, { recursive: true });
};

export const startAerenderJob = ({
  aerenderPath,
  projectPath,
  output,
  onProgress,
}: StartAerenderJobParams): AerenderRunHandle => {
  if (!window.cep || !isNodeProcessAvailable()) {
    throw new Error("Acesso ao processo do sistema nao disponivel.");
  }

  const executable = resolveAerenderPath(aerenderPath);
  const args = buildAerenderArgs(projectPath, output);
  const startedAt = Date.now();
  let cancelled = false;
  let settled = false;
  let lastLog = "";
  let progressPercent = 0;
  let currentFrame: number | null = null;

  if (!output.outputPath.trim()) {
    throw new Error(`Informe o caminho de saida para ${output.label}.`);
  }

  ensureOutputFolder(output.outputPath);

  const child = child_process.spawn(executable, args, {
    windowsHide: true,
  });

  const promise = new Promise<AerenderJobResult>((resolve, reject) => {
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const appendLog = (chunk: unknown) => {
      for (const nextLine of getLogLines(String(chunk))) {
        const parsedProgress = parseAerenderProgress(nextLine, output);

        lastLog = nextLine;
        if (parsedProgress !== null) {
          progressPercent = Math.max(
            progressPercent,
            parsedProgress.progressPercent
          );
          currentFrame = parsedProgress.currentFrame;
        }

        onProgress({
          lastLog,
          progressPercent: parsedProgress === null ? null : progressPercent,
          currentFrame,
        });
      }
    };

    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);

    child.on("error", (error: Error) => {
      rejectOnce(
        new Error(
          `Nao foi possivel iniciar o aerender em "${executable}": ${error.message}`
        )
      );
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;

      if (cancelled) {
        reject(new AerenderCancelledError());
        return;
      }

      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        reject(
          new Error(
            lastLog ||
              `aerender encerrou com codigo ${code === null ? "nulo" : code}.`
          )
        );
        return;
      }

      if (!fs.existsSync(output.outputPath)) {
        reject(new Error("Render finalizou, mas o arquivo nao foi encontrado."));
        return;
      }

      const stat = fs.statSync(output.outputPath);
      if (stat.size <= 0) {
        reject(new Error("Render finalizou, mas o arquivo esta vazio."));
        return;
      }

      resolve({
        exitCode: code,
        durationMs,
        outputSizeBytes: stat.size,
        lastLog,
        progressPercent: 100,
        currentFrame: output.totalFrames,
      });
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      child.kill();
    },
  };
};
