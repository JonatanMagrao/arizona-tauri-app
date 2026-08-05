# Revisão do visualizador de mídia — MP4 e MOV

**Status:** proposta para implementação
**Última revisão:** 04/08/2026
**Escopo:** Arizona App (Tauri)

Esta revisão não altera o render do After Effects, não instala codecs e não
adiciona FFmpeg. Seu objetivo é tornar a prévia de MP4 confiável em qualquer
pasta configurada, documentar a limitação de MOV e melhorar as mensagens
apresentadas ao usuário.

## Decisões

- MP4 compatível continuará usando o player do WebView2, sem FFmpeg externo.
- O caminho configurado em **Carrefour Drive** será a autoridade; o visualizador
  não dependerá da letra `I:`.
- O backend validará o caminho e adicionará cada mídia individualmente ao
  Asset Protocol; nenhuma pasta inteira do Drive será liberada.
- MOV continuará sem garantia de reprodução direta.
- Quando existir um MP4 correspondente ao MOV, ele será usado como prévia.
- Sem prévia compatível, o arquivo será aberto no aplicativo padrão do Windows.
- Um erro produzirá somente uma mensagem visível, escrita em linguagem humana.

## Fluxo atual

1. O backend procura o vídeo em `OUT/RENDER/MP4` ou `OUT/RENDER/MOV`.
2. O Rust tenta abrir a janela secundária e, se nem isso for possível, abre o
   arquivo diretamente no aplicativo padrão do Windows.
3. Na janela interna, o frontend transforma o caminho com `convertFileSrc()`.
4. Um elemento `<video>` do WebView2 tenta reproduzir o arquivo.
5. O evento de erro do player mostra uma mensagem genérica e tenta abrir o
   visualizador do Windows. Uma falha após o usuário acionar **Reproduzir**
   também usa esse fallback.

As ações principais de vídeo e áudio possuem ainda um fallback no Rust quando a
janela interna nem chega a abrir. Os comandos vindos do histórico não passam
por esse mesmo caminho. A implementação futura deve unificar essas entradas.

O aplicativo não distribui `ffmpeg.exe`, mpv, VLC ou outro motor próprio de
decodificação. Um MP4 em H.264/AVC com áudio AAC deve funcionar usando os
componentes normais do WebView2 e do Windows.

H.265/HEVC possui suporte condicional e pode depender dos componentes de mídia
instalados. Edições Windows N também podem precisar do Media Feature Pack. Isso
não muda a decisão de não exigir FFmpeg externo para o MP4 padrão.

## Problemas confirmados

### Caminho configurável, permissão fixa

O Carrefour Drive pode ser alterado nas configurações, mas o
`assetProtocol.scope` atual permite apenas a pasta local específica do Arizona
(`$APPLOCALDATA/**`) e o caminho fixo:

```text
I:\Drives compartilhados\Phx CRF Copa\**
```

Isso cria uma divergência:

1. o backend encontra o MP4 em outra letra ou pasta configurada;
2. a janela interna recebe o caminho correto;
3. o Asset Protocol pode recusar esse caminho;
4. o player informa apenas que não conseguiu reproduzir;
5. o visualizador do Windows pode abrir o mesmo arquivo normalmente.

### Falhas diferentes recebem mensagens insuficientes ou inconsistentes

O erro do `<video>` não distingue para o usuário uma falha de acesso pelo Asset
Protocol, interrupção de leitura, decodificação ou formato. Em etapas anteriores
e no fallback nativo existem outras mensagens, algumas genéricas ou técnicas.
No fluxo completo, ainda é necessário tratar de forma consistente:

- Drive desconectado;
- arquivo removido, renomeado ou ainda não sincronizado;
- caminho fora da pasta configurada;
- falta de permissão de leitura;
- arquivo incompleto;
- formato de vídeo não suportado;
- falha ao abrir o aplicativo padrão do Windows.

