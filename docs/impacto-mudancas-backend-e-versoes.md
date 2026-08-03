# Impacto de mudanças de backend e necessidade de nova versão

**Status:** regra operacional para mudanças futuras  
**Atualizado em:** 3 de agosto de 2026  
**Escopo:** Tauri, extensão CEP, Admin, Supabase Auth, banco e Edge Functions

Este documento define quando uma alteração central pode afetar todos os usuários
do Arizona App e quando é necessário distribuir uma nova versão do Tauri ou da
extensão CEP.

Ele complementa a
[arquitetura futura de atualizações independentes](./arquitetura-atualizacoes-independentes-tauri-cep.md).

## 1. Situação atual

As proteções administrativas implementadas em julho de 2026 são isoladas do
aplicativo distribuído:

- sessão do Admin limitada a 8 horas;
- bloqueio local do Admin depois de 30 minutos sem atividade;
- logout do Admin com revogação apenas da sessão administrativa atual;
- cabeçalhos de segurança do painel;
- validação de 8 horas nas Edge Functions quando o token apresenta autenticação
  Google OAuth;
- fluxo diário por TOTP do Tauri, preservado naquele momento.

Essas mudanças **não exigem uma nova versão do Tauri nem da extensão CEP**.
Também não encerram as sessões atuais dos usuários do aplicativo.

Em agosto de 2026 o autenticador TOTP foi removido do Arizona App e substituído
por confiança de máquina. O registro completo está na seção 8. A partir dessa
mudança:

- `validate-license` e `app-activate-device` não exigem mais AAL2 nem um AMR
  `totp` do ciclo do dia; a janela de login do Tauri é só de ativação, com
  e-mail e código de 12 caracteres;
- o Tauri envia `deviceFingerprintHash` e o backend trata divergência
  de hardware como `device_not_active`; o valor só é gravado por uma ativação
  respaldada por código, nunca por uma validação comum, e o device que não tem
  fingerprint gravado é recusado ("Reactivate this machine.") até reativar com
  código;
- vincular hardware exige a concessão de uso único emitida pelo consumo de um
  código de ativação (`device_bind_not_before` e `device_bind_expires_at` em
  `licensing.members`, validade de 30 minutos). Sem ela a resposta é
  `device_activation_expired` para uma instalação nova e `device_revoked` para
  uma instalação já liberada que tenta voltar sozinha;
- `requireRecentGoogleOAuth` exige sempre Google OAuth recente, sem
  fallback para TOTP;
- o papel de gestor saiu das Functions: `admin-add-member`,
  `admin-list-members` e `master-reset-member-totp` foram apagadas do projeto
  Supabase e do repositório em 03/08/2026, junto com `_shared/mfa-recovery.ts`,
  e as Functions `admin-*` restantes aceitam somente o master, com `forbidden`
  para qualquer outro ator.

O futuro controle de uma única sessão ativa do Admin também poderá ser
implementado sem nova versão do Tauri/CEP, desde que:

- use uma tabela aditiva exclusiva para sessões administrativas;
- seja validado somente nos fluxos Google OAuth do Admin;
- não utilize revogação global das outras sessões do usuário;
- não altere o contrato de autenticação do Tauri, hoje baseado em ativação por
  código e confiança de máquina.

## 2. Regra principal

Uma mudança no backend não exige automaticamente uma nova versão do aplicativo.
A decisão depende do contrato consumido pelo cliente.

- Se o backend continuar aceitando as requisições e tokens produzidos pelas
  versões instaladas, a mudança pode ser somente de backend.
- Se o cliente precisar enviar, ler, validar ou exibir algo novo para continuar
  funcionando, é necessária uma nova versão do componente consumidor.
- Mesmo sem exigir um novo instalador, uma mudança de backend pode ter efeito
  imediato sobre todos os usuários. Esse impacto precisa de plano de rollout e
  rollback.

## 3. Matriz de impacto

