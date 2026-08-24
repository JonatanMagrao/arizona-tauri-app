# Roadmap de privacidade, registros operacionais e diagnóstico

**Status:** diagnóstico local implementado; governança e feedback continuam em planejamento

**Atualizado em:** 11/08/2026
**Escopo:** Arizona App (Tauri), extensão CEP apenas quando relacionada à licença
e ao diagnóstico, Admin e Supabase de licenciamento

Este documento organiza o tratamento de dados técnicos em quatro frentes:

1. registros essenciais de acesso, licenciamento e segurança;
2. diagnóstico de erros;
3. telemetria de uso de funcionalidades;
4. sugestões, problemas e outros feedbacks enviados voluntariamente.

Ele não substitui revisão jurídica. A definição final de controlador, operador,
base legal, retenção e texto contratual deve ser validada entre as partes
responsáveis pelo produto e pela Arizona Global.

## Decisões deste roadmap

| Frente | Decisão | Identificação pessoal | Situação |
|---|---|---:|---|
| Acesso, licença e auditoria | Manter, minimizar e tornar transparente | Sim, quando necessária para atribuir a ação | Parte já existe |
| Diagnóstico de erros | Manter somente na máquina, com saneamento, rotação e exportação consciente | Não pretendida pelo desenho | Implementado no Tauri e no CEP |
| Uso de funcionalidades por pessoa | Não implementar; remover a infraestrutura remota sem cliente ativo | Não aplicável | Função e tabela removidas |
| Sugestões e feedbacks | Criar futuramente um canal explícito e separado | Sim, com transparência para permitir retorno | Ainda não implementado |

A terceira frente permanece deliberadamente fora do escopo. A função
`track-event` e a tabela `licensing.app_events`, que não tinham cliente ativo,
foram removidas. Não serão registrados cliques, frequência de uso de recursos
nem perfis individuais de comportamento até que exista uma nova decisão
expressa.

## 1. O que existe hoje

### 1.1 Dados operacionais enviados ao serviço

O licenciamento já trata dados necessários para autenticar pessoas, vincular
uma instalação e investigar mudanças de acesso:

- nome, e-mail corporativo, organização, perfil e estado da conta;
- identificador aleatório da instalação, nome informado pela máquina e versão
  do aplicativo;
- datas de ativação, última validação da licença e estado do dispositivo;
- sessões de licença, horários do cliente e do servidor e sinais de diferença
  relevante de relógio;
- contadores antifraude e de limitação, com identificadores armazenados como
  hashes quando aplicável;
- ações administrativas como inclusão ou remoção de membro, geração e consumo
  de código, ativação ou liberação de dispositivo e redefinição de limites.

Essas ações administrativas já são gravadas em `licensing.audit_log`. A tela
**Logs de atividade** do Admin consulta a view somente leitura
`licensing.activity_log`, que reúne esses registros e as recusas de acesso por
relógio suspeito mantidas em `licensing.clock_audits`. O acesso continua
restrito à conta master, e os horários crus da máquina não são enviados ao
navegador.

### 1.2 Dados mantidos localmente

O Tauri também mantém dados necessários ao funcionamento local, como
credenciais protegidas pelo sistema operacional, recibo de licença da extensão,
preferências, histórico e caminhos usados pelas funções do aplicativo. Esses
itens precisam constar no inventário de privacidade mesmo quando não são
enviados ao Supabase.

Tauri e CEP também mantêm diagnósticos técnicos em JSONL separados. A pasta é
configurável pelo usuário, os arquivos têm retenção automática de 14 dias e
avisos/erros podem conter uma trilha de até 12 ações técnicas anteriores. Não há
envio automático; o conteúdo só sai da máquina quando o usuário exporta um ZIP
e decide compartilhá-lo. O contrato completo está em
[Diagnósticos locais](./DIAGNOSTICOS_LOCAIS.md).

