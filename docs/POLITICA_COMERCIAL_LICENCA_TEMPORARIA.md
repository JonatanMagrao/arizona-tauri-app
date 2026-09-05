# Política comercial e análise interna de precificação do Arizona

**Uso:** reservado ao fornecedor. Contém custos, remuneração, margens e limites
de negociação. Não encaminhar este documento integralmente ao cliente.

**Última revisão:** 2026-09-05

**Status:** mensalidade-base de **R$ 1.490** escolhida pelo fornecedor. Os demais
preços e condições são referências para propostas, não aceite da Arizona
Crossmedia nem alteração automática de contrato existente.

**Material para o cliente:** [Pitch comercial do Arizona](./PITCH_COMERCIAL_ARIZONA.md),
sem cifras, custos, margens ou premissas financeiras internas.

**Fonte comercial:** este documento. A planilha de precificação entregue junto
da análise é um apoio para simulações; alterações futuras devem ser conciliadas
com as premissas e decisões registradas aqui.

**Fontes técnicas:** [Arizona App](../README.md),
[Extensão CEP](../ARIZONA-EXTENSION/README.md),
[Admin](../ADMIN/README.md) e
[licenciamento e chaves](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md).
Esta política não altera autenticação, código, instaladores ou infraestrutura.

## Escopo e contexto da negociação

O cliente desta análise é a **Arizona Crossmedia**. A proposta contempla o
Arizona App, a extensão CEP e os serviços necessários ao escopo contratado,
para **até dez pessoas cadastradas, com uma máquina ativa por pessoa**. Não é
uma licença para uma equipe ilimitada com dez acessos simultâneos.

**O módulo de renderização distribuída em outras máquinas está fora da
negociação**, inclusive dos valores de venda, documentação de transferência e
cessão apresentados neste documento. Sua existência no repositório não o
inclui no objeto comercial. O render local e os demais recursos devem constar
do inventário da versão efetivamente contratada.

O fornecedor foi contratado como freelancer de motion e criou o aplicativo por
iniciativa própria para agilizar esse trabalho. O freela era remunerado em
aproximadamente R$ 5.000 mensais. A proposta original era permitir que a equipe
executasse os fluxos atendidos pelo app, reduzindo a dependência desse trabalho
mensal e gerando receita recorrente para o fornecedor.

O fornecedor estima **160 horas totais de desenvolvimento**, distribuídas por
meses, períodos ociosos do freela e alguns fins de semana. Não há apontamento
preciso. A venda usa essa estimativa como referência econômica e compara
também 120 e 200 horas; não se trata de cobrança retroativa de horas ao cliente.

Esse histórico é contexto de negociação, não prova de economia líquida de
R$ 5.000, de horas efetivamente poupadas, de substituição integral de um
profissional ou da titularidade exclusiva do código. A margem e a capacidade
de pagamento da Arizona Crossmedia não foram verificadas. O relato de uma
operação com preços baixos e urgência frequente orienta a definição de escopo
e agenda, mas não determina sozinho o preço do produto.

## Decisão comercial e preços de referência

| Modalidade | Preço de referência | O que remunera |
|---|---:|---|
| Licença mensal | **R$ 1.490/mês** | Uso do escopo contratado, infraestrutura-base e correções cobertas |
| Manutenção cobrável ou nova feature avulsa | R$ 200/h | Trabalho autorizado e agendado |
| Pacote de quatro horas mensais | R$ 720, além da licença | R$ 180/h com pagamento antecipado e agenda combinada |
| Pacote de oito horas mensais | R$ 1.440, além da licença | R$ 180/h com pagamento antecipado e agenda combinada |
| Licença com três horas mensais adicionais | R$ 2.000/mês | Licença de R$ 1.490 e pacote especial de R$ 510, equivalente a R$ 170/h |
| Licença com oito horas mensais adicionais | R$ 2.930/mês | Licença e pacote de R$ 1.440 |

A mensalidade escolhida é R$ 1.490. Para uma negociação com orçamento próximo
de R$ 2.000, a referência é a licença com **três horas mensais adicionais**.
O desconto especial dessa composição não altera a tarifa avulsa nem dá direito
a mais horas pelo mesmo valor unitário. Excedentes dependem de autorização e
são orçados a R$ 200/h.

As tabelas antigas de assinatura, suporte, períodos e descontos foram
substituídas por esta revisão. Não há preço vigente de SLA ou desconto anual
automático. Licenças intermitentes para picos podem ser negociadas por proposta
própria, com período consecutivo, pagamento antecipado e condições de
reativação. Não derivar diárias, semanas ou descontos por simples divisão da
mensalidade atual.

### Regras da assinatura e dos serviços

- Iniciar com acompanhamento de três meses, pagamento mensal antecipado e
  medição de consumo e trabalho efetivo. A proposta deve definir início,
  vencimento, cancelamento e aviso prévio; referência de aviso: trinta dias.
  O acompanhamento não cria fidelidade anual automática.
- A assinatura inclui a infraestrutura-base descrita na proposta, hoje
  estimada principalmente pelo Supabase. Mais usuários, novos ambientes ou
  consumo extraordinário precisam de orçamento e aprovação prévios.
- Descrever versão e ambiente suportados, limites de uso e responsabilidades.
  Licenças Adobe, equipamentos, rede e serviços do próprio cliente não são
  fornecidos pela mensalidade.
- Correções de defeitos reproduzíveis atribuíveis ao produto e cobertos pela
  contratação não consomem as horas adicionais pagas.
- Horas de serviço cobrem reuniões do pedido, diagnóstico cobrável autorizado,
  implementação, testes, documentação da mudança e implantação. Registrar o
  tempo e apresentar relatório simples de utilização.
- Referência de apontamento: blocos de quinze minutos nos pacotes, sem
  arredondar individualmente cada mensagem. No avulso, uma hora mínima por
  atendimento autorizado e blocos adicionais de quinze minutos. Informar
  essas regras no orçamento.
- Pacotes são mensais, antecipados e executados em agenda acordada. Não há
  acúmulo indefinido. Se o fornecedor impedir a execução de horas agendadas,
  conceder crédito ou reagendar sem perda para o cliente.
- Comprar horas não garante concluir uma lista ilimitada de demandas.
  Estimar cada pedido e obter autorização antes de ultrapassar o orçamento.
