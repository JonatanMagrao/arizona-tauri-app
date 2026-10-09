# Plano de troca de mecânicas na extensão CEP

**Status:** proposta para implementação futura. Este documento não implementa a troca.

**Data:** 8 de outubro de 2026.

**Escopo:** trocar a mecânica de um produto dentro de uma oferta, preservando sua associação com o descritivo e a imagem. O trabalho pertence à extensão `ARIZONA-EXTENSION`.

## 1. Objetivo e abordagem

Permitir escolher outra mecânica, aproveitar os dados compatíveis e informar o que falta antes de concluir a troca.

Hoje existem sete famílias. Há **42 trocas direcionadas entre famílias diferentes**, além de sete escolhas do próprio tipo. Isso serve para organizar a validação; não exige 42 conversores separados.

A proposta é mapear cada família para um conjunto comum de dados:

```text
Mecânica de origem
    → leitura e interpretação dos dados
    → dados comuns + escolhas de transferência
    → preenchimento de uma cópia do template de destino
    → validação e substituição na oferta
```

Cada família terá regras de leitura e preenchimento. Exceções serão declaradas quando houver diferença de significado, sem criar uma tabela manual de todas as combinações.

## 2. O que existe hoje

| Recurso | Situação atual | Consequência para a troca |
|---|---|---|
| Configuração das sete famílias | JSON oficial em `src/js/assets/schema.json`, distribuído por `copyAssets` | Reutilizar a localização de camadas, efeitos e opções |
| Leitura do JSON | Configuração validada e fixa durante cada operação; relida na operação seguinte | A execução inteira deve usar a mesma configuração |
| Identificação da família | Comentário da composição de origem, com tentativa pelo nome quando necessário | Diferenciar a família do papel da camada na oferta |
| Localização interna | Comentários definidos no schema; fallback por nome controlado no código | Respeitar a configuração de fallback durante a validação |
| Associação do produto | `DESCRITIVO n`, `MECANICA n` e `PRODUTO n`, para `n` de 1 a 3 | Preservar o número do conjunto, independentemente da ordem física |
| Leitura e edição | Campos, controles e jump das famílias atuais | Reutilizar os contratos existentes, sem presumir que campos semelhantes são equivalentes |
| Troca de posição de produtos | Troca os conteúdos dos conjuntos; possui pré-validação e reversão | É uma referência de proteção, mas não converte uma mecânica em outra |
| Roteiro | Usa a associação numerada e os leitores das mecânicas | Validar sua leitura e correção após a troca |
| Configuração de réguas | Não existe configuração específica de réguas | Identificar se o destino precisa variar conforme o layout |
| Catálogo de templates e conversão | Não existem no fluxo atual | Precisam ser projetados |

O schema atual descreve **onde ler e escrever**. Ele não define qual composição é o template de destino nem como converter o significado dos dados.

### Duas identidades que precisam continuar separadas

| Identidade | Exemplo | Função |
|---|---|---|
| Comentário da camada externa | `MECANICA 2` | Associa a mecânica ao produto 2 da oferta |
| Comentário da composição usada como source | `SIMPLES` | Identifica a família e seleciona seu leitor |

Trocar a família não deve trocar o comentário externo para `SIMPLES`, nem renumerar o produto.

## 3. Dados disponíveis em cada família

Esta tabela resume os contratos atuais. Ela não afirma equivalência automática entre os campos.

| Família | Dados editáveis atuais | Controles | Jump |
|---|---|---|---|
| `SIMPLES` | `preco` | Unidade | Não |
| `TODOS A COM LEVE X PAGUE Y` | `leve-x`, `pague-y` | Subtipo | Não |
| `TODOS A COM X% DESCONTO` | `por-centagem-desconto` | Tipo e subtipo | Não |
| `DESCONTO R$ CARTAO CRF` | `desconto-reais` | Nenhum | Não |
| `DE X POR Y PARCELAMENTO` | `preco-de`, `preco`, `preco-parcela`, `numero-de-parcelas` | Condição | Preço cheio / parcela |
| `DE X POR Y MEU CRF POR Z CARTAO CRF` | `preco-de`, `preco-por`, `preco-por-cartao` | Unidade | Meu CRF / cartão CRF |
| `DE X POR Y \| X% DESCONTO \| LEVE X PAGUE Y` | `preco-de`, `preco-por`, `por-centagem-desconto`, `quantidade-x` | Tipo, subtipo e unidade; Quantidade X é um campo de efeito | Preço cheio / pulo |

