# Política comercial de licenciamento, assinatura e código-fonte

**Status:** referência comercial vigente para elaboração de propostas

**Última revisão:** 2026-08-30

**Escopo:** licenciamento temporário, assinatura contínua, entrega de
código-fonte e eventual cessão patrimonial do Arizona App, extensão CEP e
recursos associados

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

## Entrega do código-fonte e propriedade intelectual

A entrega do código-fonte é uma negociação extraordinária e não está incluída
na licença temporária nem na assinatura contínua. Antes da proposta, as partes
devem escolher expressamente entre uma **licença perpétua para uso interno com
fonte** e a **cessão dos direitos patrimoniais do produto**. Receber uma cópia do
repositório, isoladamente, não significa adquirir a propriedade intelectual.

### Modalidade A — fonte com licença perpétua interna, sem cessão

Referência inicial: **R$ 55.000**, sujeita ao escopo da documentação, transição,
versão entregue, quantidade de ambientes e forma de pagamento.

O cliente recebe, para a organização identificada no contrato:

- uma cópia da versão contratada do código-fonte e de seu histórico acordado;
- direito perpétuo de executar, compilar, hospedar, manter e modificar o sistema
  para suas próprias operações internas;
- direito de permitir acesso a empregados e prestadores que atuem em seu nome,
  sob confidencialidade e sem aquisição de direitos próprios sobre o produto;
- documentação e transferência de conhecimento definidas na proposta; e
- encerramento da mensalidade de licença referente ao escopo adquirido, sem
  converter infraestrutura, suporte ou evolução em serviços gratuitos.

Permanecem com o fornecedor:

- autoria e titularidade dos direitos patrimoniais do software;
- direito de licenciar, vender e oferecer o produto a outros clientes;
- direito de criar versões, produtos derivados e integrações;
- direito de reutilizar bibliotecas, módulos, utilitários, algoritmos, padrões,
  abstrações, scripts e blocos de código em outros projetos; e
- conhecimento técnico, métodos e experiência acumulados durante o projeto.

O fornecedor não pode reutilizar dados, credenciais, marcas, layouts protegidos,
templates, mídias, segredos de negócio ou materiais exclusivos do cliente. O
contrato deve separar claramente esses elementos do código e do conhecimento
técnico reutilizáveis.

Salvo autorização adicional, a licença interna não permite ao cliente:

- vender, sublicenciar, publicar ou disponibilizar o código-fonte;
- oferecer o produto ou uma versão derivada a terceiros, inclusive como serviço;
- transferir a licença em uma operação isolada, fora de sucessão societária
  expressamente prevista; ou
- declarar-se titular da propriedade intelectual original.

Modificações feitas pelo próprio cliente podem ser usadas internamente dentro da
mesma licença. A titularidade e os direitos sobre funcionalidades futuras
desenvolvidas pelo fornecedor devem ser definidos em cada proposta; o pagamento
da consultoria, sozinho, não altera automaticamente o regime escolhido para o
produto-base.

### Modalidade B — cessão dos direitos patrimoniais do produto

Referência inicial: **R$ 120.000**, sujeita à extensão da exclusividade, aos
componentes incluídos, à documentação, à transição e às oportunidades econômicas
que o fornecedor deixa de explorar.

Depois do pagamento e da aceitação previstos no contrato, o cliente recebe os
direitos patrimoniais expressamente cedidos sobre a versão e os componentes
identificados. Isso pode incluir o direito de modificar, rebatizar, distribuir,
licenciar, sublicenciar ou revender o produto e de contratar qualquer terceiro
para sua manutenção.

A cessão deve conter um anexo de **tecnologia preexistente e componentes
reutilizáveis**. Permanecem com o fornecedor, quando expressamente reservados:

- bibliotecas, ferramentas e componentes criados antes da cessão;
- utilitários genéricos, padrões de arquitetura, métodos, algoritmos e know-how
  que não revelem dados nem regras confidenciais do cliente;
- componentes de terceiros, que continuam sujeitos às licenças de seus próprios
  titulares; e
- o direito de usar ideias, experiência e conhecimento geral, sem reproduzir o
  produto cedido nem seus elementos exclusivos.

Esses componentes reservados são licenciados ao comprador na medida necessária
ao funcionamento do produto, mas podem continuar sendo usados pelo fornecedor em
outros trabalhos. Se o comprador exigir exclusividade também sobre tecnologia
genérica, proibição ampla de reutilização, não concorrência ou cessão sem essas
reservas, o preço deve ser revisto para remunerar a oportunidade econômica
adicional perdida.

Depois de uma cessão total, o fornecedor não pode revender ou licenciar o produto
cedido nem criar uma cópia substancialmente equivalente a partir dos elementos
exclusivos transferidos. A possibilidade de o comprador revender o produto é uma
das diferenças econômicas centrais entre esta modalidade e a licença interna.

### Escopo mínimo da documentação e transição

Quando a proposta disser **documentação completa para transferência**, o pacote
deve indicar, no mínimo:

- arquitetura, limites dos projetos e contratos de integração;
- preparação dos ambientes de desenvolvimento e produção;
- build, testes, assinatura, empacotamento, instalação, deploy e rollback;
- banco de dados, migrations, Edge Functions e dependências externas;
- licenciamento, dispositivos, chaves públicas e procedimentos de rotação;
- integração CEP/After Effects, scripts embarcados e fila de render;
- operação, diagnóstico, backup, recuperação e limitações conhecidas;
- inventário de dependências e respectivas licenças;
- backlog e pendências que não façam parte dos critérios de aceitação; e
- sessões de transferência de conhecimento e período de esclarecimentos
  expressamente quantificados.

Contas pessoais, chaves privadas e certificados do fornecedor não são cedidos
automaticamente. A transição deve transferir contas corporativas aplicáveis e
rotacionar credenciais, certificados e segredos para que o comprador assuma sua
própria identidade operacional.

### Continuidade depois da entrega

Suporte, correções, disponibilidade, operação de infraestrutura e novas
funcionalidades após a aceitação dependem de contrato separado. A compra do
fonte ou a cessão não cria obrigação de atendimento gratuito ou disponibilidade
permanente do autor original.

Uma eventual garantia de transição deve ter prazo, ambientes e critérios de
aceitação definidos. Ela cobre somente divergências reproduzíveis entre o pacote
entregue e o comportamento formalmente aceito; não cobre evolução, mudança de
terceiros, dados do cliente ou defeitos introduzidos após alterações feitas pelo
comprador ou por outros prestadores.

### Proteções do processo de negociação

- A proposta preliminar não autoriza acesso ao repositório completo.
- Análise técnica detalhada pode ser uma etapa remunerada, abatível do preço se
  a operação for concluída.
- Acesso para auditoria deve ocorrer sob confidencialidade e com escopo limitado.
- Documentação adicional e transição começam somente após contrato e primeiro
  pagamento.
- Entrega definitiva e eficácia da cessão devem acompanhar os marcos de
  pagamento e aceite definidos no instrumento.
- A proposta deve ter validade curta e registrar que valores, condições e
  concessões não constituem precedente para outra modalidade.

### Pagamento, homologação e quitação

A forma preferencial de pagamento é por marcos da operação, e não por prazo
desvinculado das entregas. Como referência:

- **40% na assinatura:** reserva da operação, início da documentação adicional e
  preparação da transição;
- **30% na homologação:** documentação concluída, demonstração do ambiente e
  validação técnica conforme os critérios acordados; e
- **30% antes da entrega definitiva:** liberação do repositório, credenciais
  corporativas aplicáveis e eficácia da licença perpétua ou da cessão.

O contrato deve definir prazo e procedimento de homologação, critérios objetivos
de rejeição, correção de não conformidades e aceite expresso ou presumido depois
de uma janela sem objeção fundamentada. Pedidos de melhoria ou de alteração do
escopo não suspendem o aceite da versão originalmente contratada.

Pagamento integral antecipado pode receber desconto apenas quando isso constar
da proposta. Parcelamento que ultrapasse a transição caracteriza concessão de
prazo financeiro e pode exigir entrada maior, correção do preço, garantias e
vencimento antecipado do saldo em caso de inadimplência.

Até a quitação:

- eventual acesso ao fonte é limitado à auditoria ou homologação autorizada;
- o fornecedor pode suspender atividades e entregas em caso de atraso;
- a licença perpétua e a cessão patrimonial ainda não produzem efeito definitivo;
  e
- o cliente não pode explorar, publicar, transferir ou distribuir o código.

A entrega final deve ser acompanhada de termo de recebimento que identifique a
versão, tag ou hash entregue, os anexos, as pendências conhecidas e a data de
início da eventual garantia de transição. Multa, juros, correção monetária,
tributação, garantias e custos de registro devem ser definidos com assessoria
jurídica e contábil na proposta definitiva.

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

### Fonte com licença perpétua interna, sem cessão

> Entrega da versão contratada do código-fonte do Arizona App e concessão de
> licença perpétua, não exclusiva e intransferível para uso, manutenção e
> modificação internos pela organização contratante, pelo valor de referência
> de R$ 55.000. A propriedade intelectual permanece com o fornecedor, que pode
> reutilizar componentes e explorar o produto em outros projetos, sem utilizar
> dados, marcas ou materiais exclusivos do cliente. Revenda, sublicenciamento,
> publicação e oferta do sistema a terceiros não estão autorizados. Suporte,
> infraestrutura e desenvolvimento posterior dependem de contratação separada.

### Cessão dos direitos patrimoniais do produto

> Entrega do código-fonte, documentação de transferência e cessão dos direitos
> patrimoniais expressamente identificados sobre a versão contratada do Arizona
> App, pelo valor de referência de R$ 120.000. O comprador poderá modificar,
> distribuir, licenciar e revender o produto nos limites do contrato. Tecnologia
> preexistente, componentes genéricos reutilizáveis, know-how e dependências de
> terceiros permanecem reservados ou sujeitos às licenças indicadas no anexo
> técnico. Suporte, infraestrutura e desenvolvimento futuro dependem de contrato
> separado, e a eficácia da cessão acompanha os marcos de pagamento e aceite.
