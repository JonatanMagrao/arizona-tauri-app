const MOV_EXT = ".mov";
const MP4_EXT = ".mp4";
const MP4_TEMPLATE_NAME = "MP4";
const MOV_COMP_NAME = "EXPORT";
const MP4_COMP_NAME = "EXPORT_MP4";

export interface QueueActiveCompRenderOutputsResult {
  ok: boolean;
  message: string;
  activeCompName: string;
  mp4CompName: string;
  movPath: string;
  mp4Path: string;
  queuedItems: number;
}

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

const createResult = (
  message: string
): QueueActiveCompRenderOutputsResult => ({
  ok: false,
  message,
  activeCompName: "",
  mp4CompName: "",
  movPath: "",
  mp4Path: "",
  queuedItems: 0,
});

const createAerenderPlanResult = (
  message: string
): PrepareAerenderRenderPlanResult => ({
  ok: false,
  message,
  projectPath: "",
  projectName: "",
  aerenderPath: "",
  outputs: [],
});

interface RenderCompPair {
  movComp: CompItem;
  mp4Comp: CompItem;
}

interface RenderCompResolution {
  ok: boolean;
  message: string;
  pair: RenderCompPair | null;
}

const getAllComps = (): CompItem[] => {
  const project = app.project;
  const comps: CompItem[] = [];
  if (project === null) return comps;

  for (let i = 1; i <= project.numItems; i += 1) {
    const item = project.item(i);
    if (item instanceof CompItem) {
      comps.push(item);
    }
  }

  return comps;
};

const normalizeCompName = (name: string): string =>
  String(name).toLowerCase();

const namesMatch = (left: string, right: string): boolean =>
  normalizeCompName(left) === normalizeCompName(right);

const findCompsByName = (comps: CompItem[], name: string): CompItem[] => {
  const matches: CompItem[] = [];

  for (let i = 0; i < comps.length; i += 1) {
    if (namesMatch(comps[i].name, name)) {
      matches.push(comps[i]);
    }
  }

  return matches;
};

const createResolution = (
  ok: boolean,
  message: string,
  pair: RenderCompPair | null
): RenderCompResolution => ({
  ok,
  message,
  pair,
});

const alertResolution = (message: string): RenderCompResolution => {
  alert(message);
  return createResolution(false, message, null);
};

const resolveRenderComps = (): RenderCompResolution => {
  const comps = getAllComps();
  const duplicateMessages: string[] = [];

  const movComps = findCompsByName(comps, MOV_COMP_NAME);
  const mp4Comps = findCompsByName(comps, MP4_COMP_NAME);

  if (movComps.length > 1) {
    duplicateMessages.push(
      'Encontrei ' + movComps.length + ' precomps "' + MOV_COMP_NAME + '".'
    );
  }

  if (mp4Comps.length > 1) {
    duplicateMessages.push(
      'Encontrei ' + mp4Comps.length + ' precomps "' + MP4_COMP_NAME + '".'
    );
  }

  if (duplicateMessages.length > 0) {
    return alertResolution(
      "Render interrompido: existem precomps duplicadas no projeto.\n\n" +
        duplicateMessages.join("\n") +
        "\n\nDeixe apenas uma precomp de cada antes de renderizar."
    );
  }

  if (movComps.length === 0 || mp4Comps.length === 0) {
    return createResolution(
      false,
      'Nao encontrei as precomps "' +
        MOV_COMP_NAME +
        '" e "' +
        MP4_COMP_NAME +
        '" para render.',
      null
    );
  }

  return createResolution(true, "", {
    movComp: movComps[0],
    mp4Comp: mp4Comps[0],
  });
};

const stripExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
};

const getInitials = (fileName: string): string => {
  const firstToken = String(fileName).split("_")[0];
  return firstToken.substring(0, 3).toUpperCase();
};

const getParentFolder = (folder: Folder, levels: number): Folder => {
  let current = folder;

  for (let level = 0; level < levels; level += 1) {
    current = current.parent;
  }

  return current;
};