O significado efetivo pode depender do tipo, subtipo ou condição selecionados. A família combinada não deve ser tratada como uma única apresentação invariável.

`A SEGUNDA UNIDADE SAI POR` não está no contrato atual do schema. Seu eventual suporte fica fora da primeira implementação e requer validação própria.

## 4. Mapeamento comum proposto

Os conceitos abaixo são uma proposta, não novos atributos já aceitos pelo JSON.

| Conceito | Regra de transferência proposta |
|---|---|
| Preço original / De | Transferir somente de um campo confirmado como preço original |
| Preço de venda sem benefício | Não confundir com preço Meu Carrefour, cartão ou parcela |
| Preço Meu Carrefour | Manter sua condição; para virar preço comum, exigir escolha explícita |
| Preço no cartão Carrefour | Manter sua condição; para virar preço comum, exigir escolha explícita |
| Desconto percentual | Preservar percentual e condição de aplicação, inclusive segunda unidade quando houver |
| Desconto em reais | Não converter em percentual sem preço-base e regra aprovada |
| Leve X e pague Y | Preservar quantidades distintas; não igualar automaticamente a Quantidade X |
| Quantidade mínima / X | Interpretar conforme o tipo selecionado; não presumir que representa parcelas ou Leve X |
| Parcelamento | Manter valor da parcela, número de parcelas e significado do preço total separados |
| Unidade | Transferir pelo significado da opção, não pelo índice do efeito |
| Tipo, subtipo e condição | Usar equivalências declaradas; labels e índices podem ser diferentes no destino |
| Jump | Interpretar os alvos de cada família; não copiar o identificador genérico de um alvo como se o significado fosse igual |

### Regras para evitar ambiguidade

- Nome, comentário, label, índice ou formato monetário iguais não bastam para provar equivalência.
- A semântica estável deve ficar no código compartilhado; o JSON continua responsável pelos comentários e vínculos de efeitos e opções.
- Registrar a origem de cada valor transferido e a condição associada. Não condensar todos os preços em um único campo ambíguo.
- Diferenciar ausência de valor de zero. Isso não exige introduzir `null` no schema.
- Preservar precisão e interpretar a formatação brasileira explicitamente. Não usar arredondamentos ou cálculos silenciosos.
- Quando uma expressão controlar o destino, validar se a escrita realmente produz o resultado desejado. Não desativar a expressão automaticamente.
- Labels editáveis não devem ser a única identidade semântica das opções. As equivalências precisam de uma definição estável no código.

## 5. Possibilidades e limites

| Situação | Comportamento proposto |
|---|---|
| Existe equivalência e o destino está completo | Permitir transferência direta após validação |
| O destino precisa de dados ausentes | Solicitar os campos necessários antes de modificar a oferta |
| Há mais de um preço possível na origem | Apresentar as alternativas e exigir a escolha do preço a preservar |
| A origem tem dados que o destino não representa | Mostrar quais dados deixarão de aparecer e exigir ciência antes da execução |
| O mesmo tipo já está selecionado | Não alterar a composição; mudanças de subtipo continuam no fluxo existente |
| O template não existe ou há vários candidatos indistinguíveis | Bloquear a troca e explicar a identificação necessária |
| Camadas, efeitos, associações ou opções estão inválidos | Bloquear a troca daquele produto antes de escrever |
| Dependências ou expressões não podem ser isoladas com segurança | Manter a origem e indicar a incompatibilidade do template |
| A composição que contém a oferta é compartilhada por outras instâncias | Bloquear inicialmente; duplicar somente a mecânica não isola a alteração do slot dentro desse contêiner |
| O destino não cabe na régua ou possui animação incompatível | Bloquear até existir uma variante validada ou uma regra de adaptação |

Exemplos:

| Troca | O que pode ser aproveitado | O que exige definição |
|---|---|---|
| Simples → família combinada em De/Por, subtipo Padrão | Preço simples como preço Por e unidade, após confirmar a equivalência | Preço De e controles do destino |
| Meu CRF/cartão → Simples | Unidade | Qual dos preços vira o preço simples e como comunicar a condição removida |
| Simples → Parcelamento | Preço como possível total, se a condição do destino tiver esse significado | Número de parcelas, valor da parcela, condição e possível preço De |
| Desconto em reais → desconto percentual | Valor original para referência | Preço-base, condição, fórmula e arredondamento; sem isso, a troca não pode calcular o percentual |
| Todos com Leve X Pague Y → Simples | Não há preço explícito nesses campos para transferir | Preço simples precisa ser informado; o benefício deixa de ser representado |

Desfazer deve recuperar a situação anterior. Trocar A → B → A não garante recuperar dados que B não representava. Um histórico persistente de dados por família seria outro recurso e fica fora do escopo inicial.

## 6. Templates e compatibilidade visual

A troca pressupõe uma composição de destino válida. Apenas renomear a composição antiga não cria as camadas, efeitos ou animações da nova família.

| Decisão | Direção proposta | Validação necessária |
|---|---|---|
| Onde buscar templates | Primeiro, catálogo explícito de composições no projeto aberto | Não selecionar a primeira composição que pareça pertencer à família; ela pode ser uma instância já preenchida |
| Identidade do template | Identificação separada da identidade da família e do slot | Distinguir claramente template e instâncias |
| Variantes | Identificar família e contexto visual quando necessário | Levantar réguas de 1, 2 e 3 produtos e orientações vertical/horizontal; não presumir template universal |
| Isolamento | Criar cópia independente das partes que receberão alterações | Auditar dependências, referências e compartilhamento antes de preencher |
| Contêiner da oferta | Detectar referências à composição que contém `MECANICA n` | Se estiver compartilhada, bloquear na primeira versão; um isolamento futuro do contêiner exige preservar também os demais slots |
| Dependências reutilizadas | Compartilhar apenas o que foi confirmado como imutável | Não escrever em composições usadas por outras ofertas |
| Catálogo em JSON | Avaliar depois do levantamento dos templates | O validador atual tem contrato estrito; novos atributos exigem evolução planejada do formato e dos testes |

Recomendação inicial: manter as regras de conversão no código e preservar a simplicidade do schema existente. Um catálogo externo ou importação de templates de outro `.aep` poderá ser uma etapa posterior.

Duplicar somente a composição principal não deve ser considerado prova de isolamento. O levantamento precisa incluir precomps aninhadas, dependências repetidas, possíveis ciclos e expressões que referenciem composições ou camadas pelo nome.

Há dois compartilhamentos diferentes: a composição da mecânica e a composição que contém a oferta. Se duas instâncias usam o mesmo contêiner de oferta, mudar o source de `MECANICA n` dentro dele afeta ambas, mesmo que a nova mecânica seja uma cópia independente. A pré-validação deve detectar esse caso antes de qualquer escrita e bloqueá-lo inicialmente.

Na clonagem, prever uma correspondência entre cada original e sua cópia. Isso evita duplicar repetidamente a mesma dependência e permite verificar referências após a cópia.

## 7. Execução segura proposta

1. **Ler e planejar:** localizar oferta e slot pela associação atual, interpretar dados e selecionar o template. Retornar ao painel uma prévia serializável, sem referências nativas do After Effects.
2. **Resolver pendências:** mostrar dados transferidos, campos ausentes, opções incompatíveis e informações não representadas no destino. Nenhuma alteração na oferta nesta etapa.
3. **Revalidar ao executar:** localizar novamente as camadas e comparar origem, dados, configuração e template com a prévia. Conferir também referências ao contêiner da oferta e bloquear compartilhamento não suportado. Se algo mudou, exigir nova prévia, em vez de aplicar decisões antigas.
4. **Capturar o estado:** guardar source original, identidade do slot e propriedades externas relevantes para conferência e reversão.
5. **Preparar a cópia:** dentro de um grupo de Undo, clonar as dependências necessárias e preencher o destino ainda sem conectá-lo à oferta. Validar camadas, efeitos, opções, valores lidos após escrita e jump.
6. **Substituir apenas a mecânica:** ligar a composição preparada à camada `MECANICA n`. Preservar descritivo, imagem, comentário externo, número do conjunto e propriedades externas compatíveis.
7. **Conferir o resultado:** gerar nova leitura da oferta e verificar família, valores, associação, jump e dados usados pelo Roteiro. Atualizar o painel apenas com o resultado confirmado.
8. **Reverter em caso de falha:** restaurar o estado original e remover somente cópias criadas pela operação que não estejam referenciadas. Informar qualquer falha de reversão; Undo é apoio, não substituto da reversão explícita.