| Mudança | Pode afetar usuários já logados? | Nova versão Tauri? | Nova versão CEP? | Observação |
|---|---:|---:|---:|---|
| Interface, sessão ou cabeçalhos somente do Admin | Não | Não | Não | Publicar apenas Admin/Functions relacionadas |
| Sessão única somente do Admin, isolada por migration aditiva | Não | Não | Não | Um painel Admin anterior pode ser desconectado |
| Correção interna de Edge Function sem mudar contrato | Normalmente não | Não | Não | Testar com a versão distribuída atual |
| Alinhar a data limite da licença ao horário de renovação diária | Não deve interromper sessões antes do limite | Não | Não | Implementado em agosto de 2026; a data escolhida é o último dia completo válido |
| Remover a exigência de autenticador para o app | Sim, imediatamente e a favor do usuário | Não para deixar de pedir o TOTP | Não | Os clientes v2.1.1 param de pedir o autenticador assim que as Functions sobem |
| Passar a exigir identidade de hardware do device | Sim, imediatamente | Sim, para enviar o `deviceFingerprintHash` | Não | O fingerprint só é gravado por ativação com código; desde 03/08/2026 o device sem fingerprint gravado é recusado (`device_not_active`) e precisa reativar com código |
| Introduzir colunas novas que uma Function passa a ler ou gravar | Sim, imediatamente e contra o usuário, se a ordem for invertida | Depende | Não | Aplicar a migration, confirmar as colunas no PostgREST e só então publicar as Functions (seção 8) |
| Nova regra de licença aplicada pelo backend | Sim, imediatamente | Talvez | Talvez | Não exige release se os clientes atuais já entendem a resposta |
| Alterar timebox, inatividade ou sessão única global do Supabase Auth | Sim | Normalmente não | Indiretamente | Pode forçar novo login ou revogar sessões sem trocar o binário |
| Desativar um método de login usado pelo Tauri | Sim | Provavelmente | Não diretamente | Preparar versão compatível antes da mudança; desligar o MFA do Supabase Auth já é permitido desde 03/08/2026 — nada mais o utiliza, com a v2.1.1 bloqueada na validação |
| Alterar campos obrigatórios de request/response das Functions | Sim | Sim | Somente se consumir o contrato | Manter compatibilidade durante a transição |
| Migration aditiva, sem mudar respostas existentes | Não | Não | Não | Colunas/tabelas novas devem aceitar clientes antigos |
| Migration destrutiva ou mudança de semântica | Sim | Sim | Talvez | Exige rollout compatível e rollback |
| Ativar exigência de SSL no acesso direto ao banco | Não para o app, se ele usar apenas APIs | Não | Não | Validar integrações operacionais e Edge Functions |
| Restringir IPs de acesso direto ao banco | Não para o app, se ele usar apenas APIs | Não | Não | Pode bloquear ferramentas administrativas ou serviços externos |
| Rotacionar segredo usado apenas pelas Edge Functions | Pode haver falha durante o rollout | Não | Não | Publicar de forma coordenada e manter rollback |
| Rotacionar chave que o CEP valida localmente | Sim | Talvez | Sim, primeiro | O CEP precisa confiar na nova chave antes de ela assinar recibos |
| Alterar protocolo ou assinatura do recibo CEP | Sim | Sim | Sim | Release coordenada e período de compatibilidade |
| Corrigir apenas a interface ou comportamento interno do CEP | Não no Tauri | Não | Sim | Pode ser uma atualização independente do CEP |
| Corrigir apenas comportamento local do Tauri | Não no CEP, se o contrato não mudar | Sim | Não | Pode ser uma atualização independente do Tauri |

## 4. Casos que podem atingir todos sem nova versão

Algumas mudanças são distribuídas pelo servidor e, portanto, entram em vigor sem
que o usuário instale outro binário:

### 4.1 Configurações globais do Supabase Auth