### 1.3 O que não existe como coleta remota do produto

- A função `track-event` e a tabela `licensing.app_events` foram removidas da
  arquitetura suportada. Tauri e CEP não enviam telemetria de funcionalidades.
- O relatório estruturado de erro e sua sequência curta de ações existem apenas
  localmente. Não há upload silencioso nem fila de envio remoto.
- Não existe hoje um canal próprio no Tauri para enviar sugestões, problemas ou
  outros feedbacks ao responsável pelo produto.
- Logs próprios da infraestrutura Supabase devem entrar no inventário de
  fornecedores, mas não devem ser confundidos com telemetria de produto criada
  pelo Arizona App.

## 2. O que precisamos ajustar

### Etapa 0 — governança e transparência

Esta etapa vem antes de qualquer nova coleta.

#### 2.1 Fechar o inventário de dados

Criar uma matriz única com:

- dado e exemplo;
- origem: Tauri, CEP, Admin, Edge Function, Auth ou infraestrutura;
- armazenamento local ou remoto;
- finalidade específica;
- pessoa ou função que pode acessar;
- retenção e forma de eliminação;
- fornecedor/suboperador e região de armazenamento;
- fundamento legal definido pelo controlador.

**Critério de aceite:** todo campo pessoal exibido no Admin ou persistido no
Supabase aparece na matriz; nenhuma categoria usa uma finalidade genérica como
“melhorar o produto”.

#### 2.2 Formalizar papéis e finalidades

O contrato e o aviso devem identificar quem decide as finalidades
(`controlador`) e quem trata dados seguindo instruções (`operador`). A hipótese
esperada é que a Arizona Global determine o uso para acesso e suporte e que o
fornecedor opere o sistema, mas isso deve ser confirmado formalmente.

O tratamento essencial deve ficar limitado a:

- autenticação e licenciamento;
- segurança e prevenção de abuso;
- suporte e investigação de falhas;
- comprovação de mudanças administrativas.

O contrato deve proibir o reaproveitamento dos registros para aferir jornada,
presença, produtividade, desempenho profissional ou aplicar medida disciplinar
sem outra finalidade documentada, análise jurídica e aviso prévio.

#### 2.3 Definir e aplicar retenção real

A limpeza de dados operacionais remotos mantém os seguintes padrões técnicos no
backend:

| Categoria | Padrão presente na função |
|---|---:|
| Sessões inativas | 14 dias |
| Auditorias de relógio | 30 dias |
| Eventos de limite | 2 dias |
| Códigos de ativação encerrados | 90 dias |

Esses valores só podem aparecer como compromisso no produto depois de confirmar
que a limpeza está agendada e funcionando em produção. Não foi encontrado no
repositório um agendamento dessa função.

`licensing.app_events` não integra mais esse inventário porque a tabela e a
função `track-event` foram removidas. Separadamente, os diagnósticos locais têm
retenção implementada de 14 dias de calendário; essa limpeza acontece na
máquina e não depende de `licensing.purge_operational_data`.

Também faltam decisões explícitas para:

- `audit_log`, que não faz parte da função de limpeza;
- cadastro de membros e dispositivos depois do fim do contrato;
- preservação excepcional de evidências de um incidente.

**Proposta inicial para discussão:** 12 meses para auditoria administrativa,
com preservação separada e justificada somente quando houver incidente ou
obrigação aplicável. Esse prazo não é uma exigência legal automática.

**Critério de aceite:** política aprovada, rotina agendada, teste de exclusão,
monitoramento da última execução e procedimento documentado para exceções.

#### 2.4 Manter acesso mínimo e rastreável

- conservar os logs detalhados somente para a conta master autorizada;
- exigir autenticação recente para operações críticas;
- não disponibilizar o histórico individual a gestores comuns;
- registrar acessos administrativos relevantes sem armazenar segredo, código
  de ativação em claro, OTP, token ou recibo completo;
