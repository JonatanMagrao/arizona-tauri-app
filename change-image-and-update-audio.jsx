/**
 * @file Script para abrir a pasta de produtos do jobão e atualizar arquivos de áudio
 * 
 * @version 1.1.0
 * @date 08/09/2025
 * 
 * @author Jonatan Magrão
 * @email magrao@jonatanmagrao.com.br
 * @instagram https://www.instagram.com/nerd_do_after/
 * 
 * @licence MIT
 * 
 * @description
 * Este script substitui imagens de produtos ou arquivos de áudio em um projeto, com base na seleção de camadas ou itens no painel do projeto.
 * 
 * ### Funcionalidades
 * 1. **Prioridade de Seleção**: 
 *    - O script verifica primeiramente se há uma camada selecionada. 
 *    - Caso uma camada e um item do projeto estejam selecionados ao mesmo tempo, **apenas a camada selecionada será considerada** para a substituição de imagem.
 *    - Para que a substituição de áudio (item do projeto) ocorra, **nenhuma camada deve estar selecionada**.
 * 
 * 2. **Troca de Imagens**:
 *    - Se uma camada de imagem estiver selecionada, o script abrirá uma caixa de diálogo para selecionar e substituir a imagem do produto correspondente.
 *    - Após selecionar o arquivo desejado, basta confirmar com "OK" para concluir a substituição.
 * 
 * 3. **Troca de Áudio**:
 *    - Se não houver nenhuma camada selecionada, mas um arquivo de áudio específico estiver selecionado no painel do projeto (por exemplo, "AUDIO" ou "AUDIO 15 SEGUNDOS"), o script realizará uma busca por arquivos de áudio que correspondam ao nome do projeto.
 *      - **Caso único**: Se houver apenas um arquivo correspondente, ele será substituído automaticamente.
 *      - **Vários arquivos**: Se houver mais de uma correspondência, o script exibirá uma caixa de opções para escolher o áudio desejado. Basta clicar no botão correspondente ao nome do arquivo.
 *      - **Nenhuma correspondência**: Se nenhum arquivo compatível for encontrado, uma caixa de diálogo será aberta para permitir a seleção manual do áudio.
 *
 * 
 * @note
 * Este script foi criado por Jonatan Magrão. Todos os direitos reservados.
 * A distribuição gratuita não implica a cessão dos direitos autorais.
 * 
 * **Permissões de Uso**:
 * - Este script pode ser utilizado para fins pessoais e comerciais exclusivamente dentro dos projetos da Arizona, incluindo produções audiovisuais, desde que seja atribuída a devida autoria a Jonatan Magrão.
 * - Adaptações deste script são permitidas e podem ser distribuídas livremente, contanto que permaneçam restritas ao uso interno na Arizona e não sejam utilizadas para desenvolvimento de ferramentas, plugins ou qualquer produto destinado à revenda ou comercialização.
 * 
 * **IMPORTANTE**: Este script é distribuído com código aberto, sob os termos da licença especificada acima.
 * 
 */

var thisProject = app.project
function setActiveComp(){
    if(thisProject.activeItem instanceof CompItem === false){
        app.activeViewer.setActive()
    }
    return thisProject.activeItem;
}

//todo ======================================= CHANGE IMG BY SELECTED LAYER =========================================

function replaceImg(camada){
    
    if(camada === undefined){
        alert("Nenhuma camada selecionada")
        return
    }
        
    if(camada.source instanceof FootageItem){
        
        var produtosPath = Folder(thisProject.file.parent.parent.parent.toString() + "/PRODUTOS");
        var newFile = produtosPath.openDlg();
    
        if(newFile !== null){
            camada.source.replace(newFile)
        } else {
            alert('Nenhum item foi selecionado')
            return
        }
        
    } else {
        alert('A camada "' + camada.name + '" não é do tipo footage')
        return
    }
}

//todo ======================================= UPDATE AUDIO FILE CARREFOUR =========================================

var projName = thisProject.file.name

function replaceSpace(input){
    var saida = String(input).replace(/%20/g," ")
    return saida
}

function button(nome,file,audioSelection){
    var btn = janela.add("button",undefined,nome)
    btn.onClick = function(){
        audioSelection.replace(file)
        alert("Arquivo atualizado!")
        this.parent.close()
    }
    return btn
}

function getAudioFolderPath(audioFolderEndpoint){
    var folderPath = Folder(thisProject.file.parent.parent.parent.toString() + "/" + audioFolderEndpoint)
    if(!folderPath.exists){
        folderPath = Folder(thisProject.file.parent.parent.parent.toString() + "/AUDIO/BOUNCE")//qualquer coisa, retornar apenas AUDIO
    }

    return folderPath
}

function getAudioFiles(audioPath,codJobinho,praca){

    var projAudioFiles = []
    
    for(var i = 0; i < audioPath.getFiles().length;i++){
        var file = File(audioPath.getFiles()[i])
        var fileName = replaceSpace(file.name)
        praca = praca.replace(/\d/g,"")
        var regExp = new RegExp(codJobinho+"_"+praca,"g")        
        if(fileName.match(regExp)){
            projAudioFiles.push(file)
        }
    }

    return projAudioFiles
}

