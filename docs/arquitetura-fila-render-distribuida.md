# Arquitetura — fila distribuída de render

**Estado:** MVP e backend implantados; testes reais com duas máquinas ainda
pendentes

**Última revisão:** 2026-08-11

**Escopo:** Arizona App (Tauri), Supabase e Google Drive compartilhado. O CEP
permanece apenas no fluxo de render local.

## 1. Objetivo

Permitir que um usuário envie um projeto do After Effects para uma fila da
organização e que outra máquina, disponibilizada voluntariamente pelo seu dono,
aceite e inicie novos renders MOV/MP4 somente enquanto o toggle estiver ligado.
Se ele for desligado durante um trabalho, a máquina conclui o atual e não inicia
outro.

Esse recurso não dá acesso remoto ao desktop da outra pessoa e não transfere a
sessão de um usuário para outro. Cada máquina continua autenticada com seu
próprio membro e device. Ela apenas oferece capacidade de render para jobs da
mesma organização.

## 2. Premissas confirmadas

- As máquinas usam o mesmo Google Drive compartilhado, embora cada instalação
  possa montá-lo com uma letra diferente.
- O `.aep` e as mídias necessárias ficam nesse Drive.
- Fontes, plug-ins, codecs e presets necessários são padronizados nas máquinas.
- O fluxo oficial continua gerando as comps `EXPORT` e `EXPORT_MP4`.
- A receita oficial inicial é MOV pela comp `EXPORT` com o template `PROXY` e
  MP4 pela comp `EXPORT_MP4` com o template `MP4`.
- Cada envio pode solicitar MOV, MP4 ou ambos; os dois formatos começam
  selecionados na interface.
- A máquina só participa depois de o dono ligar manualmente o toggle
  **Disponível para render**. O primeiro release não usa agenda, prazo nem
  detecção automática de inatividade.
- O toggle sempre começa desligado ao abrir o Tauri. A disponibilidade existe
  somente enquanto o processo está aberto; fechar o app encerra a participação.
- A máquina solicitante escolhe explicitamente qual máquina disponível receberá
  o job. O backend nunca substitui essa escolha silenciosamente.
- O projeto é escolhido no Tauri pelos mesmos campos Jobão/Jobinho já usados para
  localizar e abrir o `.aep` no After Effects.
- A aba **Render** do CEP foi removida. O atalho do Tauri e o botão local do CEP
  continuam sendo apenas ações locais da fila do After Effects.
- Cada máquina executa no máximo um job por vez, mas pode acumular vários jobs
  enviados por máquinas diferentes enquanto o toggle permanecer ligado.
- A fila de cada máquina é FIFO no primeiro release, sem prioridade manual.
- A execução distribuída usa `aerender.exe` diretamente; ela não abre o After
  Effects nem adiciona itens à fila visual do aplicativo.
- Solicitante e worker acompanham estado, posição, progresso, tempo e resultado
  no Tauri. Nenhuma dessas informações depende de o CEP estar aberto.
- O toggle **Receber renders** alterna a interface entre envio e recebimento. Ao
  desligá-lo com trabalho pendente, a fila recebida permanece visível até uma
  conclusão segura. Pessoas e máquinas são identificadas publicamente pelo nome
  do membro, nunca pelo hostname do Windows.
- Supabase é o plano de controle; arquivos grandes não passam pelos endpoints da
  fila.

## 3. Decisão central

```text
Tauri da máquina A
  └── resolve Jobão/Jobinho e o .aep salvo
        └── cria snapshot imutável e confirma os destinos
              └── usuário escolhe a máquina B disponível
                    └── Tauri cria job atribuído a B no Supabase
                          └── polling reconciliável encontra o job em B
                                └── Tauri B aberto e com toggle ligado
                                      └── reconstrói o path na sua raiz do Drive
                                            └── compara SHA-256 do snapshot
                                                  └── reivindica o job atribuído
                                                        └── executa aerender.exe
                                                              └── publica progresso e resultado
```