- Urgência depende de aceite e disponibilidade. Plantão, atendimento imediato
  e prioridade sobre compromissos existentes não estão incluídos.
- Reajuste anual pelo IPCA pode constar da proposta. A avaliação inicial pode
  fundamentar novas condições para períodos seguintes, com comunicação e
  acordo, sem cobrança retroativa ou alteração unilateral do que foi vendido.

### Correção coberta, manutenção cobrável e SLA

Correção coberta é a reparação de um defeito reproduzível na versão suportada,
em ambiente compatível, que contrarie o comportamento documentado do produto.
O atendimento segue a agenda normal e o compromisso contratual aplicável.
**Não há SLA de resposta ou solução definido nesta proposta-base.**

Mudanças de fluxo, novas funcionalidades, customizações, treinamento, ajustes
de projetos e materiais do cliente, mudanças de ambiente e adaptações a novas
versões de terceiros podem ser cobradas, conforme diagnóstico e escopo. Não
atribuir automaticamente uma falha ao cliente apenas por envolver Windows,
After Effects, Drive ou outro terceiro: investigar sua relação com o
comportamento suportado do produto.

Se for necessário diagnóstico cobrável para distinguir defeito do produto de
problema de ambiente, explicar a hipótese e obter autorização antes de gerar
cobrança. Uma correção coberta não deve virar serviço adicional apenas porque
consumiu mais tempo do que o previsto internamente.

SLA e suporte especial serão objeto de negociação própria, após verificar a
capacidade de atendimento. Não reutilizar os prazos da versão anterior da
política. Os serviços técnicos exigidos durante a validade técnica do software
devem ser tratados no contrato, conforme a Lei do Software; ausência de SLA
não equivale à ausência dessas obrigações.

### Features por hora ou por preço fechado

Manutenção cobrável e novas features usam a mesma referência avulsa de
R$ 200/h. A estimativa deve incluir definição do pedido, implementação, testes
e entrega. Para preço fechado, definir resultado, exclusões e critérios de
aceite e acrescentar contingência explícita para a incerteza do escopo.

Exemplo: vinte horas a R$ 200/h representam R$ 4.000; contingência de 20%
produz preço fechado de **R$ 4.800**. Ela faz parte do preço e do risco
assumido, não autoriza registrar horas não trabalhadas em contratação por
tempo. Alterações de escopo exigem nova estimativa antes da execução.

Cada orçamento deve definir a titularidade das melhorias. A intenção comercial
é preservar as melhorias genéricas do Arizona com o fornecedor, concedendo
licença de uso ao cliente, e orçar exclusividade ou cessão separadamente.
Isso precisa estar expresso no instrumento, inclusive para derivações;
o pagamento das horas não deve deixar a titularidade em aberto.

## Contexto interno da empresa e capacidade de trabalho

| Informação fornecida | Situação usada nesta análise |
|---|---|
| Estrutura | LTDA, ME, optante pelo Simples, sócio único e sem empregados |
| Receita dos últimos doze meses | Aproximadamente R$ 150 mil a R$ 180 mil |
| Pró-labore atual | Aproximadamente R$ 4.200; prática declarada próxima de 30% do faturamento |
| Previsão de faturamento | R$ 20 mil a R$ 25 mil mensais no mesmo CNPJ, somando os negócios |
| Atividades | Desenvolvimento de software e motion/pós-produção; CNAEs e município não confirmados |
| Jornada principal | Trabalho para a Superpley, de Israel, ocupando a jornada diária principal |
| Tempo desejado para extras | Até duas horas diárias para o conjunto dos projetos adicionais |

O cenário anterior de dividir custos por oitenta horas faturáveis não descreve
uma disponibilidade da Arizona. A jornada principal já está comprometida e
os custos compartilhados devem ser distribuídos entre os negócios.

Com vinte dias úteis como hipótese, duas horas diárias representam cerca de
**quarenta horas mensais para todos os extras**. Começar com três a oito horas
de serviço vendido à Arizona. Usar dezesseis horas mensais, incluindo
manutenção coberta, apenas como teto interno inicial de planejamento para esse
cliente, preservando o restante para outros projetos. Não prometer esse teto
como disponibilidade incluída.

A possibilidade passada de trabalhar dezesseis horas por dia não é a base
da capacidade contratada. Considerar o custo de ocupar noites, fins de semana,
descanso ou tempo dos projetos próprios ao aceitar pedidos.

## Custos mensais, dados conhecidos e hipóteses

Os valores são gerenciais. Rateios domésticos, depreciação e provisões não
representam automaticamente despesas fiscais dedutíveis ou saídas mensais de
caixa. O Simples normalmente incide sobre receita, sem abatimento desses
custos da base do DAS.

| Item | Valor informado ou hipótese | Critério empresarial | Custo mensal usado |
|---|---:|---|---:|
| Internet fibra | R$ 200/mês, informado | 50% para trabalho, hipótese | R$ 100 |
| Internet de contingência | R$ 300/mês, informado | Interpretada como conexão de backup dedicada ao trabalho, 100% | R$ 300 |
| Energia da casa e office | R$ 500/mês, informado | 50% empresarial, hipótese | R$ 250 |
| Computador | R$ 25.000, informado | Vida útil gerencial de 36 meses e residual de R$ 2.500 | R$ 625 |
| IA paga | US$ 200/mês, informado | Fatura de R$ 1.100 como hipótese em reais | R$ 1.100 |
| Contabilidade | R$ 200/mês, informado | Custo empresarial | R$ 200 |
| Reparos e periféricos | Hipótese | R$ 100/mês, sem duplicar reposição do computador | R$ 100 |
| Certificados e honorários extras | Hipótese de R$ 1.200/ano | Divisão por doze meses | R$ 100 |
| Outros softwares, backup de dados e segurança | Hipótese | Incluir Adobe apenas se o fornecedor pagar, sem repetir IA | R$ 300 |
| **Subtotal compartilhado** | | | **R$ 3.075** |
| Supabase do Arizona | Estimativa de R$ 200/mês | Atribuição direta ao produto | R$ 200 |
| **Total empresarial estimado** | | Antes de trabalho e tributos | **R$ 3.275** |

O computador informado possui Ryzen 9950X, RTX 5080 e armazenamento de alto
desempenho. Não se estimou consumo elétrico pela potência máxima dos
componentes. A parcela de energia deve ser calibrada por uso real ou medição.
O desgaste gerencial é (25.000 − 2.500) ÷ 36 = R$ 625/mês. Não descontar também
a compra integral do mesmo bem no mesmo cálculo de lucro.