Timebox, inatividade, sessão única global, expiração ou revogação de refresh
tokens podem desconectar usuários atuais. Tecnicamente, uma nova versão não é
obrigatória se o Tauri já tratar a sessão inválida e oferecer novo login.

Mesmo assim, essas configurações não devem ser alteradas diretamente em
produção. Antes é necessário:

1. confirmar que o Tauri atual recupera corretamente `401`, token expirado e
   refresh token revogado;
2. testar com master, gestor e usuário comum;
3. verificar a consequência sobre o recibo CEP;
4. definir horário, aviso aos usuários e rollback;
5. aplicar primeiro em um ambiente ou conta de teste.

### 4.2 Regras de licença e Edge Functions

Uma nova validação publicada no backend pode bloquear imediatamente todas as
versões instaladas. Não exige nova versão quando o request e a resposta
continuam compatíveis, mas exige teste explícito com a versão que está em
produção.

### 4.3 Banco, SSL e restrição de rede

O Tauri e o CEP não acessam o PostgreSQL diretamente; eles usam Supabase Auth,
Edge Functions e o contrato de licença. Por isso, ativar SSL obrigatório ou
restringir os IPs do banco normalmente não pede uma nova versão do aplicativo.

O risco está nas conexões operacionais: CLI, scripts, integrações ou serviços que
acessem o banco diretamente. A mudança deve ser feita separadamente, depois de
inventariar e testar essas conexões.

### 4.4 Data limite da licença no horário da renovação diária

**Implementado em agosto de 2026.**

A data limite escolhida no Admin representa o **último dia completo de
validade**. A licença expira no início do ciclo seguinte, usando
`daily_auth_reset_hour` em `America/Sao_Paulo`.

Exemplo:

```text
Data limite: 29/07/2026
Renovação diária: 04:00
Expiração efetiva: 30/07/2026 às 04:00 em America/Sao_Paulo
```

A regra é única e compartilhada: o helper `licenseExpiryInstant`, em
`ADMIN/supabase/functions/_shared/auth-cycle.ts`, substituiu os cálculos
duplicados em `23:59:59.999Z`. Ele é usado por todos os caminhos do backend que
consultam `license_expires_on`:

- validação e renovação da licença (`validate-license`);
- primeiro acesso e ativação (`app-activate`);
- recuperação ou ativação de dispositivo (`app-activate-device`);
- emissão de código de ativação (`admin-generate-activation-code`);
- telemetria com licença vigente (`track-event`).

A sessão de licença e o recibo CEP continuam vencendo no primeiro limite
aplicável: TTL próprio, próxima renovação diária ou expiração efetiva da
licença.

O ajuste é compatível com o contrato de erro `license_expired` e, por isso,
**não exigiu nova versão do Tauri nem da extensão CEP**: ele entrou em vigor
com o deploy das Edge Functions, inclusive para os clientes v2.1.1 já
instalados.

Como o comportamento anterior encerrava a validade em `23:59:59.999 UTC`, a
mudança estende a validade das licenças existentes. Considerando o fuso atual de
São Paulo, a extensão é de aproximadamente 3 a 26 horas, conforme o horário de
renovação configurado. Ela não antecipa o vencimento em nenhum dos horários
cobertos pelos testes de `ADMIN/tests/auth-cycle.test.mjs`.

O bloqueio é simultâneo nos dois consumidores: o Tauri percebe na próxima
verificação de 30 segundos e o recibo CEP já carrega esse limite na assinatura,
sendo relido pelo painel a cada 5 segundos. Como o prazo viaja dentro do recibo
e da sessão local, o bloqueio também acontece offline.

Alterar `daily_auth_reset_hour` também muda o instante efetivo de expiração de
uma licença com data limite definida. O campo **Validade** no Admin traz essa
relação no seu `title`, mas a consequência precisa ser confirmada com o cliente
antes de salvar a alteração.

## 5. Casos que exigem nova versão

Uma nova versão é obrigatória quando:

- o Tauri precisa produzir outro formato de autenticação ou request;
- o Tauri precisa interpretar um novo erro para não ficar preso em um fluxo;
- a forma de armazenar, renovar ou invalidar a sessão local muda;
- o protocolo do recibo muda de forma incompatível;
- a chave pública embutida no CEP precisa ser atualizada;
- o CEP precisa aceitar novos claims obrigatórios;
- uma função deixa de aceitar o contrato usado pela versão instalada;
- a correção depende de código local, e não apenas do backend.

Quando o contrato envolver Tauri e CEP, seguir a ordem compatível documentada:
atualizar primeiro o consumidor para aceitar os formatos antigo e novo e só
depois alterar o produtor.

## 6. Registro obrigatório antes de mudanças globais

Toda mudança capaz de atingir os usuários do aplicativo deve registrar:

- data e responsável;
- componentes alterados;
- versões Tauri e CEP atualmente distribuídas;
- usuários e sessões potencialmente afetados;
- compatibilidade com a versão em produção;
- necessidade ou não de novo instalador;
- comportamento esperado para quem já está logado;
- testes executados;
- plano de rollout;
- plano de rollback;
- necessidade de comunicação ao cliente.

Modelo:

```text
Mudança:
Componentes:
Impacto sobre sessões existentes:
Compatível com Tauri:
Compatível com CEP:
Nova versão necessária:
Testes:
Rollout:
Rollback:
Comunicação:
```

## 7. Decisão para os próximos ajustes

- Não ativar limites globais de sessão do Supabase para resolver uma necessidade
  exclusiva do Admin.
- Implementar sessão única do Admin somente com estado e validação isolados.
- `license_expires_on` já está alinhado ao início do ciclo posterior ao último
  dia válido, usando o horário de renovação diária da licença (seção 4.4).
- Tratar SSL obrigatório e restrição de rede como uma mudança operacional
  separada.
- Antes de qualquer regra nova nas Functions compartilhadas, testar a versão
  atual do Tauri e validar o recibo consumido pelo CEP.
- Se o teste revelar que o aplicativo atual não se recupera corretamente de uma
  sessão revogada, corrigir e distribuir o Tauri antes da alteração global.
- O `deviceFingerprintHash` vazio é recusado em todos os caminhos.
  `validate-license` devolve `device_not_active` tanto para a requisição sem
  fingerprint ("Update the app to continue.", o que a v2.1.1 sempre envia)
  quanto para o device sem valor gravado ("Reactivate this machine.").
  `app-activate-device` recusa a máquina que não se identifica com
  `device_identity_required` **antes** de gastar a concessão, e o cliente 2.2.0
  falha localmente com esse mesmo código, sem consumir código de ativação nem
  chamar a rede, quando o `MachineGuid` não pode ser lido. Não existe mais
  gravação deliberada de fingerprint vazio.
- Nada segue adiado nesse tema: desde 03/08/2026 a exigência de fingerprint
  vale para a frota inteira, inclusive para o device que nunca gravou um, e
  desligar o MFA do Supabase Auth virou uma limpeza opcional — nenhum fluxo o
  utiliza.

## 8. Registro de mudanças

### 3 de agosto de 2026 — remoção do autenticador e confiança de máquina

#### Ordem de rollout — cumprida em 03/08/2026

Esta mudança deixou de ser somente de Functions. A ordem abaixo foi seguida no
deploy de 03/08/2026 e continua obrigatória para qualquer republicação:

1. aplicar as migrations
   `ADMIN/supabase/migrations/20260803120000_device_bind_grant.sql` e
   `ADMIN/supabase/migrations/20260803130000_paused_org_member_management.sql`
   — **EXECUTADAS em 03/08/2026**;
2. confirmar que `device_bind_not_before` e `device_bind_expires_at` já
   aparecem pelo PostgREST — o cache de schema dele fica alguns segundos atrás
   do DDL, e é esse intervalo que engana quem confere só pelo SQL editor;