function updateAudioCarrefour(audioSelection){

    try{    
        
        if(!audioSelection){
            throw new Error("Nenhum áudio do projeto foi selecionado!")
        }

        if(!(audioSelection instanceof FootageItem)){
            throw new Error('O item selecionado não é do tipo Footage!')
        }

        if(audioSelection instanceof FootageItem){
            var fileType = audioSelection.file.displayName.split(".").pop()
            if(fileType !== "wav"){
                throw new Error("Item selecionado não é do tipo \"wav\"!")
            }
        }
    
        var audioPath = null
        if(audioSelection.duration >= 30 || audioSelection.name === "AUDIO 30 SEGUNDOS.wav"){
            audioPath = getAudioFolderPath("AUDIO/BOUNCE")
        } else if (audioSelection.duration < 30 || audioSelection.name === "AUDIO 15 SEGUNDOS.wav"){
            audioPath = getAudioFolderPath("AUDIO/BOUNCE 15s")
        } else {
            throw new Error("Duração: " + audioSelection.duration + " - Nome: " + audioSelection.name)
        }    
        
        var audioSelectionName = audioSelection.name
        var splitProjName = replaceSpace(projName).split("_")
        var codJobinho = splitProjName[0]
        var praca = splitProjName[1]
        var projAudioFilesList = getAudioFiles(audioPath,codJobinho,praca)   
                
        //================================ FUNCIONAMENTO =================================
        
        if(projAudioFilesList.length === 0){//caso não possua nenhum item com o nome do projeto, abre dialog para selecionar o arquivo manualmente
            var replaceAudio = audioPath.openDlg()
            if(replaceAudio !== null){//verifica se foi selecionado algum item no dialog
                audioSelection.replace(replaceAudio)
                alert("Arquivo atualizado!")
            }
        } else if(projAudioFilesList.length > 1){//caso tenha mais de um arquivo com o nome do projeto, apresenta opção através de botões. Clicando, seleciona a versão
            janela = new Window("palette","Escolha o arquivo:")
            for(var i = 0; i< projAudioFilesList.length; i++){
                var file = projAudioFilesList[i]
                if(file !== null){//verifica se foi selecionado algum item no dialog
                    var nome = replaceSpace(File(file).name)
                    button(nome,File(file),audioSelection)
                }
            }
            janela.show()
        } else {//caso encontre apenas um arquivo com o nome do projeto, este será selecionado automaticamente
            audioSelection.replace(projAudioFilesList[0])
            alert("Arquivo atualizado!")
        }
    
    }catch(e){
        alert(e.message)
    }
}

// === NOVO: CLAQUETE (CSV) ===========================================================

function getClaqueteFolderPath(){
    // .../CLAQUETES ao lado do AEP (mantém padrão de subir 3 níveis como no áudio)
    var base = thisProject.file.parent.parent.parent;
    var folderPath = Folder(base.toString() + "/CLAQUETES");
    return folderPath; // pode não existir; trataremos no fluxo
}

function updateClaqueteCSV(csvSelection){
    try {
        if(!csvSelection){
            throw new Error("Nenhum item foi selecionado!")
        }
        if(!(csvSelection instanceof FootageItem) || !csvSelection.file){
            throw new Error("Selecione um FootageItem válido (arquivo).")
        }

        // garante que é .csv
        var ext = String(csvSelection.file.displayName).split(".").pop().toLowerCase();
        if(ext !== "csv"){
            throw new Error('O item selecionado não é ".csv".');
        }

        // preferencial: TL_TARJA_CLAQUETE.csv
        var targetNameRE = /^TL_TARJA_CLAQUETE\.csv$/i;

        var claquetesFolder = getClaqueteFolderPath();
        if(claquetesFolder.exists){
            // filtra arquivos que casem com TL_TARJA_CLAQUETE.csv
            var list = claquetesFolder.getFiles(function(f){
                return (f instanceof File) && targetNameRE.test(f.name);
            }) || [];

            if(list.length === 1){
                csvSelection.replace(list[0]);
                alert("Claquete atualizada!");
                return;
            } else if(list.length > 1){
                // múltiplas opções -> palette com botões (reaproveita button())
                janela = new Window("palette","Escolha o arquivo de claquete:");
                for(var i=0;i<list.length;i++){
                    var f = File(list[i]);
                    button(replaceSpace(f.name), f, csvSelection);
                }
                janela.show();
                return;
            }
            // se chegou aqui, não encontrou o nome exato: abre diálogo em CLAQUETES
            var pick = claquetesFolder.openDlg();
            if(pick){
                csvSelection.replace(pick);
                alert("Claquete atualizada!");
                return;
            }
            // se cancelou, cai para o alerta abaixo
        } else {
            // se não existe pasta CLAQUETES, abre diálogo direto
            var choose = File.openDialog("Selecione o CSV da claquete (TL_TARJA_CLAQUETE.csv)");
            if(choose){
                csvSelection.replace(choose);
                alert("Claquete atualizada!");
                return;
            }
        }

        alert('Arquivo "TL_TARJA_CLAQUETE.csv" não encontrado e nenhuma seleção foi feita.');
    } catch(e){
        alert(e.message);
    }
}

//todo =============================== EXECUÇÃO ========================================

var item = null

if(setActiveComp().selectedLayers[0] !== undefined){
    item = setActiveComp().selectedLayers[0]
    replaceImg(item)
} else if(thisProject.selection[0] !== undefined){
    item = thisProject.selection[0]

    // === Inclusão: decidir entre CSV (claquete) e ÁUDIO (wav) =======================
    if(item instanceof FootageItem && item.file){
        var _ext = String(item.file.displayName).split(".").pop().toLowerCase();

        if(_ext === "csv"){
            updateClaqueteCSV(item);
        } else {
            // preserva sua lógica existente de áudio
            updateAudioCarrefour(item);
        }
    }
}

if(item === null){
    alert("Nenhuma camada ou item do projeto selecionado")
}
