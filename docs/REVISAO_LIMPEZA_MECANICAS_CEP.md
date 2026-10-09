# Limpeza das mecânicas do CEP

**Status:** suporte limitado às sete famílias atuais confirmadas pelo usuário.

**Última revisão:** 8 de outubro de 2026.

**Escopo:** extensão CEP (`ARIZONA-EXTENSION`), incluindo leitores do host JSX,
ações de edição, painel React e descoberta/validação das ofertas no roteiro.

## Decisão vigente

A extensão mantém as seis famílias do projeto-base apresentado pelo usuário e a
mecânica Meu CRF/Cartão CRF, confirmada como atual. O registro passou de
**18 para sete famílias**. Os 11 leitores antigos foram retirados juntamente com
seus tratamentos exclusivos.

Essa decisão substitui a orientação da revisão de agosto de 2026, que preservava
leitores antigos para compatibilidade. A limpeza anterior havia removido apenas
resíduos inertes e a interface não funcional de troca de mecânica.

Não há migração automática, renomeação ou remoção de camadas dos arquivos
`.aep`. A compatibilidade com as 11 famílias descontinuadas foi encerrada.

## Sete famílias mantidas

| Família reconhecida | Leitor |
|---|---|
| `SIMPLES` | [simples.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/simples.ts) |
| `DE X POR Y PARCELAMENTO` | [deXPorYParcelamento.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYParcelamento.ts) |
| `DE X POR Y \| X% DESCONTO \| LEVE X PAGUE Y` | [deXPorYDescontoLeveXPagueY.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYDescontoLeveXPagueY.ts) |
| `DESCONTO R$ CARTAO CRF` | [descontoValor.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoValor.ts) |
| `TODOS A COM LEVE X PAGUE Y` | [simples.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/simples.ts) |
| `TODOS A COM X% DESCONTO` | [descontoPercentual.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoPercentual.ts) |
| `DE X POR Y MEU CRF POR Z CARTAO CRF` | [meuCrfCartao.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/meuCrfCartao.ts) |

`TODOS A LEVE X PAGUE Y` continua como alias de
`TODOS A COM LEVE X PAGUE Y`; ambos usam o mesmo leitor.
Duplicações como `SIMPLES 1`, `SIMPLES 2` e `SIMPLES 3` também não representam
novas famílias.

As camadas, efeitos, nomes, índices e opções necessários a cada família estão no
[mapa de camadas atual](../MAPA_CAMADAS_MECANICAS_CEP.md).

## Onze famílias descontinuadas

- `DE POR`
- `DE POR CARTAO CRF`
- `DE POR MEU CRF (DUAL)`
- `DE POR PARCELAMENTO CARTAO CRF`
- `DE A UNIDADE SAI POR`
- `LEVE X PAGUE Y`
- `DESCONTO X%`
- `DESCONTO X% SEGUNDA UNIDADE`
- `DESCONTO X% MEU CRF`
- `DESCONTO X% CARTAO CRF`
- `DESCONTO X% CARTAO CRF SEGUNDA UNIDADE`

Quando comentário e nome da precomp só identificarem mecânicas descontinuadas,
o registro retorna `unsupported: true`, com campos e grupos de opções vazios.
O painel exibe **Mecânica não mapeada**. A remoção do leitor não altera o conteúdo
existente no After Effects e não faz a extensão tentar escrever em uma estrutura
antiga usando o leitor de uma família diferente.

Para reutilizar uma oferta antiga, seu template precisa ser adaptado à estrutura
de uma família atual. Apenas mudar o comentário ou o nome da precomp não valida
as posições, nomes, efeitos e expressões internas.

## Identificação preservada

O contrato continua sendo:

1. `valueLayer.source.comment` é a primeira fonte de identificação;
2. quando o comentário estiver vazio ou não for reconhecido, a extensão tenta
   `valueLayer.source.name`;
3. `valueLayer.name`, o nome na timeline, não participa da identificação;
4. espaços externos e diferenças de maiúsculas/minúsculas são ignorados; os
   padrões aceitam sufixo numérico de duplicação, sem alterar o projeto;
5. os acentos dos identificadores não são normalizados.

Fonte: [registro](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/registry.ts)
e [identidade da precomp](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/mechanicIdentity.ts).

## Alcance da remoção

- O registro contém apenas os sete leitores atuais.
- `mechanics/dePor.ts` foi removido.
- `mechanics/descontoPercentual.ts` mantém somente o leitor de
  `TODOS A COM X% DESCONTO`.
