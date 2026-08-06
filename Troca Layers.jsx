// Troca a origem e a escala de duas camadas selecionadas
// por Wiliam Takashi Yamashita
// takashiyamashita.com

var layers = app.project.activeItem.selectedLayers;
var sourceLayer1, sourceLayer2, scaleLayer1, scaleLayer2;

for (var i = 0; i < 2; i++){
	if(i == 0) {sourceLayer1 = layers[i].source; scaleLayer1 = layers[i].scale.value;}
	if(i == 1) {sourceLayer2 = layers[i].source; scaleLayer2 = layers[i].scale.value;}
};

layers[0].replaceSource(sourceLayer2,true);
layers[0].scale.setValue(scaleLayer2);
layers[1].replaceSource(sourceLayer1,true);
layers[1].scale.setValue(scaleLayer1);

