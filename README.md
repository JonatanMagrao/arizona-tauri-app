# Arizona App

Monorepo com os quatro projetos do ecossistema Arizona. Cada projeto é
independente — eles se comunicam por contratos (arquivo assinado, named pipe,
HTTP), nunca por import de código. Veja `AGENTS.md` para o mapa de fronteiras.

| Projeto | Pasta | Descrição |
|---|---|---|
| **Tauri (Arizona App)** | raiz — `src/` (React) + `src-tauri/` (Rust) | App desktop dos usuários finais: jobs, mídias, importação de produtos, histórico, atalhos do After. Autoridade local de sessão/licença. |
| **Extensão CEP** | `ARIZONA-EXTENSION/` | Painel React dentro do After Effects (ofertas, roteiro, render). Bloqueia/libera pela licença do Arizona App. |
| **Plugin AEX** | `AE-PLUGIN-ARIZONA/` | Plugin nativo (C++) que executa os atalhos globais dentro do After Effects. |
| **Admin** | `ADMIN/` | Painel web de gestão de licenças + Supabase (migrations, Edge Functions, scripts de chave). |

## Licenciamento: leia antes de mexer

Antes de alterar autenticação, licenciamento, Supabase, extensão CEP, plugin
AEX, secrets, tokens ou chaves, leia:

[LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md)

Diagnóstico rápido de paridade das chaves (env, manifesto, extensão, plugin,
recibo em disco):

```powershell
npm run license:check
```

## Comandos do dia a dia

Tudo junto (Tauri + extensão CEP em modo dev, nesta raiz):

```powershell
npm run dev:all            # sobe tauri:dev:bridge e o dev da extensão lado a lado
```

Tauri (nesta raiz):

```powershell
npm run tauri:dev:bridge   # dev com token de desenvolvimento do bridge AEX
npm run tauri:build        # build de produção
npm run cep:dev            # atalho para o dev da extensão sem trocar de pasta
npm run cep:build          # atalho para o build de produção da extensão
```

Extensão CEP:

```powershell
cd ARIZONA-EXTENSION
npm run dev                # HMR durante desenvolvimento
npm run build              # build de produção (embute chaves e atualiza a junction do CEP)
```

Admin:

```powershell
cd ADMIN
npm run dev                # painel local (porta 1430)
```

Plugin AEX: ver `AE-PLUGIN-ARIZONA/README.md` (build via
`sample/Win/build.ps1`).

## Roadmap

Melhorias de arquitetura do app Tauri estão registradas em
[roadmap.md](./roadmap.md).

## IDE recomendada

[VS Code](https://code.visualstudio.com/) +
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