3. somente então publicar as Edge Functions — **PUBLICADAS em 03/08/2026**: 14
   Functions ativas, e `admin-add-member`, `admin-list-members` e
   `master-reset-member-totp` **apagadas** do projeto e do repositório, junto
   com `_shared/mfa-recovery.ts`;
4. somente então distribuir o build 2.2.0 do Tauri — **etapa humana restante**.

**Publicar as Edge Functions antes da migration quebra todas as ativações e
todas as recuperações, para todo mundo, imediatamente.** `app-activate` grava
as duas colunas novas no mesmo UPDATE que vincula o membro; sem elas o
PostgREST responde `PGRST204`, o rollback devolve o código de ativação e o
usuário recebe `503 activation_unavailable`. `app-activate-device` lê as mesmas
colunas logo no início e falha com `500 internal_error`. Não é degradação
parcial nem intermitente: enquanto a migration não estiver aplicada, ninguém
ativa nem recupera máquina. Quem já está logado continua validando, porque
`validate-license` não toca nessas colunas.

#### Concessão de vínculo de máquina (device bind grant)

Consumir um código de ativação é o que dá o direito de vincular hardware, e é a
única coisa que dá. `app-activate` grava a concessão em `licensing.members`
(`device_bind_not_before` e `device_bind_expires_at`); `app-activate-device`
exige que a sessão que a apresenta tenha sido criada em ou depois de
`device_bind_not_before`, de modo que uma credencial copiada não consiga pegar
carona na ativação alheia. A concessão é de uso único: ela é gasta por um
UPDATE condicional à expiração que foi lida, **antes** de o device ser gravado
— quem apagar primeiro leva o vínculo, e a segunda chamada é recusada. Se a
gravação do device falhar depois disso, a concessão é restaurada, para que um
erro transitório não custe um código ao usuário; se a própria ativação falhar,
o rollback de `app-activate` apaga a concessão junto com o código, para não
deixar nada gastável para trás. O prazo é de 30 minutos
(`DEVICE_BIND_GRANT_TTL_MINUTES` em `_shared/device-bind-grant.ts`): sem
cadastro de autenticador no fluxo, a janela só precisa cobrir uma ativação
abandonada entre o código e a primeira abertura do app, e fica bem acima dos
timeouts do cliente e do ritmo humano de nova tentativa.

Revogar um device também anula a concessão que ainda não foi gasta.
`admin-release-device`, `app-release-device` e `admin-remove-member`
chamam `clearDeviceBindGrant` logo depois de revogar
o device e as sessões, porque o portão de reativação de uma instalação liberada
aceita a concessão como autoridade: sem essa limpeza, a máquina recém-liberada
gastaria uma concessão pendente e retomaria o próprio lugar em silêncio, por até
30 minutos depois de o administrador liberá-la. Só um código consumido **depois**
da liberação a traz de volta.

A liberação feita pelo próprio app ("Liberar e sair") passou a enviar o
`installId` junto com o `source`. `app-release-device` recusa com `403
device_not_active`, registrando `device.self_release_rejected` na auditoria, a
liberação pedida por uma instalação que não é a dona do lugar. A checagem só
vale de fato com a frota na 2.2.0: a v2.1.1 não envia o campo e continua sendo
aceita, assim como a liberação disparada pelo desinstalador.

#### O vínculo de máquina vale para a frota inteira desde o primeiro dia

O `device_fingerprint_hash` passou a ser gravado **exclusivamente** por uma
ativação respaldada por código. `validate-license` não grava mais fingerprint
nenhum, e `app-activate-device` só grava quando a concessão de vínculo está
presente. Isso fecha o buraco em que o primeiro que enviasse um valor não vazio
— inclusive uma credencial copiada — reivindicava a máquina e trancava o dono
para fora do próprio lugar.