O Tauri A é responsável por localizar a versão salva do projeto, criar o
snapshot e escolher o destino. O Tauri B é responsável por disponibilidade e
execução do `aerender.exe`. O Supabase mantém o estado durável e garante que
somente o device escolhido execute o job. O CEP não participa do protocolo da
fila distribuída.

As letras A e B representam papéis de um job, não máquinas fixas. Uma mesma
estação pode solicitar renders para outras e também receber, em sua própria fila,
jobs enviados por diversos membros da organização.

O MVP usa polling periódico como fonte reconciliável. Uma notificação privada
pode ser adicionada depois apenas para reduzir latência; ela não poderá
substituir a consulta autoritativa.

## 4. Como provar que o Google Drive já sincronizou o `.aep`

### 4.1 Não usar data de modificação como autoridade

`mtime`, tamanho e nome do arquivo são úteis para diagnóstico e para evitar hash
desnecessário, mas não provam que duas máquinas têm os mesmos bytes. Horários
podem ser preservados ou alterados pelo cliente do Drive, e dois arquivos
diferentes podem ter o mesmo tamanho.

A autoridade deve ser o SHA-256 do conteúdo completo.

### 4.2 Por que o job precisa de um snapshot imutável

Não se deve enfileirar diretamente o `.aep` que continua aberto para edição.
Considere esta sequência:

1. a máquina A salva a revisão 10 e publica seu hash;
2. antes de a máquina B baixar a revisão 10, a máquina A salva a revisão 11;
3. o Google Drive pode entregar somente a revisão 11 para B;
4. B nunca encontrará o hash da revisão 10 ou poderá renderizar conteúdo que não
   corresponde ao clique original.

Por isso, cada job recebe uma cópia exclusiva e que não volta a ser modificada.
O original pode continuar sendo editado sem mudar o conteúdo do job já criado.

Uma convenção possível é:

```text
<pasta-do-projeto>\.arizona-render\<job-id>\<nome-do-projeto>.aep
```

O local definitivo deve ser validado com projetos reais para confirmar que as
referências compartilhadas continuam resolvendo corretamente. O manifesto usa
sempre caminho relativo à raiz configurada do Drive; nunca grava a letra `I:`
como identidade do arquivo.

### 4.3 Publicação do snapshot na máquina de origem

1. O Tauri resolve o `.aep` salvo a partir de Jobão/Jobinho sem abrir o After.
2. A interface informa que será usada a última versão salva no Drive; alterações
   ainda não salvas em um After aberto não fazem parte do job.
3. O Tauri calcula os destinos oficiais relativos à raiz do Drive e confirma uma
   possível substituição com o solicitante.
4. O Tauri copia o `.aep` salvo para um nome temporário exclusivo do job.
5. O Tauri fecha o arquivo temporário e calcula SHA-256 lendo todos os bytes.
6. Confere que tamanho e data não mudaram durante a leitura.
7. Renomeia o temporário para o nome final do snapshot.
8. Cria o job no Supabase, atribuído à máquina escolhida, com paths relativos,
   tamanho e SHA-256 esperado.
9. A partir desse ponto o snapshot é somente leitura para o protocolo da fila.

O rename local evita que outro processo da mesma máquina veja uma cópia ainda
incompleta. Ele não substitui a validação de hash na máquina remota.

Exemplo conceitual do manifesto:

```json
{
  "schemaVersion": 1,
  "jobId": "uuid",
  "targetWorkerDeviceId": "uuid-da-maquina-b",
  "jobaoCod": "JOB-2026",
  "jobinhoCod": "12345",
  "projectName": "projeto.aep",
  "projectRelativePath": "CARREFOUR/.../.arizona-render/uuid/projeto.aep",
  "projectSizeBytes": 4829137,
  "projectSha256": "hex-minusculo",
  "recipe": "arizona-render-v1",
  "outputs": [
    {
      "kind": "mov",
      "comp": "EXPORT",
      "template": "PROXY",
      "destinationRelativePath": "CARREFOUR/.../OUT/RENDER/MOV/projeto.mov",
      "replaceExisting": false
    },
    {
      "kind": "mp4",
      "comp": "EXPORT_MP4",
      "template": "MP4",
      "destinationRelativePath": "CARREFOUR/.../OUT/RENDER/MP4/projeto.mp4",
      "replaceExisting": false
    }
  ],
  "createdAt": "2026-08-11T12:00:00Z"
}
```