O grupo de Undo deve ser encerrado em `finally`. Manter a composição original durante a operação e não apagar templates ou instâncias anteriores como parte da troca inicial.

### Propriedades externas a conferir

| Grupo | Verificações |
|---|---|
| Associação | Comentário `MECANICA n`, posição física, identidade da camada e vínculo com descritivo/produto |
| Transformação | Posição, escala, âncora, rotação, opacidade, parent, keyframes e expressões |
| Tempo | In/out, start time, stretch, duração, frame rate e time remap |
| Composição | Dimensões, alinhamento, máscaras, efeitos externos, mattes e switches relevantes |
| Referências | Expressões externas e internas, referências por nome e dependências compartilhadas |

A intenção é preservar a camada externa, mas trocar seu source pode mudar o resultado visual mesmo com os valores externos intactos. Não copiar a lógica de escala da troca de posições sem validar essa diferença. A correção automática de expressões também precisa de auditoria, não de ativação presumida.

## 8. Dificuldades e decisões antes de implementar

| Ponto | Dificuldade estimada | Como reduzir a incerteza |
|---|---|---|
| Aproveitar localização por comentário e schema | Baixa a moderada | Reutilizar os leitores e validar o destino pelo mesmo contrato |
| Equivalência dos preços e condições | Alta | Aprovar uma tabela semântica por família e por variante |
| Campos ausentes e perda de informações | Moderada | Prévia explícita e preenchimento obrigatório quando necessário |
| Catálogo e compatibilidade entre réguas | Moderada a alta | Inventariar templates reais e validar dimensões/animações |
| Clonagem e expressões | Alta | Inspecionar dependências e limitar inicialmente aos templates comprovados |
| Preservação de tempo, jump e propriedades externas | Alta | Fixtures reais, comparação antes/depois e testes no After Effects |
| Reversão e isolamento de outras ofertas | Alta | Preparação separada, escrita tardia no slot e testes de falha em cada etapa |

A estimativa depende dos templates reais. O código sozinho não demonstra que as expressões, animações e layouts de todos os `.aep` são compatíveis.

Decisões necessárias: catálogo de templates; variantes visuais aceitas; significado de cada campo condicionado; opções equivalentes; dados obrigatórios por destino; regras para perda de informações; limites para dependências e expressões. Cálculos automáticos ficam fora da primeira versão.

## 9. Plano de ação

| Etapa | Trabalho futuro | Entregável / critério de saída |
|---|---|---|
| 1. Inventário | Inspecionar os templates atuais das sete famílias, variantes, dependências e expressões | Catálogo identificável e matriz de compatibilidade com as réguas |
| 2. Contrato dos dados | Definir significados, tipos, condições e campos obrigatórios por variante | Tabela aprovada; nenhuma equivalência baseada apenas no nome |
| 3. Regras de transferência | Definir leitura para dados comuns e preenchimento por família | Casos diretos, pendentes e bloqueados documentados; sem cálculos implícitos |
| 4. Planejamento sem escrita | Produzir prévia e detectar dados ausentes, perdas e incompatibilidades | Oferta permanece intacta; resultado determinístico e verificável |
| 5. Preparação do destino | Resolver template, clonar dependências e preencher cópia isolada | Leitura após escrita confirma dados e controles; outras ofertas intactas |
| 6. Piloto controlado | Implementar Simples ↔ família combinada em De/Por, subtipo Padrão, usando templates validados | Preço De informado quando faltar; retorno usa preço Por; associação e Undo aprovados |
| 7. Expansão | Cobrir as demais famílias, variantes e alvos de jump | Cada caso possui resultado correto ou bloqueio explicado |
| 8. Integração do painel | Oferecer seleção, prévia, campos pendentes e execução com revalidação | Interface não conclui trocas incompletas nem aplica uma prévia desatualizada |
| 9. Regressão e homologação | Testar editor, Roteiro, swaps, imagens, texto legal e layouts reais | Testes automatizados e validação manual no After Effects aprovados |

