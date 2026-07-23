(function arizonaRunEmbeddedAfterEffectsAction() {
  var action = "__ARIZONA_ACTION__";
  var LABEL_TO_MARKER_INDEX = {
    1: 1,
    2: 2,
    8: 3,
    9: 4,
    10: 5,
    11: 6
  };
  var TIMELINE_COMP_NAME = "Miolo";
  var JUMP_MARKER_INDEX = 2;
  var TAIL_MARKER_START_INDEX = 2;
  var TAIL_MARKER_END_INDEX = 6;

  function isComp(item) {
    return item !== null && item instanceof CompItem;
  }

  function getActiveComp() {
    if (app.project === null || !isComp(app.project.activeItem)) {
      return null;
    }

    return app.project.activeItem;
  }

  function findCompByName(name) {
    if (app.project === null) return null;

    var expected = String(name).toLowerCase();
    for (var index = 1; index <= app.project.numItems; index += 1) {
      var item = app.project.item(index);
      if (isComp(item) && String(item.name).toLowerCase() === expected) {
        return item;
      }
    }

    return null;
  }

  function getMarkerIndexForLayer(layer) {
    var markerIndex = LABEL_TO_MARKER_INDEX[layer.label];
    return markerIndex || 0;
  }

  function getLayerMarkerProperty(layer) {
    return layer.property("ADBE Marker");
  }

  function isLayerVisibleInTimeline(layer, comp) {
    return !layer.shy || !comp.hideShyLayers;
  }

  function containsLayer(layers, layer) {
    for (var index = 0; index < layers.length; index += 1) {
      if (layers[index] === layer) return true;
    }

    return false;
  }

  function copyLayers(layers) {
    var result = [];
    for (var index = 0; index < layers.length; index += 1) {
      result.push(layers[index]);
    }
    return result;
  }

  function setSelectedLayers(comp, layers) {
    for (var index = 1; index <= comp.numLayers; index += 1) {
      comp.layer(index).selected = false;
    }

    for (var selectedIndex = 0; selectedIndex < layers.length; selectedIndex += 1) {
      layers[selectedIndex].selected = true;
    }
  }

  function timesNear(left, right, epsilon) {
    return Math.abs(left - right) <= epsilon;
  }

  function moveMarkerKeyToTime(markerProperty, keyIndex, targetTime, epsilon) {
    var keyTime = markerProperty.keyTime(keyIndex);
    if (timesNear(keyTime, targetTime, epsilon)) return false;

    var markerValue = markerProperty.keyValue(keyIndex);
    markerProperty.removeKey(keyIndex);
    markerProperty.setValueAtTime(targetTime, markerValue);
    return true;
  }

  function moveDirectionalCompMarker(comp, direction, currentTime, epsilon) {
    var markerProperty = comp.markerProperty;
    var markerCount = markerProperty.numKeys;
    var ctiOnMarker = false;
    var markerIndex;

    for (markerIndex = 1; markerIndex <= markerCount; markerIndex += 1) {
      if (timesNear(markerProperty.keyTime(markerIndex), currentTime, epsilon)) {
        ctiOnMarker = true;
        break;
      }
    }

    if (ctiOnMarker || markerCount === 0) return false;

    var chosenIndex = -1;
    var fallbackIndex = -1;
    var chosenDelta = Number.MAX_VALUE;
    var fallbackDelta = Number.MAX_VALUE;

    for (markerIndex = 1; markerIndex <= markerCount; markerIndex += 1) {
      var delta = markerProperty.keyTime(markerIndex) - currentTime;
      var preferred =
        (direction === "forward" && delta > 0) ||
        (direction === "backward" && delta < 0);
      var fallback =
        (direction === "forward" && delta < 0) ||
        (direction === "backward" && delta > 0);
      var absoluteDelta = Math.abs(delta);

      if (preferred && absoluteDelta < chosenDelta) {
        chosenDelta = absoluteDelta;
        chosenIndex = markerIndex;
      } else if (fallback && absoluteDelta < fallbackDelta) {
        fallbackDelta = absoluteDelta;
        fallbackIndex = markerIndex;
      }
    }

    if (chosenIndex < 0) chosenIndex = fallbackIndex;
    if (chosenIndex < 0) return false;

    return moveMarkerKeyToTime(markerProperty, chosenIndex, currentTime, epsilon);
  }

  function alignLayersToColorMarkers(comp, initialSelection, currentTime, epsilon) {
    var markerProperty = comp.markerProperty;
    var finalSelection = copyLayers(initialSelection);

    for (var index = 1; index <= comp.numLayers; index += 1) {
      var layer = comp.layer(index);
      if (layer.locked) continue;

      var markerIndex = getMarkerIndexForLayer(layer);
      if (markerIndex === 0 || markerProperty.numKeys < markerIndex) continue;

      var targetTime = markerProperty.keyTime(markerIndex);
      layer.startTime = targetTime;

      if (
        timesNear(targetTime, currentTime, epsilon) &&
        isLayerVisibleInTimeline(layer, comp) &&
        !containsLayer(finalSelection, layer)
      ) {
        finalSelection.push(layer);
      }
    }

    setSelectedLayers(comp, finalSelection);
  }

  function moveLayersToMarkers(direction) {
    var comp = getActiveComp();
    if (comp === null) {
      return "Abra uma composicao antes de usar o atalho.";
    }

    app.beginUndoGroup("Mover layers para markers");
    try {
      var currentTime = comp.time;
      var epsilon = comp.frameDuration / 2;
      var selectedLayers = copyLayers(comp.selectedLayers);

      moveDirectionalCompMarker(comp, direction, currentTime, epsilon);
      alignLayersToColorMarkers(comp, selectedLayers, currentTime, epsilon);
      return "";
    } finally {
      app.endUndoGroup();
    }
  }

  function selectedLayersShareColorGroup(selectedLayers) {
    if (selectedLayers.length <= 1) return true;

    var firstMarkerIndex = getMarkerIndexForLayer(selectedLayers[0]);
    if (firstMarkerIndex === 0) return false;

    for (var index = 1; index < selectedLayers.length; index += 1) {
      if (getMarkerIndexForLayer(selectedLayers[index]) !== firstMarkerIndex) {
        return false;
      }
    }

    return true;
  }

  function moveSecondLayerMarkerToTime(layer, currentTime, frameDuration, epsilon) {
    var markerProperty = getLayerMarkerProperty(layer);
    if (markerProperty === null || markerProperty.numKeys < JUMP_MARKER_INDEX) {
      return false;
    }

    var minimumJumpTime = layer.inPoint + frameDuration * 27;
    var targetTime = Math.max(currentTime, minimumJumpTime);
    return moveMarkerKeyToTime(
      markerProperty,
      JUMP_MARKER_INDEX,
      targetTime,
      epsilon
    );
  }

  function moveSelectedJumpMarkers() {
    var comp = getActiveComp();
    if (comp === null) {
      return "Abra uma composicao antes de usar o atalho.";
    }

    var selectedLayers = copyLayers(comp.selectedLayers);
    if (selectedLayers.length === 0) return "";
    if (!selectedLayersShareColorGroup(selectedLayers)) {
      return "Selecione apenas layers do mesmo grupo de cor.";
    }

    app.beginUndoGroup("Mover marker pulo");
    try {
      var epsilon = comp.frameDuration / 2;
      for (var index = 0; index < selectedLayers.length; index += 1) {
        moveSecondLayerMarkerToTime(
          selectedLayers[index],
          comp.time,
          comp.frameDuration,
          epsilon
        );
      }
      setSelectedLayers(comp, []);
      return "";
    } finally {
      app.endUndoGroup();
    }
  }

  function layerNameMatchesOffer(layer) {
    var layerName = String(layer.name || "").toLowerCase();
    var sourceName = "";

    try {
      if (layer.source !== null) sourceName = String(layer.source.name || "").toLowerCase();
    } catch (error) {}

    return /oferta_\d/.test(layerName) || /oferta_\d/.test(sourceName);
  }

  function layerHasPuloMarker(layer) {
    var markerProperty = getLayerMarkerProperty(layer);
    if (markerProperty === null) return false;

    for (var index = 1; index <= markerProperty.numKeys; index += 1) {
      var markerValue = markerProperty.keyValue(index);
      if (String(markerValue.comment || "").toLowerCase().indexOf("pulo") >= 0) {
        return true;
      }
    }

    return false;
  }

  function selectLayerWithJumpMarker() {
    var comp = getActiveComp();
    if (comp === null) {
      return "Abra uma composicao antes de usar o atalho.";
    }

    app.beginUndoGroup("Selecionar marker pulo");
    try {
      if (comp.selectedLayers.length > 0) {
        setSelectedLayers(comp, []);
        return "";
      }

      for (var index = 1; index <= comp.numLayers; index += 1) {
        var layer = comp.layer(index);
        if (layer.locked) continue;
        if (!isLayerVisibleInTimeline(layer, comp)) continue;
        if (!layer.activeAtTime(comp.time)) continue;
        if (!layerNameMatchesOffer(layer)) continue;
        if (!layerHasPuloMarker(layer)) continue;

        setSelectedLayers(comp, [layer]);
        return "";
      }

      return "";
    } finally {
      app.endUndoGroup();
    }
  }

  function hasIndexedJumpMarker(layer) {
    var markerProperty = getLayerMarkerProperty(layer);
    return markerProperty !== null && markerProperty.numKeys >= JUMP_MARKER_INDEX;
  }

  function findLayerGroupStartTimeForMarker(
    comp,
    markerIndex,
    preferredTime,
    epsilon
  ) {
    var firstStartTime = null;

    for (var index = 1; index <= comp.numLayers; index += 1) {
      var layer = comp.layer(index);
      if (layer.locked) continue;
      if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
      if (!hasIndexedJumpMarker(layer)) continue;

      if (firstStartTime === null) firstStartTime = layer.startTime;
      if (timesNear(layer.startTime, preferredTime, epsilon)) {
        return layer.startTime;
      }
    }

    return firstStartTime;
  }

  function moveLayerGroupToTime(
    comp,
    markerIndex,
    sourceTime,
    targetTime,
    epsilon
  ) {
    for (var index = 1; index <= comp.numLayers; index += 1) {
      var layer = comp.layer(index);
      if (layer.locked) continue;
      if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
      if (!timesNear(layer.startTime, sourceTime, epsilon)) continue;
      if (!timesNear(layer.startTime, targetTime, epsilon)) {
        layer.startTime = targetTime;
      }
    }
  }

  function selectOfferLayersAtTime(
    comp,
    markerIndex,
    startTime,
    epsilon
  ) {
    var selectedLayers = [];

    for (var index = 1; index <= comp.numLayers; index += 1) {
      var layer = comp.layer(index);
      if (layer.locked) continue;
      if (getMarkerIndexForLayer(layer) !== markerIndex) continue;
      if (!isLayerVisibleInTimeline(layer, comp)) continue;
      if (!hasIndexedJumpMarker(layer)) continue;
      if (!timesNear(layer.startTime, startTime, epsilon)) continue;
      selectedLayers.push(layer);
    }

    setSelectedLayers(comp, selectedLayers);
  }

  function getTailMarkerTime(comp, markerIndex) {
    var lastFrameTime = Math.max(0, comp.duration - comp.frameDuration);
    var secondsFromEnd = TAIL_MARKER_END_INDEX - markerIndex;
    return Math.max(0, lastFrameTime - secondsFromEnd);
  }

  function adjustTimelineMarkersToTail() {
    var comp = findCompByName(TIMELINE_COMP_NAME);
    if (comp === null) {
      return 'Precomp "Miolo" nao encontrada.';
    }
    if (comp.markerProperty.numKeys < TAIL_MARKER_END_INDEX) {
      return 'A precomp "Miolo" precisa ter os markers 1 a 6.';
    }

    try {
      var viewer = comp.openInViewer();
      if (viewer !== null) viewer.setActive();
    } catch (viewerError) {}

    app.beginUndoGroup("Ajustar markers para o fundo");
    try {
      var epsilon = comp.frameDuration / 2;
      var markerProperty = comp.markerProperty;
      var firstMarkerTime = markerProperty.keyTime(1);
      var firstGroupStartTime = findLayerGroupStartTimeForMarker(
        comp,
        1,
        firstMarkerTime,
        epsilon
      );
      var markerValues = [];
      var groupStartTimes = [];
      var markerIndex;

      for (
        markerIndex = TAIL_MARKER_START_INDEX;
        markerIndex <= TAIL_MARKER_END_INDEX;
        markerIndex += 1
      ) {
        var markerTime = markerProperty.keyTime(markerIndex);
        markerValues[markerIndex] = markerProperty.keyValue(markerIndex);
        groupStartTimes[markerIndex] = findLayerGroupStartTimeForMarker(
          comp,
          markerIndex,
          markerTime,
          epsilon
        );
      }

      for (
        markerIndex = TAIL_MARKER_END_INDEX;
        markerIndex >= TAIL_MARKER_START_INDEX;
        markerIndex -= 1
      ) {
        markerProperty.removeKey(markerIndex);
      }

      for (
        markerIndex = TAIL_MARKER_START_INDEX;
        markerIndex <= TAIL_MARKER_END_INDEX;
        markerIndex += 1
      ) {
        var targetTime = getTailMarkerTime(comp, markerIndex);
        markerProperty.setValueAtTime(targetTime, markerValues[markerIndex]);

        if (groupStartTimes[markerIndex] !== null) {
          moveLayerGroupToTime(
            comp,
            markerIndex,
            groupStartTimes[markerIndex],
            targetTime,
            epsilon
          );
        }
      }

      var selectedTime =
        firstGroupStartTime !== null ? firstGroupStartTime : firstMarkerTime;
      comp.time = Math.max(0, Math.min(comp.duration, selectedTime));
      selectOfferLayersAtTime(comp, 1, comp.time, epsilon);
      return "";
    } finally {
      app.endUndoGroup();
    }
  }

  function getAllComps() {
    var comps = [];
    if (app.project === null) return comps;

    for (var index = 1; index <= app.project.numItems; index += 1) {
      var item = app.project.item(index);
      if (isComp(item)) comps.push(item);
    }

    return comps;
  }

  function findCompsByName(comps, name) {
    var matches = [];
    var expected = String(name).toLowerCase();

    for (var index = 0; index < comps.length; index += 1) {
      if (String(comps[index].name).toLowerCase() === expected) {
        matches.push(comps[index]);
      }
    }

    return matches;
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
    if (parent !== null && !parent.exists && !ensureFolder(parent)) {
      return false;
    }

    return folder.create() || folder.exists;
  }

  function queueRenderOutputs() {
    if (app.project === null || app.project.file === null) {
      return "Salve o projeto do After Effects antes de enviar para render.";
    }

    var comps = getAllComps();
    var movComps = findCompsByName(comps, "EXPORT");
    var mp4Comps = findCompsByName(comps, "EXPORT_MP4");
    var duplicateMessages = [];

    if (movComps.length > 1) {
      duplicateMessages.push(
        'Encontrei ' + movComps.length + ' precomps "EXPORT".'
      );
    }
    if (mp4Comps.length > 1) {
      duplicateMessages.push(
        'Encontrei ' + mp4Comps.length + ' precomps "EXPORT_MP4".'
      );
    }
    if (duplicateMessages.length > 0) {
      return (
        "Render interrompido: existem precomps duplicadas no projeto.\n\n" +
        duplicateMessages.join("\n") +
        "\n\nDeixe apenas uma precomp de cada antes de renderizar."
      );
    }
    if (movComps.length === 0 || mp4Comps.length === 0) {
      return 'Nao encontrei as precomps "EXPORT" e "EXPORT_MP4" para render.';
    }

    var project = app.project;
    var projectFile = project.file;
    var outputBaseName = stripExtension(projectFile.name);
    var isClara = getInitials(projectFile.name) === "CLA";
    var baseFolder = getParentFolder(projectFile.parent, isClara ? 1 : 2);
    var movFolder = isClara
      ? new Folder(baseFolder.fsName + "/OUT")
      : new Folder(baseFolder.fsName + "/OUT/RENDER/MOV");
    var mp4Folder = isClara
      ? new Folder(baseFolder.fsName + "/OUT")
      : new Folder(baseFolder.fsName + "/OUT/RENDER/MP4");
    var movFile = new File(movFolder.fsName + "/" + outputBaseName + ".mov");
    var mp4File = new File(mp4Folder.fsName + "/" + outputBaseName + ".mp4");

    if (!ensureFolder(movFolder) || !ensureFolder(mp4Folder)) {
      return "Nao foi possivel criar a pasta de render.";
    }

    app.beginUndoGroup("Enviar render MOV/MP4");
    var movQueueItem = null;
    var mp4QueueItem = null;

    try {
      movQueueItem = project.renderQueue.items.add(movComps[0]);
      movQueueItem.outputModule(1).file = movFile;

      mp4QueueItem = project.renderQueue.items.add(mp4Comps[0]);
      mp4QueueItem.outputModule(1).applyTemplate("MP4");
      mp4QueueItem.outputModule(1).file = mp4File;
      return "";
    } catch (error) {
      try {
        if (mp4QueueItem !== null) mp4QueueItem.remove();
        if (movQueueItem !== null) movQueueItem.remove();
      } catch (removeError) {}

      return error && error.message
        ? error.message
        : "Nao foi possivel adicionar o render na fila.";
    } finally {
      app.endUndoGroup();
    }
  }

  function executeAction() {
    if (action === "move_layers_backward") {
      return moveLayersToMarkers("backward");
    }
    if (action === "move_layers_forward") {
      return moveLayersToMarkers("forward");
    }
    if (action === "move_jump_marker") {
      return moveSelectedJumpMarkers();
    }
    if (action === "select_jump_marker_layer") {
      return selectLayerWithJumpMarker();
    }
    if (action === "adjust_markers_to_tail") {
      return adjustTimelineMarkersToTail();
    }
    if (action === "render") {
      return queueRenderOutputs();
    }

    return "Acao Arizona desconhecida: " + action;
  }

  try {
    var errorMessage = executeAction();
    if (errorMessage) alert("Arizona\n\n" + errorMessage);
    return errorMessage || "ok";
  } catch (error) {
    var message =
      error && error.message
        ? error.message
        : "Nao foi possivel executar a acao.";
    alert("Arizona\n\n" + message);
    return message;
  }
})();
