# Arquitetura proposta — fila distribuída de render

**Estado:** proposta, ainda não implementada  
**Última revisão:** 2026-08-06  
**Escopo:** Arizona App (Tauri), extensão CEP, Supabase e Google Drive compartilhado

## 1. Objetivo

Permitir que um usuário envie um projeto do After Effects para uma fila da
organização e que outra máquina, disponibilizada voluntariamente pelo seu dono,
execute somente o render MOV/MP4 enquanto estiver ociosa.

Esse recurso não dá acesso remoto ao desktop da outra pessoa e não transfere a
sessão de um usuário para outro. Cada máquina continua autenticada com seu
próprio membro e device. Ela apenas oferece capacidade de render para jobs da
mesma organização.

## 2. Premissas confirmadas

- As máquinas usam o mesmo Google Drive compartilhado.
- O `.aep` e as mídias necessárias ficam nesse Drive.
- Fontes, plug-ins, codecs e presets necessários são padronizados nas máquinas.
- O fluxo oficial continua gerando as comps `EXPORT` e `EXPORT_MP4`.
- A máquina só participa depois de o dono escolher **Disponível para render**.
- O primeiro release deve executar no máximo um job por máquina.
- Supabase é o plano de controle; arquivos grandes não passam pelo Realtime.

## 3. Decisão central

```text
CEP da máquina solicitante
  └── prepara e salva o projeto
        └── cria snapshot imutável do .aep
              └── entrega manifesto local ao Tauri
                    └── Tauri cria job no Supabase
                          └── Realtime avisa que a fila mudou
                                └── Tauri disponível verifica o Google Drive
                                      └── compara SHA-256 do snapshot
                                            └── reivindica o job
                                                  └── executa aerender.exe
                                                        └── publica progresso e resultado
```

O CEP é responsável pelo contexto do projeto aberto. O Tauri é responsável por
autenticação, fila, disponibilidade da máquina e processo `aerender.exe`. O
Supabase mantém o estado durável e coordena quem possui cada job.

Realtime é somente um aviso de baixa latência. Se um evento for perdido, polling
periódico precisa reencontrar o job no banco.

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

1. O CEP valida as comps e salva o projeto atual.
2. O Tauri copia o `.aep` salvo para um nome temporário exclusivo do job.
3. O Tauri fecha o arquivo temporário e calcula SHA-256 lendo todos os bytes.
4. Confere que tamanho e data não mudaram durante a leitura.
5. Renomeia o temporário para o nome final do snapshot.
6. Cria o job no Supabase com caminho relativo, tamanho e SHA-256 esperado.
7. A partir desse ponto o snapshot é somente leitura para o protocolo da fila.

O rename local evita que outro processo da mesma máquina veja uma cópia ainda
incompleta. Ele não substitui a validação de hash na máquina remota.

Exemplo conceitual do manifesto:

```json
{
  "schemaVersion": 1,
  "jobId": "uuid",
  "driveRootId": "carrefour-drive",
  "projectRelativePath": "CARREFOUR/.../.arizona-render/uuid/projeto.aep",
  "projectSizeBytes": 4829137,
  "projectSha256": "hex-minusculo",
  "outputs": [
    { "kind": "mov", "comp": "EXPORT" },
    { "kind": "mp4", "comp": "EXPORT_MP4", "recipe": "arizona-mp4-v1" }
  ],
  "createdAt": "2026-08-06T12:00:00Z"
}
```

### 4.4 Verificação na máquina candidata

Ao receber aviso de job:

1. O Tauri reconstrói o caminho usando sua raiz local configurada do Drive.
2. Canonicaliza o caminho e confirma que ele continua dentro dessa raiz.
3. Se o arquivo não existir, mantém `waiting_for_sync`.
4. Se for placeholder ou ainda não estiver hidratado, a leitura completa deve
   solicitar a hidratação; erros transitórios voltam para espera.
5. Compara primeiro o tamanho, como filtro rápido.
6. Calcula o SHA-256 completo.
7. Só chama o claim atômico quando o hash observado for igual ao esperado.
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

Um backoff simples pode começar em poucos segundos e crescer até um teto. Um
evento Realtime novo pode antecipar a próxima tentativa, mas não elimina o
polling.

