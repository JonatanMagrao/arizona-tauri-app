# Ações manuais de segurança

Última revisão: 03/08/2026

O hardening que depende somente do repositório já está implementado. Este
arquivo contém apenas ações que exigem acesso ao projeto Supabase, decisão
operacional, certificado externo ou o build final que o responsável pelo
projeto preferiu executar localmente.

## Publicação concluída no Supabase

Em 23/07/2026, foram aplicadas no projeto `nizchnscqkixawqxrwzd`:

- `20260723170000_add_daily_auth_reset_hour.sql`;
- `20260723210000_security_activation_mfa.sql`;
- as 13 Edge Functions versionadas no repositório.

O histórico remoto ficou em paridade com as migrations locais e todas as
Functions foram confirmadas com status `ACTIVE`, incluindo `app-activate`,
`app-activate-device`, `admin-generate-activation-code`, `app-release-device`,
`validate-license` e a versão encerrada com HTTP 410 de `app-set-password`.

O deploy usou `--use-api --no-verify-jwt`, sem Docker ou Deno local. O
`--no-verify-jwt` é intencional: as Functions validam publishable key, JWT,
ator, papel, frescor da autenticação e horário dentro do código. Nenhum secret
de assinatura foi alterado.

### Executado em 03/08/2026: confiança de máquina

Em 03/08/2026 foram aplicadas as migrations
`20260803120000_device_bind_grant.sql` (colunas `device_bind_not_before` e
`device_bind_expires_at` em `licensing.members`) e
`20260803130000_paused_org_member_management.sql` (o trigger de assentos deixa
de barrar o estado `paused`), e as 14 Edge Functions do repositório foram
publicadas. Três Functions foram apagadas do projeto e do repositório —
`admin-add-member`, `admin-list-members` e `master-reset-member-totp` —, junto
com `_shared/mfa-recovery.ts`. A ordem obrigatória — migration, colunas
visíveis pelo PostgREST (o cache de schema atrasa alguns segundos depois do
DDL), só então as Functions — foi cumprida e continua valendo para qualquer
republicação futura: publicar as Functions sem as colunas derruba toda ativação
e toda recuperação (`app-activate` devolve `503 activation_unavailable` e
`app-activate-device` falha com `500 internal_error`). Os detalhes estão em
`docs/impacto-mudancas-backend-e-versoes.md`, seção 8.

## 2. Conferir Auth no Dashboard do Supabase

Em Authentication:

- desabilitar cadastro público de usuários;
- manter o provedor de e-mail disponível apenas para o master existente;
- desligar o TOTP em MFA é opcional e está liberado desde 03/08/2026: o
  backend não consulta fatores, o cliente 2.2.0 não cadastra nada e a v2.1.1 —
  que cadastrava o fator sozinha durante a ativação — está bloqueada na
  validação;
- manter rotação de refresh token ligada;
- habilitar proteção contra senhas vazadas, se a opção estiver disponível no
  plano;
- revisar URLs de redirecionamento e remover qualquer `arizona://`.

O fluxo de usuários finais não usa SMTP, e-mail transacional, Google OAuth ou
serviço adicional. O código é entregue diretamente ao usuário. O Google OAuth
existe apenas para o master entrar no painel Admin web, e hoje é o único
caminho aceito para ele.

## 3. Vincular masters explicitamente

Todo master precisa ter `auth_user_id`; não há mais vínculo automático por
e-mail em runtime:

```sql
insert into licensing.master_accounts (email, auth_user_id, status)
select email, id, 'active'
from auth.users
where id = '<UUID_DO_USUARIO_AUTH>'::uuid
on conflict (email) do update
set
  auth_user_id = excluded.auth_user_id,
  status = 'active',
  updated_at = now();
```

Cada master entra no painel Admin pelo Google OAuth; o backend exige sempre um
OAuth recente, sem fallback para TOTP. A sessão fica em `sessionStorage`:
sobrevive a recarregamentos na mesma aba e é removida ao sair ou fechar a aba.

## 4. Agendar retenção

