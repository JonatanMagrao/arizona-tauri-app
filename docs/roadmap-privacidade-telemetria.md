# Roadmap de privacidade, registros operacionais e diagnóstico

**Status:** planejamento — nenhuma implementação autorizada por este documento  
**Atualizado em:** 28/07/2026  
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
| Diagnóstico de erros | Preparar para uma implementação futura controlada | Somente quando necessária ao suporte | Ainda não implementado no cliente |
| Uso de funcionalidades por pessoa | Não implementar agora | Não aplicável | Em aberto |
| Sugestões e feedbacks | Criar futuramente um canal explícito e separado | Sim, com transparência para permitir retorno | Ainda não implementado |

A terceira frente permanece deliberadamente fora do escopo. Não serão
registrados cliques, frequência de uso de recursos nem perfis individuais de
comportamento até que exista uma nova decisão expressa.

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
  de código, ativação ou liberação de dispositivo, redefinição de TOTP e
  redefinição de limites.

Essas ações administrativas já são gravadas em `licensing.audit_log`. A tela
**Logs de atividade** do Admin apenas consulta esses registros e atualmente é
restrita à conta master.

### 1.2 Dados mantidos localmente

O Tauri também mantém dados necessários ao funcionamento local, como
credenciais protegidas pelo sistema operacional, recibo de licença da extensão,
preferências, histórico e caminhos usados pelas funções do aplicativo. Esses
itens precisam constar no inventário de privacidade mesmo quando não são
enviados ao Supabase.

### 1.3 O que não deve ser anunciado como existente

- Não foi encontrada chamada do Tauri ou da extensão CEP para a função
  `track-event`. A existência da função e da tabela `licensing.app_events` não
  significa que exista telemetria de uso ativa no cliente.
- O Tauri e a extensão já produzem alguns códigos de erro localmente, mas não
  enviam hoje um relatório remoto estruturado com erro e sequência de ações.
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

A função `licensing.purge_operational_data` contém hoje os seguintes padrões
técnicos:

| Categoria | Padrão presente na função |
|---|---:|
| Sessões inativas | 14 dias |
| Auditorias de relógio | 30 dias |
| Eventos de aplicativo | 90 dias |
| Eventos de limite | 2 dias |
| Códigos de ativação encerrados | 90 dias |

Esses valores só podem aparecer como compromisso no produto depois de confirmar
que a limpeza está agendada e funcionando em produção. Não foi encontrado no
repositório um agendamento dessa função.

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

### Etapa 2 — diagnóstico de erros, somente depois da Etapa 0

O diagnóstico futuro deve coletar apenas:

- código de erro enumerado;
- componente e etapa técnica;
- versão do app/extensão;
- resultado e horário;
- identificador do usuário/dispositivo somente quando necessário;
- no máximo os últimos 10 a 20 identificadores de ações técnicas permitidas.

Não coletar:

- conteúdo, nome ou caminho de projeto/arquivo;
- texto digitado, clipboard, título de janela ou captura de tela;
- briefing, cliente, produto ou conteúdo criativo;
- token, senha, OTP, código de ativação ou recibo;
- mensagem livre sem saneamento.

Antes de reutilizar `track-event`, substituir metadados genéricos por uma lista
estrita de campos permitidos para cada evento, com limite de tamanho. O
saneamento baseado apenas no nome da chave não é uma barreira suficiente.

Outros requisitos:

- buffer local circular, limitado por quantidade e idade;
- envio em background com fila limitada, backoff e jitter;
- erro de envio nunca bloqueia a interface;
- retenção remota proposta de 90 dias, a validar;
- sinais de integridade tratados como indícios, nunca como prova automática de
  burla;
- revisão humana antes de qualquer bloqueio adicional ou conclusão sobre uma
  pessoa;
- testes que comprovem a ausência dos campos proibidos.

### Etapa 3 — telemetria de funcionalidades em aberto

Nesta etapa não será feito nenhum trabalho de implementação:

- não ligar o cliente à função `track-event` para registrar uso;
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
reutilizar `licensing.audit_log` nem `licensing.app_events`.

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
> aplicativo podem permanecer no dispositivo.
>
> **O que não enviamos atualmente**  
> O Tauri e a extensão CEP não enviam telemetria sobre quais funcionalidades
> cada pessoa utiliza. Também não enviam automaticamente o conteúdo dos projetos
> ou arquivos como parte do licenciamento. Relatórios remotos estruturados de
> diagnóstico do Tauri/CEP ainda não estão ativos.
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

### 3.7 Mensagem reservada para o diagnóstico futuro

**Não exibir enquanto o envio estruturado de erros não estiver ativo.**

> **Diagnóstico técnico**  
> Para identificar e corrigir falhas, o {{NOME_DO_PRODUTO}} pode enviar o código
> do erro, a versão do componente, o estado técnico e uma sequência curta de
> ações do próprio aplicativo anteriores à falha. Esse diagnóstico não inclui
> conteúdo ou caminho de arquivos, texto digitado, capturas de tela, senhas,
> tokens ou códigos de autenticação.

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

## 5. Ordem recomendada de execução futura

1. Aprovar inventário, papéis, finalidades e proibições.
2. Definir retenções ainda abertas e confirmar o agendamento de limpeza.
3. Finalizar aviso de privacidade e aditivo contratual.
4. Implementar somente as mensagens relativas ao tratamento que já existe.
5. Aprovar o desenho e a retenção do canal voluntário de feedback.
6. Implementar o formulário no Tauri e a caixa restrita no Admin.
7. Validar acesso, exportação, exclusão e procedimento de incidente.
8. Desenhar o catálogo fechado de erros e seus campos permitidos.
9. Fazer revisão técnica e jurídica antes de ativar diagnóstico remoto.
10. Manter telemetria de funcionalidades fora do produto até nova decisão.

Qualquer etapa que envolva migration, banco, Edge Function, segredo, deploy,
Tauri ou extensão deve ser apresentada e aprovada separadamente antes da
execução. Como o produto está em beta de produção, a proposta deverá incluir
testes, compatibilidade, implantação gradual e forma de reversão.

## 6. Critérios gerais de conclusão

- O usuário consegue ler o aviso antes de ativar e depois, nas configurações.
- O texto diferencia claramente dados locais, dados enviados e dados que ainda
  não são coletados.
- Cada categoria possui finalidade, acesso e retenção verificáveis.
- A nomenclatura não sugere monitoramento de jornada ou produtividade.
- O Admin continua restrito e suas ações sensíveis permanecem auditáveis.
- A rotina de exclusão é executada e monitorada, não apenas declarada.
- Feedbacks só são enviados por ação expressa, com contexto visível e
  armazenamento separado.
- Nenhuma telemetria de uso individual foi habilitada.
- O diagnóstico futuro não aceita metadados livres.

## 7. Referências

- [Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD — Guia orientativo sobre legítimo interesse](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse)
- [ANPD — Guia dos agentes de tratamento](https://www.gov.br/anpd/pt-br/assuntos/noticias/nova-versao-do-guia-dos-agentes-de-tratamento)
- [ANPD — Relatório de Impacto à Proteção de Dados Pessoais](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)
- [ANPD — Comunicação de incidente de segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [Arquitetura de licenciamento](../LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md)