const ensureFolder = (folder: Folder): boolean => {
  if (folder.exists) return true;

  const parent = folder.parent;
  if (parent !== null && !parent.exists) {
    if (!ensureFolder(parent)) return false;
  }

  return folder.create() || folder.exists;
};

const getChildFolder = (folder: Folder, path: string): Folder =>
  new Folder(folder.fsName + "/" + path);

const getChildFile = (folder: Folder, fileName: string): File =>
  new File(folder.fsName + "/" + fileName);

const getOutputPlanTiming = (comp: CompItem): {
  frameRate: number;
  durationSeconds: number;
  startFrame: number;
  totalFrames: number;
} => {
  const frameRate = comp.frameRate > 0 ? comp.frameRate : 30;
  const durationSeconds =
    comp.workAreaDuration > 0 ? comp.workAreaDuration : comp.duration;
  const startSeconds = comp.workAreaDuration > 0 ? comp.workAreaStart : 0;

  return {
    frameRate,
    durationSeconds,
    startFrame: Math.max(0, Math.round(startSeconds * frameRate)),
    totalFrames: Math.max(1, Math.ceil(durationSeconds * frameRate)),
  };
};

const createAerenderOutputPlan = (
  id: string,
  label: string,
  comp: CompItem,
  outputPath: string,
  outputModuleTemplate: string
): AerenderOutputPlan => {
  const timing = getOutputPlanTiming(comp);

  return {
    id,
    label,
    compName: comp.name,
    outputPath,
    outputModuleTemplate,
    frameRate: timing.frameRate,
    durationSeconds: timing.durationSeconds,
    startFrame: timing.startFrame,
    totalFrames: timing.totalFrames,
  };
};

interface RenderTargets {
  project: Project;
  projectFile: File;
  movComp: CompItem;
  mp4Comp: CompItem;
  movFolder: Folder;
  mp4Folder: Folder;
  movFile: File;
  mp4File: File;
}

interface RenderTargetsResolution {
  ok: boolean;
  message: string;
  targets: RenderTargets | null;
}

const resolveRenderTargets = (
  missingProjectMessage: string
): RenderTargetsResolution => {
  if (app.project === null || app.project.file === null) {
    return {
      ok: false,
      message: missingProjectMessage,
      targets: null,
    };
  }

  const project = app.project;
  const projectFile = project.file;
  const resolution = resolveRenderComps();

  if (!resolution.ok || resolution.pair === null) {
    return {
      ok: false,
      message: resolution.message,
      targets: null,
    };
  }

  const outputBaseName = stripExtension(projectFile.name);
  const isClara = getInitials(projectFile.name) === "CLA";
  const baseFolder = getParentFolder(projectFile.parent, isClara ? 1 : 2);
  const movFolder = isClara
    ? getChildFolder(baseFolder, "OUT")
    : getChildFolder(baseFolder, "OUT/RENDER/MOV");
  const mp4Folder = isClara
    ? getChildFolder(baseFolder, "OUT")
    : getChildFolder(baseFolder, "OUT/RENDER/MP4");
  const movFile = getChildFile(movFolder, outputBaseName + MOV_EXT);
  const mp4File = getChildFile(mp4Folder, outputBaseName + MP4_EXT);

  return {
    ok: true,
    message: "",
    targets: {
      project,
      projectFile,
      movComp: resolution.pair.movComp,
      mp4Comp: resolution.pair.mp4Comp,
      movFolder,
      mp4Folder,
      movFile,
      mp4File,
    },
  };
};

const addAerenderCandidate = (candidates: File[], value: string): void => {
  if (!value) return;

  candidates.push(new File(value + "/aerender.exe"));

  const valueAsFile = new File(value);
  if (valueAsFile.parent !== null) {
    candidates.push(new File(valueAsFile.parent.fsName + "/aerender.exe"));
  }
};