Os destinos pertencem ao projeto original e não podem ser recalculados a partir
da pasta do snapshot, pois isso mudaria a base para `.arizona-render`.

Para projetos comuns, MOV e MP4 ficam respectivamente em
`OUT/RENDER/MOV` e `OUT/RENDER/MP4`, exatamente como no botão local do CEP e no
atalho do Tauri. A exceção histórica `CLA` também é preservada nos três fluxos:
quando o nome do `.aep` começa com `CLA`, ambos os arquivos ficam juntos em
`PROJETOS/OUT`.

### 4.4 Verificação na máquina escolhida

Ao receber aviso de um job destinado ao seu próprio device:

1. O Tauri reconstrói o caminho usando sua raiz local configurada do Drive.
2. Canonicaliza o caminho e confirma que ele continua dentro dessa raiz.
3. Se o arquivo não existir, mantém `waiting_for_sync`.
4. Se for placeholder ou ainda não estiver hidratado, a leitura completa deve
   solicitar a hidratação; erros transitórios voltam para espera.
5. Compara primeiro o tamanho, como filtro rápido.
6. Calcula o SHA-256 completo.
7. Só chama o claim atômico quando o hash observado for igual ao esperado e o
   toggle daquela execução continuar ligado.
8. Depois do claim, repete uma verificação leve antes de iniciar o `aerender`.

Resultados possíveis:

| Resultado local | Estado/ação |
|---|---|
| Arquivo ausente | `waiting_for_sync` |
| Leitura temporariamente indisponível | aguardar com backoff |
| Tamanho diferente | ainda não sincronizado ou arquivo inválido |
| SHA-256 diferente | não reivindicar o job |
| SHA-256 igual | máquina apta a reivindicar |
| Prazo de sincronização excedido | `sync_timeout`, sem apagar o snapshot |

Um backoff simples pode começar em poucos segundos e crescer até um teto. Uma
notificação futura pode antecipar a próxima tentativa, mas não elimina a
consulta autoritativa.

### 4.5 O Supabase faz a comparação; as máquinas não conversam diretamente

A máquina de origem grava o hash esperado no job. A máquina escolhida calcula o
hash que enxerga localmente e envia esse valor ao endpoint de claim. A RPC só
entrega o job se:

- o job ainda estiver livre;
- o device autenticado for a máquina escolhida;
- solicitante e worker pertencerem à mesma organização;
- o worker estiver disponível e licenciado;
- o hash informado for igual ao hash esperado;
- os requisitos do job forem compatíveis com o worker.

Isso evita conexão direta entre estações e funciona mesmo se uma delas ficar
offline depois de criar o job.

### 4.6 Teste manual de aceitação

