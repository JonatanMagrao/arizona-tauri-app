# AGENTS.md — Mapa do repositório e fronteiras

Este repositório contém QUATRO projetos separados. Eles conversam entre si por
contratos bem definidos (arquivos assinados, named pipe, HTTP), mas **não se
misturam**: código de um projeto nunca importa código de outro.

## Os quatro projetos

| Projeto | Pasta | O que é | Doc principal |
|---|---|---|---|
| **Tauri (Arizona App)** | raiz (`src/`, `src-tauri/`) | App desktop usado pelos usuários finais. Autoridade local de sessão/licença. | `README.md` |
| **Extensão CEP** | `ARIZONA-EXTENSION/` | Painel React dentro do After Effects (ofertas, roteiro, render). | `ARIZONA-EXTENSION/README.md` |
| **Plugin AEX** | `AE-PLUGIN-ARIZONA/` | Plugin nativo C++ do After Effects que executa os atalhos globais. | `AE-PLUGIN-ARIZONA/README.md` |
| **Admin** | `ADMIN/` | Painel web de gestão de licenças + Supabase (migrations, Edge Functions, chaves). | `ADMIN/README.md` |

## Como eles conversam (e é SÓ assim que conversam)

```text
ADMIN/Supabase (Edge Function validate-license)
    |                          |
    | sessão + cepLicenseReceipt (JWS)         bridgeToken (JWS)
    v                          v
Tauri (raiz) ── grava ──> cep-license-receipt.json ── lê ──> Extensão CEP
    |
    └── named pipe \\.\pipe\arizona-aegp-bridge ──> Plugin AEX
```

- **Tauri → Extensão CEP**: apenas pelo arquivo `cep-license-receipt.json` em
  `%LOCALAPPDATA%\com.pc.arizona-app\`. A extensão NÃO recebe comandos do Tauri,
  não abre socket com ele e não executa `evalScript` a pedido dele.
- **Tauri → Plugin AEX**: apenas pelo named pipe, com `bridgeToken` assinado.
- **Extensão e Plugin nunca falam entre si.**
- **Todos validam assinatura com chave pública embutida**; nenhum segredo sai
  do backend (`ADMIN/supabase/functions/.env.production.local`, gitignored).

## Regras de fronteira para agentes

1. **Não importe código entre projetos.** A extensão não enxerga nada do Tauri;
   o Tauri não enxerga nada da extensão; etc. Se dois projetos precisam do mesmo
   dado, ele passa pelo contrato (arquivo assinado, pipe ou HTTP), nunca por
   import.
2. **Exceção única e sancionada**: o build da extensão lê o manifesto público
   `ADMIN/supabase/license-trusted-keys.json` (via
   `ARIZONA-EXTENSION/scripts/generate-license-trusted-keys.mjs`) para embutir
   as chaves públicas de licença. É leitura de build-time de dado público
   versionado — não é acoplamento de runtime. Não crie outras exceções.
3. **Cada projeto tem seu próprio package.json/lockfile/node_modules** (raiz,
   `ARIZONA-EXTENSION/`, `ADMIN/`). Rode os comandos npm dentro da pasta certa.
4. Trabalhando em um projeto, siga os AGENTS.md internos dele quando existirem
   (ex.: `ARIZONA-EXTENSION/src/js/main/AGENTS.md`,
   `ARIZONA-EXTENSION/src/jsx/aeft/AGENTS.md`).

## Licenciamento — leia antes de mexer

Antes de alterar autenticação, licenciamento, Supabase secrets, validação da
extensão CEP, validação do bridge AEX, chaves públicas/privadas ou geração de
tokens, leia `LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.

- NÃO delete, regenere, sobrescreva ou faça upload de chaves de licença sem uma
  rotação planejada pedida explicitamente pelo usuário.
- Diagnóstico de paridade das chaves: `npm run license:check` (na raiz).

## Notas operacionais

- Após rodar checks/builds Rust com target temporário, remova pastas geradas
  como `src-tauri/target-codex/` antes de finalizar a tarefa.
- Se locks de arquivo do Windows impedirem a limpeza, mencione a pasta restante
  claramente na resposta final; não deixe como ruído de Git sem explicação.
- A extensão instalada no Adobe CEP é uma junction para
  `ARIZONA-EXTENSION\dist\cep`; o build recria/aponta a junction sozinho.
- O usuário costuma ter `tauri dev` e watch da extensão rodando — espere locks
  de build e rebuilds automáticos.
