# AGENTS.md - Front / Painel CEP

Este diretorio contem o front do painel CEP em React. Trate este codigo como experiencia de usuario e orquestracao: ele apresenta estado, chama servicos e envia comandos para o After Effects.

## Escopo

- `main.tsx`, componentes, hooks, estilos e servicos do painel.
- Dominios de UI em `domains/`.
- Nenhuma manipulacao direta de `Layer`, `CompItem`, `Property` ou outros objetos nativos do After Effects deve morar aqui.

## Regras de fronteira

- Para falar com o After Effects, use servicos de dominio que chamam `evalTS`.
- Nao chame funcoes JSX diretamente dentro de componentes quando um service/hook pode encapsular a chamada.
- Sempre trate o caso sem CEP (`!window.cep`) com fallback seguro para desenvolvimento no browser.
- Dados vindos do After devem ser DTOs simples e tipados no front.
- Se uma funcao publica mudar em `src/jsx/aeft`, atualize o service, tipos e telas que consomem essa funcao.

## Boas praticas de React

- Mantenha componentes focados em renderizacao e interacao.
- Coloque chamadas assicronas e orquestracao em hooks ou services do dominio.
- Evite estado duplicado; derive valores quando possivel.
- Sempre represente estados de loading, erro e indisponibilidade quando a acao depende do After Effects.
- Nao quebre atalhos, selecao atual ou refresh de snapshot ao ajustar fluxos existentes.
- Preserve nomes, labels e mensagens que o operador ja reconhece, salvo quando a mudanca pedir texto novo.

## UI e estilos

- Siga os padroes visuais existentes em `styles/` e nos dominios atuais.
- Evite criar landing pages, telas explicativas ou cards decorativos sem necessidade operacional.
- Para ferramentas repetidas, prefira controles compactos, escaneaveis e consistentes.
- Mantenha texto dentro dos limites do componente em desktop e em painel estreito.
- CSS/SCSS especifico de dominio deve ficar perto do dominio; estilos globais so para tokens, layout base e resets.

## Ofertas

- O front deve consumir `OfferEditorSnapshot` como fonte principal de verdade.
- Acoes de ofertas devem passar por `domains/ofertas/services/ofertas.ts` e depois atualizar snapshot/estado.
- Nao replique regras de mecanica no front quando a regra depende da estrutura do template do After.
- Regras de exibicao podem usar `mechanic.type`, mas alteracoes reais devem ficar no JSX.
- Ao mexer em imagens de produto, preserve fallback para ausencia de CEP e leitura por pasta do projeto.

## Validacao

- Depois de mudancas no front, rode `npm run build`.
- Ao alterar fluxo visual importante, teste mentalmente: CEP indisponivel, projeto sem comp esperada, erro do After e sucesso.
