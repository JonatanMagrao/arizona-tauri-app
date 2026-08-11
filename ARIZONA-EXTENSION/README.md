# Arizona Extension (CEP â€” After Effects)

Painel CEP do Arizona para After Effects: ediÃ§Ã£o de ofertas, roteiro e render.
ConstruÃ­do sobre [Bolt CEP](https://hyperbrew.co/resources/bolt-cep)
(React + Vite + TypeScript); a documentaÃ§Ã£o do framework fica no site do Bolt,
nÃ£o aqui.

Este projeto Ã© **independente**: nÃ£o importa nada do Tauri, do plugin AEX nem
do admin. A Ãºnica relaÃ§Ã£o com o resto do ecossistema Ã© por contrato:

- lÃª o recibo de licenÃ§a `cep-license-receipt.json` gravado pelo Arizona App em
  `%LOCALAPPDATA%\com.pc.arizona-app\`;
- consulta primeiro o cache de previews preparado pelo Arizona App conforme o
  contrato `../docs/CACHE_PREVIEWS_PRODUTOS.md`, mantendo geraÃ§Ã£o local como
  fallback;
- lÃª `diagnostics-config.json` para gravar seu prÃ³prio JSONL na pasta local
  escolhida no Arizona App, conforme `../docs/DIAGNOSTICOS_LOCAIS.md`;
- no build, embute as chaves pÃºblicas do manifesto versionado
  `../ADMIN/supabase/license-trusted-keys.json` (Ãºnica exceÃ§Ã£o de fronteira,
  build-time e dado pÃºblico â€” ver `AGENTS.md` na raiz do repo).

## LicenÃ§a / bloqueio

- Sem recibo vÃ¡lido, o painel mostra "Plugin bloqueado" com o cÃ³digo do motivo
  entre parÃªnteses (ex.: `receipt_expired`).
- A validaÃ§Ã£o roda a cada 5s; o Arizona App renova o recibo enquanto aberto.
- `src/js/main/services/licenseTrustedKeys.generated.ts` Ã© **gerado** â€” nunca
  edite na mÃ£o. RotaÃ§Ã£o de chaves: ver `../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`
  na raiz do repo.
- No navegador (fora do CEP), o painel roda destravado (`browser_dev`).

## DiagnÃ³stico local

Dentro do Adobe CEP, o painel usa o Node do host para gravar
`arizona-cep-AAAA-MM-DD.jsonl`. O ExtendScript nÃ£o escreve arquivos de log
diretamente; o painel registra as etapas observadas e marca
`runtime: "extendscript"` quando aplicÃ¡vel. A gravaÃ§Ã£o Ã© sequencial e
assÃ­ncrona; cada evento tenta a pasta selecionada e depois o fallback local.

A pasta Ã© escolhida em **ConfiguraÃ§Ãµes > DiagnÃ³stico** no Arizona App e o
fallback Ã© `%LOCALAPPDATA%\com.pc.arizona-app\logs`. A retenÃ§Ã£o mantÃ©m o dia
atual e os 13 anteriores. NÃ£o existe envio automÃ¡tico: o usuÃ¡rio exporta e
compartilha o pacote somente quando desejar. Formato, saneamento, migraÃ§Ã£o e
soluÃ§Ã£o de problemas: `../docs/DIAGNOSTICOS_LOCAIS.md`.

## Comandos

```powershell
npm run dev          # HMR (painel em localhost:3000; exige build previo uma vez)
npm run build        # build de produÃ§Ã£o; embute chaves e atualiza a junction do CEP
npm run build:debug  # igual ao build, mas grava %LOCALAPPDATA%\com.pc.arizona-app\cep-license-debug.json
npm run license:keys # (roda sozinho nos pre-hooks) regenera o mÃ³dulo de chaves
```

O pacote oficial assinado nÃ£o Ã© gerado pelo `npm run zxp` desta pasta, pois
esse comando do framework pode criar uma identidade descartÃ¡vel. Para gerar o
artefato distribuÃ­vel com o certificado estÃ¡vel da Arizona, rode na raiz:

```powershell
npm run cep:zxp
```

A extensÃ£o instalada no Adobe CEP Ã© uma junction criada pelo build:

```text
%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep -> dist\cep
```

Depois de um build novo, reinicie o After Effects para recarregar o painel.

## Estrutura

```text
src/js/main/    painel React (UI, hooks, services) â€” ver src/js/main/AGENTS.md
src/jsx/aeft/   ExtendScript (manipulaÃ§Ã£o do projeto AE) â€” ver src/jsx/aeft/AGENTS.md
src/js/lib/     runtime do Bolt CEP (csinterface, utils) â€” nÃ£o editar sem necessidade
scripts/        gerador do mÃ³dulo de chaves de licenÃ§a
cep.config.ts   id, painel, portas e empacotamento
```

Regra de fronteira interna: o front (`js/main`) fala com o After Effects apenas
via `evalTS` atravÃ©s dos services de domÃ­nio; objetos nativos do AE sÃ³ existem
em `src/jsx/aeft`.