O piloto é uma proposta de sequência. Sua viabilidade depende do inventário e das equivalências confirmadas nas etapas 1 a 3.

## 10. Validação necessária

| Área | Cobertura planejada |
|---|---|
| Famílias | Os 42 pares direcionados; resultado esperado pode ser sucesso, pendência ou bloqueio. Sete seleções do próprio tipo sem alteração |
| Variantes | Tipos, subtipos, condições e opções de cada família; os 42 pares não cobrem sozinhos todas as apresentações |
| Valores | Ausência, zero, casas decimais, formatação brasileira, porcentagem, quantidades, preços condicionais e valores controlados por expressão |
| Associação | Slots 1–3, ordem invertida, lacunas, grupos inativos, comentários duplicados e grupos incompletos |
| Isolamento | Template usado em várias ofertas, dependências repetidas, mecânica compartilhada e duas instâncias usando o mesmo contêiner de oferta; o último caso deve ser bloqueado sem alterações |
| Jump e tempo | Marcadores ausentes, alvos incompatíveis, posição temporal, duração diferente, stretch e time remap |
| Falhas | Erro de clonagem, preenchimento, substituição, leitura final, limpeza e reversão; mudança da origem entre prévia e execução |
| Integração | Atualização do painel, edição posterior, troca de posições, imagens e texto legal; Roteiro lê e corrige o produto correto |
| Visual | Réguas de 1, 2 e 3 produtos, vertical e horizontal, alinhamento e animação em templates reais |

Executar testes e build no diretório da extensão, conforme seus scripts. Os testes automatizados precisam comprovar regras e reversão; não substituem a conferência visual e temporal no After Effects.

### Critérios de aceite

- Nenhum preço condicional é transformado em preço comum sem regra explícita.
- Nenhum dado obrigatório é inventado ou ocultado para concluir a troca.
- Somente o slot selecionado muda; outras ofertas e os templates permanecem intactos.
- Comentário e associação externa são preservados, inclusive com camadas fora de ordem.
- A nova mecânica continua editável pelos leitores e ações atuais.
- Falha deixa a origem preservada ou restaurada e produz informação suficiente para recuperação.
- Roteiro, jump, layout, Undo e edição posterior funcionam nos templates homologados.

## 11. Fronteiras e referências

A implementação futura pertence ao CEP. Não exige importações de runtime do Tauri, do Admin ou do plugin legado, nem alterações em licenciamento, render ou contratos externos.

Mudanças futuras em assets distribuídos seguem o empacotamento oficial existente. O plano não prevê contornar assinatura nem editar o payload instalado em clientes.

| Referência | Papel |
|---|---|
| [Mapa das camadas](../MAPA_CAMADAS_MECANICAS_CEP.md) | Camadas e efeitos atualmente necessários |
| [Schema oficial](../ARIZONA-EXTENSION/src/js/assets/schema.json) | Comentários, vínculos e opções configuráveis |
| [Configuração das mecânicas](../ARIZONA-EXTENSION/README.md) | Leitura do asset e distribuição |
| [Registro](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/registry.ts) | Reconhecimento das famílias |
| [Bindings](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/mechanics/schemaBindings.ts) | Campos, efeitos e jump por família |
| [Estrutura da oferta](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/layers/offerStructure.ts) | Associação numerada dos conjuntos |
| [Troca de posições](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/actions/swapProducts.ts) | Referência existente de pré-validação e reversão; não é conversor |
| [Leitura para o Roteiro](../ARIZONA-EXTENSION/src/jsx/aeft/domains/ofertas/snapshot/firstOfferProductForValidation.ts) | Identificação do produto usado na validação |

