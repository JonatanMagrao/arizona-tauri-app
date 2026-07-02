# Arizona Extension (CEP — After Effects)

Painel CEP do Arizona para After Effects: edição de ofertas, roteiro e render.
Construído sobre [Bolt CEP](https://hyperbrew.co/resources/bolt-cep)
(React + Vite + TypeScript); a documentação do framework fica no site do Bolt,
não aqui.

Este projeto é **independente**: não importa nada do Tauri, do plugin AEX nem
do admin. A única relação com o resto do ecossistema é por contrato:

- lê o recibo de licença `cep-license-receipt.json` gravado pelo Arizona App em
  `%LOCALAPPDATA%\com.pc.arizona-app\`;
- no build, embute as chaves públicas do manifesto versionado
  `../ADMIN/supabase/license-trusted-keys.json` (única exceção de fronteira,
  build-time e dado público — ver `AGENTS.md` na raiz do repo).

## Licença / bloqueio

- Sem recibo válido, o painel mostra "Plugin bloqueado" com o código do motivo
  entre parênteses (ex.: `receipt_expired`).
- A validação roda a cada 5s; o Arizona App renova o recibo enquanto aberto.
- `src/js/main/services/licenseTrustedKeys.generated.ts` é **gerado** — nunca
  edite na mão. Rotação de chaves: ver `LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`
  na raiz do repo.
- No navegador (fora do CEP), o painel roda destravado (`browser_dev`).

## Comandos

```powershell
npm run dev          # HMR (painel em localhost:3000; exige build previo uma vez)
npm run build        # build de produção; embute chaves e atualiza a junction do CEP
npm run build:debug  # igual ao build, mas grava %LOCALAPPDATA%\com.pc.arizona-app\cep-license-debug.json
npm run zxp          # pacote ZXP para distribuição
npm run license:keys # (roda sozinho nos pre-hooks) regenera o módulo de chaves
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
