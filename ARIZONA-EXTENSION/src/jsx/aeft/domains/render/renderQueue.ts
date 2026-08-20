const MOV_EXT = ".mov";
const MP4_EXT = ".mp4";
const MOV_TEMPLATE_NAME = "PROXY";
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
      'Encontrei ' + movComps.length + ' composições "' + MOV_COMP_NAME + '".'
    );
  }

  if (mp4Comps.length > 1) {
    duplicateMessages.push(
      'Encontrei ' + mp4Comps.length + ' composições "' + MP4_COMP_NAME + '".'
    );
  }

  if (duplicateMessages.length > 0) {
    return alertResolution(
      "Não foi possível preparar o render porque existem composições duplicadas.\n\n" +
        duplicateMessages.join("\n") +
        "\n\nDeixe apenas uma composição de cada nome e tente novamente."
    );
  }

  if (movComps.length === 0 && mp4Comps.length === 0) {
    return createResolution(
      false,
      'Não encontrei as composições "' + MOV_COMP_NAME + '" e "' +
        MP4_COMP_NAME + '" necessárias para gerar os arquivos.',
      null
    );
  }

  if (movComps.length === 0) {
    return createResolution(
      false,
      'Não encontrei a composição "' + MOV_COMP_NAME +
        '" necessária para gerar o MOV.',
      null
    );
  }

  if (mp4Comps.length === 0) {
    return createResolution(
      false,
      'Não encontrei a composição "' + MP4_COMP_NAME +
        '" necessária para gerar o MP4.',
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

const findOutputModuleTemplateName = (
  outputModule: OutputModule,
  expectedName: string
): string | null => {
  const templates = outputModule.templates;
  const normalizedExpectedName = String(expectedName).toLowerCase();

  for (let index = 0; index < templates.length; index += 1) {
    if (String(templates[index]).toLowerCase() === normalizedExpectedName) {
      return templates[index];
    }
  }

  return null;
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
      result.message =
        "Não foi possível preparar a pasta onde os arquivos serão salvos.";
      return result;
    }

    app.beginUndoGroup("Enviar render MOV/MP4");

    let movQueueItem: RenderQueueItem | null = null;
    let mp4QueueItem: RenderQueueItem | null = null;

    try {
      movQueueItem = project.renderQueue.items.add(movComp);
      const movOutputModule = movQueueItem.outputModule(1);
      const movTemplateName = findOutputModuleTemplateName(
        movOutputModule,
        MOV_TEMPLATE_NAME
      );

      if (movTemplateName === null) {
        result.message =
          "O formato PROXY não está disponível neste After Effects. Adicione esse formato e tente novamente.";
        throw new Error("MOV output template unavailable");
      }

      movOutputModule.applyTemplate(movTemplateName);
      movOutputModule.file = movFile;

      mp4QueueItem = project.renderQueue.items.add(mp4Comp);
      const mp4OutputModule = mp4QueueItem.outputModule(1);
      const mp4TemplateName = findOutputModuleTemplateName(
        mp4OutputModule,
        MP4_TEMPLATE_NAME
      );

      if (mp4TemplateName === null) {
        result.message =
          "O formato MP4 não está disponível neste After Effects. Adicione esse formato e tente novamente.";
        throw new Error("MP4 output template unavailable");
      }

      mp4OutputModule.applyTemplate(mp4TemplateName);
      mp4OutputModule.file = mp4File;

      result.ok = true;
      result.queuedItems = 2;
      result.message = "MOV e MP4 foram adicionados à fila de render.";
    } catch (error) {
      try {
        if (mp4QueueItem !== null) mp4QueueItem.remove();
        if (movQueueItem !== null) movQueueItem.remove();
      } catch (removeError) {}

      if (!result.message) {
        result.message =
          "Não foi possível preparar o MOV e o MP4. Confira os formatos de saída e tente novamente.";
      }
    } finally {
      app.endUndoGroup();
    }

    return result;
  };
