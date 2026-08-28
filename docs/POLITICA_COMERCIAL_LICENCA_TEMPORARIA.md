# Política comercial de licenciamento e assinatura

**Status:** referência comercial vigente para elaboração de propostas

**Última revisão:** 2026-08-28

**Escopo:** licenciamento temporário e assinatura contínua do Arizona App,
extensão CEP e recursos associados

**Fonte da verdade técnica:** `README.md`, `ADMIN/README.md` e
`docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`

Este documento registra a política comercial pretendida. Ele não altera o
contrato técnico de autenticação, o comportamento do software ou os contratos
entre os três projetos. A proposta aceita pelas partes continua sendo a fonte
da verdade para preço, período, quantidade de dispositivos e condições de
atendimento de cada contratação.

## Modalidades de contratação

O produto pode ser contratado de duas formas, sempre definidas expressamente na
proposta:

- **licença temporária**, normalmente ativada em períodos de pico e paga
  antecipadamente; ou
- **assinatura contínua**, com acesso recorrente e pagamento mensal.

As modalidades são alternativas e não se acumulam. A licença temporária não é
uma assinatura mensal contínua e não gera obrigação de disponibilidade,
manutenção ou atendimento nos períodos sem licença paga.

### Regras da licença temporária

- Cada período é contratado e pago antecipadamente.
- Os dias são consecutivos; a licença não pode ser pausada, fracionada ou
  transferida para outro período depois da ativação.
- Não há rateio linear nem cobrança proporcional por horas usadas.
- O período começa e termina no ciclo operacional combinado na proposta. Como
  padrão, deve acompanhar a renovação diária da licença configurada no sistema,
  atualmente `04:00` em `America/Sao_Paulo`.
- Ativação no meio de um ciclo não desloca automaticamente o encerramento. Uma
  janela diferente precisa ser combinada antes da liberação.
- O preço concede somente o direito temporário de uso. Código-fonte,
  propriedade intelectual e direito de distribuição permanecem com o
  fornecedor.

## Tabela de referência

| Modalidade |    Janela consecutiva | Preço antecipado | Equivalente mensal aproximado | Desconto sobre R$ 2.000/mês |
|------------|----------------------:|-----------------:|------------------------------:|----------------------------:|
| Diária     |     1 dia operacional |           R$ 350 |                             — |                           — |
| Semanal    |   7 dias operacionais |         R$ 1.000 |                             — |                           — |
| Mensal     |  30 dias operacionais |         R$ 2.000 |                      R$ 2.000 |                           — |
| Trimestral |  90 dias operacionais |         R$ 5.000 |                      R$ 1.667 |                       16,7% |
| Semestral  | 180 dias operacionais |         R$ 9.000 |                      R$ 1.500 |                         25% |
| Anual      | 365 dias operacionais |        R$ 16.000 |                      R$ 1.333 |                       33,3% |

Esses valores são uma referência inicial para o escopo e a quantidade de
dispositivos definidos na proposta. Mais usuários, mais dispositivos, uso
extraordinário de infraestrutura, exclusividade, plantão ou compromisso de
nível de serviço podem alterar o preço.

A diária curta custa proporcionalmente mais porque concentra o valor no
momento de maior demanda e ainda exige ativação, conferência e administração da
licença. Períodos maiores reduzem o custo mensal em troca de pagamento integral
antecipado e compromisso contínuo.

### Condições dos descontos por prazo

- Os valores trimestral, semestral e anual exigem pagamento integral antes da
  ativação.
- Os períodos são consecutivos e não podem ser pausados, congelados ou
  redistribuídos.
- A falta de uso em parte do período não gera crédito, prorrogação ou reembolso
  proporcional.
- Três meses escolhidos separadamente ao longo do ano não equivalem a uma
  contratação trimestral consecutiva e devem receber proposta própria.
- O desconto remunera a antecipação e a previsibilidade da contratação. Ele não
  acrescenta suporte, manutenção contínua, SLA ou novas funcionalidades.
- Renovações futuras podem receber nova proposta; a primeira condição
  comercial não congela o preço indefinidamente.

## Assinatura contínua — crivo de negociação

A assinatura contínua é a opção preferencial quando fornecedor e cliente
buscam previsibilidade. Os valores abaixo são referências mínimas para o escopo
e a quantidade de dispositivos definidos na proposta.

