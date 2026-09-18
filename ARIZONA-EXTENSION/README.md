# Arizona Extension (CEP — After Effects)

Painel CEP do Arizona para After Effects: edição de ofertas e roteiro, com
botão de render local.
Construído sobre [Bolt CEP](https://hyperbrew.co/resources/bolt-cep)
(React + Vite + TypeScript); a documentação do framework fica no site do Bolt,
não aqui.

Este projeto é **independente**: não importa nada do Tauri, do plugin AEX nem
do admin. A única relação com o resto do ecossistema é por contrato:

- lê o recibo de licença `cep-license-receipt.json` gravado pelo Arizona App em
  `%LOCALAPPDATA%\com.pc.arizona-app\`;
- consulta primeiro o cache de previews preparado pelo Arizona App conforme o
  contrato `../docs/CACHE_PREVIEWS_PRODUTOS.md`, mantendo geração local como
  fallback;
- lê `diagnostics-config.json` para gravar seu próprio JSONL na pasta local
  escolhida no Arizona App, conforme `../docs/DIAGNOSTICOS_LOCAIS.md`;
- no build, embute as chaves públicas do manifesto versionado
  `../ADMIN/supabase/license-trusted-keys.json` (única exceção de fronteira,
  build-time e dado público — ver `AGENTS.md` na raiz do repo).

## Licença / bloqueio

- Sem recibo válido, o painel mostra "Painel indisponível" e uma mensagem
  humana explicando o motivo e o que o usuário pode fazer.
- A validação roda a cada 5s; o Arizona App renova o recibo enquanto aberto.
- `src/js/main/services/licenseTrustedKeys.generated.ts` é **gerado** — nunca
  edite na mão. Rotação de chaves: ver `../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`
  na raiz do repo.
- No navegador (fora do CEP), o painel roda destravado (`browser_dev`).

## Diagnóstico local

Dentro do Adobe CEP, o painel usa o Node do host para gravar
`arizona-cep-AAAA-MM-DD.jsonl`. O ExtendScript não escreve arquivos de log
diretamente; o painel registra as etapas observadas e marca
`runtime: "extendscript"` quando aplicável. A gravação é sequencial e
assíncrona; cada evento tenta a pasta selecionada e depois o fallback local.

A pasta é escolhida em **Configurações > Diagnóstico** no Arizona App e o
fallback é `%LOCALAPPDATA%\com.pc.arizona-app\logs`. A retenção mantém o dia
atual e os 13 anteriores. Não existe envio automático: o usuário exporta e
compartilha o pacote somente quando desejar. Formato, saneamento, migração e
solução de problemas: `../docs/DIAGNOSTICOS_LOCAIS.md`.

## Troca de projeto

O botão de pasta ao lado da engrenagem permite abrir outro `.aep` ou `.aepx`
dentro do After Effects. O seletor começa na pasta do projeto atual, permitindo
reabrir o mesmo arquivo ou navegar para outras pastas. Sem projeto salvo ou com
a pasta indisponível, usa a localização padrão do diálogo.
Primeiro escolhe o arquivo; em seguida, fecha o projeto
atual com a confirmação nativa para salvar alterações, limpa os caches do After
(`PurgeTarget.ALL_CACHES`) e abre o arquivo escolhido. Cancelar a escolha ou o
fechamento interrompe a operação. A limpeza de cache não apaga as miniaturas do
Arizona; no After Effects 24.3 ou mais recente, ela limpa RAM e cache de disco.

Após a abertura, o painel descarta os dados do projeto anterior e carrega a aba
ativa com os dados do novo projeto, inclusive ao reabrir o mesmo arquivo. A outra
aba carrega ao ser selecionada. A aba atual é mantida. Se a abertura falhar
depois de fechar o projeto anterior, o painel reflete o estado atual do After.
Se apenas a limpeza de cache falhar, a abertura continua e exibe um aviso.
Enquanto uma ação estiver em andamento, o botão fica indisponível.

Essa atualização ocorre ao abrir pelo botão do painel; não há consulta periódica
para detectar aberturas pelo menu do After Effects.

## Carregamento do roteiro

Ao voltar à aba Roteiro no mesmo projeto, o painel reaproveita o texto extraído
do DOCX se caminho, tamanho e datas de alteração dos metadados ainda coincidem.
O cache fica somente em memória, limitado a um documento de até 2 milhões de
caracteres. Trocar ou reabrir o projeto cria um cache novo; arquivo alterado,
ausente ou ilegível não reutiliza o texto antigo. O botão de atualização e a
escolha manual do DOCX forçam uma nova leitura completa.

Ao atualizar um roteiro já exibido, o conteúdo e a rolagem permanecem na tela
enquanto o ícone de atualização gira. As ações ficam bloqueadas até a consulta
terminar; falhas descartam a validação anterior e exibem a mensagem de erro.

A cada entrada na aba, o painel consulta novamente as ofertas no After para
validar os valores atuais. Essa consulta lê a mecânica do primeiro produto
ativo de cada oferta, sem montar os dados de imagens, descrições e textos legais
do editor. Não há consulta periódica nem validações antigas em cache.

Os eventos locais de carregamento registram separadamente o tempo da consulta
ao After, da localização do DOCX e da leitura/reutilização do texto. Não gravam
o conteúdo do roteiro, nomes de arquivo ou caminhos.

## Render local

O CEP não executa `aerender` e não possui uma aba de render dedicada. O botão
**Render** do Roteiro apenas adiciona duas saídas à fila nativa do After
Effects: a composição `EXPORT` como MOV usando o modelo `PROXY` e a composição
`EXPORT_MP4` como MP4 usando o modelo `MP4`.

## Comandos

```powershell
npm run dev          # HMR (painel em localhost:3000; exige build prévio uma vez)
npm run build        # build de produção; embute chaves e atualiza a junction do CEP
npm run build:debug  # igual ao build, mas grava %LOCALAPPDATA%\com.pc.arizona-app\cep-license-debug.json
npm run license:keys # (roda sozinho nos pre-hooks) regenera o módulo de chaves
```

O pacote oficial assinado não é gerado pelo `npm run zxp` desta pasta, pois
esse comando do framework pode criar uma identidade descartável. Para gerar o
artefato distribuível com o certificado estável da Arizona, rode na raiz:

```powershell
npm run cep:zxp
```

A extensão instalada no Adobe CEP é uma junction criada pelo build:

```text
%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep -> dist\cep
```

Depois de um build novo, reinicie o After Effects para recarregar o painel.

## Estrutura

```text
src/js/main/    painel React (UI, hooks, services) — ver src/js/main/AGENTS.md
src/jsx/aeft/   ExtendScript (manipulação do projeto AE) — ver src/jsx/aeft/AGENTS.md
src/js/lib/     runtime do Bolt CEP (csinterface, utils) — não editar sem necessidade
scripts/        gerador do módulo de chaves de licença
cep.config.ts   id, painel, portas e empacotamento
```

Regra de fronteira interna: o front (`js/main`) fala com o After Effects apenas
via `evalTS` através dos services de domínio; objetos nativos do AE só existem
em `src/jsx/aeft`.
