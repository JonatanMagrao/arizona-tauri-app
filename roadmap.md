# Roadmap de Arquitetura

Este roadmap registra possibilidades de melhoria para o Arizona App sem pressupor uma reescrita. A ideia e evoluir por etapas pequenas, preservando os fluxos atuais de trabalho.

## Objetivos

- Reduzir acoplamento entre UI, comandos Tauri e regras de negocio.
- Tornar os fluxos de job, midia, historico e importacao mais faceis de testar.
- Diminuir duplicacao de regras de path, regex e abertura de arquivos.
- Padronizar contratos de erro/sucesso entre frontend e backend.
- Preparar o app para novas abas e recursos sem aumentar o tamanho do `App.jsx` e do `arizona.rs`.

## Estado Atual

- `src/App.jsx` centraliza estado, modais, toasts, configuracoes, comandos Tauri e titulo da janela.
- `src-tauri/src/arizona.rs` concentra localizacao de projetos, abertura de links, After Effects, midias, leitura de Excel, copia de produtos e geracao de log.
- `src-tauri/src/history.rs` ja esta mais modularizado, com SQLite e acoes proprias.
- `src-tauri/src/settings.rs` ja isola persistencia e validacao de configuracoes.
- O contrato Tauri mistura `Result<T, String>` com payloads `ActionResponse { ok, message }`.

## Fase 1: Fundacoes de Baixo Risco

- Centralizar nomes e invocacao de comandos Tauri no frontend.
- Criar helpers de comando para tratar `ActionResponse` de forma consistente.
- Remover duplicacoes claras no backend, comecando por localizacao de midias MP4/MOV.
- Alinhar versoes entre `package.json`, `Cargo.toml` e `tauri.conf.json`.
- Atualizar `README.md` para documentar fluxos reais do app.

## Fase 2: Separacao de Dominio

- Dividir `Arizona` em servicos menores:
  - `ProjectLocator`: localizar Jobao, Jobinho e projeto `.aep`.
  - `MediaLocator`: resolver MP4/MOV e outras midias.
  - `ProductImporter`: ler Excel, copiar produtos e gerar resultado de importacao.
  - `ExternalOpener`: abrir urls, Explorer, arquivos e After Effects.
  - `ProjectTitle`: extrair nome e praca a partir do nome do `.aep`.
- Manter uma fachada simples para os comandos Tauri enquanto os servicos internos amadurecem.

## Fase 3: Tipos e Contratos

- Introduzir tipos para strings de dominio:
  - `JobaoCode`
  - `JobinhoCode`
  - `MediaType`
  - `OutputFolderKind`
- Trocar `option: String` e `media_type: String` por enums validaveis.
- Padronizar respostas dos comandos:
  - sucesso com payload tipado quando houver dados;
  - erro estruturado com codigo e mensagem amigavel.
- Reduzir mensagens de erro montadas em pontos diferentes do frontend.

## Fase 4: Frontend Modular

- Extrair hooks:
  - `useToast`
  - `useAppConfig`
  - `useProjectTitle`
  - `useTauriAction`
  - `useHistory`
- Transformar tabs, modais e botoes de acao em componentes mais especificos.
- Remover codigo morto ou trocar por feature flags reais para `LinksPanel` e `CopyPanel`.
- Consolidar CSS em blocos menores por area ou componente.

## Fase 5: Testes e Confiabilidade

- Adicionar testes Rust para:
  - nomes de meses;
  - regex de Jobao/Jobinho;
  - extracao de titulo/praca;
  - localizacao de midia;
  - leitura de planilha `.xlsx`;
  - deduplicacao de historico.
- Adicionar testes leves no frontend para helpers puros de filtro e parsing.
- Criar fixtures pequenas para simular a arvore de pastas do drive.

## Fase 6: Seguranca e Empacotamento

- Reavaliar `csp: null` no Tauri.
- Revisar permissoes em `capabilities/default.json`.
- Documentar paths esperados e configuracoes iniciais.
- Padronizar versionamento do pacote e release notes.

## Ordem Recomendada

1. Centralizar comandos Tauri no frontend.
2. Extrair utilitarios compartilhados no backend.
3. Separar `Arizona` em modulos internos menores.
4. Introduzir tipos de dominio.
5. Criar testes sobre regras de path e parsing.
6. Revisar seguranca, docs e empacotamento.