| Plano                   | Compromisso | Pagamento         | Valor de referência |
|-------------------------|-------------|-------------------|--------------------:|
| Sem SLA                 | 12 meses    | Mensal antecipado |          R$ 790/mês |
| Com SLA                 | 12 meses    | Mensal antecipado |          R$ 990/mês |
| Com SLA, sem fidelidade | Mensal      | Mensal antecipado |        R$ 1.190/mês |

O compromisso anual permite pagamento mensal, mas mantém a contratação pelos
12 meses. Eventual cancelamento antecipado, inadimplência e aviso de renovação
devem ser tratados na proposta ou no contrato. A modalidade sem fidelidade pode
ser encerrada com aviso prévio de 30 dias.

Os planos incluem:

- licença de uso contínuo para o escopo contratado;
- infraestrutura atual do produto dentro do uso normal;
- recebimento e correção, sem cobrança de desenvolvimento, de defeitos
  reproduzíveis atribuíveis à versão suportada do produto; e
- atualizações corretivas disponibilizadas durante a vigência.

No plano **sem SLA**, a correção entra na agenda normal, sem prazo garantido de
resposta ou entrega. No plano **com SLA**, o atendimento ocorre em horário
comercial, com o seguinte compromisso mínimo:

- incidente crítico, com o uso principal bloqueado: primeira resposta em até
  4 horas úteis e meta de contorno em até 1 dia útil;
- falha importante, mas com uso parcial possível: primeira resposta em até
  1 dia útil e meta de correção em até 5 dias úteis; e
- falha normal ou visual: primeira resposta em até 2 dias úteis e correção
  programada na agenda de atualização.

O SLA garante prioridade de resposta, triagem e acompanhamento. As metas de
contorno e correção não são garantia absoluta de solução quando houver
dependência de diagnóstico, acesso do cliente ou serviço de terceiro. Plantão,
atendimento fora do horário comercial e disponibilidade 24 horas não estão
incluídos.

O valor inclui a infraestrutura-base atual, inclusive o plano de produção do
Supabase. Consumo extraordinário, mudança de faixa, ambiente adicional ou
aumento relevante de custos de terceiros pode ser cobrado separadamente, após
comunicação e aprovação do cliente.

Novas funcionalidades, mudanças de fluxo, customizações, integrações,
treinamento, manutenção evolutiva e adaptação a novas versões de terceiros são
orçados separadamente. Os valores são reajustados anualmente pelo IPCA; uma
mudança material de escopo pode exigir nova proposta.

## O que as modalidades não incluem

Salvo contratação expressa, o preço da modalidade não inclui:

- instalação, configuração ou treinamento;
- atendimento remoto ou presencial;
- investigação de falhas no ambiente do cliente;
- plantão, prazo de resposta ou SLA;
- acompanhamento de renderizações ou da operação;
- recuperação ou correção de projetos, mídias e templates do After Effects;
- novas funcionalidades, mudanças de fluxo ou customizações;
- adaptação a novas versões de softwares e serviços de terceiros;
- garantia de compatibilidade com versões futuras do Windows, After Effects,
  Google Drive, Supabase ou outros componentes externos.

## Limites das correções sem custo

Uma **correção do produto** é a alteração de um defeito reproduzível na versão
atual suportada, em ambiente compatível, quando o comportamento contradiz a
documentação ou impede um fluxo que a versão declara oferecer.

Na licença temporária e na assinatura sem SLA, uma correção confirmada pode ser
feita sem cobrança de desenvolvimento, mas:

- entra na agenda normal do fornecedor;
- não possui prazo de início, resposta ou entrega;
- não implica atendimento imediato durante o período de pico;
- não inclui investigação contínua do ambiente do cliente;
- pode depender de diagnóstico, evidências e reprodução antes de ser aceita
  como defeito do produto;
- não transforma a licença em contrato de manutenção contínua.

Sem SLA ou suporte contratado, o cliente deve enviar, quando solicitado, versão
do aplicativo, passos para reprodução e o pacote de diagnóstico local exportado
conscientemente pelo Arizona App. O recebimento do relato não cria SLA nem
obrigação de interrupção de outros trabalhos.

Não são consideradas correções gratuitas:

- erro de uso, configuração ou dados fornecidos pelo cliente;
- problema em projeto `.aep`, mídia, template, permissão ou caminho de arquivo;
- falha de máquina, rede, Google Drive, Windows, After Effects ou outro serviço
  externo;
