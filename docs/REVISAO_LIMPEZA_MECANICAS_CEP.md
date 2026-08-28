# Revisão e plano de limpeza das mecânicas do CEP

**Status:** primeira limpeza segura aplicada; compatibilidade legada preservada

**Última revisão:** 28 de agosto de 2026

**Escopo:** extensão CEP (`ARIZONA-EXTENSION`), incluindo host JSX, painel React
e integrações da área de roteiro.

## Decisão vigente

A limpeza deve ser dividida em duas frentes:

1. resíduos comprovadamente inertes podem ser removidos numa alteração pequena e
   isolada;
2. readers de mecânicas antigas devem permanecer enquanto projetos anteriores
   continuarem suportados.

Em 20 de agosto de 2026 foi aplicada somente a primeira limpeza de risco mínimo
descrita neste documento. Nenhum reader, mapping do registry, DTO, helper de
jump ou regra do roteiro foi removido.

O registry possui 17 mappings alcançáveis. Portanto, os readers antigos não são
`dead code` técnico: basta o comentário ou, por compatibilidade, o nome do
source de uma precomp corresponder ao mapping para que o reader seja executado.

Fonte da verdade:

- [`mechanics/registry.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/registry.ts)
- [`snapshot/buildOfferSnapshot.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/buildOfferSnapshot.ts)
- [`actions/updateField.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/updateField.ts)
- [`actions/updateOption.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/updateOption.ts)

## Identificação da mecânica

A identificação não depende mais do nome da layer na timeline. O contrato é:

1. `valueLayer.source.comment` é a fonte primária e deve conter o nome canônico
   da mecânica, por exemplo `TODOS A COM LEVE X PAGUE Y`;
2. quando o comentário estiver vazio ou não for reconhecido, o fallback é
   `valueLayer.source.name` para preservar projetos ainda não migrados;
3. `valueLayer.name` não participa da identificação;
4. espaços externos são ignorados e os padrões continuam aceitando o sufixo
   numérico criado por duplicações, sem renomear ou alterar o projeto.

## Mecânicas do projeto-base atual

A inspeção somente leitura do projeto-base aberto encontrou estas famílias:

- `SIMPLES`
- `DE X POR Y PARCELAMENTO`
- `DE X POR Y | X% DESCONTO | LEVE X PAGUE Y`
- `DESCONTO R$ CARTAO CRF`
- `TODOS A COM LEVE X PAGUE Y`
- `TODOS A COM X% DESCONTO`

Essas mecânicas e seus controles devem permanecer.

## Compatibilidade com projetos anteriores

Projetos reais recentes ainda contêm todos ou vários destes nomes:

- `DE POR`
- `DE POR CARTAO CRF`
- `DE POR MEU CRF (DUAL)`
- `DE POR PARCELAMENTO CARTAO CRF`
- `LEVE X PAGUE Y`
- `DESCONTO X%`
- `DESCONTO X% SEGUNDA UNIDADE`
- `DESCONTO X% MEU CRF`
- `DESCONTO X% CARTAO CRF`
- `DESCONTO X% CARTAO CRF SEGUNDA UNIDADE`

Remover esses readers agora faria o CEP classificar as precomps como não
mapeadas quando campanhas anteriores fossem reabertas.

`DE A UNIDADE SAI POR` não apareceu no projeto-base nem nas amostras históricas
inspecionadas. É o melhor candidato entre os readers antigos, mas a amostra não
prova que ele esteja ausente de todo o acervo. Sua remoção depende de uma
varredura maior ou de uma decisão explícita de encerrar essa compatibilidade.

## Limpezas de risco mínimo aplicadas

Os seguintes itens foram confirmados como inertes ou redundantes e removidos:

1. `keepDigitsAndOneComma`, em
   [`layers/textFields.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/textFields.ts),
   não possui consumidores.
2. `getWritableFieldValue`, no mesmo arquivo, apenas devolve o valor recebido e
   pode ser eliminado substituindo sua única chamada pelo valor já normalizado.
3. A classe `is-installment`, emitida em
   [`OffersPanel.tsx`](../ARIZONA-EXTENSION/src/js/main/domains/ofertas/components/OffersPanel.tsx),
   não possui seletor nem consumidor.
4. O seletor `.offer-product-mechanic-selector span`, em
   [`offers.scss`](../ARIZONA-EXTENSION/src/js/main/domains/ofertas/components/offers.scss),
   é resíduo do título “Mecânica”. O dropdown do cabeçalho sempre usa
   `showLabel={false}`, portanto o `span` não é criado.
5. O `grid-template-areas` de `.offer-price-field` não produz efeito porque o
   elemento utiliza `display: flex` e nenhum filho declara `grid-area`.

Essa limpeza não alterou o contrato das mecânicas.

## Interface inerte de troca de mecânica removida

O menu de três pontos chamado “Alterar mecânica” não troca a precomp:

- `OFFER_MECHANIC_OPTIONS` é uma lista fixa e desatualizada;
- não existe callback, serviço ou função host que efetue a troca;
- o botão “Confirmar” apenas fecha o diálogo.

Como esse recurso não efetuava nenhuma troca, foram removidos em conjunto:

- `OFFER_MECHANIC_OPTIONS`;
- `isMechanicMenuOpen`, `pendingMechanic` e o tratamento de `Escape` exclusivo;
- botão, menu e diálogo de alteração;
- estilos `has-open-menu`, `offer-card-actions`, `offer-card-menu-*` e
  `offer-confirm-dialog`;
- o espaço do cabeçalho reservado apenas para esse botão.

`.offer-modal-backdrop` deve permanecer, pois também atende os diálogos de texto
legal e imagens.

Se o recurso voltar no futuro, ele precisa ser implementado de verdade e a lista
não deve ficar fixa no front.

## Dependência do roteiro

A remoção das mecânicas antigas não pode ser feita apenas no registry. O roteiro
ainda reconhece explicitamente vários tipos antigos em:

- [`offerDiscovery.ts`](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/offerDiscovery.ts)
- [`textSegments.ts`](../ARIZONA-EXTENSION/src/js/main/domains/roteiro/utils/textSegments.ts)

Lacunas conhecidas:

- `TODOS A COM LEVE X PAGUE Y` ainda não recebe o tratamento semântico usado por
  `LEVE X PAGUE Y`;
- `DE X POR Y PARCELAMENTO` ainda não recebe o tratamento específico do antigo
  parcelamento e pode cair na leitura genérica do primeiro preço (`De`).

Antes de apagar compatibilidade, o roteiro deve ser adaptado para as novas
famílias e validado com dados reais.

## Cascata da remoção grande

Se a política futura passar a ser “somente projeto-base novo”, a remoção precisa
ser atômica:

1. retirar os 11 mappings antigos do registry;
2. excluir `mechanics/dePor.ts`;
3. preservar apenas `readAllPercentDiscountMechanic` em
   `mechanics/descontoPercentual.ts`;
4. retirar `readLeveXPagueYMechanic` de `mechanics/simples.ts`;
5. retirar somente o reader e wrapper legados de Cartão Carrefour de
   `mechanics/parcelamento.ts`;
6. preservar toda a implementação genérica de jump, usada pelas mecânicas
   atuais;
7. retirar `getInstallmentControllerProperty` de `mechanics/shared.ts` e, se
   ficar realmente sem consumidor, `findLayerByNamePart`;
8. limpar o dispatch legado em `actions/updateOption.ts`;
9. limpar branches e estilos de UI exclusivos das mecânicas aposentadas;
10. migrar ou remover conscientemente os tratamentos antigos do roteiro.

## Itens que devem permanecer

- helpers genéricos de jump em `mechanics/parcelamento.ts`;
- `installmentJump` e seus DTOs, apesar da nomenclatura hoje ser mais ampla;
- `makeControllerOptionGroup`, `getEffectControlValueProperty`,
  `makeTextField`, `makeIndexedTextField` e `makeValueField`;
- `makeLayerOptionGroup` e opções do tipo `layers`, pois também são usados pelos
  controles legais;
- `OfferOptionGroupPlacement` e a separação entre controles de cabeçalho e
  corpo;
- a ordem completa dos itens dos dropdowns antigos enquanto seus readers
  existirem. Remover opções intermediárias desloca os índices numéricos usados
  pelo After Effects.

## Critérios para retomar o plano

A remoção das mecânicas legadas só deve avançar quando todos os itens abaixo
estiverem resolvidos:

- definir até qual geração/data de projeto o CEP deve manter compatibilidade;
- varrer o acervo oficial de projetos e registrar quais precomps ainda existem;
- definir o equivalente novo de cada mecânica antiga;
- adaptar primeiro a descoberta e a validação do roteiro;
- criar testes ou fixtures para registry, campos, dropdowns e jumps;
- validar manualmente no After Effects um projeto-base atual e amostras antigas;
- executar o build da extensão e conferir o bundle CEP após a alteração.

Até essa decisão, os readers antigos devem ser tratados como uma camada de
compatibilidade, não como resíduos removíveis.