O `media.error.code` do elemento de vídeo também não é usado hoje. Ele ajuda,
mas não identifica sozinho problemas de escopo, sincronização ou arquivo
incompleto. A classificação deve combinar a validação do Rust, o resultado da
leitura, o código do player e o resultado do fallback.

### Seleção do arquivo não é uniforme

A busca principal aceita o primeiro item cujo nome começa com o nome do projeto,
sem aplicar a mesma filtragem e ordenação usadas no fallback por código de
jobinho. Um arquivo auxiliar ou mais de um item com o mesmo prefixo pode tornar
a escolha imprecisa.

A revisão deve centralizar a localização de mídia: aceitar somente arquivo com
a extensão solicitada, ordenar candidatos e nunca depender da ordem devolvida
pelo Windows.

### O fallback `file:///` não resolve o escopo

Se `convertFileSrc()` lançar uma exceção, o frontend tenta montar uma URL
`file:///`. Normalmente a recusa de escopo acontece depois, quando o WebView
solicita a mídia, e não durante a conversão da string. O acesso direto também
pode ser bloqueado pelo WebView ou pela CSP; portanto, esse fallback não deve
ser considerado uma correção para caminhos fora do `assetProtocol.scope`.

### Mensagem duplicada

A falha aparece dentro do player e em um toast. O usuário recebe duas
notificações para o mesmo acontecimento.

### Fallback informado antes do resultado

A interface diz “Abrindo no visualizador do sistema” antes de saber se a ação
funcionou. Se também falhar, outra mensagem substitui a primeira.

### Reprodução automática deve continuar separada

O código atual já ignora corretamente a rejeição da primeira tentativa de
autoplay e mantém o botão de reprodução disponível. Esse comportamento deve ser
preservado: uma política de autoplay não comprova incompatibilidade do arquivo e
não deve abrir outro aplicativo. Uma rejeição depois de clique ou tecla também
só deve acionar o fallback quando houver evidência de falha da mídia.

## Diagnóstico enquanto a correção não é implementada

Para um relato de MP4 que não abre:

1. conferir o caminho exato salvo em **Carrefour Drive**;
2. se ele não estiver dentro do caminho fixo `I:\...`, considerar primeiro a
   divergência do Asset Protocol;
3. arrastar o mesmo arquivo para uma aba do Microsoft Edge;
4. se funcionar no Edge e falhar no Arizona, priorizar a investigação de caminho
   e permissão do app;
5. se também falhar no Edge, conferir o formato com uma ferramenta como
   MediaInfo; H.264/AVC com AAC é a combinação preferencial;
6. verificar se outro MP4 conhecido funciona na mesma máquina.

O fato de VLC ou outro aplicativo abrir o arquivo não comprova compatibilidade
com o WebView2, pois esses programas podem usar decodificadores próprios.

## Fluxo proposto para MP4

1. Localizar o arquivo no backend.
2. Confirmar que ele existe e pode ser lido.
3. Canonicalizar o caminho.
4. Confirmar que o arquivo pertence ao Carrefour Drive configurado.
5. Adicionar somente esse arquivo validado ao escopo do Asset Protocol no
   processo atual.
6. Enviar ao player o mesmo caminho já validado.
7. Tentar a reprodução interna.
8. Classificar uma eventual falha sem expor detalhes técnicos.
9. Oferecer ou executar o fallback apropriado.
10. Mostrar apenas o resultado real da ação.

Todos os pontos de entrada — tela principal, histórico e histórico de cópias —
devem usar a mesma preparação. Não se deve liberar o disco inteiro, uma unidade
inteira ou `scope: ["**"]`.

As liberações individuais são cumulativas até o encerramento do processo. O
escopo estático de `$APPLOCALDATA/**` pode permanecer se ainda for necessário
para arquivos gerenciados pelo próprio Arizona; o que deve desaparecer é a
liberação estática de uma pasta inteira do Carrefour Drive.

Uma alternativa seria copiar o vídeo para a pasta específica do app,
`%LOCALAPPDATA%\com.pc.arizona-app`, que já está no escopo. Ela não é
recomendada: vídeos grandes criariam espera, duplicação, limpeza de cache e
consumo desnecessário de disco.