- revisar periodicamente quem possui conta master.

Ter apenas uma pessoa com acesso reduz a exposição, mas não elimina a natureza
pessoal dos dados nem a obrigação de transparência.

#### 2.5 Definir atendimento e incidentes

Documentar:

- canal para pedidos de acesso, correção, informação e eliminação;
- responsável por responder ao titular;
- fluxo entre operador e controlador;
- exportação compreensível dos registros ligados a uma pessoa;
- procedimento de incidente, preservação de evidências e comunicação;
- prazo contratual interno do operador para avisar o controlador.

Uma meta contratual de aviso do operador em até 24 horas deixa margem para o
controlador avaliar o incidente e, quando aplicável, cumprir os prazos da ANPD.

### Etapa 1 — melhorar a linguagem do produto sem ampliar a coleta

1. Adicionar um aviso curto no primeiro acesso/ativação do Tauri.
2. Criar no Tauri uma área permanente chamada **Privacidade e dados técnicos**.
3. Adicionar mensagens contextuais antes de liberar dispositivo ou gerar
   código.
4. Explicar na tela de logs do Admin o uso permitido desse histórico.
5. Trocar termos ambíguos:
   - usar **Última validação da licença**, não “última atividade”;
   - usar **Ativado em** e **Liberado em**, não “online” ou “presença”;
   - não apresentar os registros como medição de tempo de uso.
6. Manter uma versão do aviso e a data em que ele foi apresentado. O botão
   **Continuar** ou **Entendi** comprova exibição, não consentimento.

Não usar a frase “ao continuar, você concorda com a coleta” para dados
obrigatórios. O aviso serve para transparência; ele não deve simular uma escolha
que o usuário não possui.

#### Revisão contínua de erros, alerts e toasts do Tauri e do CEP

Os registros técnicos estruturados e a trilha anterior à falha já foram
implantados no Arizona App e na extensão CEP. A revisão integral das mensagens
visíveis ainda é uma etapa de produto e deverá abranger alerts, banners e
toasts dos dois componentes.

A interface deve mostrar uma mensagem humana, breve e orientada à próxima ação.
Ela não deve expor nome de fornecedor, URL, tabela, função remota, código SQL,
stack trace, token, caminho interno ou outra informação de implementação. Por
exemplo, uma falha de comunicação pode aparecer como:

> Não foi possível acessar o serviço agora. Verifique sua conexão e tente
> novamente.

Quando a causa já estiver classificada com segurança, o texto pode ser mais
específico, como indisponibilidade dos dados necessários, arquivo não
sincronizado ou versão incompatível. Não transformar toda falha em uma mensagem
genérica: o usuário precisa entender o que pode fazer, sem receber o detalhe
técnico do backend.

A manutenção das mensagens deverá:

- manter um catálogo compartilhado de códigos e textos, aplicado nos limites de
  apresentação de cada projeto, sem importar código entre Tauri e CEP;
- revisar todos os alerts, banners, mensagens locais e toasts, evitando que a
  mesma falha apareça repetida em mais de um lugar;
- definir severidade, duração, ação sugerida e possibilidade de tentar
  novamente para cada categoria;
- permitir um identificador curto de suporte, sem mostrar o diagnóstico
  completo na interface;
- testar que respostas técnicas desconhecidas não chegam diretamente ao
  usuário.

Ocultar o nome do fornecedor na interface melhora a segurança de apresentação e
a clareza, mas não substitui autenticação, autorização e proteção das
credenciais. A segurança não pode depender somente dessa ocultação.

O diagnóstico completo segue um canal local separado da mensagem visível. A
decisão vigente é manter um registro diário rotativo, com prazo curto e
exportação consciente para suporte. Não existe destino remoto ou modelo
híbrido: o ZIP somente deixa a máquina por ação posterior do usuário. Formato,
pasta, migração e exportação estão definidos em
[Diagnósticos locais](./DIAGNOSTICOS_LOCAIS.md).

