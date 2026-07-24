# Ações manuais de segurança

Última revisão: 23/07/2026

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
ator, papel, AAL2/TOTP e horário dentro do código. Nenhum secret de assinatura
foi alterado.

## 2. Conferir Auth no Dashboard do Supabase

Em Authentication:

- desabilitar cadastro público de usuários;
- manter o provedor de e-mail disponível apenas para o master existente;
- habilitar TOTP em MFA;
- manter rotação de refresh token ligada;
- habilitar proteção contra senhas vazadas, se a opção estiver disponível no
  plano;
- revisar URLs de redirecionamento e remover qualquer `arizona://`.

O fluxo de usuários finais não usa SMTP, e-mail transacional, Google OAuth ou
serviço adicional. O gestor entrega o código diretamente ao usuário. A senha
continua existindo apenas para o master do painel Admin.

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

Cada master deve entrar no painel Admin e cadastrar o TOTP. Fechar ou recarregar
o painel encerra a sessão porque os tokens ficam somente em memória.

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

1. Aplicar migration e Functions em um ambiente de teste.
2. Entrar como master e confirmar TOTP.
3. Criar um usuário e emitir o código.
4. Copiar o código com o botão `file_copy`.
5. Ativar o Tauri com e-mail + código e cadastrar TOTP.
6. Confirmar que reutilizar ou errar o código falha.
7. Liberar o device pelo gestor e verificar que o Tauri bloqueia na próxima
   validação e que o CEP perde o recibo em até 15 minutos.
8. Emitir código de recuperação e confirmar que ele revoga o device e as
   sessões antigas somente quando for consumido, preserva o fator TOTP
   verificado e aceita o código da mesma entrada `Arizona App` do autenticador.
   Um novo QR deve aparecer apenas se a conta não possuir fator verificado.
9. Testar `npm run tauri:dev`.
10. Gerar o bundle final com o fluxo de build do responsável pelo projeto.

## Decisões mantidas fora do escopo

- assinatura do EXE/NSIS e do ZXP foi adiada por decisão do responsável;
- Google OAuth e SMTP próprio não serão adicionados;
- as flags locais usadas pelo NSIS para logout/liberação permanecem como risco
  local baixo: um processo executando na mesma conta Windows já consegue
  apagar a credencial dessa conta. A liberação remota é best effort e nunca
  pode travar a desinstalação.
