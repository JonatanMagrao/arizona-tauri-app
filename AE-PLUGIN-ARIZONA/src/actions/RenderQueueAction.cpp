#include "RenderQueueAction.h"

#include <string>

namespace {

const char* kQueueRenderOutputsScript = R"ARIZONA_JS(
(function () {
  var MOV_EXT = ".mov";
  var MP4_EXT = ".mp4";
  var MP4_TEMPLATE_NAME = "MP4";
  var MOV_COMP_NAME = "EXPORT";
  var MP4_COMP_NAME = "EXPORT_MP4";

  function createResult(message) {
    return {
      ok: false,
      message: message,
      activeCompName: "",
      mp4CompName: "",
      movPath: "",
      mp4Path: "",
      queuedItems: 0
    };
  }

  function getAllComps() {
    var project = app.project;
    var comps = [];
    if (project === null) return comps;

    for (var i = 1; i <= project.numItems; i += 1) {
      var item = project.item(i);
      if (item instanceof CompItem) {
        comps.push(item);
      }
    }

    return comps;
  }

  function normalizeCompName(name) {
    return String(name).toLowerCase();
  }

  function namesMatch(left, right) {
    return normalizeCompName(left) === normalizeCompName(right);
  }

  function findCompsByName(comps, name) {
    var matches = [];

    for (var i = 0; i < comps.length; i += 1) {
      if (namesMatch(comps[i].name, name)) {
        matches.push(comps[i]);
      }
    }

    return matches;
  }

  function createResolution(ok, message, pair) {
    return {
      ok: ok,
      message: message,
      pair: pair
    };
  }

  function alertResolution(message) {
    alert(message);
    return createResolution(false, message, null);
  }

  function resolveRenderComps() {
    var comps = getAllComps();
    var duplicateMessages = [];
    var movComps = findCompsByName(comps, MOV_COMP_NAME);
    var mp4Comps = findCompsByName(comps, MP4_COMP_NAME);

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
      mp4Comp: mp4Comps[0]
    });
  }

  function stripExtension(fileName) {
    var dotIndex = fileName.lastIndexOf(".");
    return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
  }

  function getInitials(fileName) {
    var firstToken = String(fileName).split("_")[0];
    return firstToken.substring(0, 3).toUpperCase();
  }

  function getParentFolder(folder, levels) {
    var current = folder;

    for (var level = 0; level < levels; level += 1) {
      current = current.parent;
    }

    return current;
  }

  function ensureFolder(folder) {
    if (folder.exists) return true;

    var parent = folder.parent;
    if (parent !== null && !parent.exists) {
      if (!ensureFolder(parent)) return false;
    }

    return folder.create() || folder.exists;
  }

  function getChildFolder(folder, path) {
    return new Folder(folder.fsName + "/" + path);
  }

  function getChildFile(folder, fileName) {
    return new File(folder.fsName + "/" + fileName);
  }

  function resolveRenderTargets(missingProjectMessage) {
    if (app.project === null || app.project.file === null) {
      return {
        ok: false,
        message: missingProjectMessage,
        targets: null
      };
    }

    var project = app.project;
    var projectFile = project.file;
    var resolution = resolveRenderComps();

    if (!resolution.ok || resolution.pair === null) {
      return {
        ok: false,
        message: resolution.message,
        targets: null
      };
    }

    var outputBaseName = stripExtension(projectFile.name);
    var isClara = getInitials(projectFile.name) === "CLA";
    var baseFolder = getParentFolder(projectFile.parent, isClara ? 1 : 2);
    var movFolder = isClara
      ? getChildFolder(baseFolder, "OUT")
      : getChildFolder(baseFolder, "OUT/RENDER/MOV");
    var mp4Folder = isClara
      ? getChildFolder(baseFolder, "OUT")
      : getChildFolder(baseFolder, "OUT/RENDER/MP4");
    var movFile = getChildFile(movFolder, outputBaseName + MOV_EXT);
    var mp4File = getChildFile(mp4Folder, outputBaseName + MP4_EXT);

    return {
      ok: true,
      message: "",
      targets: {
        project: project,
        projectFile: projectFile,
        movComp: resolution.pair.movComp,
        mp4Comp: resolution.pair.mp4Comp,
        movFolder: movFolder,
        mp4Folder: mp4Folder,
        movFile: movFile,
        mp4File: mp4File
      }
    };
  }

  function queueActiveCompRenderOutputs() {
    var resolution = resolveRenderTargets(
      "Salve o projeto do After Effects antes de enviar para render."
    );

    if (!resolution.ok || resolution.targets === null) {
      return createResult(resolution.message);
    }

    var targets = resolution.targets;
    var project = targets.project;
    var movComp = targets.movComp;
    var mp4Comp = targets.mp4Comp;
    var movFolder = targets.movFolder;
    var mp4Folder = targets.mp4Folder;
    var movFile = targets.movFile;
    var mp4File = targets.mp4File;
    var result = createResult("");

    result.activeCompName = movComp.name;
    result.mp4CompName = mp4Comp.name;
    result.movPath = movFile.fsName;
    result.mp4Path = mp4File.fsName;

    if (!ensureFolder(movFolder) || !ensureFolder(mp4Folder)) {
      result.message = "Nao foi possivel criar a pasta de render.";
      return result;
    }

    app.beginUndoGroup("Enviar render MOV/MP4");

    var movQueueItem = null;
    var mp4QueueItem = null;

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
        error && error.message
          ? error.message
          : "Nao foi possivel adicionar o render na fila.";
    } finally {
      app.endUndoGroup();
    }

    return result;
  }

  return queueActiveCompRenderOutputs().message;
}());
)ARIZONA_JS";

} // namespace

A_Err RunQueueRenderOutputs(const BridgeContext& context)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);
    AEGP_MemHandle resultH = nullptr;
    AEGP_MemHandle errorH = nullptr;

    ERR(suites.UtilitySuite6()->AEGP_ExecuteScript(
        context.plugin_id,
        kQueueRenderOutputsScript,
        TRUE,
        &resultH,
        &errorH));

    if (resultH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(resultH));
    }

    if (errorH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(errorH));
    }

    return err;
}
