# AGENTS.md — Mapa do repositório e fronteiras

Este repositório contém TRÊS projetos ativos e um arquivo legado. Eles conversam
por contratos bem definidos, mas código de um projeto nunca importa código de
outro.

## Projetos ativos

| Projeto | Pasta | O que é | Doc principal |
|---|---|---|---|
| **Tauri (Arizona App)** | raiz (`src/`, `src-tauri/`) | App desktop, autoridade local de sessão/licença e executor dos atalhos do After via ExtendScript embutido. | `README.md` |
| **Extensão CEP** | `ARIZONA-EXTENSION/` | Painel React dentro do After Effects (ofertas, roteiro, render). | `ARIZONA-EXTENSION/README.md` |
| **Admin** | `ADMIN/` | Gestão de licenças + Supabase (migrations, Edge Functions e chaves). | `ADMIN/README.md` |

`AE-PLUGIN-ARIZONA/` preserva o código-fonte do antigo plugin AEX apenas como
histórico. Ele não faz parte do runtime, do build oficial nem do instalador.

## Como os projetos conversam

```text
ADMIN/Supabase (Edge Function validate-license)
    |
    | sessão + cepLicenseReceipt (JWS)
    v
Tauri (raiz) ── grava ──> cep-license-receipt.json ── lê ──> Extensão CEP
    |
    ├── prepara ──> cache local de previews ── lê ──> Extensão CEP
    |
    └── materializa JSX embutido em AppData
          └── AfterFX.exe -r <acao.jsx> ──> After Effects
```

- **Tauri → Extensão CEP**: pelo recibo
  `cep-license-receipt.json` em `%LOCALAPPDATA%\com.pc.arizona-app\` e pelo
  cache local de previews documentado em `docs/CACHE_PREVIEWS_PRODUTOS.md`.
  O cache contém somente miniaturas e metadados de arquivos; não transporta
  comandos, sessão ou dados de licença.
- **Tauri → After Effects**: os atalhos exigem sessão autenticada no Tauri. O
  Tauri embute `src-tauri/src/after_effects/arizona_actions.jsx`, materializa
  lançadores em `%LOCALAPPDATA%\com.pc.arizona-app\after-effects-scripts\` e
  chama `AfterFX.exe -r`. Não existe named pipe e nenhum AEX é instalado.
- **Extensão CEP não recebe comandos do Tauri** e não executa `evalScript` a
  pedido dele.
- A extensão continua validando a assinatura do recibo com chave pública
  embutida; nenhum segredo sai do backend.

## Regras de fronteira para agentes

1. **Não importe código entre projetos.** Se dois projetos precisam do mesmo
   dado, ele passa pelo contrato documentado, nunca por import de runtime.
   Para previews de produtos, preserve o contrato de path, versão e hash em
   `docs/CACHE_PREVIEWS_PRODUTOS.md` nos dois lados.
2. **Exceção única e sancionada**: o build da extensão lê o manifesto público
   `ADMIN/supabase/license-trusted-keys.json` via
   `ARIZONA-EXTENSION/scripts/generate-license-trusted-keys.mjs`.
3. A lógica JSX dos atalhos pertence ao Tauri. Não importe o bundle da extensão
   nem fonte de `AE-PLUGIN-ARIZONA/`; mantenha a implementação embutida
   autocontida.
4. Cada projeto tem seu próprio package.json/lockfile/node_modules (raiz,
   `ARIZONA-EXTENSION/`, `ADMIN/`). Rode os comandos npm na pasta certa.
5. Trabalhando em um projeto, siga os AGENTS.md internos dele quando existirem.

## Licenciamento — leia antes de mexer

Antes de alterar autenticação, licenciamento, Supabase secrets, validação da
extensão CEP, chaves públicas/privadas ou geração de tokens, leia
`docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.

- NÃO delete, regenere, sobrescreva ou faça upload de chaves sem uma rotação
  planejada pedida explicitamente pelo usuário.
- Diagnóstico de paridade: `npm run license:check` na raiz.
- As chaves antigas do bridge AEX permanecem arquivadas para compatibilidade de
  backend durante a migração. O app atual não usa `bridgeToken`.

## Instalador

- O payload oficial contém o app Tauri e a extensão CEP. Não contém `.aex`.
- A instalação Full oficial é `perMachine` e instala a extensão diretamente em
  `%CommonProgramW6432%\Adobe\CEP\extensions\com.arizona-carrefour.cep`.
- Staging e backups do Full ficam na pasta irmã
  `%CommonProgramW6432%\Adobe\CEP\.arizona-install-work`, fora de `extensions`.
  Os helpers elevados de assets do Full não escrevem em `%APPDATA%` nem alteram
  HKCU.
- A instalação/atualização manual iniciada pelo Tauri continua `per-user`, em
  `%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep`.
- Instalação não cria `Plug-ins\Arizona` em nenhuma versão do After Effects.
- Upgrade e desinstalação procuram apenas o arquivo legado exato
  `Plug-ins\Arizona\ArizonaBridgeTest.aex`, removem-no com segurança e só apagam
  a pasta `Arizona` quando ela fica vazia.
- Em desenvolvimento, o destino `per-user` pode ser uma junction para
  `ARIZONA-EXTENSION\dist\cep`.

## Notas operacionais

- Após checks/builds Rust com target temporário, remova pastas geradas como
  `src-tauri/target-codex/` antes de finalizar.
- Se locks do Windows impedirem a limpeza, mencione a pasta restante claramente.
- O usuário costuma ter `tauri dev` e watch da extensão rodando; espere locks de
  build e rebuilds automáticos.