### 4.5 O Supabase faz a comparação; as máquinas não conversam diretamente

A máquina de origem grava o hash esperado no job. Cada candidata calcula o hash
que enxerga localmente e envia esse valor ao endpoint de claim. A RPC só entrega
o job se:

- o job ainda estiver livre;
- solicitante e worker pertencerem à mesma organização;
- o worker estiver disponível e licenciado;
- o hash informado for igual ao hash esperado;
- os requisitos do job forem compatíveis com o worker.

Isso evita conexão direta entre estações e funciona mesmo se uma delas ficar
offline depois de criar o job.

### 4.6 Teste manual do princípio

Antes de implementar a fila, o protocolo pode ser provado com um snapshot real.
Depois de o Drive sincronizar, execute nas duas máquinas:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "I:\caminho\snapshot.aep"
```

Hashes iguais significam que o conteúdo local é byte a byte igual. Esse teste
não substitui o fluxo automático, mas valida a premissa principal.

## 5. Responsabilidades por projeto

### 5.1 Extensão CEP

- Validar que há exatamente uma comp `EXPORT` e uma `EXPORT_MP4`.
- Salvar o projeto antes da submissão.
- Produzir apenas um manifesto declarativo e versionado.
- Mostrar fila, sincronização, progresso, conclusão e falha.
- Nunca receber access token ou refresh token do Supabase.
- Nunca enviar JSX, executável ou argumentos livres para outra máquina.

O CEP atual já prepara um plano contendo projeto, comps e saídas, e já inicia
`aerender.exe` localmente. Esse comportamento serve de referência para o
contrato, mas o worker permanente não deve depender de React ou de o painel
estar aberto.

### 5.2 Tauri da máquina solicitante

- Consumir o pedido local do CEP.
- Validar licença, organização e caminhos permitidos.
- Criar e hashear o snapshot.
- Chamar a Edge Function que cria o job.
- Receber atualizações e materializar um estado local para o CEP.

Hoje o único contrato Tauri → CEP é o recibo de licença. A implementação desta
proposta exige um novo contrato local explícito e documentado. Uma caixa de
entrada/saída versionada em `%LOCALAPPDATA%` é suficiente para o MVP e mantém os
tokens exclusivamente no Rust.

### 5.3 Tauri da máquina worker

- Manter o opt-in e o prazo de disponibilidade.
- Enviar heartbeat independente da WebView.
- Resolver o caminho relativo no Google Drive.
- Comparar tamanho e SHA-256.
- Reivindicar um único job por RPC atômica.
- Executar `aerender.exe` sem depender do After interativo já aberto.
- Capturar stdout, stderr, progresso, exit code e cancelamento.
- Renovar a lease durante preparação e render.
- Gravar cada tentativa em destino temporário exclusivo.
- Publicar a saída final somente se ainda possuir a lease vigente.

O worker deve rodar no tray, dentro da sessão gráfica do usuário. Não deve ser
um Windows Service em Session 0. Ao fechar a janela, o modo worker continua; a
ação **Sair** encerra de fato o processo.

### 5.4 Supabase

- Autenticar todos os endpoints pelo JWT mantido no Tauri.
- Confirmar membro, organização e device ativo.
- Persistir jobs e histórico.
- Fazer claim e conclusão de maneira atômica.
- Emitir Broadcast privado apenas com identificador e mudança de estado.
- Reencaminhar leases vencidas com limite de tentativas.
- Impedir acesso entre organizações.

## 6. Modelo de dados sugerido

As tabelas devem seguir o padrão atual do schema `licensing`: RLS forçada,
acesso direto revogado de `anon` e `authenticated`, e operações privilegiadas
somente por Edge Functions/RPCs internas.

### 6.1 `licensing.render_workers`

- `device_id` — PK/FK do device já licenciado;
- `enabled` — opt-in do dono;
- `availability` — `available`, `busy`, `draining` ou `disabled`;
- `available_until` — prazo opcional;
- `last_heartbeat_at`;
- `current_job_id`;
- `worker_protocol_version`;
- `render_recipe_version`;
- `capabilities` — inventário operacional;
- `updated_at`.

`offline` deve ser derivado da idade do heartbeat, nunca confiado como estado
declarado pelo cliente.

### 6.2 `licensing.render_jobs`

- `id`, `organization_id`, `requested_by_member_id` e
  `requested_by_device_id`;
- `schema_version` e `idempotency_key`;
- `project_relative_path`, `project_size_bytes` e `project_sha256`;
- comps e receitas permitidas;
- `status`, `priority` e `available_at`;
- `worker_device_id`;
- `lease_id`, `lease_generation` e `lease_expires_at`;
- `attempt_count` e `max_attempts`;
- progresso e etapa atual;
- pedido de cancelamento;
- erro sanitizado;
- timestamps.

Estados principais:

```text
waiting_for_sync
  └── queued
        └── claimed
              └── rendering
                    └── publishing
                          └── completed