### Custos ocultos e campos a confirmar

- Conferir a fatura de IA em reais, câmbio, encargos e entidade faturadora.
  Avaliar com o contador eventuais tributos da contratação internacional de
  IA, Supabase ou outros serviços, sem presumir que o cartão encerra todas
  as obrigações tributárias.
- Substituir as provisões pelos gastos reais de software, armazenamento,
  domínio, backup, segurança, certificado digital, taxas e honorários extras.
- Acrescentar taxas bancárias, de cobrança ou recebimento, juros e serviços de
  terceiros efetivamente contratados, sem contar novamente o mesmo gasto.
- Se existirem, informar parcela empresarial de aluguel, condomínio, seguro,
  nobreak e outros equipamentos. Não há valores confirmados para esses itens.
- Registrar reuniões, mensagens dos pedidos, diagnóstico, pesquisa específica,
  testes, implantação, documentação e cobrança.
- Medir retrabalho coberto, interrupções, incidentes e períodos sem demanda.
  A reserva de risco é uma hipótese financeira, não uma estimativa comprovada
  de todos esses eventos.
- Separar reservas de caixa para férias, doença e atrasos de clientes de
  despesas contábeis. A condição de sócio sem empregados não cria, por si,
  encargos automáticos de férias, décimo terceiro e FGTS de empregado.

O uso compartilhado da estrutura pela Superpley e pelos demais projetos não
torna todo recebimento do Arizona lucro. Também não justifica atribuir ao
Arizona a fatura integral de todos os recursos da empresa.

## Tributos e retiradas: referência interna

As regras de 2026 são referência para planejar 2027, não apuração antecipada
definitiva. Todas as receitas informadas entram no mesmo CNPJ para a RBT12,
com segregação por atividade para o anexo aplicável.

| Receita mensal estável | RBT12 | DAS se toda a receita estiver no III | DAS se toda a receita estiver no V |
|---|---:|---:|---:|
| R$ 15.000 | R$ 180.000 | R$ 900,00 — 6% | R$ 2.325,00 — 15,5% |
| R$ 20.000 | R$ 240.000 | R$ 1.460,00 — 7,30% | R$ 3.225,00 — 16,125% |
| R$ 25.000 | R$ 300.000 | R$ 2.020,00 — 8,08% | R$ 4.125,00 — 16,50% |

