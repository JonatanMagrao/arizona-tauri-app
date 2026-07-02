# AGENTS.md - After Effects / JSX

Este diretorio contem a camada que roda dentro do After Effects. Trate este codigo como codigo de host: ele manipula projeto, comps, layers, footage, markers e undo groups diretamente.

## Escopo

- `aeft.ts` e a API publica exportada para o front.
- `domains/` com logicas por dominio do After Effects.
- Nenhum componente React, CSS, hook de UI ou estado visual deve morar aqui.

## Regras de fronteira

- Exporte para o front apenas funcoes finas e dados serializaveis.
- Nao retorne objetos nativos do After Effects para o front (`Layer`, `CompItem`, `Property`, `FootageItem`, `File`, etc.).
- Use DTOs simples: `string`, `number`, `boolean`, `null`, arrays e objetos planos.
- O front chama esta camada via `evalTS`; mantenha nomes exportados estaveis em `aeft.ts`.
- Quando mudar uma assinatura publica, atualize tambem os tipos/servicos correspondentes em `src/js/main`.

## Boas praticas no After Effects

- Qualquer acao que altera projeto deve usar `app.beginUndoGroup(...)` e `app.endUndoGroup()` em `finally`.
- Prefira retornar `{ ok, message, errors }` em vez de deixar excecoes escaparem para o front.
- Acumule erros recuperaveis em `errors`; use `throw` apenas quando a acao solicitada nao pode continuar.
- Sempre trate ausencia de projeto, comp, layer, source e property.
- Ao navegar por layers/properties, isole helpers reutilizaveis em arquivos de `layers/` ou no dominio correspondente.
- Evite depender de indices magicos sem nome: se precisar de indices fixos, crie constantes nomeadas perto da regra.
- Preserve nomes de layer/precomp usados por templates. Regex deve aceitar sufixos de duplicacao quando aplicavel, por exemplo `(?:\\s+\\d+)?`.

## Ofertas

- `domains/ofertas/ofertas.ts` deve continuar sendo uma fachada fina de exports.
- `snapshot/` monta leitura/DTOs e nao deve alterar o projeto.
- `actions/` contem operacoes que alteram o projeto.
- `mechanics/registry.ts` e o mapa completo de mecanicas suportadas.
- Arquivos de `mechanics/` podem agrupar mecanicas por familia quando compartilham estrutura.
- Ao adicionar uma mecanica, inclua leitor, registry, tipos de campos/opcoes e valide duplicacao de nome da precomp.

## Compatibilidade

- Evite APIs exclusivas de browser ou Node nesta camada.
- Tenha cuidado com recursos modernos de JS quando o codigo final roda no host CEP/ExtendScript.
- Mantenha os arquivos em TypeScript, com dados serializaveis e sem dependencias de UI.

## Validacao

- Depois de mudancas nesta camada, rode `npm run build`.
- Revise o bundle gerado apenas quando a mudanca envolver export publico ou integracao com CEP.