Quando as duas máquinas licenciadas estiverem disponíveis, o protocolo deve ser
provado com um snapshot real antes da liberação. Depois de o Drive sincronizar,
execute nas duas máquinas:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "I:\caminho\snapshot.aep"
```

Hashes iguais significam que o conteúdo local é byte a byte igual. Esse teste
não substitui o fluxo automático, mas valida a premissa principal.

## 5. Responsabilidades por projeto

### 5.1 Extensão CEP

- A aba **Render** e o executor `aerender` local associado a ela foram removidos.
- O botão local continua adicionando `EXPORT` e `EXPORT_MP4` à fila do After
  Effects.
- Esse botão usa a receita oficial: MOV com `PROXY` e MP4 com `MP4`.
- Não criar jobs, listar máquinas nem mostrar a fila distribuída.
- Não receber tokens, manifests ou estados do protocolo distribuído.

O botão do CEP e o atalho do Tauri são duas entradas locais para a fila do After
Effects. A fila distribuída é uma funcionalidade separada e integralmente
controlada pelo Arizona App.

### 5.2 Tauri da máquina solicitante

- Resolver o `.aep` salvo usando Jobão/Jobinho sem abri-lo no After.
- Validar licença, organização e caminhos permitidos.
- Listar máquinas atualmente disponíveis da mesma organização.
- Receber a escolha explícita da máquina de destino.
- Calcular paths finais relativos e confirmar substituições.
- Criar e hashear o snapshot.
- Chamar a Edge Function que cria o job já atribuído ao device escolhido.
- Exibir posição na fila, sincronização, progresso, conclusão, conflito e falha
  dos jobs enviados pela conta do membro.
- Exibir o tempo de espera separado do tempo total de execução e manter os
  resultados recentes visíveis após a conclusão.
- Exibir no dropdown do Histórico os jobs solicitados pelo membro, identificados
  como enviados para outra máquina.

O resolver da fila deve reaproveitar a mesma regra da ação **Abrir AE**, mas
separar localização e abertura. O manifesto guarda o snapshot e os destinos
exatos relativos à raiz; Jobão/Jobinho são contexto de seleção e exibição, não a
identidade suficiente do arquivo remoto.

### 5.3 Tauri da máquina worker

- Iniciar o opt-in desligado em toda execução do app.
- Enviar heartbeat no Rust enquanto o processo estiver aberto e o toggle ligado,
  sem depender de timers da WebView.
- Resolver o caminho relativo no Google Drive.
- Comparar tamanho e SHA-256.
- Reivindicar somente jobs atribuídos ao próprio device, um por vez.
- Executar `aerender.exe` diretamente, sem abrir o After interativo nem modificar
  sua fila visual.
- Capturar stdout, stderr, progresso, exit code e cancelamento.
- Renovar a lease durante preparação e render.
- Gravar cada tentativa em destino temporário exclusivo.
- Publicar a saída final somente se ainda possuir a lease vigente.
- Exibir no Tauri os jobs recebidos, suas origens, posições, progresso e ações
  permitidas.
- Exibir no dropdown do Histórico os jobs destinados ao device atual,
  identificados como executados nesta máquina.

O worker existe somente durante a execução normal do Arizona App. Não há tray,
inicialização automática nem Windows Service no primeiro release. A janela
principal só pode encerrar o processo depois que a disponibilidade for
desligada e não houver trabalho recebido; um heartbeat vencido continua sendo a
autoridade em encerramento forçado, crash ou falta de energia.

### 5.4 Supabase

- Autenticar todos os endpoints pelo JWT mantido no Tauri.
- Confirmar membro, organização e device ativo.
- Persistir workers e jobs, inclusive o resumo terminal durante a retenção
  operacional.
- Revalidar disponibilidade ao criar o job e garantir que somente o device
  escolhido possa reivindicar, renovar ou concluir.
- Fazer claim e conclusão de maneira atômica.
- Expor status reconciliável para o polling dos Tauri envolvidos.
- Tratar leases vencidas com limite de tentativas sem trocar a máquina escolhida
  silenciosamente.
- Impedir que dois jobs não terminais reservem os mesmos destinos finais.
- Impedir acesso entre organizações.

## 6. Modelo de dados implementado

As tabelas seguem o padrão atual do schema `licensing`: RLS forçada,
acesso direto revogado de `anon` e `authenticated`, e operações privilegiadas
somente por Edge Functions/RPCs internas.

### 6.1 `licensing.render_workers`

- `device_id` — PK/FK do device já licenciado;
- `organization_id`, `member_id` e `worker_session_id` — escopo e execução
  atual do Tauri;
- `enabled` — opt-in somente da execução atual, sempre iniciado como `false`;
- `reported_availability` — saúde declarada: `available`, `degraded` ou
  `unavailable`;
- `status_code` e `status_message` — motivo sanitizado quando a máquina exige
  atenção;
- `protocol_version`, `render_recipe` e `after_effects_year` — compatibilidade
  operacional;
- `heartbeat_at`, `created_at` e `updated_at`.

`busy`, `draining`, profundidade da fila e job atual são estados derivados dos
jobs e da preferência local; não são gravados como autoridade nessa tabela.

`offline` deve ser derivado da idade do heartbeat e da sessão atual do worker,
nunca confiado como estado declarado pelo cliente. Um `enabled = true` antigo
não torna a máquina disponível depois de reinício ou crash.

### 6.2 `licensing.render_jobs`

- `id`, `organization_id`, `requester_member_id` e `requester_device_id`;
- `target_worker_device_id` — máquina escolhida pelo solicitante;
- `previous_target_worker_device_ids` — histórico allowlisted usado somente para
  a máquina anterior reconciliar uma publicação interrompida após reatribuição;
- `schema_version` e `idempotency_key`;
- `jobao_cod`, `jobinho_cod` e `project_name` — contexto exibido ao usuário;
- `project_relative_path`, `project_size_bytes` e `project_sha256` — snapshot
  imutável;
- `recipe` e `outputs` — um ou dois formatos escolhidos, com comp, template,
  destino, política de substituição e fingerprint confirmados;
- `status`, `stage` e `progress_percent`;
- posição derivada por ordem de criação na fila da máquina escolhida;
- `lease_id`, `lease_generation`, `lease_expires_at` e
  `claimed_worker_session_id`;
- `attempt_count` e `max_attempts`;
- pedido e autoria do cancelamento;
- conflito de saída, erro enumerado e hashes/tamanhos dos resultados;
- timestamps.

`started_at` é fixado imediatamente antes de iniciar o primeiro processo
`aerender.exe`. `finished_at` é fixado depois que todas as saídas solicitadas
foram verificadas e publicadas. A diferença entre os dois representa o tempo
total mostrado na interface: inclui o cold start do primeiro `aerender`, a
execução sequencial das saídas MOV/MP4 escolhidas e a finalização segura dos
arquivos. O tempo entre `created_at` e `started_at` é exibido separadamente como
espera.

Estados principais:

```text
waiting_for_worker
  └── waiting_for_sync
        └── queued
              └── claimed
                    ├── rendering
                    │     └── publishing
                    │           └── completed
                    ├── cancelled
                    └── failed