Esses cenários pressupõem receita estável por doze meses. Ultrapassar R$ 15 mil
em um mês não produz sozinho uma troca imediata para uma alíquota fixa maior.
A alíquota efetiva usa (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12.

Para atividades sujeitas ao fator R, a relação entre folha e encargos elegíveis
pagos e a receita dos doze meses anteriores deve alcançar 28% para aplicação
do III. Pró-labore e CPP elegível podem participar; distribuir lucros ou pagar
IA não substitui folha. Manter R$ 4.200 enquanto a receita cresce pode
comprometer o enquadramento. A CPP incluída no DAS e o histórico efetivo
precisam ser considerados antes de escolher o pró-labore.

Manter a prática de pró-labore em 30% produziria R$ 6.000 ou R$ 7.500. É uma
hipótese, não valor obrigatório ou opção tributária ótima. Motion/pós-produção
pode ter tratamento diferente do software; não presumir que perder o fator R
desloca automaticamente todas as receitas ao V.

| Pró-labore bruto | INSS retido | IRRF estimado | Pró-labore líquido |
|---|---:|---:|---:|
| R$ 4.200 | R$ 462,00 | R$ 0,00 | R$ 3.738,00 |
| R$ 6.000 | R$ 660,00 | R$ 380,02 | R$ 4.959,98 |
| R$ 7.500 | R$ 825,00 | R$ 926,90 | R$ 5.748,10 |

Retenções simuladas com regras de 2026, sem dependentes, outras deduções ou
fontes de renda tributável. Considerou-se retenção usual de INSS do sócio
de 11%, observando o teto previdenciário de R$ 8.475,55. Para IRRF, comparar
deduções legais com desconto simplificado mensal de R$ 607,20 e aplicar a
redução vigente. A declaração anual pode alterar o resultado.

**Não contar INSS e IRRF duas vezes:** são retidos dentro do pró-labore bruto.
No resultado da PJ, deduzir o bruto; no recebimento do sócio, calcular o líquido.
Nos III/V, CPP e ISS normalmente já integram o DAS. Não acrescentar
automaticamente outro INSS patronal de 20% ou outro ISS à mesma receita.

Com os custos gerenciais desta revisão, os cenários de toda a receita no III
ficam assim, antes de custos ainda não informados:

| Item mensal | Receita de R$ 20 mil | Receita de R$ 25 mil |
|---|---:|---:|
| Receita | R$ 20.000 | R$ 25.000 |
| DAS | R$ 1.460 | R$ 2.020 |
| Estrutura estimada, incluindo desgaste do computador | R$ 3.275 | R$ 3.275 |
| Pró-labore bruto de 30% | R$ 6.000 | R$ 7.500 |
| **Resultado gerencial parcial após pró-labore** | **R$ 9.265** | **R$ 12.205** |

Somando DAS, INSS e IRRF, a carga aproximada sobre o faturamento é 12,50% e
15,09%, respectivamente. O resultado parcial não é lucro distribuível.
Distribuições exigem escrituração; saldo bancário não é prova de lucro.
As regras de 2026 também podem gerar retenção de 10% sobre o total quando a
mesma PJ distribuir à mesma PF mais de R$ 50 mil em um mês. Tributação mínima
de altas rendas considera renda pessoal e seus critérios, não o faturamento
da empresa isoladamente.

Para 2027, avaliar com o contador a escolha de IBS/CBS no prazo divulgado até
30/09/2026. Já optantes normalmente não precisam renovar a adesão ao Simples.
Sem opção específica pelo regime regular, esses tributos permanecem no
recolhimento do Simples no primeiro semestre. Esta análise não calcula a
alternativa fora do DAS, nem substitui a atualização das tabelas para 2027.

## Formação do preço do Arizona e significado da margem

### Premissas escolhidas para precificar

| Premissa | Valor | Natureza |
|---|---:|---|
| Rateio da IA para o Arizona | 25% da fatura de R$ 1.100 | Hipótese de uso: R$ 275/mês |
| Rateio dos outros custos compartilhados | 10% de R$ 1.975 | Hipótese: R$ 197,50/mês |
| Supabase | R$ 200/mês | Estimativa direta do produto |
| **Custos fixos atribuídos ao Arizona** | **R$ 672,50/mês** | Infraestrutura e estrutura compartilhada |
| Manutenção coberta estimada | Duas horas mensais | Estimativa interna de trabalho, não franquia vendida |
| Valor econômico do tempo extra | R$ 100/h | Meta de remuneração/oportunidade, não despesa obrigatória |
| Trabalho coberto valorizado | R$ 200/mês | Duas horas multiplicadas pela referência de R$ 100/h |
| **Custo econômico mensal da licença** | **R$ 872,50/mês** | Fixos e trabalho coberto |
| Custo incremental por hora de serviço | R$ 10/h | Provisão para recursos específicos de teste e operação |
| **Custo econômico da hora de serviço** | **R$ 110/h** | Tempo extra valorizado e custo incremental |
| Tributos para precificação recorrente | 10% da receita | Reserva de planejamento, não alíquota confirmada |
| Reserva gerencial de risco | 5% da receita | Contingência, não imposto ou despesa contábil automática |

Os custos fixos rateados cobrem o conjunto atual de licença e serviços. Não
repetir a mesma parcela da IA, energia ou computador em cada hora. Os R$ 10/h
são hipótese de consumo adicional específico; substituir pelo custo
observado, inclusive por zero se ele não existir. Ambiente adicional ou
serviço sem a estrutura-base ativa exige orçamento próprio.

**Os R$ 100/h não são um novo pró-labore obrigatório nem remuneração líquida na
PF.** São uma escolha gerencial para valorizar o tempo fora do trabalho
principal. Podem ser revistos pelo fornecedor. Não somar outra remuneração
integral de pró-labore ao mesmo tempo já valorizado na análise por produto.
O pró-labore contábil efetivo é apurado no conjunto do CNPJ.

### Sobra de uma hora a R$ 120 não é margem de R$ 102

| Etapa ilustrativa | Valor restante |
|---|---:|
| Preço cobrado | R$ 120,00 |
| Após 10% de tributos estimados, R$ 12 | R$ 108,00 |
| Após 5% de reserva, R$ 6 | **R$ 102,00** |
| Após R$ 10 de custos incrementais | **R$ 92,00** |
| Após valorizar a hora de trabalho em R$ 100 | **−R$ 8,00** |

R$ 102 é a sobra após apenas tributos estimados e reserva. R$ 92 é a quantia
restante para remunerar a hora e gerar lucro, antes da tributação pessoal
aplicável. O resultado de −R$ 8 indica que o preço não atinge a referência
escolhida de remuneração de R$ 100/h. **Não é prova de saída de caixa de R$ 8,
nem de um custo obrigatório imposto ao fornecedor.**

Cobrar R$ 120 pode melhorar o caixa com a estrutura principal sustentada por
outros trabalhos, mas não entrega a meta de remuneração e margem usada nesta
proposta. A revisão para R$ 200/h decorre também dessa meta, não apenas de
novas contas domésticas descobertas.

### Fórmulas e metas de margem

- Resultado gerencial = preço − tributos estimados − reserva de risco − custos
  atribuídos − valor econômico do trabalho.
- Margem gerencial = resultado gerencial ÷ preço.
- Preço para margem-alvo = custo econômico ÷ (1 − tributos − reserva − margem-alvo).
- Licença, meta de 25%: 872,50 ÷ (1 − 0,10 − 0,05 − 0,25) = R$ 1.454,17.
- Hora, meta de 30%: 110 ÷ (1 − 0,10 − 0,05 − 0,30) = R$ 200.

A margem é sobre o preço, não um acréscimo sobre custo. Metas propostas:
**25% a 30% na licença**, **30% no avulso** e **20% a 25% em pacotes**, em
troca de previsibilidade e menor esforço comercial. Não são margens de mercado
observadas nem lucro líquido pessoal. As margens recorrentes não demonstram
recuperação do investimento histórico de desenvolvimento.

| Modalidade | Receita | Custo econômico, incluindo trabalho | Tributos de 10% | Reserva de 5% | Resultado gerencial | Margem |
|---|---:|---:|---:|---:|---:|---:|
| Licença escolhida | R$ 1.490 | R$ 872,50 | R$ 149 | R$ 74,50 | **R$ 394** | **26,4%** |
| Licença a R$ 1.200, concessão | R$ 1.200 | R$ 872,50 | R$ 120 | R$ 60 | R$ 147,50 | 12,3% |
| Hora avulsa | R$ 200 | R$ 110 | R$ 20 | R$ 10 | **R$ 60** | **30,0%** |
| Pacote de quatro horas | R$ 720 | R$ 440 | R$ 72 | R$ 36 | R$ 172 | 23,9% |
| Pacote de oito horas | R$ 1.440 | R$ 880 | R$ 144 | R$ 72 | R$ 344 | 23,9% |
| Licença com três horas | R$ 2.000 | R$ 1.202,50 | R$ 200 | R$ 100 | **R$ 497,50** | **24,9%** |
| Licença com oito horas | R$ 2.930 | R$ 1.752,50 | R$ 293 | R$ 146,50 | **R$ 738** | **25,2%** |

No plano de R$ 2.000, a estimativa interna totaliza cinco horas: duas de
manutenção coberta e três vendidas. O custo inclui R$ 500 de trabalho
valorizado. Os R$ 497,50 são resultado adicional a essa remuneração econômica,
não o total atribuído ao fornecedor. No plano de R$ 2.930, são dez horas
estimadas, R$ 1.000 de trabalho valorizado e R$ 738 de resultado.

### Sensibilidade e propostas que ficaram para trás

| Manutenção coberta média da licença de R$ 1.490 | Margem com tributos de 10% | Margem com tributos de 16,5% |
|---|---:|---:|
| Duas horas/mês | 26,4% | 19,9% |
| Quatro horas/mês | 13,0% | 6,5% |
| Oito horas/mês | −13,8% | −20,3% |

O controle mais importante é o trabalho coberto que o produto realmente exige.
Essas horas não podem ser transformadas retroativamente em cobrança apenas
para recuperar margem. A medição orienta estabilização, escopo e condições
futuras.

Na hipótese antiga de licença de R$ 1.200 mais oito horas mensais por R$ 800,
o total de R$ 2.000 produziria resultado gerencial de **−R$ 52,50**, já
valorizando as duas horas cobertas. Oito horas **semanais** equivalem a
34,67 horas mensais na média anual; pelo mesmo adicional de R$ 800, o resultado
do conjunto seria aproximadamente **−R$ 2.985,83**. Esses resultados decorrem
do modelo econômico e da remuneração escolhida, não de uma afirmação de
prejuízo contábil ou caixa negativo nesses valores.

## Venda, fonte e propriedade intelectual

### Titularidade anterior e objeto contratual

A iniciativa própria durante o freela de motion não resolve, isoladamente, a
titularidade do Arizona. O art. 4 da Lei do Software exige examinar contrato,
natureza dos encargos e relação do desenvolvimento com a prestação de serviços
e seus recursos. Antes de formalizar licença ou venda, revisar o contrato
anterior e registrar bilateralmente a titularidade e as permissões pertinentes.
O art. 5 também demanda definição das derivações autorizadas.

Todas as modalidades pressupõem que o fornecedor tenha os direitos necessários
para concedê-las. Receber o repositório não significa, por si, adquirir os
direitos patrimoniais do produto.

| Modalidade | Abertura | Alvo de fechamento | Limite interno condicional | Direito principal |
|---|---:|---:|---:|---|
| Perpétua com fonte, sem cessão | R$ 49.000 | **R$ 45.000** | R$ 42.000 | Operar, compilar, manter e modificar para uso interno |
| Cessão parcial com núcleo reservado | R$ 69.000 | **R$ 60.000** | R$ 55.000 | Direitos sobre componentes identificados, com reserva do núcleo |
| Cessão total do escopo negociado | R$ 110.000 | **R$ 90.000** | R$ 80.000 | Direitos patrimoniais do código incluído no objeto cedido |

São âncoras propostas de negociação, não avaliação independente de mercado.
Os limites internos não são ofertas, mínimos garantidos ou autorização para
desconto. Dependem do escopo de transição, pagamento, tributos, investimento
ainda não recuperado e direitos efetivamente transferidos.

Esta tabela substitui as antigas âncoras de venda. O recálculo abrange a
aquisição com fonte; a modalidade perpétua sem fonte fica **sob consulta**,
sem reutilizar automaticamente o preço anterior. A preferência comercial é
licença mensal ou fonte sem cessão, pois preservam a exploração do produto.

### Perpétua sem cessão de IP, com ou sem fonte

O comprador recebe direito de uso interno da versão identificada, para a
organização, usuários e máquinas contratados. O fornecedor preserva a
exploração comercial e pode atender outras varejistas e reutilizar módulos
próprios, sem reproduzir dados, marcas, layouts protegidos, templates, mídias,
segredos ou materiais exclusivos do cliente.

Com fonte, definir o direito de compilar, hospedar, manter e modificar
internamente, inclusive com terceiros contratados sob sigilo. Não autorizar
revenda, sublicenciamento, publicação do fonte ou oferta como serviço a
terceiros. Tratar a titularidade das modificações e as hipóteses de sucessão
ou transferência da licença.

O pagamento extingue a mensalidade de licença do escopo adquirido conforme o
contrato, mas não torna hospedagem, suporte ou evolução gratuitos. A
infraestrutura fica em conta do comprador ou em serviço recorrente separado.
O produto hoje depende de autenticação e backend: a autonomia técnica de uma
entrega perpétua precisa ser preparada e validada, não apenas declarada.
Sem fonte, o plano de continuidade operacional precisa ser especialmente claro.

### Cessão parcial, reutilização e outras varejistas

Identificar componentes específicos cedidos e componentes genéricos reservados
em anexos. O comprador recebe licença dos elementos reservados na extensão
necessária para operar e manter a solução. Se puder distribuir o produto,
definir os direitos necessários de distribuição incorporada desses componentes,
sem transferir sua titularidade por omissão.

O fornecedor pode reutilizar e comercializar o núcleo reservado. Novas
soluções para outras varejistas devem respeitar componentes exclusivos cedidos
e confidencialidade. Não chamar essa operação de cessão integral de toda a
tecnologia se o núcleo permanecer reservado.

Inventariar o núcleo antes de precificar exclusividade. A mera descrição
"módulos genéricos" é insuficiente: identificar arquivos, componentes,
interfaces e documentação reservados, e distinguir os materiais do cliente
que já pertenciam a ele. O preço adicional deve corresponder a direitos novos
efetivamente concedidos, não à devolução de dados ou marcas do comprador.

#### Orçamento intermediário: termos propostos da cessão parcial

Referência interna: abertura de **R$ 69 mil**, alvo de **R$ 60 mil** e limite
condicional de **R$ 55 mil**, sujeito às condições financeiras já descritas.
O orçamento contempla entrega do fonte necessário à operação, cessão de
componentes identificados e licença de uso dos componentes reservados.

| Objeto | Regra proposta |
|---|---|
| Componentes exclusivos cedidos | Anexo A identifica precisamente código, documentação, versão e direitos cedidos. Podem incluir implementações específicas de regras ou integrações da Arizona, se existirem e forem de titularidade do fornecedor. A relação definitiva depende de inventário. |
| Núcleo reservado | Anexo B identifica os componentes que continuam do fornecedor. Candidatos incluem infraestrutura de autenticação, bibliotecas, mecanismos genéricos de automação, organização de dados e integrações reutilizáveis. Não há classificação automática de arquivos por esses exemplos. |
| Licença do núcleo ao comprador | Direito perpétuo da versão entregue, sem nova mensalidade de licença, para operar, compilar, hospedar, manter e adaptar internamente, inclusive por terceiros sob confidencialidade. O escopo-base mantém até dez pessoas cadastradas e uma máquina ativa por pessoa. |
| Direitos sobre a parte cedida | O comprador recebe os direitos patrimoniais expressamente descritos, incluindo modificação e exploração comercial dos componentes cedidos. Explorar esses componentes não autoriza redistribuir o núcleo reservado. |
| Revenda do produto completo | Não incluída neste orçamento-base. Distribuição ou SaaS do conjunto exigem licença comercial adicional do núcleo, com direitos, alcance e preço próprios. |
| Reutilização pelo fornecedor | Permitida para os componentes reservados, inclusive em soluções para outras varejistas. Não permite copiar componentes exclusivos cedidos, segredos, dados ou materiais protegidos do cliente. |
| Alterações posteriores | Definir expressamente a titularidade das derivações feitas por cada parte. O comprador preserva seus componentes cedidos e os direitos que contratar sobre novas criações; modificar o conjunto não lhe transfere automaticamente o núcleo preexistente. Serviços futuros devem repetir ou alterar essa divisão por escrito. |
| Exclusividade | Limitada ao objeto efetivamente cedido. Não inclui exclusividade de todo o varejo nem proibição geral de o fornecedor desenvolver soluções independentes para outras empresas. |
| Infraestrutura e continuidade | Migração para infraestrutura do comprador ou serviço de hospedagem separado, com homologação da autonomia operacional. Correções cobertas e validade técnica constam do contrato; novos recursos e SLA têm negociação própria. |
| Pagamento | No alvo de R$ 60 mil: R$ 24 mil na assinatura, R$ 18 mil na homologação e R$ 18 mil antes da entrega definitiva e eficácia da cessão. |

Os anexos devem permitir que um terceiro saiba o que pode manter, alterar,
redistribuir e reutilizar sem depender de uma interpretação informal. Não
ceder apenas um nome abstrato, uma funcionalidade genérica ou materiais que
já pertencem ao comprador. Se o inventário mostrar que a particularização é
apenas configuração, dados e templates do cliente, sem componentes próprios
relevantes a ceder, a licença com fonte pode ser a proposta mais adequada.
Nesse caso, não justificar o adicional de R$ 15 mil por uma exclusividade vazia.

Essa estrutura permite ao comprador controlar suas implementações exclusivas
e escolher quem mantém a solução, enquanto o fornecedor conserva uma base
tecnológica para outros negócios. É uma proposta comercial para delimitação
contratual, não uma cessão já realizada nem minuta jurídica final.

### Cessão total e exclusividade

O comprador recebe os direitos patrimoniais expressamente cedidos, que podem
abranger modificação, distribuição, licenciamento, sublicenciamento e revenda.
O fornecedor deixa de reutilizar ou explorar o código cedido, salvo reserva
ou licença de retorno expressa. Conhecimento geral e experiência não
autorizam reproduzir os elementos exclusivos transferidos.

Se o comprador exigir a titularidade do núcleo e o fornecedor precisar
continuar usando esse código, negociar **cessão com licença de retorno**:
uso, adaptação, incorporação em outros produtos, distribuição e sublicença
devem estar expressamente contemplados, conforme o modelo pretendido. Essa
reserva reduz a exclusividade econômica e exige proposta própria. Os R$ 90 mil
abaixo pressupõem cessão do escopo incluído sem essa licença de retorno.

Identificar separadamente marca, domínio, contas, documentação e outros
ativos que entrem na operação. Render distribuído, direitos de terceiros,
credenciais pessoais e dados de outros clientes ficam fora. Dependências de
terceiros continuam regidas por suas próprias licenças.

Não concorrência ou exclusividade de mercado são objetos adicionais: definir
segmento, clientes, território, prazo e compensação. Não incluir automaticamente
proibição de atender todo o varejo por tempo indeterminado. Reavaliar o preço
se a exigência impedir outros negócios, mesmo com boa margem imediata.

Atender outras varejistas com desenvolvimento independente não fica proibido
automaticamente pela cessão de código. Respeitar o objeto cedido, o sigilo e
eventual restrição contratual válida. O art. 6, III, da Lei do Software trata
da semelhança decorrente de características funcionais, normas ou limitação
de formas alternativas de expressão; não confundir isso com autorização para
copiar implementação exclusiva.

### Valoração, tributos e margem das vendas

O cálculo pontual usa os custos da empresa uma única vez. A estrutura
compartilhada já estimada é **R$ 3.075/mês**, incluindo IA, internet, energia,
contabilidade, depreciação e provisões. O Supabase dedicado fica fora desse
total e aparece separadamente apenas durante a transição.

Para ratear a estrutura, adota-se **160 horas mensais de atividade da empresa**
como convenção de cálculo, sujeita a revisão. Esse denominador não é uma
medição da agenda nem disponibilidade vendável do Arizona. É distinto das
**160 horas totais de criação estimadas pelo fornecedor**; os números
coincidem, mas têm unidades e funções diferentes. Usar os custos atuais é uma
referência de reposição, não reconstituição de desembolsos históricos.

```text
Custo econômico de uma hora = R$ 100 + R$ 3.075 / 160 = R$ 119,21875
Criação estimada = 160 horas × R$ 119,21875 = R$ 19.075
Custo da venda = criação + transição × custo/h + Supabase + assessoria incremental
Resultado = preço × (1 − reserva tributária − reserva de risco) − custo da venda
Margem = resultado / preço
```

Os R$ 100/h representam remuneração econômica pelo trabalho, inclusive o
passado. Não usar a tarifa de venda de R$ 200/h como custo e acrescentar nova
margem sobre ela. **Não acrescentar novamente** o rateio mensal de R$ 672,50,
os R$ 10/h do modelo de serviços, a compra integral do computador, a fatura
integral da IA ou outro pró-labore pelas mesmas horas. Cada modalidade abaixo
é uma alternativa: seus custos não se somam entre si.

| Componente | Fonte sem cessão | Cessão parcial | Cessão total |
|---|---:|---:|---:|
| Criação: 160 h com trabalho e estrutura | R$ 19.075,00 | R$ 19.075,00 | R$ 19.075,00 |
| Transição estimada | 40 h | 60 h | 80 h |
| Custo da transição com estrutura | R$ 4.768,75 | R$ 7.153,13 | R$ 9.537,50 |
| Supabase: hipótese de três meses a R$ 200 | R$ 600,00 | R$ 600,00 | R$ 600,00 |
| Assessoria jurídica/contábil incremental estimada | R$ 2.500,00 | R$ 3.500,00 | R$ 5.000,00 |
| **Custo econômico total** | **R$ 26.943,75** | **R$ 30.328,13** | **R$ 34.212,50** |

As horas de transição e a assessoria são hipóteses de orçamento, não propostas
de terceiros nem escopo técnico já estimado. A transição deve contemplar
documentação, preparação da entrega, testes, transferência de conhecimento e
provisão das correções cobertas acordadas. As horas estimadas não encerram
automaticamente essas obrigações. A assessoria é adicional à contabilidade
mensal que já está no rateio. Estender o cronograma ou as obrigações exige
recalcular a provisão correspondente antes de contratar.

A hipótese central busca recuperar **todo o custo econômico das 160 horas
nesta operação**. Receber pelo freela de motion não prova, por si, que a
criação do software foi remunerada ou cedida. Se houver recuperação anterior
identificável, abater esse valor uma vez da parcela a recuperar. Em novas
vendas, não apresentar novamente investimento já recuperado como custo ainda
pendente. O fornecedor pode continuar cobrando pelo valor de uso e dos
direitos. Horas próprias valorizadas não se tornam automaticamente custo
fiscal dedutível de um ativo.

Para a negociação, usar duas **hipóteses de reserva tributária**: 15% no
cenário central e 30% no estresse, ambas com mais 5% de reserva gerencial de
risco. Não são alíquotas apuradas, previsão garantida ou teto de tributos.
O cenário de 30% permanece visível para que reduzir a reserva não esconda a
fragilidade de um desconto. A reserva de 10% do modelo recorrente não foi
alterada e não deve ser reaplicada por cima destas reservas de venda.

| Modalidade no preço-alvo | Preço | Resultado com 15% + 5% | Margem | Resultado com 30% + 5% | Margem no estresse |
|---|---:|---:|---:|---:|---:|
| Fonte sem cessão | **R$ 45.000** | R$ 9.056,25 | **20,1%** | R$ 2.306,25 | **5,1%** |
| Cessão parcial | **R$ 60.000** | R$ 17.671,87 | **29,5%** | R$ 8.671,87 | **14,5%** |
| Cessão total | **R$ 90.000** | R$ 37.787,50 | **42,0%** | R$ 24.287,50 | **27,0%** |

Esses resultados já recuperam o trabalho passado e remuneram as horas de
transição pela referência escolhida. São **margens econômicas estimadas da
operação**, antes de valorar oportunidades futuras abandonadas, e não lucro
contábil comprovado ou dinheiro líquido disponível na pessoa física. Nas
cessões, o saldo também remunera os direitos entregues. O prêmio de IP está
contido no preço e no resultado, sem outra linha de cobrança pelo mesmo direito.

Metas comerciais aproximadas no cenário central: **20% sem cessão, 30% na
parcial e 40% na total**, após a recuperação integral modelada. Para conferir
o preço por custo e meta, usar `custo / (1 − tributos − risco − margem)`.
Essa conta informa sustentabilidade; o preço de IP também depende do alcance
dos direitos e das alternativas de exploração, não apenas de um percentual
sobre horas. Os limites de negociação aceitam margens menores e são
condicionais, não metas equivalentes.

Na fonte a R$ 42.000, o estresse deixa só **R$ 356,25**, ou **0,8%**. Não
oferecer esse limite antes de esclarecer tributação e escopo. Se a reserva
tributária de 30% for necessária, preservar margem de 20% exige cerca de
**R$ 59.875** nessa modalidade. Melhor manter a assinatura se o comprador
não puder pagar por uma transferência economicamente viável.

| Sensibilidade das horas históricas: fonte a R$ 45 mil | Custo total | Margem central | Margem no estresse |
|---|---:|---:|---:|
| 120 h | R$ 22.175,00 | 30,7% | 15,7% |
| 160 h | R$ 26.943,75 | 20,1% | 5,1% |
| 200 h | R$ 31.712,50 | 9,5% | −5,5% |

A diferença de quarenta horas altera o custo em **R$ 4.768,75**. A estimativa
de 160 horas é suficiente para trabalhar uma proposta preliminar, mas não
justifica precisão financeira além das hipóteses utilizadas.

Se a venda integrar receita operacional, pode elevar RBT12 e alterar fator R
nos meses seguintes, afetando outras receitas do CNPJ. Parcelar recebimentos
não garante diluir esse efeito. Aumentar pró-labore não corrige retroativamente
o histórico. A classificação de cessão efetiva de intangível pode diferir da
receita de licença. Não somar automaticamente ganho de capital e DAS sobre
a mesma parcela, nem denominar a operação venda de ativo para escolher
tributação sem fundamento. O contador deve simular a operação e os meses
seguintes antes de fechar o preço. A retirada na pessoa física tem análise
própria; não descontar tributos pessoais duas vezes da remuneração modelada.

Como comparação alternativa, a contribuição mensal da licença antes dos
fixos compartilhados é 1.490 × 85% − 200 de Supabase − 200 de trabalho =
**R$ 866,50**. A venda com fonte a R$ 45 mil deixa R$ 28.131,25 após reservas
centrais e custos da entrega, **antes** de recuperar a criação histórica:
equivale a aproximadamente **32,5 meses** dessa contribuição. Manter os fixos
que continuarão existindo após a venda. É uma conferência entre alternativas,
sem somar mensalidades futuras ao custo já calculado e sem afirmar que o
cliente permaneceria contratado por esse prazo.

Na cessão total a R$ 90 mil, o adicional líquido sobre a fonte a R$ 45 mil é
**R$ 28.731,25** no cenário central, descontados reservas e custos adicionais
de transferência. Esse é o prêmio econômico disponível para justificar abrir
mão dos direitos incluídos, além da base comparável da venda sem cessão.
Três outros clientes com R$ 400 mensais de contribuição por 36 meses gerariam
R$ 43.200 potenciais; é apenas um exemplo sem probabilidade, desconto ou
receita contratada. Não tratar esse valor como custo certo ou acrescê-lo
automaticamente ao preço. Se oportunidades plausíveis superarem o prêmio,
preservar o núcleo, negociar licença de retorno ou elevar o preço da cessão.

### Negociação e apresentação da aquisição

Apresentar primeiro a solução para a necessidade real do cliente: continuidade
e autonomia podem ser atendidas com fonte e licença interna, sem transferir
toda a exploração comercial. A mensalidade continua uma alternativa para
quem prefere menor desembolso inicial. Não usar o preço da Adobe como régua
de esforço de desenvolvimento nem presumir economia garantida de um freela.

Abrir em R$ 49 mil pela fonte, com documentação e transição delimitadas, e
buscar R$ 45 mil mediante contrapartidas concretas: pagamento por marcos,
escopo fechado e agenda regular. Apresentar cessão parcial ou total quando
houver interesse real pelos respectivos direitos. Os valores de R$ 69 mil
e R$ 110 mil são aberturas negociáveis, não descontos promocionais fictícios
nem avaliação de mercado comprovada. Limites internos não entram na proposta.

Dar desconto em troca de condições identificáveis. Não incluir horas futuras,
plantão, novas features, exclusividade ampla ou financiamento longo gratuito
para salvar o fechamento. Se o orçamento estiver abaixo do custo e da margem
aceitáveis, preservar a licença mensal ou reduzir o objeto antes de conceder
mais direitos. Trabalho feito em tempo ocioso também consumiu capacidade e
não torna todo recebimento posterior lucro.

Argumento externo, sem memória de custos:

> A aquisição com código-fonte permite que a Arizona Crossmedia mantenha e
> evolua a versão contratada com sua equipe ou com fornecedores de sua escolha.
> A entrega contempla documentação e uma transição com critérios de aceite,
> para dar continuidade à operação. Os direitos de uso, as responsabilidades
> pela infraestrutura e os serviços posteriores ficam definidos desde o início.
> Caso a empresa queira também explorar comercialmente a tecnologia, podemos
> estruturar uma cessão dos direitos correspondentes.

### Entrega, continuidade e pagamento

Antes de fechar a transferência, definir:

- versão, tag ou commit, módulos, dependências, exclusões e pendências
  conhecidas, com exclusão efetiva do render distribuído no pacote negociado;
- arquitetura, integrações, preparação de ambientes, build, instalação,
  deploy, rollback, banco, migrations e operação do backend;
- integração local com After Effects e CEP, licenciamento, diagnóstico,
  backup, recuperação e limitações da versão entregue;
- inventário de dependências e licenças, documentação, sessões de transferência
  e horas de esclarecimento incluídas;
- infraestrutura sob responsabilidade do comprador ou operação recorrente
  separada, sem prometer independência antes de preparar a entrega;
- demonstração do produto sob infraestrutura e identidade do comprador,
  incluindo builds, autenticação, emissão e validação de recibos de licença,
  ou aceite explícito de hospedagem continuada contratada separadamente;
- critérios objetivos de homologação, prazo de análise, procedimento para
  não conformidades e distinção entre defeito e alteração de escopo;
- validade técnica, correções cobertas, garantia de transição e serviços
  posteriores, respeitando as obrigações aplicáveis à comercialização;
- calendário compatível com a capacidade real. Quarenta horas de transferência
  não são uma promessa de entrega em poucos dias de extras.

Pagamento de referência: **40% na assinatura**, **30% na homologação** e
**30% antes da entrega definitiva e da eficácia dos direitos contratados**.
O instrumento deve sincronizar acesso de auditoria, uso de homologação,
entregas, aceite e quitação. Prazo financeiro posterior à transferência exige
reavaliação de preço, condições de pagamento e garantias.

No alvo de R$ 45 mil, os marcos equivalem a R$ 18 mil, R$ 13,5 mil e
R$ 13,5 mil. Não prometer parcelamento longo sem avaliar financiamento,
inadimplência e efeito tributário. Definir quando termina a mensalidade de
licença. Se houver assinatura paga durante a transição, reconciliar o que
ela já remunera: não cobrar novamente a mesma infraestrutura nem atribuir
as mesmas despesas ou horas à margem das duas operações. Os R$ 600 de
Supabase desta simulação pressupõem ausência dessa recuperação concomitante.

A proposta preliminar não autoriza acesso irrestrito ao repositório. Auditoria
técnica pode ser remunerada, com escopo e confidencialidade. Contas pessoais,
chaves privadas e certificados não são transferidos automaticamente.
O comprador deve assumir sua identidade operacional e credenciais corporativas
pertinentes, sem acesso a outros projetos do fornecedor.

## Revisão periódica e comunicação com o cliente

Ao final do acompanhamento inicial, revisar horas de defeitos cobertos, horas
vendidas, consumo de infraestrutura e IA, rateios, despesas pendentes,
enquadramento tributário, remuneração desejada pelo tempo extra e ocupação da
agenda. Recalcular margem antes de conceder desconto ou ampliar escopo.

Manter cifras e memória de cálculo neste documento interno. O
[pitch comercial](./PITCH_COMERCIAL_ARIZONA.md) justifica a contratação pelo
fluxo de trabalho, autonomia da equipe, padronização e clareza de escopo.
Ele complementa uma proposta formal com preço e condições, sem expor custos
ou margens. Não promete economia garantida, ausência de erros, substituição
integral de profissionais, evolução gratuita ou atendimento imediato.

## Fontes e limites da análise

- Dados de negócio e custos: informações do fornecedor na conversa de
  05/09/2026; estimativas estão identificadas nas tabelas.
- [LC 123/2006](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm):
  Simples, alíquotas efetivas, anexos e distribuição de lucros.
- [Perguntas e respostas do Simples Nacional](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/PerguntaoSN.pdf):
  receita, segregação, fator R, CPP e custos que não reduzem a base do DAS.
- [Cosit 271/2024](https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=75847):
  licenciamento de software próprio e fator R.
- [Tabela de IR de 2026](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026)
  e [tabela previdenciária](https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal):
  referência das retenções simuladas e do teto previdenciário.
- [Lei 15.270/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm):
  redução do IR e regras adicionais de rendas e distribuições.
- [Comunicado da Receita sobre a escolha para 2027](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/setembro/receita-federal-alerta-comeca-hoje-o-prazo-para-opcao-pelo-simples-nacional-e-para-a-escolha-do-modelo-de-recolhimento-do-ibs-e-da-cbs-em-2027):
  prazo e alternativas de recolhimento de IBS/CBS.
- [Lei 9.609/1998](https://www.planalto.gov.br/ccivil_03/leis/l9609.htm):
  titularidade, derivações, licença e validade técnica do software.
- [Lei 9.610/1998](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm):
  objeto e formalização da cessão de direitos patrimoniais.
- [Cosit 211/2024](https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=75104):
  tratamento de domínio de website como intangível. É analogia condicionada,
  não enquadramento automático da venda do Arizona.

As metas de remuneração, margens, reservas, rateios, prazos de reposição e
preços de venda são escolhas e hipóteses gerenciais. Não provam preço de
mercado, aceitação do cliente, titularidade, economia obtida ou apuração fiscal.
O contador deve confirmar receitas, folha e encargos, CNAEs, município,
contratações internacionais e tratamento da operação antes da formalização.