- `mechanics/simples.ts` mantém Simples e Todos A Com Leve X Pague Y.
- `mechanics/parcelamento.ts` mantém os helpers comuns de jump; o leitor,
  a definição e a ação exclusivos do parcelamento antigo foram retirados.
- A busca especial da controladora de parcelamento antiga e seus auxiliares
  sem consumidores foram retirados.
- O dispatch de atualização do jump mantém as três famílias atuais que o usam.
- O painel e o roteiro não mantêm tratamentos exclusivos das 11 famílias
  descontinuadas.

Fontes de edição:
[campos](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/updateField.ts)
e [opções/jump](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/updateOption.ts).

## Integração com o roteiro

A descoberta e a validação do roteiro foram alinhadas às famílias mantidas:

- `TODOS A COM LEVE X PAGUE Y`, incluindo o alias sem `COM`, usa os campos
  Leve X e Pague Y para validar as duas quantidades.
- `DE X POR Y PARCELAMENTO` usa os campos do parcelamento atual, incluindo
  preço cheio e parcela; não cai na seleção genérica do primeiro campo
  monetário, que correspondia ao preço De.
- A mecânica combinada mantém a leitura de De/Por já existente.
- Os demais tratamentos atuais permanecem no escopo existente; esta limpeza
  não introduz uma nova interpretação comercial para Meu CRF/Cartão CRF ou
  para desconto em dinheiro.
- Uma mecânica não mapeada não fornece campos para edição ou valores de sua
  mecânica para a validação.

Fontes:
[offerDiscovery.ts](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/offerDiscovery.ts)
e [textSegments.ts](../ARIZONA-EXTENSION/src/js/main/domains/roteiro/utils/textSegments.ts).

## Contratos e auxiliares preservados

- A ordem descritivo → mecânica → imagem e a descoberta de ofertas em `Miolo`.
- Os índices, nomes, IDs e formatos dos campos das sete famílias.
- A ordem e os valores numéricos dos dropdowns atuais.
- Os helpers genéricos de jump e `installmentJump`, usados também pelas
  mecânicas combinada e Meu CRF/Cartão CRF.
- `makeControllerOptionGroup`, `getEffectControlValueProperty`,
  `makeTextField`, `makeIndexedTextField` e `makeValueField`.
- `makeLayerOptionGroup` e opções do tipo `layers`, utilizadas também pelos
  controles legais.
- `OfferOptionGroupPlacement` e a posição dos controles no cabeçalho ou corpo.
- Os controles legais, troca de imagens, descrição do produto e ações comuns
  das ofertas.
- Os labels de apresentação permanecem separados dos identificadores internos.

## Auditoria entre projetos

A busca por identificadores, leitores e tratamentos de mecânicas cobriu o
repositório, incluindo Tauri, Admin, backend, scripts, instalador e o arquivo
histórico `AE-PLUGIN-ARIZONA`. Não foi localizada dependência dessas 11 famílias
fora da extensão CEP e da documentação relacionada.

O Tauri possui um realce textual de expressões Leve/Pague em
[roteiroHighlights.js](../src/features/secondary/roteiroHighlights.js).
Esse código não identifica precomps, não consome o registro do CEP e continua
necessário para destacar texto do roteiro das famílias atuais.

O empacotamento usa o bundle/diretório da extensão e não importa leitores
individuais. Licenciamento, recibos, previews, diagnósticos e fila distribuída
não têm contrato de nomes de mecânicas e não foram alterados.

## Limites da validação

Validações executadas em 08/10/2026:

- `npm run build` na extensão: TypeScript, painel CEP e bundle JSXBIN gerados.
- `npm test` na extensão: **148 testes aprovados**, incluindo 40 novos testes
  com as sete famílias, o alias Todos A sem COM, a identificação por
  comentário/nome, campos, dropdowns, ações reais de edição, jumps e rejeição
  das 11 famílias removidas. Os objetos do After Effects são simulados.
- `npm test` na raiz/Tauri: **61 testes aprovados**.
- Busca de dependências no repositório e revisão dos contratos públicos:
  nenhuma referência órfã aos leitores retirados ou alteração de DTO/API.

A validação do roteiro também cobre o destino correto de cada preço no
parcelamento: quando a parcela está vazia ou ausente, a correção não pode
escrever no preço cheio por engano.

Testes com fixtures verificam os contratos programáveis de leitura e edição.
Eles não equivalem a abrir cada template real no After Effects: expressões,
animações e disposição visual do arquivo `.aep` dependem da conferência do
projeto-base. Esta revisão documental não registra uma inspeção nova de
projetos reais no After Effects.