Qualquer proposta futura de envio remoto exige uma nova decisão técnica,
jurídica e de produto. Ela não pode reaproveitar silenciosamente a auditoria de
licença nem reintroduzir `track-event` ou `licensing.app_events` como um canal
genérico.

### Etapa 2 — diagnóstico de erros local implementado

O formato vigente registra somente contexto técnico necessário:

- código de erro enumerado, quando conhecido;
- origem, componente, ação, estado e mensagem técnica curta;
- horário, identificadores efêmeros da execução e correlação de operação no CEP;
- detalhes limitados e saneados;
- no máximo as 12 ações técnicas anteriores em eventos de aviso ou erro.

Não devem ser coletados:

- conteúdo, nome ou caminho de projeto/arquivo;
- texto digitado, clipboard, título de janela ou captura de tela;
- briefing, cliente, produto ou conteúdo criativo;
- token, senha, OTP, código de ativação ou recibo;
- mensagem livre sem saneamento.

Os gravadores aplicam limites de tamanho, profundidade e quantidade e removem
padrões de e-mail, credencial, token, código, URL com parâmetros e caminho. O
saneamento é defesa adicional; cada novo ponto de instrumentação ainda precisa
evitar esses dados na origem.

Outros requisitos vigentes:

- arquivos diários separados para Tauri e CEP, sem escrita concorrente no mesmo
  arquivo;
- retenção automática do dia atual e dos 13 anteriores;
- erro de gravação nunca bloqueia a interface ou a operação principal;
- filas locais limitadas a 512 eventos e escrita sequencial assíncrona, com
  descarte de melhor esforço em vez de bloquear a interface quando saturadas;
- nenhuma fila de upload, backoff de rede ou envio remoto;
- exportação explícita em ZIP, sem sessão de autenticação, recibo ou
  configuração;
- sinais de integridade tratados como indícios, nunca como prova automática de
  burla;
- revisão humana antes de qualquer bloqueio adicional ou conclusão sobre uma
  pessoa;
- testes que comprovem a ausência dos campos proibidos.

### Etapa 3 — telemetria de funcionalidades fora do produto

Nesta etapa não será feito nenhum trabalho de implementação:

- não recriar `track-event` ou `licensing.app_events` para registrar uso;
- não criar eventos de clique;
- não registrar frequência de recursos por pessoa;
- não acrescentar toggle de analytics como se a coleta já existisse;
- não reutilizar logs de licença para inferir produtividade ou uso de features.

Se essa frente for retomada, ela exigirá uma decisão independente contendo:

- finalidade além de mera curiosidade;
- teste de necessidade e proporcionalidade;
- avaliação de riscos/RIPD quando pertinente;
- métricas agregadas ou anonimizadas como padrão;
- regras contratuais e aviso específicos;
- garantia de que participar ou não participar não alterará o acesso do
  trabalhador ao produto.

### Etapa 4 — canal voluntário de sugestões e feedbacks

O envio de feedback deve ser uma ação iniciada conscientemente pelo usuário.
Ele não é telemetria, não deve acontecer em background e não deve ser usado
para inferir comportamento.

#### Onde disponibilizar

- **Tauri:** nova aba **Ajuda e feedback** dentro de Configurações, ao lado de
  **Ambiente** e **Atalhos After**.
- **Erros conhecidos:** ação contextual **Relatar este problema**, abrindo o
  mesmo formulário e identificando a área de origem.
- **Admin:** futura área **Feedbacks**, restrita à conta master, para leitura,
  classificação e acompanhamento.
- **Extensão CEP:** não criar outro formulário na primeira versão. Um link
  futuro poderá abrir o fluxo central do Tauri com a área **Extensão CEP**
  selecionada.

#### Campos do formulário

