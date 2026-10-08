# Mapa de camadas das mecânicas — Extensão CEP

Referência do código em **08/10/2026**.

Este documento reúne as camadas, os efeitos e os marcadores que a extensão
Arizona utiliza diretamente nas **18 mecânicas de ofertas** reconhecidas hoje.
Também registra a estrutura comum dos produtos e os controles do texto legal.

O levantamento descreve as dependências do código. Outras camadas do arquivo
`.aep` podem ser necessárias às animações, às expressões e à aparência do template.
Uma camada ausente pode indisponibilizar apenas o controle correspondente;
nem todas as dependências abaixo são condições para abrir o painel.

## Sumário

- [Como interpretar o mapa](#como-interpretar-o-mapa)
- [Estrutura comum das ofertas](#estrutura-comum-das-ofertas)
- [Identificação das mecânicas](#identificacao-das-mecanicas)
- [Mecânicas simples e Leve/Pague](#mecanicas-simples-e-leve-pague)
- [Mecânicas De/Por](#mecanicas-de-por)
- [Mecânicas de desconto](#mecanicas-de-desconto)
- [Parcelamentos e mecânicas combinadas](#parcelamentos-e-mecanicas-combinadas)
- [Camadas e marcadores do jump](#camadas-e-marcadores-do-jump)
- [Estrutura do texto legal](#estrutura-do-texto-legal)
- [Dependências que precisam ser preservadas](#dependencias-que-precisam-ser-preservadas)
- [Fontes do levantamento](#fontes-do-levantamento)

<a id="como-interpretar-o-mapa"></a>
## Como interpretar o mapa

| Notação | Significado |
|---|---|
| **#6** | Camada de índice 6. A contagem do After Effects começa em **1**. |
| **Efeito 2** | Segundo efeito dentro da camada indicada; não é a camada #2. |
| **Por nome: `PRECO`** | O código procura a camada por esse nome. |
| **#6: preço De** | O código procura a camada pela posição. “Preço De” descreve sua função; o nome real não é conferido nessa busca. |
| **Nome obrigatório** | O código também verifica o nome da camada naquela posição. |
| **Alterna camadas** | A opção liga a camada escolhida e desliga as outras do mesmo grupo, usando `layer.enabled`. |
| **Controle numérico** | O painel escreve em uma propriedade de efeito; não exige uma camada diferente para cada opção. |

Os índices das tabelas de mecânicas são **locais à precomp de origem da camada
da mecânica**. A estrutura externa da oferta e a precomp do texto legal têm suas
próprias contagens, indicadas nas respectivas seções.

Todos os campos de texto precisam oferecer **Source Text**. Para efeitos
localizados por posição, o helper procura recursivamente a primeira propriedade
numérica `OneD` dentro daquele efeito. Nesses casos, “Tipo”, “Subtipo”, “Unidade”
e “Quantidade X” são descrições da função, não nomes de efeito exigidos.

Os controles de seleção numérica escrevem valores **1, 2, 3…**, seguindo a ordem
das opções do painel. Os nomes internos em código, inclusive `PRECO`, `CARTAO`
e `POR CENTAGEM DESCONTO`, estão reproduzidos como são usados nas buscas.

<a id="estrutura-comum-das-ofertas"></a>
## Estrutura comum das ofertas

| Local | Dependência |
|---|---|
| Projeto | Composição chamada exatamente `Miolo`. |
| Dentro de `Miolo` | Camadas com `Oferta_` no nome, cuja origem seja a precomp da oferta. O painel guarda o índice da camada para executar as ações. |
| Dentro da oferta | Uma camada ativa com `DESCRITIVO` no nome para cada produto reconhecido. |
| Dentro da precomp do descritivo | Camada de texto chamada `DESCRITIVO`. |
| Próxima camada após o descritivo | Precomp da mecânica: **índice do descritivo + 1**. |
| Próxima camada após a mecânica | Imagem do produto: **índice do descritivo + 2**. |
| Camada #1 da oferta | Precomp do texto legal, usada pelos controles legais. |

O conjunto de cada produto precisa preservar esta sequência na precomp da oferta:

```text
#N       Descritivo ativo — nome contém DESCRITIVO
#(N+1)   Precomp da mecânica
#(N+2)   Imagem do produto
```

A origem das camadas de oferta, descritivo e mecânica precisa ser uma composição
(`CompItem`). Para a substituição de imagem pelo painel, a camada da imagem
precisa ser uma `AVLayer` cuja origem seja um `FootageItem`; a ação substitui o
arquivo dessa origem.

Fontes: [descoberta e leitura das ofertas](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/buildOfferSnapshot.ts),
[busca de camadas](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/findLayers.ts),
[substituição da imagem](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/replaceProductImage.ts).

<a id="identificacao-das-mecanicas"></a>
## Identificação das mecânicas

A extensão tenta reconhecer a mecânica nesta ordem:

1. **Comentário da precomp de origem** (`source.comment`).
2. **Nome da precomp de origem** (`source.name`), se o comentário não identificar
   uma mecânica suportada.

O nome visível da camada da mecânica na timeline não é usado nessa identificação.
O registro ignora maiúsculas/minúsculas e aceita um sufixo de duplicação com
espaço e número, como `SIMPLES 2`. Os espaços das extremidades são removidos,
mas os acentos não são normalizados. Isso não transforma os nomes das camadas
internas em buscas flexíveis: cada leitor mantém os critérios descritos abaixo.

Fonte: [registro das mecânicas](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/registry.ts)
e [identidade da precomp](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/mechanicIdentity.ts).

<a id="mecanicas-simples-e-leve-pague"></a>
## Mecânicas simples e Leve/Pague

### 1. SIMPLES

Identificação aceita: `SIMPLES`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do preço | Por nome: `PRECO` | Preço do produto. |
| Controladora | **#4**, nome obrigatório `Controlador de Mecânica` | Contém o controle de unidade. |
| Controle de unidade | **Efeito 1** da controladora | Seleção numérica da unidade. |

Ordem das unidades: **Cada; Kg; A cada 100g; Kg/cada**.

### 2. LEVE X PAGUE Y

Identificação aceita: `LEVE X PAGUE Y`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto Leve X | **#3**, nome não conferido | Quantidade inteira levada. |
| Texto Pague Y | **#4**, nome não conferido | Quantidade inteira paga. |

Esse leitor não usa controladora ou grupo de opções adicional.

### 3. TODOS A COM LEVE X PAGUE Y

Identificação aceita: `TODOS A COM LEVE X PAGUE Y`.
Também aceita o nome antigo `TODOS A LEVE X PAGUE Y`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#3**, nome obrigatório `Controlador de Mecânica` | Contém o controle de subtipo. |
| Texto Leve X | **#4**, nome não conferido | Quantidade inteira levada. |
| Texto Pague Y | **#5**, nome não conferido | Quantidade inteira paga. |
| Controle de subtipo | **Efeito 1** da controladora | Seleção numérica do subtipo. |

Ordem dos subtipos: **Padrão; Meu Carrefour; Cartão Carrefour**.

Nas mecânicas 1 e 3, o nome da controladora é conferido sem diferenciar
maiúsculas/minúsculas, preservando o acento em `Mecânica`.

Fonte: [simples.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/simples.ts).

<a id="mecanicas-de-por"></a>
## Mecânicas De/Por

### 4. DE POR

Identificação aceita: `DE POR`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#5**, nome não conferido | Contém os três efeitos abaixo. |
| Texto De | **#6**, nome não conferido | Preço original. |
| Texto Por | **#12**, nome não conferido | Preço final. |
| Subtipo | **Efeito 1** da #5 | Seleção numérica do subtipo. |
| Unidade | **Efeito 2** da #5 | Seleção numérica da unidade. |
| Quantidade X | **Efeito 3** da #5 | Valor inteiro; não é uma camada de texto separada. |

Ordem dos subtipos: **De Por; Nesta Embalagem; Levando X Unidades;
Com o Desconto; A partir de X Unidades**.

Ordem das unidades: **Cada; Kg; A cada 100g; Kg/cada**.

### 5. DE POR CARTAO CRF

Identificação aceita: `DE POR CARTAO CRF`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#5**, nome não conferido | Contém os três efeitos abaixo. |
| Texto De | **#6**, nome não conferido | Preço original. |
| Texto Por | **#12**, nome não conferido | Preço final. |
| Subtipo | **Efeito 1** da #5 | Seleção numérica do subtipo. |
| Unidade | **Efeito 2** da #5 | Seleção numérica da unidade. |
| Quantidade X | **Efeito 3** da #5 | Valor inteiro; não é uma camada de texto separada. |

Ordem dos subtipos: **Cartão Carrefour De Por; NÃO EXISTE MAIS, NÃO USAR;
Cartão Carrefour Levando X Unidades; Cartão Carrefour Com o Desconto;
Cartão Carrefour A partir de X Unidades**.

A segunda posição continua existindo no mapeamento, embora seu label indique
que não deve ser utilizada. Ordem das unidades: **Cada; Kg; A cada 100g; Kg/cada**.

### 6. DE A UNIDADE SAI POR

Identificação aceita: `DE A UNIDADE SAI POR`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto De | Por nome: `PRECO DE` | Preço original. |
| Texto Por | Por nome: `PRECO POR` | Preço final. |
| Unidade Kg/cada | Nome `KG/CADA`; se ausente, **#6** | Camada alternada pelo grupo Unidade. |
| Unidade 100 g | Nome `100G`; se ausente, **#7** | Camada alternada pelo grupo Unidade. |
| Unidade Kg | Nome `KG`; se ausente, **#8** | Camada alternada pelo grupo Unidade. |
| Unidade Cada | Nome `CADA`; se ausente, **#9** | Camada alternada pelo grupo Unidade. |
| Opções de descrição | **#11, #12, #13 e #14**, nomes não conferidos | Camadas alternadas pelo grupo Descr. |

Essas opções alteram a visibilidade de camadas reais. Os labels das quatro
opções de descrição vêm dos nomes reais das camadas encontradas.

### 7. DE POR MEU CRF (DUAL)

Identificação aceita: `DE POR MEU CRF (DUAL)`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#5**, nome não conferido | Contém os três efeitos abaixo. |
| Texto De | Por nome: `PRECO DE` | Preço original. |
| Texto Por | Por nome: `PRECO POR` | Preço final. |
| Subtipo | **Efeito 1** da #5 | Seleção numérica do subtipo. |
| Unidade | **Efeito 2** da #5 | Seleção numérica da unidade. |
| Quantidade X | **Efeito 3** da #5 | Valor inteiro; não é uma camada de texto separada. |

Ordem dos subtipos: **De Por; NÃO EXISTE MAIS, NÃO USAR!; Levando X Unidades;
Com o Desconto; A partir de X Unidades**.

A segunda posição permanece reservada no mapeamento. Ordem das unidades:
**Cada; Kg; A cada 100g; Kg/cada**.

Fonte das mecânicas 4 a 7: [dePor.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/dePor.ts).

<a id="mecanicas-de-desconto"></a>
## Mecânicas de desconto

### 8. TODOS A COM X% DESCONTO

Identificação aceita: `TODOS A COM X% DESCONTO`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#3**, nome obrigatório `Controlador de Mecânica` | Contém os efeitos de tipo e subtipo. |
| Texto do desconto | **#4**, nome não conferido | Percentual de desconto. |
| Tipo | **Efeito 1** da #3 | Seleção numérica do tipo. |
| Subtipo | **Efeito 2** da #3 | Seleção numérica do subtipo. |

Ordem dos tipos: **desconto; na 2ª unidade; Direto no caixa**.
Ordem dos subtipos: **Padrão; Meu Carrefour; Cartão Carrefour**.

O nome da controladora é conferido sem diferenciar maiúsculas/minúsculas,
preservando o acento em `Mecânica`.

### 9. DESCONTO X% MEU CRF

Identificação aceita: `DESCONTO X% MEU CRF`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | Por nome: `POR CENTAGEM DESCONTO` | Percentual de desconto. |
| Opção desconto | **#4**, nome não conferido | Camada ligada/desligada pela opção de desconto. |
| Opção bônus | **#5**, nome não conferido | Camada ligada/desligada pela opção de bônus. |

### 10. DESCONTO X% CARTAO CRF SEGUNDA UNIDADE

Identificação aceita: `DESCONTO X% CARTAO CRF SEGUNDA UNIDADE`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | **#3**, nome não conferido | Percentual de desconto. |
| Opção desconto | **#4**, nome não conferido | Camada ligada/desligada pela opção de desconto. |
| Opção bônus | **#6**, nome não conferido | Camada ligada/desligada pela opção de bônus. |

### 11. DESCONTO X% CARTAO CRF

Identificação aceita: `DESCONTO X% CARTAO CRF`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | **#3**, nome não conferido | Percentual de desconto. |
| Opção desconto | **#4**, nome não conferido | Camada ligada/desligada pela opção de desconto. |
| Opção bônus | **#5**, nome não conferido | Camada ligada/desligada pela opção de bônus. |

### 12. DESCONTO X%

Identificação aceita: `DESCONTO X%`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | **#3**, nome não conferido | Percentual de desconto. |

Esse leitor não usa controladora ou grupo de opções adicional.

### 13. DESCONTO X% SEGUNDA UNIDADE

Identificação aceita: `DESCONTO X% SEGUNDA UNIDADE`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | Por nome: `POR CENTAGEM DESCONTO` | Percentual de desconto. |
| Opção direto no caixa | **#5**, nome não conferido | Camada ligada/desligada pela primeira opção. |
| Opção segunda unidade | **#6**, nome não conferido | Camada ligada/desligada pela segunda opção. |

O leitor retorna o tipo interno `Porcentagem Desconto`, apresentado no painel
como “Porcentagem de desconto”. **Esse tipo interno não é uma identificação
alternativa cadastrada no registro**: o nome reconhecido é o indicado acima.

Nas mecânicas 9 e 13, o nome exigido tem o espaço em **`POR CENTAGEM DESCONTO`**.

### 14. DESCONTO R$ CARTAO CRF

Identificação aceita: `DESCONTO R$ CARTAO CRF`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto do desconto | **#4**, nome não conferido | Valor monetário do desconto. |

Esse leitor não usa controladora ou grupo de opções adicional.

Fontes: [descontoPercentual.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoPercentual.ts)
e [descontoValor.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoValor.ts).

<a id="parcelamentos-e-mecanicas-combinadas"></a>
## Parcelamentos e mecânicas combinadas

### 15. DE POR PARCELAMENTO CARTAO CRF

Identificação aceita: `DE POR PARCELAMENTO CARTAO CRF`.
O tipo retornado ao painel é `De Por Parcelamento Cartao Carrefour`; essa
diferença não muda o nome aceito pelo registro.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto De | Por nome: `PRECO DE` | Preço original. |
| Texto do preço | Por nome: `PRECO` | Preço cheio. |
| Texto da parcela | Por nome: `PRECO PARCELA` | Valor da parcela. |
| Texto da quantidade de parcelas | Por nome: `NUMERO DE PARCELAS` | Quantidade inteira de parcelas. |
| Controladora | Primeira camada cujo nome contenha `Controlador`, em qualquer índice | Contém a propriedade de seleção das opções. |

A busca por `Controlador` diferencia maiúsculas/minúsculas. Dentro dos efeitos
dessa camada, o código procura o `matchName`:

```text
Pseudo/@@yTkh8nJETS2o0/FMnF3Nlw-0001
```

Se não o encontrar, utiliza a primeira propriedade numérica `OneD` encontrada
nos efeitos. Não há exigência de nome público ou posição específica do efeito.

Ordem das opções: **Cartão Carrefour; Plano Controle; Cartão/Plano;
De/Por Cartão; De/Por Plano; De/Por Cartão/Plano**.

O jump depende também das camadas **#2, #3 e #4**, detalhadas na seção de jump.

Fonte: [parcelamento.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/parcelamento.ts)
e [busca da controladora](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/shared.ts).

### 16. DE X POR Y PARCELAMENTO

Identificação aceita: `DE X POR Y PARCELAMENTO`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#5**, nome obrigatório `Controlador de Mecânica` | Contém o controle da condição comercial. |
| Texto De | **#6**, nome não conferido | Preço original. |
| Texto do preço | **#11**, nome não conferido | Preço cheio. |
| Texto da parcela | **#17**, nome não conferido | Valor da parcela. |
| Texto da quantidade de parcelas | **#20**, nome não conferido | Quantidade inteira de parcelas. |
| Controle da condição | Efeito chamado **`Condição`**, na #5, em qualquer posição | Dentro dele, precisa existir uma propriedade numérica `OneD`. |

Ordem das opções: **Cartão Carrefour; Plano Controle;
Cartão Carrefour/Plano Controle; De/Por no Cartão Carrefour;
De/Por no Plano Controle; De/Por no Cartão Carrefour/Plano Controle;
De/Por no Cartão Carrefour PB**.

O jump depende também das camadas **#1, #2 e #3**, com nomes verificados.

Fonte: [deXPorYParcelamento.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYParcelamento.ts).

### 17. DE X POR Y MEU CRF POR Z CARTAO CRF

Identificação aceita: `DE X POR Y MEU CRF POR Z CARTAO CRF`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Texto De | Por nome: `PRECO DE` | Preço original. |
| Texto Por | Por nome: `PRECO POR` | Preço Meu CRF. |
| Texto Por cartão | Por nome: `PRECO POR CARTAO` | Preço Cartão CRF. |
| Controle de unidade | Um único efeito dropdown chamado **`Unidade`**, em qualquer camada e posição da precomp | Seleção da unidade. |

O controle precisa ter propriedade numérica reconhecida como dropdown
(`isDropdownEffect === true`). O nome `Unidade` é comparado exatamente, incluindo
maiúsculas/minúsculas. Mais de um dropdown válido chamado `Unidade`
torna a busca ambígua e desabilita esse controle. Não há exigência de camada
controladora com nome ou índice específico.

Ordem das unidades: **Cada; Kg; A cada 100g; Kg/cada**.

O jump depende também das camadas **#1, #2 e #3**, com nomes verificados.
Seus destinos são **Meu CRF** e **Cartão CRF**.

Fonte: [meuCrfCartao.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/meuCrfCartao.ts).

### 18. DE X POR Y | X% DESCONTO | LEVE X PAGUE Y

Identificação aceita: `DE X POR Y | X% DESCONTO | LEVE X PAGUE Y`.

| Elemento | Localização exigida | Função |
|---|---|---|
| Controladora | **#5**, nome obrigatório `Controlador de Mecânica` | Contém os quatro efeitos abaixo. |
| Texto De | **#6**, nome não conferido | Preço original. |
| Texto Por | **#12**, nome não conferido | Preço final. |
| Texto do desconto | **#16**, nome não conferido | Percentual de desconto. |
| Tipo | **Efeito 1** da #5 | Seleção numérica do tipo. |
| Subtipo | **Efeito 2** da #5 | Seleção numérica do subtipo. |
| Unidade | **Efeito 3** da #5 | Seleção numérica da unidade. |
| Quantidade X | **Efeito 4** da #5 | Valor inteiro; não é uma camada de texto separada. |

Ordem dos tipos: **De Por; Nesta Embalagem; Levando X Unidades;
Com o Desconto; A partir de X Unidades**.

Ordem dos subtipos: **Padrão; Meu Carrefour; Cartão Carrefour**.
Ordem das unidades: **Cada; Kg; A cada 100g; Kg/cada**.

O jump depende também das camadas **#1, #2 e #3**, com nomes verificados.

Nas mecânicas 16 e 18, o nome da controladora é conferido sem diferenciar
maiúsculas/minúsculas, preservando o acento em `Mecânica`.

Fonte: [deXPorYDescontoLeveXPagueY.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYDescontoLeveXPagueY.ts).

<a id="camadas-e-marcadores-do-jump"></a>
## Camadas e marcadores do jump

As quatro mecânicas abaixo usam o **segundo marcador** da camada de marcadores
indicada. Portanto, essa camada precisa conter pelo menos dois marcadores.
O marcador é da camada, não da composição. Os índices continuam sendo locais
à precomp da mecânica.

| Mecânica | Camada dos marcadores | Primeiro destino | Segundo destino | Conferência dos nomes |
|---|---|---|---|---|
| **15 — DE POR PARCELAMENTO CARTAO CRF** | **#2**, segundo marcador | **#3**, pulo do preço cheio | **#4**, pulo da parcela | Nomes não conferidos. |
| **16 — DE X POR Y PARCELAMENTO** | **#1**, `Marcadores`, segundo marcador | **#2**, `PULO PREÇO CHEIO` | **#3**, `PULO PARCELA` | Índices e nomes conferidos. |
| **17 — DE X POR Y MEU CRF POR Z CARTAO CRF** | **#1**, `Marcadores`, segundo marcador | **#2**, `PULO PREÇO MEU CRF` | **#3**, `PULO PREÇO CARTAO CRF` | Índices e nomes conferidos. |
| **18 — Mecânica compartilhada De/Por, desconto e Leve/Pague** | **#1**, `Marcadores`, segundo marcador | **#2**, `PULO PREÇO CHEIO` | **#3**, `PULO` | Índices e nomes conferidos. |

Quando há conferência de nome, a comparação ignora maiúsculas/minúsculas,
mas preserva espaços e acentos. A ausência da estrutura exigida desabilita o
jump; os campos independentes da mecânica ainda podem funcionar.

Fonte da resolução comum: [parcelamento.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/parcelamento.ts).

<a id="estrutura-do-texto-legal"></a>
## Estrutura do texto legal

A extensão acessa a precomp do texto legal pela **camada #1 dentro da precomp
da oferta**, sem conferir o nome dessa camada.

Na tabela abaixo, os índices são **dentro da precomp do texto legal**.

| Elemento | Localização exigida | Comportamento |
|---|---|---|
| Tarja de validade | **#1**, nome não conferido | Permanece ativa. O ajuste de valor usa a primeira propriedade numérica encontrada nos efeitos. |
| Texto legal | **#3**, com Source Text; nome não conferido | Permanece ativo. O conteúdo é editado pelo Source Text; o ajuste numérico usa a primeira propriedade numérica encontrada nos efeitos. |
| Limitação por CPF | Na **#3**, efeito chamado `Limitado por CPF` | Checkbox nativo, propriedade `ADBE Checkbox Control-0001`. Altera o checkbox, sem desligar a camada do texto legal. |
| Quantidade por CPF | Na **#3**, efeito chamado `Quantidade por CPF` | Slider nativo, propriedade `ADBE Slider Control-0001`. |
| Selo de leite | **#4**, nome não conferido | Liga/desliga a camada. |
| Selo beba com moderação | **#5**, nome não conferido | Liga/desliga a camada. |
| Eletro/Pneu | **#6**, cuja origem seja uma precomp; nome não conferido | Liga/desliga a camada e oferece opções da precomp interna. |
| Opções Eletro/Pneu | **#4, #5, #6, #7, #8 e #9 dentro da precomp de origem da #6** | Liga somente a opção selecionada nesse grupo. Os labels vêm dos nomes reais dessas camadas. |

Fontes: [leitura dos controles legais](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/legalControls.ts)
e [ações dos controles legais](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/legalControls.ts).

<a id="dependencias-que-precisam-ser-preservadas"></a>
## Dependências que precisam ser preservadas

- A sequência **descritivo → mecânica → imagem** associa os elementos de cada
  produto. Inserir uma camada entre eles muda a associação.
- Nos campos e controles por índice, preserve a posição da camada ou do efeito.
- Nos campos e controles por nome, preserve o nome usado na busca, incluindo
  espaços e acentos quando presentes.
- Em algumas controladoras e nos jumps mais novos, o código exige **posição e
  nome ao mesmo tempo**.
- As opções de dropdown usam posições numéricas. Preserve a ordem dos itens,
  inclusive posições antigas marcadas como “NÃO USAR”.
- Labels visuais do painel e identificadores internos têm funções diferentes.
  Corrigir a apresentação de “Preço” ou “Cartão” não renomeia `PRECO`, `CARTAO`
  nem as referências dos templates.
- A ausência de uma camada nesta lista não determina que ela possa ser removida
  do `.aep`: outras camadas e expressões do próprio template podem depender dela.

<a id="fontes-do-levantamento"></a>
## Fontes do levantamento

| Responsabilidade | Arquivo |
|---|---|
| Registro dos 18 leitores | [registry.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/registry.ts) |
| Comentário e nome da precomp | [mechanicIdentity.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/mechanicIdentity.ts) |
| Estrutura das ofertas e dos produtos | [buildOfferSnapshot.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/buildOfferSnapshot.ts) |
| Busca por nome, índice e origem | [findLayers.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/findLayers.ts) |
| Source Text e campos por índice | [textFields.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/textFields.ts) |
| Efeitos, controladoras e seleção de opções | [shared.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/shared.ts) |
| Simples e Leve/Pague | [simples.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/simples.ts) |
| Alias do Todos A Com Leve X Pague Y | [allTakePayMechanic.js](ARIZONA-EXTENSION/src/shared/allTakePayMechanic.js) |
| De/Por e variações | [dePor.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/dePor.ts) |
| Descontos percentuais | [descontoPercentual.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoPercentual.ts) |
| Desconto em dinheiro | [descontoValor.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/descontoValor.ts) |
| Parcelamento antigo e resolução dos jumps | [parcelamento.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/parcelamento.ts) |
| De X Por Y Parcelamento | [deXPorYParcelamento.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYParcelamento.ts) |
| Meu CRF e Cartão CRF | [meuCrfCartao.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/meuCrfCartao.ts) |
| Mecânica compartilhada | [deXPorYDescontoLeveXPagueY.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/deXPorYDescontoLeveXPagueY.ts) |
| Estrutura do texto legal | [legalControls.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/legalControls.ts) |
| Ações do texto legal | [actions/legalControls.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/legalControls.ts) |
| Troca do arquivo de imagem | [replaceProductImage.ts](ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/replaceProductImage.ts) |