## Limitação do MOV

MOV é um contêiner e pode carregar formatos diferentes. Alguns arquivos com
H.264 podem funcionar, mas ProRes, Animation e outros formatos comuns de
produção não têm reprodução garantida no WebView2.

### Estratégia recomendada

Esta proposta prefere imediatamente o MP4 como prévia; não tenta primeiro
decodificar o MOV original.

1. Ao solicitar um MOV, procurar o MP4 correspondente.
2. Se existir, reproduzir esse MP4 como prévia no Arizona.
3. Manter o MOV original como arquivo de entrega.
4. Se não houver MP4, abrir o MOV no aplicativo padrão do Windows.
5. Se a prévia MP4 também falhar, abrir o MOV original no Windows.

A correspondência precisa ser determinística para não exibir outro render por
engano:

1. preferir um MP4 com o mesmo nome-base do MOV;
2. usar projeto ou código de jobinho apenas como fallback;
3. aceitar somente arquivos reais com extensão `.mp4`;
4. se mais de um candidato continuar igualmente válido, não escolher um ao
   acaso: considerar que não há prévia inequívoca e abrir o MOV no Windows.

Incorporar FFmpeg, mpv ou VLC aumentaria o tamanho do instalador, a manutenção,
a superfície de segurança e a complexidade de distribuição e licenças. Caso a
solução também transcodificasse arquivos, haveria custo adicional de CPU,
espera e possível uso de arquivos temporários. Isso não é necessário para
corrigir o fluxo normal de MP4.

## Mensagens sugeridas para mídia

| Situação | Mensagem para o usuário |
|---|---|
| Drive inacessível | Não conseguimos acessar o Carrefour Drive. Verifique se ele está conectado e tente novamente. |
| Arquivo ausente | Não encontramos este vídeo. Ele pode ter sido movido, renomeado ou ainda não terminou de sincronizar. |
| Fora da configuração | Este vídeo não está na pasta configurada. Confira o Carrefour Drive nas Configurações. |
| Acesso recusado | Não conseguimos acessar este vídeo. Verifique se a pasta está disponível e tente novamente. |
| MP4 não reproduzido, fallback concluído | Este vídeo não pôde ser reproduzido no Arizona e foi aberto no aplicativo padrão do Windows. |
| MOV com prévia | Usando a versão MP4 como prévia deste MOV. |
| MOV sem prévia, fallback concluído | A prévia deste MOV não está disponível. O arquivo foi aberto no aplicativo padrão do Windows. |
| Fallback falhou | Não conseguimos reproduzir o vídeo no Arizona nem abri-lo no Windows. Abra a pasta e escolha outro aplicativo de vídeo. |
| Falha desconhecida | Não conseguimos reproduzir este vídeo agora. Tente novamente. |

A informação sobre a prévia MP4 é contexto, não erro, e deve aparecer de forma
discreta no player, sem toast. Antes de tentar o fallback, a interface pode
oferecer o botão **Abrir no Windows**. Depois da tentativa automática, deve
informar somente o resultado real.

## Padrão geral para mensagens de erro

Esta revisão começa pelo visualizador, mas o padrão pode ser aplicado
progressivamente aos outros fluxos do Tauri e da extensão. Não é necessário
reescrever mensagens que já são claras.

Uma mensagem destinada ao usuário deve responder, quando possível:

1. o que aconteceu;
2. qual foi a consequência;
3. o que ele pode fazer agora.

Regras:

- não mostrar `WebView`, Asset Protocol, códigos HTTP, APIs, stack trace ou erro
  bruto do Windows;
- evitar “erro inesperado” quando já for possível identificar arquivo, acesso,
  conexão ou formato;
- não adivinhar a causa quando ela não foi confirmada;
- não culpar o usuário;
- não repetir o mesmo erro em modal, toast e conteúdo da janela;
- não anunciar sucesso antes de a operação terminar;
- oferecer uma ação útil, como **Tentar novamente**, **Abrir no Windows** ou
  **Revisar configurações**;