- tipo: **Sugestão**, **Problema**, **Dúvida** ou **Outro**;
- assunto curto;
- mensagem;
- área relacionada: Projetos, Utilitários, After Effects, Extensão, Acesso ou
  outra área controlada;
- opção **Podem entrar em contato comigo sobre isso**;
- opção **Incluir contexto técnico**;
- aviso para não incluir senha, OTP, código de acesso, dado confidencial de
  cliente ou conteúdo de projeto.

O formulário não deve prometer anonimato. Como o envio parte de uma sessão
corporativa, o usuário deve ver claramente que seu e-mail e sua organização
acompanharão a mensagem.

#### Contexto técnico permitido

Dados que podem acompanhar todo envio, sempre visíveis antes da confirmação:

- versão do Arizona App;
- área do produto de onde o formulário foi aberto;
- data e hora;
- organização e usuário autenticado.

Dados adicionais somente quando **Incluir contexto técnico** estiver ativo:

- versão da extensão CEP, quando disponível;
- versão do Windows;
- código de erro enumerado, quando o formulário partir de um erro conhecido.

Para o tipo **Problema**, a opção pode aparecer marcada por padrão, desde que a
lista exata seja exibida e o usuário possa desmarcá-la. Para os demais tipos,
ela deve começar desmarcada.

Não anexar automaticamente:

- screenshot ou gravação de tela;
- arquivo, nome ou caminho de projeto;
- logs completos, histórico de navegação ou breadcrumbs;
- texto digitado fora do formulário;
- token, recibo, código de ativação, OTP ou credencial;
- detalhes livres de exceção sem saneamento.

Anexos ficam fora da primeira versão, pois ampliam consideravelmente os riscos
de conteúdo confidencial, malware, armazenamento e retenção.

#### Armazenamento e acompanhamento

O conteúdo do feedback deve ter finalidade e armazenamento próprios. Não
reutilizar `licensing.audit_log`. A tabela `licensing.app_events` não existe
mais e não deve ser recriada oportunisticamente para receber feedback.

Um desenho futuro poderá usar uma Edge Function dedicada e uma tabela isolada,
com nomes como `feedback-submit` e `product_feedback`. Isso é apenas uma
referência de arquitetura e exigirá aprovação prévia de migration e deploy.

O registro precisará conter apenas:

- identificador, categoria, assunto e mensagem;
- organização, autor e permissão de contato;
- contexto técnico autorizado;
- estado: **Novo**, **Em análise**, **Planejado** ou **Encerrado**;
- datas de criação e atualização.

O conteúdo da mensagem não deve ser copiado para o log administrativo. Se for
necessário auditar a gestão da caixa, registrar somente mudanças de estado e
identificadores internos, sem repetir o texto.

O Admin não precisa se tornar um sistema completo de chamados na primeira
versão. Filtros, estado e permissão de contato são suficientes. Uma confirmação
com protocolo permite ao usuário saber que a mensagem foi recebida.

#### Privacidade, segurança e retenção

- acesso ao conteúdo somente pela conta master autorizada;
- limite de tamanho e saneamento de todos os campos;
- rate limit por usuário e organização;
- mensagem do usuário tratada como potencialmente confidencial;
- proibição de reutilização para avaliação profissional ou telemetria de uso;
- procedimento para excluir feedbacks ligados a um titular;
- prazo de retenção aprovado antes da publicação.

**Proposta inicial para discussão:** manter o feedback por até 12 meses depois
de encerrado e, se houver valor duradouro, preservar somente uma síntese
anonimizada da sugestão. Esse prazo deve ser validado antes da implementação.

#### Critérios de aceite

- nenhum envio ocorre sem ação expressa do usuário;
- a pessoa vê os dados que acompanharão a mensagem;
- desmarcar o contexto técnico realmente remove os campos adicionais;
- nenhuma informação proibida aparece no payload ou nos logs;
- o feedback fica separado de auditoria e telemetria;
- apenas a conta master consegue consultar o conteúdo;
- o usuário recebe confirmação e protocolo;
- a retenção está implementada e testada.