A consequência precisa ser dita sem eufemismo: **o servidor força a rodada de
reativação.** `validate-license` recusa também o device que não tem fingerprint
gravado — `403 device_not_active`, "Reactivate this machine.", auditoria
`device.fingerprint_mismatch` com `outcome: "unbound"` — e recusa toda
validação que chega sem fingerprint ("Update the app to continue.", o caso da
v2.1.1, que nunca envia o campo). Distribuir a 2.2.0 não vincula ninguém
sozinho: cada máquina que estava em campo precisa passar por **uma** ativação
respaldada por código na 2.2.0, e é essa ativação que grava o fingerprint. Na
prática, cada usuário recebe um código de ativação novo junto com o instalador.
Para um usuário já ativo, o código emitido é de recuperação e o próprio consumo
revoga o device atual, então a liberação manual no painel é conveniência, não
requisito.

Uma máquina que não consegue ler o próprio `MachineGuid` não gasta código: o
cliente 2.2.0 falha localmente com `device_identity_required` antes de consumir
o código ou chamar a rede, e `app-activate-device` repete a mesma recusa antes
de gastar a concessão, então o código sobrevive para nova tentativa depois da
correção.

#### Clientes anteriores à 2.2.0

A v2.1.1 está aposentada e bloqueada no backend: ela nunca envia o
`deviceFingerprintHash` e toda validação dela falha com `device_not_active`
("Update the app to continue."). O usuário precisa instalar a 2.2.0. Ativar na
2.1.1 consome o código e falha do mesmo jeito, então o suporte só deve entregar
um código **depois** que a versão nova estiver instalada.

Sem concessão de vínculo, `app-activate-device` responde
`device_activation_expired` a uma instalação que nunca foi cadastrada — a 2.2.0
reabre a janela de ativação e mostra "Esta sessão é antiga demais para
cadastrar a máquina. Solicite um novo código de ativação." — e `device_revoked`
a uma instalação já liberada que tenta voltar sozinha.

O suporte precisa saber disso: `device_revoked` pode significar apenas "essa
instalação não tem mais direito de cadastrar a máquina".
Leia sempre como **"peça um código novo"**, e não como "o administrador
liberou este device" — a auditoria em `licensing.audit_log` é quem diz qual dos
dois aconteceu de verdade.