- manter detalhes técnicos e códigos estruturados somente para diagnóstico.

Os erros internos podem usar códigos estáveis, por exemplo:

```text
media_not_found
media_drive_unavailable
media_not_ready
media_outside_config
media_access_denied
media_decode_failed
media_format_unsupported
media_native_open_failed
```

Esses códigos não precisam aparecer na mensagem principal. Podem ser usados em
logs locais ou numa futura ação voluntária de suporte, respeitando a política de
privacidade.

## Testes necessários

- MP4 H.264/AAC no caminho padrão `I:`;
- o mesmo MP4 em outra letra de unidade;
- caminho com espaços e caracteres acentuados;
- caminho UNC ou de rede, se for oficialmente suportado;
- arquivo do Google Drive disponível localmente e somente on-line;
- Drive desconectado durante a abertura e durante a reprodução;
- mudança do Carrefour Drive sem reiniciar o aplicativo;
- dois vídeos sucessivos na mesma sessão;
- arquivo removido depois de localizado;
- MP4 HEVC, cujo resultado depende dos componentes disponíveis, com fallback
  humano quando não houver suporte;
- MP4 XAVC ou outro formato não suportado;
- arquivo MP4 incompleto;
- arquivo auxiliar ou pasta com o mesmo prefixo do projeto;
- mais de um MP4 válido com o mesmo prefixo;
- MOV H.264;
- MOV ProRes e Animation, com e sem MP4 correspondente;
- mais de um MP4 candidato para o mesmo código, sem escolha aleatória;
- nomes contendo `#`, `%`, `?` e caracteres Unicode;
- computador sem aplicativo padrão de vídeo;
- abertura pela tela principal, histórico e histórico de cópias;
- histórico apontando para um Drive antigo;
- seek em MP4 grande ou localizado em unidade compartilhada;
- reprodução de áudio depois da mudança de escopo;
- arquivo fora das raízes configuradas, que deve continuar bloqueado;
- bloqueio de autoplay, que não deve ser tratado como erro de formato.

## Critérios de aceite

- nenhuma reprodução depende da letra fixa `I:`;
- um MP4 H.264/AAC conhecido, disponível localmente, dentro do Drive configurado
  e em uma instalação suportada do Windows abre no player interno;
- a localização nunca escolhe pasta, extensão errada ou candidato ao acaso;
- somente mídias previamente validadas são adicionadas individualmente ao Asset
  Protocol; nenhuma pasta do Drive é liberada integralmente;
- arquivos fora das raízes permitidas continuam bloqueados;
- uma falha gera somente uma mensagem visível;
- nenhuma mensagem voltada ao usuário apresenta termos técnicos;
- o fallback informa corretamente se abriu ou se também falhou;
- MOV incompatível usa a prévia MP4 ou o aplicativo padrão do Windows;
- o fluxo básico de MP4 não exige FFmpeg; edições Windows N podem precisar do
  recurso de mídia do próprio sistema.

## Arquivos envolvidos numa implementação futura

- `src-tauri/tauri.conf.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/media.rs`
- `src-tauri/src/arizona/media_files.rs`
- `src-tauri/src/history.rs`
- `src-tauri/src/settings.rs`
- `src/features/secondary/SecondaryWindow.jsx`
- testes Rust de validação e escopo de mídia
- testes de frontend para classificação e apresentação dos erros

## Referências técnicas

- [Tauri — configuração do Asset Protocol](https://v2.tauri.app/reference/config/#assetprotocolconfig)
- [Tauri 2.8.4 — escopo do Asset Protocol em runtime](https://docs.rs/tauri/2.8.4/tauri/trait.Manager.html#method.asset_protocol_scope)
- [Microsoft Edge — solução de problemas de reprodução de vídeo](https://learn.microsoft.com/pt-br/troubleshoot/microsoft-edge/development/video-playback-issues)