## 3. Mensagens propostas e onde colocá-las

Os textos abaixo são modelos. Os campos entre chaves devem vir de configuração
para facilitar futuro white label:

- `{{NOME_DO_PRODUTO}}`
- `{{CONTROLADOR}}`
- `{{OPERADOR}}`
- `{{CONTATO_PRIVACIDADE}}`
- `{{URL_DO_AVISO}}`
- `{{VERSAO_DO_AVISO}}`

### 3.1 Tauri — tela de ativação/primeiro acesso

**Posição:** abaixo dos campos de e-mail/código e antes da ação principal, com
link sempre visível.

> **Privacidade e dados técnicos**  
> Para validar seu acesso, proteger a licença e permitir suporte,
> o {{NOME_DO_PRODUTO}} registra dados da conta e da operação, como e-mail
> corporativo, versão do aplicativo, identificação da instalação, nome da
> máquina e horários de ativação e validação. Ações administrativas relacionadas
> à conta e ao dispositivo também ficam registradas. Esses dados não são usados
> para medir jornada, produtividade ou desempenho profissional.  
> **Ver como os dados são tratados**

O link deve abrir a área completa do próprio Tauri e, quando disponível, a
versão web do aviso.

### 3.2 Tauri — Configurações > Privacidade e dados técnicos

**Posição:** item permanente nas configurações, acessível também antes do login.

Texto-base:

> **Por que tratamos dados técnicos**  
> Usamos os dados estritamente necessários para autenticar usuários, validar a
> licença, proteger contas e dispositivos, prestar suporte e manter um histórico
> de mudanças administrativas.
>
> **O que é enviado ao serviço**  
> Dados de cadastro e perfil; identificador da instalação e nome da máquina;
> versão do aplicativo; horários e estado das validações de licença; sinais
> técnicos de segurança; e registros de ações administrativas, com responsável,
> alvo e data.
>
> **O que permanece na máquina**  
> Credenciais protegidas pelo sistema operacional, recibos de licença,
> preferências, histórico e caminhos necessários às funções locais do
> aplicativo podem permanecer no dispositivo. Diagnósticos técnicos do Tauri e
> da extensão CEP permanecem em arquivos locais por até 14 dias.
>
> **O que não enviamos atualmente**  
> O Tauri e a extensão CEP não enviam telemetria sobre quais funcionalidades
> cada pessoa utiliza. Também não enviam automaticamente o conteúdo dos projetos
> ou arquivos como parte do licenciamento. Os diagnósticos locais não são
> enviados automaticamente; um pacote só pode ser compartilhado depois que o
> usuário o exporta conscientemente.
>
> **Quem pode acessar**  
> O tratamento é realizado por {{OPERADOR}} seguindo as finalidades e instruções
> definidas por {{CONTROLADOR}}. O acesso detalhado é restrito a administradores
> técnicos autorizados.
>
> **Retenção e direitos**  
> Os prazos aplicáveis a cada categoria e os direitos do titular estão descritos
> no Aviso de Privacidade. Para solicitar informações, correção ou exercer
> outros direitos, use {{CONTATO_PRIVACIDADE}}.  
> **Abrir Aviso de Privacidade — versão {{VERSAO_DO_AVISO}}**

O texto final deve substituir a frase genérica de retenção por uma tabela de
prazos depois que a rotina de limpeza for verificada em produção.

### 3.3 Tauri — confirmação de liberação de dispositivo

**Posição:** dentro da confirmação, antes do botão destrutivo.

> Esta ação desvinculará **{{DISPOSITIVO}}** e encerrará suas sessões de licença.
> A liberação será registrada com o responsável, o dispositivo afetado e a
> data/hora para segurança e suporte. Deseja continuar?

### 3.4 Tauri — geração de código de ativação

