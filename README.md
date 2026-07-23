# Arizona App

Monorepo com três projetos ativos do ecossistema Arizona. Cada projeto é
independente e se comunica apenas pelos contratos descritos em `AGENTS.md`.

| Projeto | Pasta | Descrição |
|---|---|---|
| **Tauri (Arizona App)** | raiz — `src/` + `src-tauri/` | App desktop: jobs, mídias, produtos, histórico e atalhos do After executados por ExtendScript embutido. |
| **Extensão CEP** | `ARIZONA-EXTENSION/` | Painel React dentro do After Effects, liberado pelo recibo de licença do Arizona App. |
| **Admin** | `ADMIN/` | Gestão de licenças + Supabase. |

`AE-PLUGIN-ARIZONA/` é apenas o arquivo histórico do bridge AEX aposentado. O
build e o instalador atuais não compilam, empacotam nem instalam plugin nativo.

## Licenciamento

Antes de alterar autenticação, licenciamento, Supabase, extensão CEP, secrets,
tokens ou chaves, leia
[LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md).

Diagnóstico:

```powershell
npm run license:check
```

O horário de renovação diária é configurado por licença no painel Admin. O
padrão é `04:00` em `America/Sao_Paulo`; isso controla a sessão diária e o
recibo CEP, não a expiração global do refresh token do Supabase.

## Comandos do dia a dia

Tudo junto:

```powershell
npm run dev:all
```

Tauri:

```powershell
npm run tauri:dev
npm run tauri:build
npm run cep:dev
npm run cep:build
```

Extensão CEP:

```powershell
cd ARIZONA-EXTENSION
npm run dev
npm run build
```

Admin:

```powershell
cd ADMIN
npm run dev
```

## Atalhos do After Effects

O Tauri registra os atalhos globais, exige uma sessão autenticada e executa o
motor JSX embutido através do comando oficial `AfterFX.exe -r`. Os arquivos
materializados ficam nos dados locais do Arizona App, nunca nas pastas
`Plug-ins` ou `Scripts` do Adobe.

O fonte mantido pelo projeto fica em
`src-tauri/src/after_effects/arizona_actions.jsx`. Em `npm run tauri:dev`, ele
continua legivel e e materializado como `.jsx`. No build release, o
`src-tauri/build.rs` chama `scripts/build-after-effects-jsxbin.mjs`, gera uma
variante `.jsxbin` por acao e embute somente essas variantes no executavel.
JSXBIN dificulta a leitura casual do codigo distribuido, mas nao deve ser
tratado como criptografia ou como uma fronteira de seguranca.

## Roadmap

Melhorias do app Tauri estão em [roadmap.md](./roadmap.md).
