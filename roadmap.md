# Roadmap de Arquitetura

Este roadmap registra possibilidades de melhoria para o Arizona App sem pressupor uma reescrita. A ideia é evoluir por etapas pequenas, preservando os fluxos atuais de trabalho.

## Objetivos

- Reduzir acoplamento entre UI, comandos Tauri e regras de negócio.
- Tornar os fluxos de job, mídia, histórico e importação mais fáceis de testar.
- Diminuir duplicação de regras de path, regex e abertura de arquivos.
- Padronizar contratos de erro/sucesso entre frontend e backend.
- Preparar o app para novas abas e recursos sem aumentar o tamanho do `App.jsx` e do `arizona.rs`.

## Estado Atual

- `src/app/App.jsx` centraliza estado, modais, toasts, configurações, comandos Tauri e título da janela.
- `src-tauri/src/arizona/` concentra localização de projetos, abertura de links, After Effects, mídias, leitura de Excel, cópia de produtos e geração de log.
- `src-tauri/src/history.rs` já está mais modularizado, com SQLite e ações próprias.
- `src-tauri/src/settings.rs` já isola persistência e validação de configurações.
- O contrato Tauri mistura `Result<T, String>` com payloads `ActionResponse { ok, message }`.

## Fase 1: Fundações de Baixo Risco

- Centralizar nomes e invocação de comandos Tauri no frontend.
- Criar helpers de comando para tratar `ActionResponse` de forma consistente.
- Remover duplicações claras no backend, começando por localização de mídias MP4/MOV.
- Alinhar versões entre `package.json`, `Cargo.toml` e `tauri.conf.json`.
- Atualizar `README.md` para documentar fluxos reais do app.

## Fase 2: Separação de Domínio

- Dividir `Arizona` em serviços menores:
  - `ProjectLocator`: localizar Jobao, Jobinho e projeto `.aep`.
  - `MediaLocator`: resolver MP4/MOV e outras mídias.
  - `ProductImporter`: ler Excel, copiar produtos e gerar resultado de importação.
  - `ExternalOpener`: abrir URLs, Explorer, arquivos e After Effects.
  - `ProjectTitle`: extrair nome e praça a partir do nome do `.aep`.
- Manter uma fachada simples para os comandos Tauri enquanto os serviços internos amadurecem.

## Fase 3: Tipos e Contratos

- Introduzir tipos para strings de domínio:
  - `JobaoCode`
  - `JobinhoCode`
  - `MediaType`
  - `OutputFolderKind`
- Trocar `option: String` e `media_type: String` por enums validáveis.
- Padronizar respostas dos comandos:
  - sucesso com payload tipado quando houver dados;
  - erro estruturado com código e mensagem amigável.
- Reduzir mensagens de erro montadas em pontos diferentes do frontend.

## Fase 4: Frontend Modular

- Extrair hooks:
  - `useToast`
  - `useAppConfig`
  - `useProjectTitle`
  - `useTauriAction`
  - `useHistory`
- Transformar tabs, modais e botões de ação em componentes mais específicos.
- Remover código morto ou trocar por feature flags reais para `LinksPanel` e `CopyPanel`.
- Consolidar CSS em blocos menores por área ou componente.

## Fase 5: Testes e Confiabilidade

- Adicionar testes Rust para:
  - nomes de meses;
  - regex de Jobao/Jobinho;
  - extração de título/praça;
  - localização de mídia;
  - leitura de planilha `.xlsx`;
  - deduplicação de histórico.
- Adicionar testes leves no frontend para helpers puros de filtro e parsing.
- Criar fixtures pequenas para simular a árvore de pastas do drive.

## Fase 6: Segurança e Empacotamento

- Reavaliar `csp: null` no Tauri.
- Revisar permissões em `capabilities/default.json`.
- Documentar paths esperados e configurações iniciais.
- Padronizar versionamento do pacote e release notes.

## Ordem Recomendada

1. Centralizar comandos Tauri no frontend.
2. Extrair utilitários compartilhados no backend.
3. Separar `Arizona` em módulos internos menores.
4. Introduzir tipos de domínio.
5. Criar testes sobre regras de path e parsing.
6. Revisar segurança, docs e empacotamento.