**Posição:** junto à confirmação ou ao resultado da geração.

> A emissão deste código será registrada com o responsável, o destinatário e a
> data/hora. O valor do código não será exibido no histórico de atividades.

### 3.5 Admin — topo de Logs de atividade

**Posição:** aviso persistente abaixo do título da página.

> **Uso restrito a segurança, licenciamento e suporte**  
> Este histórico mostra mudanças administrativas e de dispositivos. Ele não
> deve ser usado para medir jornada, presença, produtividade ou desempenho
> profissional. Um evento isolado de integridade é um sinal técnico e deve ser
> revisado antes de qualquer conclusão.

### 3.6 Tauri — atualização relevante do aviso

**Posição:** banner não bloqueante no primeiro acesso após uma mudança material.

> Atualizamos o Aviso de Privacidade para explicar uma mudança no tratamento de
> dados técnicos. Consulte a versão {{VERSAO_DO_AVISO}}.  
> **Ver atualização**

Não mostrar esse banner para correções meramente editoriais.

### 3.7 Tauri — Configurações > Diagnóstico

**Posição:** aba permanente na janela de Configurações.

> **Registros locais do Arizona**
>
> O aplicativo e a extensão registram apenas informações técnicas neste
> computador. Nada é enviado automaticamente. E-mails, credenciais, recibos de
> licença e códigos de ativação são removidos dos registros. Ao ocorrer um erro,
> o arquivo inclui uma trilha curta das ações anteriores para facilitar o
> suporte.

A área mostra a pasta, a retenção de 14 dias, a quantidade de arquivos e o
espaço usado. As ações **Escolher**, **Padrão**, **Abrir pasta** e **Exportar
diagnóstico** tornam a localização e o compartilhamento decisões visíveis do
usuário.

### 3.8 Tauri — Configurações > Ajuda e feedback

**Posição:** nova aba na janela de Configurações.

> **Ajuda e feedback**  
> Encontrou um problema ou tem uma ideia para melhorar o
> {{NOME_DO_PRODUTO}}? Envie uma mensagem diretamente para a equipe responsável
> pelo produto.

Texto próximo ao contexto técnico:

> **Incluir contexto técnico**  
> Acrescenta as versões da extensão, quando disponível, e do Windows, além do
> código do erro quando este formulário tiver sido aberto por uma falha
> conhecida. Nenhum arquivo, caminho de projeto, captura de tela, senha, token
> ou código de acesso será anexado.

Aviso antes do envio:

> Sua mensagem será enviada com seu e-mail corporativo, organização, versão do
> aplicativo, área de origem e data/hora. Não inclua informações confidenciais
> de clientes, senhas ou códigos de acesso no texto.

Ações:

- botão principal **Enviar feedback**;
- botão secundário **Cancelar**;
- link **Privacidade e dados técnicos**.

Confirmação:

> **Feedback enviado**  
> Recebemos sua mensagem. Protocolo: **{{PROTOCOLO}}**.

### 3.9 Tauri — ação contextual em uma mensagem de erro

**Posição:** ação secundária em erros para os quais exista um código enumerado.

> **Relatar este problema**

Ao abrir o formulário:

> O formulário foi preenchido com a área e o código técnico desta falha. Revise
> os dados antes de enviar. Você pode remover o contexto técnico.

Essa ação não deve aparecer como se o erro já tivesse sido enviado
automaticamente.

### 3.10 Admin — área Feedbacks

**Posição:** futura entrada própria na navegação lateral do Admin.

> **Feedbacks do produto**  
> Sugestões, dúvidas e problemas enviados voluntariamente pelos usuários. O
> conteúdo é restrito a suporte e melhoria do produto e não deve ser utilizado
> para avaliar jornada, produtividade ou desempenho profissional.

## 4. Ajustes contratuais mínimos

O contrato principal ou aditivo de tratamento de dados deve prever:

- papéis de controlador e operador;
- instruções documentadas e finalidades permitidas;
- categorias de dados e pessoas afetadas;
- acesso restrito e confidencialidade;
- retenção, devolução e eliminação ao fim do serviço;
- subprocessadores, hospedagem e transferência internacional;
- medidas de segurança e evidências de auditoria;
- apoio a direitos dos titulares;
- comunicação e cooperação em incidentes;
- proibição de uso para produtividade, jornada ou disciplina fora do escopo;
- vedação ao uso independente de dados identificáveis para analytics de
  produto.
- tratamento separado para mensagens voluntárias de feedback, incluindo acesso,
  retenção e eventual contato com o autor.

O aviso aos usuários e o contrato entre empresas são complementares. Um não
substitui o outro.

Cláusula-base para revisão jurídica:

> Os dados técnicos individualizados serão utilizados exclusivamente para
> segurança, autenticação, licenciamento, suporte e diagnóstico. Os registros
> não serão utilizados para aferição de jornada, presença, produtividade,
> desempenho profissional ou aplicação automatizada de medida disciplinar.
> Qualquer nova finalidade dependerá de instrução documentada do controlador,
> avaliação de necessidade e atualização prévia das informações fornecidas aos
> titulares.

## 5. Ordem recomendada para o trabalho restante

1. Aprovar inventário, papéis, finalidades e proibições.
2. Definir retenções ainda abertas e confirmar o agendamento de limpeza.
3. Finalizar aviso de privacidade e aditivo contratual.
4. Concluir as mensagens relativas ao tratamento que já existe.
5. Manter e testar o contrato local de diagnóstico em cada release, incluindo
   retenção, mudança de pasta, saneamento e exportação.
6. Aprovar o desenho e a retenção do canal voluntário de feedback.
7. Implementar o formulário no Tauri e a caixa restrita no Admin.
8. Validar acesso, exportação, exclusão e procedimento de incidente.
9. Manter telemetria de funcionalidades fora do produto até nova decisão.

Qualquer etapa restante que envolva migration, banco, Edge Function, segredo,
deploy, Tauri ou extensão deve ser apresentada e aprovada separadamente antes
da execução. Como o produto está em beta de produção, a proposta deverá incluir
testes, compatibilidade, implantação gradual e forma de reversão.

## 6. Critérios gerais de conclusão

- O usuário consegue ler o aviso antes de ativar e depois, nas configurações.
- O texto diferencia claramente dados locais, dados enviados e dados que ainda
  não são coletados.
- Cada categoria possui finalidade, acesso e retenção verificáveis.
- A nomenclatura não sugere monitoramento de jornada ou produtividade.
- O Admin continua restrito e suas ações sensíveis permanecem auditáveis.
- A rotina de exclusão é executada e monitorada, não apenas declarada.
- O diagnóstico técnico permanece local, saneado, separado por componente e
  limitado a 14 dias; exportar não envia o pacote automaticamente.
- A auditoria essencial em `licensing.audit_log` não é confundida com
  diagnóstico nem usada como telemetria de funcionalidades.
- Feedbacks só são enviados por ação expressa, com contexto visível e
  armazenamento separado.
- Nenhuma telemetria de uso individual foi habilitada.
- Novos eventos de diagnóstico respeitam o contrato fechado e não adicionam
  conteúdo livre do usuário.

## 7. Referências

- [Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD — Guia orientativo sobre legítimo interesse](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse)
- [ANPD — Guia dos agentes de tratamento](https://www.gov.br/anpd/pt-br/assuntos/noticias/nova-versao-do-guia-dos-agentes-de-tratamento)
- [ANPD — Relatório de Impacto à Proteção de Dados Pessoais](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)
- [ANPD — Comunicação de incidente de segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [Contrato de diagnósticos locais](./DIAGNOSTICOS_LOCAIS.md)
- [Arquitetura de licenciamento](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md)
