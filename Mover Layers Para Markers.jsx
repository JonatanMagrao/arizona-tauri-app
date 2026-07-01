// Mover Layers Para Markers V3
// Move layers para markers de composição de acordo com a cor da label.
// Também move o marker de "pulo" das layers selecionadas para a agulha.
// por Wiliam Takashi Yamashita na FUNÇÃO 2 - PUXAR LAYERS PARA MARKERS (POR COR)
// com contribuição de Adriano Fernandes Giacon na FUNÇÃO 1 - MARKER INTELIGENTE DA TIMELINE
// takashiyamashita.com
// www.behance.net/adriano_gi9eed?locale=pt_BR

(function smartMarkerSystem_FINAL() {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        return;
    }

    app.beginUndoGroup("Sistema Inteligente de Markers (Final)");

    try {
        var currentTime = comp.time;
        var epsilon = comp.frameDuration / 2;
        var compMarkerProp = comp.markerProperty;

        // =================================================
        // CONFIGURAÇÃO DE GRUPOS POR COR
        // =================================================
        var labelToMarkerIndex = {
            1: 1,
            2: 2,
            8: 3,
            9: 4,
            10: 5,
            11: 6
        };

        function getMarkerIndexForLayer(layer) {
            var key = String(layer.label);

            if (labelToMarkerIndex.hasOwnProperty(key)) {
                return labelToMarkerIndex[key];
            }

            return null;
        }

        function selectedLayersShareColorGroup(selectedLayers) {
            if (selectedLayers.length <= 1) {
                return true;
            }

            var firstMarkerIndex = getMarkerIndexForLayer(selectedLayers[0]);
            if (firstMarkerIndex === null) {
                return false;
            }

            for (var i = 1; i < selectedLayers.length; i++) {
                if (getMarkerIndexForLayer(selectedLayers[i]) !== firstMarkerIndex) {
                    return false;
                }
            }

            return true;
        }

        function moveSecondLayerMarkerToTime(layer, time, epsilon) {
            var layerMarkerProp = layer.property("ADBE Marker");

            if (!layerMarkerProp || layerMarkerProp.numKeys < 2) {
                return false;
            }

            var secondIndex = 2;
            var secondTime = layerMarkerProp.keyTime(secondIndex);

            if (Math.abs(secondTime - time) <= epsilon) {
                return false;
            }

            var secondValue = layerMarkerProp.keyValue(secondIndex);
            layerMarkerProp.removeKey(secondIndex);
            layerMarkerProp.setValueAtTime(time, secondValue);
            return true;
        }

        function handleSelectedJumpMarkers(selectedLayers, time, epsilon) {
            if (selectedLayers.length === 0) {
                return false;
            }

            if (!selectedLayersShareColorGroup(selectedLayers)) {
                return false;
            }

            for (var i = 0; i < selectedLayers.length; i++) {
                moveSecondLayerMarkerToTime(selectedLayers[i], time, epsilon);
            }

            // Remove seleção após uso para evitar que o próximo atalho repita o modo "pulo".
            for (var s = 0; s < selectedLayers.length; s++) {
                selectedLayers[s].selected = false;
            }

            return true;
        }

        // =================================================
        // FUNÇÃO 3 - PRIORITÁRIA
        // Move o 2º marker de uma ou mais layers selecionadas.
        // Com múltiplas layers, só atua se todas forem do mesmo grupo de cor.
        // =================================================
        var initialSelectedLayers = comp.selectedLayers;
        if (handleSelectedJumpMarkers(initialSelectedLayers, currentTime, epsilon)) {
            return;
        }

        // =================================================
        // FUNÇÃO 1 - MARKER INTELIGENTE DA TIMELINE
        // =================================================
        var markerCount = compMarkerProp.numKeys;
        var ctiOnMarker = false;

        for (var m = 1; m <= markerCount; m++) {
            if (Math.abs(compMarkerProp.keyTime(m) - currentTime) <= epsilon) {
                ctiOnMarker = true;
                break;
            }
        }

        if (!ctiOnMarker && markerCount > 0) {
            var nextIndex = -1;
            var prevIndex = -1;
            var nextDelta = Number.MAX_VALUE;
            var prevDelta = Number.MAX_VALUE;

            for (var markerIndex = 1; markerIndex <= markerCount; markerIndex++) {
                var markerTime = compMarkerProp.keyTime(markerIndex);
                var delta = markerTime - currentTime;

                if (delta > 0 && delta < nextDelta) {
                    nextDelta = delta;
                    nextIndex = markerIndex;
                }

                if (delta < 0 && Math.abs(delta) < prevDelta) {
                    prevDelta = Math.abs(delta);
                    prevIndex = markerIndex;
                }
            }

            var chosenIndex = (nextIndex !== -1) ? nextIndex : prevIndex;

            if (chosenIndex !== -1) {
                var markerValue = compMarkerProp.keyValue(chosenIndex);
                compMarkerProp.removeKey(chosenIndex);
                compMarkerProp.setValueAtTime(currentTime, markerValue);
            }
        }

        // =================================================
        // FUNÇÃO 2 - PUXAR LAYERS PARA MARKERS (POR COR)
        // + SELEÇÃO AUTOMÁTICA APENAS DE LAYER VISÍVEL
        // =================================================
        for (var l = 1; l <= comp.numLayers; l++) {
            var layer = comp.layer(l);
            if (layer.locked) continue;

            var targetMarkerIndex = getMarkerIndexForLayer(layer);
            if (targetMarkerIndex === null || compMarkerProp.numKeys < targetMarkerIndex) {
                continue;
            }

            var targetTime = compMarkerProp.keyTime(targetMarkerIndex);
            layer.startTime = targetTime;

            // Seleciona apenas se cair no CTI e estiver visível na timeline.
            if (
                Math.abs(layer.startTime - currentTime) <= epsilon &&
                (!layer.shy || !comp.hideShyLayers)
            ) {
                layer.selected = true;
            }
        }
    } finally {
        app.endUndoGroup();
    }
})();