A migration cria `licensing.purge_operational_data()`, mas o agendamento depende
de `pg_cron` estar habilitado no projeto. Depois de habilitar a extensão no
Supabase, execute uma vez:

```sql
select cron.schedule(
  'arizona-purge-operational-data',
  '17 4 * * *',
  $$select licensing.purge_operational_data();$$
);
```

O padrão preserva sessões revogadas por 14 dias, auditoria de relógio por 30
dias, eventos e códigos por 90 dias e rate limits por 2 dias.

## 5. Conferir controles do projeto em produção

No Dashboard:

- confirmar backups automáticos e testar uma restauração;
- avaliar PITR conforme a necessidade da empresa;
- exigir SSL nas conexões do banco;
- restringir acesso de rede ao banco quando a operação permitir;
- ativar alertas de uso, custo, erros de Auth e Edge Functions;
- revisar periodicamente `audit_log`, tentativas limitadas e devices revogados.

Essas opções são estado do projeto remoto e não podem ser comprovadas pelo
repositório local.

## 6. Teste coordenado antes da distribuição

1. Aplicar a migration em um ambiente de teste, confirmar as colunas novas pelo
   PostgREST e só então publicar as Functions, nessa ordem.
2. Entrar como master no painel Admin web pelo Google OAuth.
3. Criar um usuário e emitir o código.
4. Copiar o código com o botão `file_copy`.
5. Ativar o Tauri com e-mail + código de 12 caracteres e confirmar que nenhum
   autenticador é pedido, nem na ativação nem nos dias seguintes.
6. Confirmar que reutilizar ou errar o código falha.
7. Liberar o device pelo master e verificar que o Tauri bloqueia na próxima
   validação e que o CEP perde o recibo em até 15 minutos.
8. Emitir código de recuperação e confirmar que ele revoga o device e as
   sessões antigas somente quando for consumido, e que a máquina é registrada
   apenas dentro da janela de recuperação configurada.
9. Copiar o registro do Windows Credential Manager para outra máquina e
   confirmar que a validação devolve `device_not_active`, com
   `device.fingerprint_mismatch` gravado em `licensing.audit_log`. O teste vale
   para qualquer device: se ele já gravou fingerprint (ativação com código na
   2.2.0), a divergência é recusada; se ainda não gravou, a validação é
   recusada com "Reactivate this machine." (`outcome: "unbound"`) até uma
   ativação com código — o vínculo de máquina vale para a frota inteira.
10. Confirmar que a concessão de vínculo é de uso único: depois de cadastrar a
    máquina com o código, liberar o device pelo painel e tentar cadastrar outra
    máquina reaproveitando a mesma sessão. A resposta esperada é
    `device_activation_expired`, porque a concessão já foi gasta e a liberação
    anula qualquer resto; a instalação liberada que tenta voltar sozinha recebe
    `device_revoked`. Com o primeiro device ainda ativo, a resposta correta é
    `device_limit_reached`.
11. Confirmar que uma licença com data limite no dia anterior só bloqueia na
    hora da renovação diária, e não à meia-noite UTC.
12. Testar `npm run tauri:dev`.
13. Gerar o bundle final com o fluxo de build do responsável pelo projeto.

## Decisões mantidas fora do escopo

- assinatura do EXE/NSIS e do ZXP foi adiada por decisão do responsável;
- SMTP próprio não será adicionado; o Google OAuth acabou sendo adotado, mas
  somente para o login do master no painel Admin web;
- exigir `deviceFingerprintHash` de todo mundo deixou de ser adiado: desde
  03/08/2026 a validação recusa tanto a requisição sem fingerprint ("Update
  the app to continue.", o que a v2.1.1 sempre envia) quanto o device sem
  valor gravado ("Reactivate this machine."), e o fingerprint continua sendo
  gravado apenas por ativação com código — a validação comum não grava nada.
  Desabilitar o MFA no Supabase Auth virou opcional: nada mais o utiliza;
- as flags locais usadas pelo NSIS para logout/liberação permanecem como risco
  local baixo: um processo executando na mesma conta Windows já consegue
  apagar a credencial dessa conta. A liberação remota é best effort e nunca
  pode travar a desinstalação.