```text
Mudança:
Remoção do autenticador TOTP do Arizona App, substituído por confiança de
máquina, com vínculo obrigatório para a frota inteira desde o primeiro dia;
concessão de uso único (30 minutos) para vincular hardware, emitida pelo
consumo do código de ativação; expiração da licença movida para a hora da
renovação diária do dia seguinte a license_expires_on; suspensão ('paused')
deixa de bloquear a gestão do master; track-event recusa licença pausada ou
expirada; Gestão removida do Tauri; Functions de TOTP e de membro apagadas.

Componentes:
Migrations EXECUTADAS em 03/08/2026: 20260803120000_device_bind_grant.sql
(colunas aditivas device_bind_not_before e device_bind_expires_at em
licensing.members) e 20260803130000_paused_org_member_management.sql (o
trigger de assentos deixa de barrar o estado 'paused'). Edge Functions
PUBLICADAS em 03/08/2026 (14 ativas): validate-license, app-activate-device,
app-activate, app-set-password, app-release-device, track-event,
admin-generate-activation-code, admin-release-device, admin-remove-member,
master-create-organization, master-get-license, master-set-organization-status,
master-list-audit-log e master-reset-member-rate-limits. Functions APAGADAS do
projeto e do repositório: admin-add-member, admin-list-members e
master-reset-member-totp, junto com _shared/mfa-recovery.ts. Compartilhados:
_shared/auth-cycle.ts (helper licenseExpiryInstant), _shared/auth-assurance.ts,
_shared/security.ts e os novos _shared/device-fingerprint.ts e
_shared/device-bind-grant.ts. Cliente Tauri 2.2.0
(src-tauri/src/device_identity.rs, auth.rs, lib.rs) e frontend do app (janela
de login, remoção da janela de Gestão, de adminApi.js e dos cinco comandos
admin_*); rótulo "Validade" no painel Admin.

Impacto sobre sessões existentes:
O prompt diário do autenticador deixa de aparecer e a validade das licenças
vigentes é estendida entre 3 e 26 horas, conforme o horário de renovação. O
vínculo de máquina passa a valer para a frota inteira: a v2.1.1 nunca envia o
fingerprint e falha na próxima validação com device_not_active ("Update the
app to continue."), e um device sem fingerprint gravado é recusado com
device_not_active ("Reactivate this machine."), mesmo na 2.2.0. Na prática,
toda a frota fica bloqueada até instalar a 2.2.0 e reativar com um código
novo; a credencial guardada não é apagada por esses erros. O gestor que usava
a Gestão dentro do Tauri perde essa capacidade: as Functions admin-* aceitam
somente o master. Masters não são afetados, pois já usavam o painel web com
Google OAuth.

Compatível com Tauri:
Somente com a 2.2.0, que envia o deviceFingerprintHash e o installId, entende
device_activation_expired e falha localmente com device_identity_required
quando o MachineGuid não pode ser lido, sem consumir código. A v2.1.1 está
bloqueada: toda validação dela devolve device_not_active, e ativar nela
consome o código e falha do mesmo jeito.

Compatível com CEP:
Sim. O contrato do recibo não mudou; apenas o instante de expiração passa a
seguir a nova regra, dentro do mesmo campo assinado.

Nova versão necessária:
Sim, para todos: a 2.2.0 é obrigatória. É ela que envia o fingerprint de
hardware, entende device_activation_expired e retirou a Gestão da interface.
As migrations são pré-requisito das Functions, não do cliente.

Testes:
48 testes em ADMIN, 34 em src-tauri e 6 no frontend do app, além dos builds
Vite do app e do ADMIN. Todos passando antes do deploy.

Rollout:
Etapas 1 a 3 EXECUTADAS em 03/08/2026: migrations
20260803120000_device_bind_grant.sql e
20260803130000_paused_org_member_management.sql aplicadas, colunas confirmadas
pelo PostgREST e as 14 Edge Functions publicadas, com admin-add-member,
admin-list-members e master-reset-member-totp apagadas. Etapas humanas
restantes:
1. Distribuir o instalador 2.2.0 do Tauri.
2. Emitir um código de ativação por usuário: a frota inteira precisa reativar —
   a v2.1.1 está bloqueada e os devices sem fingerprint gravado são recusados.
   Entregar o código somente depois que a 2.2.0 estiver instalada na máquina.
3. Opcional: desligar o MFA no painel do Supabase Auth — nada mais o utiliza.

Rollback:
Reverter agora exige duas coisas: republicar as Edge Functions anteriores a
partir do git E redistribuir o cliente anterior — o 2.2.0 não sabe apresentar
TOTP e, contra as Functions antigas, exibe "Backend desatualizado — contate o
suporte". As migrations não precisam de rollback: as duas colunas são aditivas
e nenhuma Function antiga as enxerga, e a mudança do trigger só deixa de barrar
o estado 'paused' — comportamento compatível com as Functions antigas. Qualquer
device_fingerprint_hash já gravado é inofensivo para as Functions antigas, que
apenas o sobrescrevem. As três Functions apagadas também teriam de ser
republicadas a partir do git se o comportamento antigo delas fizer falta.

Comunicação:
Avisar os usuários de que o autenticador não será mais pedido, de que a
atualização para a 2.2.0 é obrigatória e de que cada um receberá um código de
ativação novo para reativar a própria máquina. Avisar o suporte de que
device_revoked e device_activation_expired significam "peça um código novo" e
de que o código só deve ser entregue com a 2.2.0 já instalada. Avisar
individualmente os gestores que usavam a Gestão dentro do Tauri de que essa
tela saiu e que os pedidos passam pelo master no painel Admin.
```