const findAerenderPath = (): string => {
  const candidates: File[] = [];

  try {
    addAerenderCandidate(candidates, String(app.path));
  } catch (error) {}

  try {
    if (typeof Folder.appPackage !== "undefined") {
      addAerenderCandidate(candidates, Folder.appPackage.fsName);
    }
  } catch (error) {}

  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].exists) {
      return candidates[index].fsName;
    }
  }

  return candidates.length > 0 ? candidates[0].fsName : "aerender";
};

export const prepareAerenderRenderPlan = (
  saveProjectBeforeRender: boolean = true
): PrepareAerenderRenderPlanResult => {
    const resolution = resolveRenderTargets(
      "Salve o projeto do After Effects antes de exportar."
    );

    if (!resolution.ok || resolution.targets === null) {
      return createAerenderPlanResult(resolution.message);
    }

    const targets = resolution.targets;
    const result = createAerenderPlanResult("");

    result.projectPath = targets.projectFile.fsName;
    result.projectName = targets.projectFile.name;
    result.aerenderPath = findAerenderPath();

    if (saveProjectBeforeRender) {
      if (!ensureFolder(targets.movFolder) || !ensureFolder(targets.mp4Folder)) {
        result.message = "Nao foi possivel criar a pasta de render.";
        return result;
      }

      try {
        targets.project.save(targets.projectFile);
      } catch (error) {
        result.message = "Nao foi possivel salvar o projeto antes do render.";
        return result;
      }
    }

    result.ok = true;
    result.message = "Projeto pronto para exportar pelo aerender.";
    result.outputs = [
      createAerenderOutputPlan(
        "mov",
        "MOV",
        targets.movComp,
        targets.movFile.fsName,
        ""
      ),
      createAerenderOutputPlan(
        "mp4",
        "MP4",
        targets.mp4Comp,
        targets.mp4File.fsName,
        MP4_TEMPLATE_NAME
      ),
    ];

    return result;
  };

export const queueActiveCompRenderOutputs =
  (): QueueActiveCompRenderOutputsResult => {
    const resolution = resolveRenderTargets(
      "Salve o projeto do After Effects antes de enviar para render."
    );

    if (!resolution.ok || resolution.targets === null) {
      return createResult(resolution.message);
    }

    const targets = resolution.targets;
    const project = targets.project;
    const movComp = targets.movComp;
    const mp4Comp = targets.mp4Comp;
    const movFolder = targets.movFolder;
    const mp4Folder = targets.mp4Folder;
    const movFile = targets.movFile;
    const mp4File = targets.mp4File;
    const result = createResult("");

    result.activeCompName = movComp.name;
    result.mp4CompName = mp4Comp.name;
    result.movPath = movFile.fsName;
    result.mp4Path = mp4File.fsName;

    if (!ensureFolder(movFolder) || !ensureFolder(mp4Folder)) {
      result.message = "Nao foi possivel criar a pasta de render.";
      return result;
    }

    app.beginUndoGroup("Enviar render MOV/MP4");

    let movQueueItem: RenderQueueItem | null = null;
    let mp4QueueItem: RenderQueueItem | null = null;

    try {
      movQueueItem = project.renderQueue.items.add(movComp);
      movQueueItem.outputModule(1).file = movFile;

      mp4QueueItem = project.renderQueue.items.add(mp4Comp);
      mp4QueueItem.outputModule(1).applyTemplate(MP4_TEMPLATE_NAME);
      mp4QueueItem.outputModule(1).file = mp4File;

      result.ok = true;
      result.queuedItems = 2;
      result.message = "Render adicionado na fila: MOV e MP4.";
    } catch (error) {
      try {
        if (mp4QueueItem !== null) mp4QueueItem.remove();
        if (movQueueItem !== null) movQueueItem.remove();
      } catch (removeError) {}

      result.message =
        error instanceof Error
          ? error.message
          : "Nao foi possivel adicionar o render na fila.";
    } finally {
      app.endUndoGroup();
    }

    return result;
  };