Uma lease vencida retorna o job à espera na mesma máquina enquanto ainda houver
tentativas; ao atingir o limite, o job termina como `failed`. Não existe estado
persistido `retry_wait`.
```

No primeiro release, cada `target_worker_device_id` consome jobs por ordem de
criação. Um job em execução não impede novos envios para a mesma máquina; eles
permanecem em `queued` e recebem uma posição derivada, sem gravar um número de
posição mutável como autoridade.

### 6.3 Tentativas e diagnósticos

O MVP não cria tabelas separadas de tentativas ou eventos. A tentativa atual,
seu limite, erro final e resultado ficam resumidos em `render_jobs`. Detalhes do
processo, exit code, `stdout` e `stderr` sanitizados permanecem apenas nos
diagnósticos locais rotativos do Tauri.

O status também expõe `recoverableJob` somente quando a mesma execução do
worker ainda possui uma reserva ativa e vigente. Depois de uma resposta de
claim perdida, o worker revalida o snapshot e repete o claim idempotente para
recuperar sua autorização antes de iniciar o render.

O dropdown **Renders** do histórico usa a ação `history`, separada do polling de
`status`. Ela pagina por cursor estável `(created_at, id)`, em lotes de até 100,
e consulta todos os jobs ainda retidos que o membro solicitou ou que esta
máquina executou. Assim, os rótulos **Enviado**, **Executado aqui**, **Enviado e
executado aqui** e **Enviado em outro computador** são derivados dos IDs do
device e do membro autenticado. A rotina `licensing.purge_render_queue()` usa
30 dias como retenção padrão quando estiver agendada; até a limpeza, todos os
jobs ainda retidos continuam pagináveis. A janela limitada do status não define
o histórico.

## 7. Concorrência e recuperação

Polling ou notificações não podem decidir a posse do job. A RPC de claim usa
transação, serializa o worker escolhido e bloqueia o job com `FOR UPDATE`,
filtrando `target_worker_device_id` pelo device autenticado e garantindo no
máximo um dono por vez.

Cada claim cria:

- uma `lease_id` aleatória;
- uma `lease_generation` monotônica;
- um prazo curto renovado pelo heartbeat.

A geração funciona como fencing token. Se uma execução antiga da máquina B
perder a rede e a lease expirar, uma nova execução do mesmo device só continua
por uma geração nova. Mesmo que o processo antigo termine depois, ele não terá
autorização para publicar no destino final. Trocar para outra máquina exige uma
ação explícita do solicitante.

Saídas devem ser geradas em caminho exclusivo por tentativa, por exemplo:

```text
OUT\.arizona-render\<job-id>\<attempt-id>\video.mov
OUT\.arizona-render\<job-id>\<attempt-id>\video.mp4
```

Somente a tentativa que ainda possui a lease move/publica os arquivos para o
destino oficial. Isso evita duas máquinas sobrescreverem o mesmo MOV/MP4.

### 7.1 Arquivo final já existente

O worker não pode abrir uma confirmação interativa na máquina de outra pessoa.
Por isso, a decisão de substituir deve acontecer na máquina solicitante, antes
de criar o job:

1. O Tauri verifica somente os destinos finais dos formatos escolhidos.
2. Se algum já existir, mostra quais resultados serão substituídos.
3. O job só recebe permissão imutável de substituição depois da confirmação.
4. Se o arquivo existente mudar entre a confirmação e a publicação, o worker
   não o substitui: registra conflito e orienta o solicitante a reenviar o
   projeto para fazer uma nova confirmação. Se o trabalho ainda estiver
   aguardando, ele deve ser cancelado antes do novo envio.

Sem confirmação explícita, a política é sempre `fail-if-exists`.

## 8. Disponibilidade voluntária

Fluxo recomendado para o dono da máquina:

1. Abrir o Arizona App, que sempre inicia com o toggle desligado.
2. Ligar o toggle **Disponível para render**.
3. O Tauri confere a máquina e mostra `Disponível`, `Com aviso` ou
   `Indisponível`.
4. Ao desligar o toggle durante um job, muda para `draining`: conclui o atual e
   não reivindica outro.
5. Uma ação separada permite cancelar o job atual quando realmente necessário.

O painel da fila pode ser fechado ou minimizado sem interferir no envio nem no
worker que recebe trabalhos. Fechar o painel apenas oculta essa janela; enquanto
o Arizona App permanecer aberto, a disponibilidade, os heartbeats e um render em
andamento continuam no processo Rust. A janela principal se recusa a encerrar
quando o toggle estiver ligado ou houver trabalhos recebidos: nesse caso, ela
reabre a fila para o usuário aguardar o fim, cancelar os trabalhos ou desligar a
disponibilidade. Encerramento forçado pelo sistema, crash e falta de energia
continuam sendo recuperados pela expiração da lease.

A máquina precisa permanecer ligada, sem suspensão e com a sessão do Windows
ativa. Bloquear a tela deve ser validado em teste real; fazer logoff encerra os
processos do usuário.

Durante um render, o Tauri deve solicitar ao Windows que não suspenda a máquina
automaticamente. Isso não impede desligamento manual, falta de energia ou queda
do processo. Nesses casos o heartbeat para, a lease vence e o backend libera uma
nova tentativa para a mesma máquina escolhida. O solicitante pode então aguardar
a máquina voltar e ligar o toggle novamente, reatribuir ou cancelar o job.
Arquivos parciais ficam na pasta exclusiva da tentativa e nunca são promovidos
ao destino final. O `aerender` não retoma o vídeo no ponto em que parou; a saída
interrompida começa novamente.

Um job nunca migra automaticamente para outra máquina. Enquanto o destino
escolhido estiver offline ou com o toggle desligado, ambos os lados mostram
**Aguardando a máquina escolhida**. Somente o solicitante pode reatribuir o
job; o solicitante e a máquina executora podem cancelá-lo.

O processo filho deve ser supervisionado pelo Rust e encerrado junto com o
worker. Assim, um crash ou uma saída explícita do Tauri não deixa um `aerender`
órfão produzindo arquivos depois de perder sua lease. Ao voltar de suspensão ou
reinício, o worker sempre reconcilia o job com o backend antes de continuar e
nunca reutiliza uma lease vencida.

## 9. Segurança

- Solicitante e worker usam suas próprias sessões e devices.
- Ambos precisam estar ativos na mesma organização.
- O CEP permanece fora do protocolo e não recebe credenciais ou estado remoto.
- Chaves secretas permanecem somente nas Edge Functions.
- Jobs não aceitam JSX, executável, shell command ou argumento arbitrário.
- Comps, formatos e receitas são allowlists versionadas.
- Caminhos sempre são relativos e canonicalizados sob a raiz do Drive.
- As respostas públicas nunca carregam token, caminho absoluto ou log técnico.
- Claim, heartbeat, cancelamento e conclusão revalidam autorização no backend.
- O backend guarda apenas estado operacional mínimo da fila, códigos enumerados
  e timestamps com retenção definida. Logs técnicos, `stdout` e `stderr`
  permanecem somente nos diagnósticos locais.

## 10. Compatibilidade da receita de render

Embora a sincronização do `.aep` seja a comparação crítica, o worker ainda deve
anunciar um perfil operacional, por exemplo:

```text
workerProtocolVersion = 1
renderRecipeVersion = arizona-render-v1
afterEffectsYear = 2026
movOutputModuleTemplate = PROXY
mp4OutputModuleTemplate = MP4
```

`arizona-render-v1` é uma receita fechada e resolvida dentro do worker:

- MOV: comp `EXPORT`, template de módulo de saída `PROXY`, extensão `.mov`;
- MP4: comp `EXPORT_MP4`, template de módulo de saída `MP4`, extensão `.mp4`.

O manifesto transporta o identificador da receita, não nomes livres de template
ou argumentos de linha de comando. A fila distribuída e o botão local do CEP
aplicam essa combinação fixa. O atalho local de render do Tauri usa esses mesmos
defaults, mas permite configurar os nomes dos templates na tela **Atalhos
After** sem alterar o contrato distribuído.

Não é necessário bloquear toda versão que não seja a mais nova. O backend deve
aceitar versões comprovadamente compatíveis e bloquear somente uma combinação
incompatível ou conhecida como defeituosa.

O worker anuncia a versão do app, o ano configurado do After e a receita. O
preflight também confere o `aerender.exe` e a raiz compartilhada. O After
interativo pode permanecer aberto porque o worker executa o `aerender.exe`
diretamente. Nesse caso, a disponibilidade continua `available`, sem código de
falha, e o painel mostra apenas um aviso humano; fechá-lo pode liberar recursos
da máquina. A presença
efetiva dos templates ainda precisa ser comprovada no teste real de render em
cada máquina.

## 11. Estado da implementação

### Fase 1 — inventário e disponibilidade — implementada

- Adicionar worker Rust ligado à vida do processo, mas independente da WebView.
- Implementar toggle iniciado em OFF, heartbeat por sessão e `draining`.
- Mostrar no Tauri se Drive, `aerender` e receita estão aptos; tratar o After
  interativo aberto somente como recomendação de recursos.
- Ainda sem executar jobs remotos.

### Fase 2 — seleção, snapshot e submissão no Tauri — implementada

- Reaproveitar o resolver de Jobão/Jobinho sem abrir o After.
- Tratar seleção ambígua quando mais de um `.aep` corresponder ao Jobinho.
- Listar máquinas disponíveis e receber a escolha explícita do usuário.
- Criar snapshot atômico, calcular hash e criar o job atribuído.
- Mostrar `aguardando a máquina` e `aguardando sincronização` no Tauri.

### Fase 3 — backend da fila — implementada e implantada

- Criar migrations de workers e jobs com retenção operacional.
- Criar uma Function versionada para disponibilidade, criação, lista,
  atribuição/reatribuição, claim, heartbeat, conclusão, falha e cancelamento.
- Implementar RPCs internas com lease e fencing.
- Manter polling de reconciliação; notificações privadas ficam como otimização
  futura.

### Fase 4 — executor remoto — implementada

- Localizar o `aerender.exe` no worker.
- Verificar snapshot por hash.
- Executar diretamente uma saída por vez, sem abrir o After interativo.
- Capturar progresso, cancelamento e resultado.
- Publicar por tentativa e promover somente com lease válida.

### Fase 5 — resiliência e operação — parcial

- Implementados: retry com limite, recuperação transacional após reinício,
  fencing de lease, cancelamento, limpeza de snapshots/tentativas conhecidas,
  diagnósticos locais e limites por ação.
- Pendente de prova em ambiente real: suspensão/queda de energia, comportamento
  do Google Drive durante rename, templates instalados e render em duas contas.

### Fase 6 — prova real e gate de aceitação

- Criar snapshots de projetos reais.
- Comparar SHA-256 em duas máquinas licenciadas da mesma organização.
- Medir o tempo até o hash ficar igual.
- Testar arquivo somente on-line, já hidratado e atualização concorrente.
- Confirmar que a cópia do `.aep` resolve todas as referências esperadas.
- Validar publicação e substituição de MOV/MP4 pelo Google Drive.

Até essas máquinas estarem disponíveis, as fases anteriores usam testes
automatizados, duas raízes locais simuladas e testes locais do contrato do
backend. A prova real
continua obrigatória antes de liberar o recurso em produção; somente ela valida
a hidratação do Drive e as referências dos projetos reais.

## 12. Cenários mínimos de teste

- O snapshot chega imediatamente à outra máquina.
- O `.aep` demora para sincronizar e o worker espera.
- O manifest/aviso chega antes do conteúdo do `.aep`.
- A origem continua editando o projeto depois de enfileirar.
- O caminho do Drive usa outra letra na máquina worker.
- O arquivo existe com mesmo tamanho, mas hash diferente.
- Somente a máquina escolhida consegue reivindicar o job.
- A máquina escolhida fica offline antes de aceitar e o job aguarda ou é
  reatribuído manualmente.
- O worker perde a rede durante o render.
- A lease vence e uma nova execução não reutiliza a lease anterior.
- O worker antigo termina depois de perder a lease.
- O app sempre reinicia com o toggle desligado.
- O After interativo está aberto: o worker continua aceitando jobs, exibe o
  aviso de recursos e inicia somente `aerender.exe`.
- O usuário desliga o toggle ou fecha o app durante o render.
- O Tauri reinicia durante `waiting_for_sync` e durante `rendering`.
- A saída final já existe.
- A organização ou device é revogado durante o job.

## 13. Fontes da verdade atuais

- Fronteiras entre projetos: `AGENTS.md`.
- Autenticação e sessão local: `src-tauri/src/lib.rs` e
  `src-tauri/src/auth.rs`.
- Identidade do device: `src-tauri/src/device_identity.rs`.
- Resolução da instalação do After: `src-tauri/src/after_effects.rs`.
- Coordenação, segurança e recuperação da fila distribuída:
  `src-tauri/src/render_queue.rs`.
- Execução supervisionada do `aerender.exe`:
  `src-tauri/src/render_process.rs`.
- Painel da fila no Tauri:
  `src/features/renderQueue/RenderQueueWindow.jsx`.
- Render local preservado no CEP:
  `ARIZONA-EXTENSION/src/jsx/aeft/domains/render/renderQueue.ts`.
- Instalação/status do CEP: `src-tauri/src/cep_manager.rs`.
- Schema e segurança do backend: `ADMIN/supabase/migrations/` e
  `ADMIN/supabase/functions/`.
- Configuração da raiz do Drive: `src-tauri/src/settings.rs`.
- Regras de licenciamento:
  `docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.

O contrato Tauri/backend e a separação do CEP local também estão resumidos no
`AGENTS.md` da raiz e nos READMEs dos projetos envolvidos.