Qualquer etapa ativa pode ir para cancelled, retry_wait ou failed.
```

### 6.3 `licensing.render_attempts`

- job, número da tentativa e device executor;
- `lease_generation` usada;
- início/fim, exit code e duração;
- caminhos temporários de saída;
- tamanho/hash dos resultados;
- resumo de erro e log sanitizado.

### 6.4 `licensing.render_job_events`

Histórico append-only para criação, sincronização, claim, início, progresso
relevante, cancelamento, retry, conclusão e falha.

## 7. Concorrência e recuperação

Realtime não pode decidir a posse do job. A RPC de claim deve usar transação e
`FOR UPDATE SKIP LOCKED`, garantindo no máximo um dono por vez.

Cada claim cria:

- uma `lease_id` aleatória;
- uma `lease_generation` monotônica;
- um prazo curto renovado pelo heartbeat.

A geração funciona como fencing token. Se o worker A perder a rede e a lease
expirar, o worker B poderá receber uma geração nova. Mesmo que A termine depois,
ele não terá autorização para publicar no destino final.

Saídas devem ser geradas em caminho exclusivo por tentativa, por exemplo:

```text
OUT\.arizona-render\<job-id>\<attempt-id>\video.mov
OUT\.arizona-render\<job-id>\<attempt-id>\video.mp4
```

Somente a tentativa que ainda possui a lease move/publica os arquivos para o
destino oficial. Isso evita duas máquinas sobrescreverem o mesmo MOV/MP4.

## 8. Disponibilidade voluntária

Fluxo recomendado para o dono da máquina:

1. Escolher **Disponível para render**.
2. Opcionalmente definir **até 14:00**, **até eu voltar** ou uma agenda.
3. O Tauri faz preflight e mostra `Apta`, `Degradada` ou `Indisponível`.
4. Ao detectar retorno do usuário ou receber **Parar de aceitar**, muda para
   `draining`.
5. Em `draining`, termina o job atual e não pega outro.
6. Uma ação separada permite cancelar o job atual quando realmente necessário.

A máquina precisa permanecer ligada, sem suspensão e com a sessão do Windows
ativa. Bloquear a tela deve ser validado em teste real; fazer logoff encerra os
processos do usuário.

## 9. Segurança

- Solicitante e worker usam suas próprias sessões e devices.
- Ambos precisam estar ativos na mesma organização.
- CEP não usa o recibo de licença como credencial genérica do Supabase.
- Chaves secretas permanecem somente nas Edge Functions.
- Jobs não aceitam JSX, executável, shell command ou argumento arbitrário.
- Comps, formatos e receitas são allowlists versionadas.
- Caminhos sempre são relativos e canonicalizados sob a raiz do Drive.
- Broadcast nunca carrega manifesto completo, caminho sensível ou token.
- Claim, heartbeat, cancelamento e conclusão revalidam autorização no backend.
- Logs remotos devem ser sanitizados e ter retenção definida.

## 10. Compatibilidade da receita de render

Embora a sincronização do `.aep` seja a comparação crítica, o worker ainda deve
anunciar um perfil operacional, por exemplo:

```text
workerProtocolVersion = 1
renderRecipeVersion = arizona-render-v1
afterEffectsYear = 2026
mp4Preset = Arizona_MP4_v1
```

Não é necessário bloquear toda versão que não seja a mais nova. O backend deve
aceitar versões comprovadamente compatíveis e bloquear somente uma combinação
incompatível ou conhecida como defeituosa.

O projeto já consegue ler a versão do app, listar anos instalados do After e
ler a versão instalada do CEP. A implementação precisa complementar isso com o
`aerender.exe` local, estado do Drive e revisão da receita.

## 11. Etapas de implementação

### Fase 0 — prova do Google Drive

- Criar snapshots manuais de projetos reais.
- Comparar SHA-256 em duas máquinas.
- Medir tempo até o hash ficar igual.
- Testar arquivo somente on-line, já hidratado e atualização concorrente.
- Confirmar que a cópia do `.aep` resolve todas as referências esperadas.

### Fase 1 — inventário e disponibilidade

- Adicionar modo tray e worker Rust independente da WebView.
- Implementar opt-in, `available_until`, heartbeat e `draining`.
- Mostrar no Tauri se Drive, After e receita estão aptos.
- Ainda sem executar jobs remotos.

### Fase 2 — snapshot e contrato CEP → Tauri

- Definir schemas versionados de pedido e status local.
- CEP salva/valida e grava o pedido de submissão.
- Tauri cria snapshot atômico, calcula hash e cria o job.
- CEP mostra `aguardando sincronização`.

### Fase 3 — backend da fila

- Criar migrations de workers, jobs, attempts e events.
- Criar Functions de disponibilidade, criação, lista, claim, heartbeat,
  conclusão, falha e cancelamento.
- Implementar RPCs internas com lease e fencing.
- Adicionar Broadcast privado e polling de reconciliação.

### Fase 4 — executor remoto

- Localizar o `aerender.exe` no worker.
- Verificar snapshot por hash.
- Executar uma saída por vez inicialmente.
- Capturar progresso, cancelamento e resultado.
- Publicar por tentativa e promover somente com lease válida.

### Fase 5 — resiliência e operação

- Retry com backoff e limite.
- Recuperação após reinício do Tauri.
- Tratamento de suspensão, logoff, Drive offline e licença revogada.
- Limpeza segura de snapshots e tentativas antigas.
- Auditoria, métricas operacionais e limites por usuário.

## 12. Cenários mínimos de teste

- O snapshot chega imediatamente à outra máquina.
- O `.aep` demora para sincronizar e o worker espera.
- O manifest/aviso chega antes do conteúdo do `.aep`.
- A origem continua editando o projeto depois de enfileirar.
- O caminho do Drive usa outra letra na máquina worker.
- O arquivo existe com mesmo tamanho, mas hash diferente.
- Duas máquinas tentam reivindicar simultaneamente.
- O worker perde a rede durante o render.
- A lease vence e outro worker tenta novamente.
- O worker antigo termina depois de perder a lease.
- O usuário volta e ativa `draining`.
- O Tauri reinicia durante `waiting_for_sync` e durante `rendering`.
- A saída final já existe.
- A organização ou device é revogado durante o job.

## 13. Fontes da verdade atuais

- Fronteiras entre projetos: `AGENTS.md`.
- Autenticação e sessão local: `src-tauri/src/lib.rs` e
  `src-tauri/src/auth.rs`.
- Identidade do device: `src-tauri/src/device_identity.rs`.
- Detecção e execução do After: `src-tauri/src/after_effects.rs`.
- Render atual no CEP:
  `ARIZONA-EXTENSION/src/jsx/aeft/domains/render/renderQueue.ts` e
  `ARIZONA-EXTENSION/src/js/main/domains/render/services/aerenderService.ts`.
- Instalação/status do CEP: `src-tauri/src/cep_manager.rs`.
- Schema e segurança do backend: `ADMIN/supabase/migrations/` e
  `ADMIN/supabase/functions/`.
- Configuração da raiz do Drive: `src-tauri/src/settings.rs`.
- Regras de licenciamento:
  `docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.

Ao implementar esta proposta, os contratos novos entre CEP e Tauri precisam ser
adicionados também ao `AGENTS.md` da raiz e aos READMEs dos projetos envolvidos.