- incompatibilidade surgida após atualização de componente de terceiro;
- comportamento de versão antiga ou que deixou de ser suportada;
- pedido de melhoria, mudança visual, conveniência ou novo fluxo;
- alteração para atender um ambiente que não fazia parte do escopo validado;
- otimização de desempenho sem defeito reproduzível no cenário suportado.

Se a investigação concluir que o problema não é um defeito do produto, o tempo
de diagnóstico pode ser tratado como suporte cobrado. Antes de iniciar trabalho
cobrável adicional, o fornecedor deve informar o enquadramento e obter a
aprovação do cliente.

Na licença temporária ou assinatura sem SLA, quando um defeito confirmado do
produto impedir o uso principal, a solução comercial preferencial é avaliar a
extensão dos dias comprovadamente perdidos depois que a correção estiver
disponível. Isso não cria atendimento urgente, reembolso automático ou
indenização. Na assinatura com SLA, aplicam-se os prazos de resposta e as metas
operacionais definidos na proposta.

## Suporte cobrado separadamente

| Modalidade                      | Referência comercial | Condição                                    |
|---------------------------------|---------------------:|---------------------------------------------|
| Agendado em horário comercial   |             R$ 250/h | Mínimo de 1 hora                            |
| Prioritário no mesmo dia útil   |             R$ 400/h | Mínimo de 2 horas e sujeito a aceite prévio |
| Noite, fim de semana ou plantão |             R$ 500/h | Mínimo de 2 horas e sujeito a aceite prévio |
| Pacote pré-pago de 5 horas      |             R$ 1.100 | Validade de 90 dias                         |

A primeira hora pode ser usada para triagem e diagnóstico. Depois dela, o
fornecedor deve apresentar uma estimativa antes de continuar. Frações e forma
de apontamento devem constar na proposta; na ausência de outra regra, aplica-se
uma hora mínima inicial e blocos adicionais de 30 minutos.

O pagamento de suporte remunera o tempo de atendimento e investigação. Ele não
garante que toda falha tenha solução, nem inclui desenvolvimento de nova
funcionalidade. Atendimento prioritário só existe depois do aceite explícito do
pedido e da confirmação de disponibilidade.

## Reativação após períodos sem uso

Antes de um novo pico, o fornecedor pode solicitar uma validação técnica da
versão e do ambiente. Se o produto permanecer na versão suportada e o ambiente
não tiver mudado, a contratação pode se limitar à nova liberação.

Trabalho necessário por mudanças ocorridas durante o período sem contratação —
incluindo atualizações do After Effects, Windows, Drive ou requisitos internos
do cliente — deve ser classificado como suporte, adaptação ou nova evolução e
orçado separadamente. O pagamento de uma nova janela de licença não quita
retroativamente manutenção que não foi contratada.

## Textos curtos para proposta

### Licença temporária

> Licença temporária de uso do Arizona App pelo período contratado e para a
> quantidade de dispositivos indicada na proposta. O valor não inclui suporte,
> instalação, treinamento, customizações, plantão ou SLA. Defeitos reproduzíveis
> atribuíveis à versão suportada poderão ser corrigidos sem custo de
> desenvolvimento, conforme a disponibilidade do fornecedor e sem prazo
> garantido. Diagnóstico de ambiente, atendimento prioritário, alterações
> decorrentes de terceiros e novas funcionalidades serão cobrados separadamente.

### Assinatura sem SLA

> Assinatura contínua do Arizona App, com compromisso de 12 meses e pagamento
> mensal antecipado de R$ 790. Inclui licença de uso, infraestrutura-base e
> correções de defeitos reproduzíveis da versão suportada, atendidas na agenda
> normal e sem prazo garantido. Suporte, novas funcionalidades, customizações e
> custos extraordinários de infraestrutura serão cobrados separadamente.

### Assinatura com SLA

> Assinatura contínua do Arizona App, com compromisso de 12 meses e pagamento
> mensal antecipado de R$ 990. Inclui licença de uso, infraestrutura-base e
> prioridade para correção de defeitos reproduzíveis da versão suportada em
> horário comercial, conforme o SLA da proposta. Novas funcionalidades,
> customizações, plantão e custos extraordinários de infraestrutura serão
> cobrados separadamente.
