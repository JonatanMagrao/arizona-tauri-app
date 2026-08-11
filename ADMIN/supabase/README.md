# Supabase cloud setup

Este projeto usa Supabase somente em cloud. Nao use `supabase start`, Docker local,
nem a conta antiga.

## Chaves permitidas

Use somente o modelo novo de API keys:

- `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_SECRET_KEYS`

Nao use `SUPABASE_ANON_KEY` nem `SUPABASE_SERVICE_ROLE_KEY`.

## Projeto atual

- Project ref: `nizchnscqkixawqxrwzd`
- Project name: `arizona`
- Region: South America (Sao Paulo)

## 1. Criar o projeto

Na nova conta Supabase, crie um projeto limpo e anote:

- Project ref
- Database password
- Project URL
- Publishable key
- Secret key

## 2. Login na conta nova

Crie um access token na conta nova e rode:

```powershell
npx supabase login --name arizona --token <SUPABASE_ACCESS_TOKEN>
```

Se comandos como `functions list` ou `db push` falharem com
`Unsupported Config Type ""`, confira `C:\Users\<usuario>\.supabase\profile`.
No Windows, o CLI pode salvar o token real no perfil `supabase`; nesse caso o
arquivo deve conter:

```text
supabase
```

## 3. Linkar este projeto admin ao projeto novo

```powershell
cd ADMIN
npx supabase link --project-ref <PROJECT_REF>
```

Se o CLI pedir senha, use a database password do projeto novo.

## 4. Subir o schema

Primeiro confira o que sera aplicado:

```powershell
cd ADMIN
npx supabase db push --linked --dry-run
```

Depois aplique:

```powershell
cd ADMIN
npx supabase db push --linked
```

## 5. Gerar as chaves de assinatura

SOMENTE no primeiro setup de um projeto novo (ou em rotacao planejada â€” leia
`../../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`):

```powershell
cd ADMIN
npm run license:keygen:env
```

Os scripts se recusam a sobrescrever chaves existentes sem `--force` e, com
`--force`, salvam backup datado do env anterior. O `license:keygen:env` tambem:

- gera um `kid` unico derivado da chave publica;
- adiciona a chave nova ao manifesto `supabase/license-trusted-keys.json`
  SEM remover as antigas (a extensao CEP embute esse manifesto no build);
- grava o PEM publico versionado.

O arquivo `supabase/functions/.env.production.local` e gitignored e guarda a
chave privada da licenca. Ele ainda pode conter a chave privada do bridge AEX
legado para compatibilidade temporaria com clientes antigos.

O comando legado `bridge:keygen:env` escreve
`supabase/aex-bridge-token-public-key.<kid>.json`, com os campos publicos `x` e
`y`. O app atual nao usa plugin AEX nem `bridgeToken`; nao rode esse keygen e
nao apague as chaves antigas sem encerrar formalmente a compatibilidade.

As chaves publicas ficam versionadas; a privada nunca sai dos secrets da Edge
Function. Depois de gerar/rotacionar chaves, rebuilde e reinstale a extensao
CEP e confira com `npm run license:check`.

## 6. Configurar secrets das Edge Functions

No Supabase hosted, as Edge Functions ja recebem automaticamente:

```dotenv
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEYS={"default":"sb_publishable_..."}
SUPABASE_SECRET_KEYS={"default":"sb_secret_..."}
```

O arquivo de producao local deve conter apenas os secrets de assinatura:

```dotenv
LICENSE_TOKEN_KEY_ID=v1
LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64=...
# Legado opcional durante a migracao:
AEX_BRIDGE_TOKEN_KEY_ID=v1
AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64=...
```

Envie para o projeto:

```powershell
cd ADMIN
npx supabase secrets set --project-ref <PROJECT_REF> --env-file supabase\functions\.env.production.local
```

## 7. Deploy sem Docker

Use `--use-api` para empacotar pelo servico do Supabase:

```powershell
cd ADMIN
npx supabase functions deploy --project-ref <PROJECT_REF> --use-api --no-verify-jwt
```

A telemetria tecnica remota do aplicativo foi aposentada. A Function
`track-event` nao faz mais parte do codigo publicado e a migration
`20260811120000_remove_remote_app_telemetry.sql` remove sua tabela. Apagar o
diretorio local de uma Function nao apaga uma versao que ja esteja no projeto
remoto; durante a publicacao dessa retirada, remova-a explicitamente e confirme
a lista restante:

```powershell
cd ADMIN
npx supabase functions delete track-event --project-ref <PROJECT_REF>
npx supabase functions list --project-ref <PROJECT_REF>
```

Essa retirada nao alcanca `licensing.audit_log`, auditorias de relogio, sessoes
de licenca ou os demais controles de rate limit.

O ciclo de desinstalacao do Tauri depende de `app-release-device`. Para publicar
somente essa funcao, sem alterar secrets ou as demais functions:

```powershell
cd ADMIN
npx supabase functions deploy app-release-device --project-ref <PROJECT_REF> --use-api --no-verify-jwt
```

As functions validam a publishable key e o JWT do usuario dentro do proprio codigo.

## 8. Criar o primeiro master

Crie primeiro o usuÃ¡rio no Supabase Auth, confirme o e-mail e copie o UUID do
usuÃ¡rio. Depois, no SQL Editor, vincule a identidade explicitamente:

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

O runtime nÃ£o vincula master ou membro apenas por coincidÃªncia de e-mail. A
migration de hardening faz uma Ãºnica compatibilizaÃ§Ã£o dos masters antigos que
jÃ¡ existiam, estavam confirmados no Auth e ainda nÃ£o tinham `auth_user_id`.

## Admin local

A tela local e o app React/Vite deste projeto. Rode:

```powershell
cd ADMIN
npm run dev
```

Ela usa Google OAuth via Supabase Auth para o master e chama
`master-create-organization` para salvar:

- licenca do Grupo Arizona;
- seats;
- data limite ou validade indefinida;
- usuarios da licenca;
- papel de gestor por usuario, definido apenas pelo master;
- liberacao de device ativo por usuario;
- reset explicito do TOTP de um usuario, disponivel somente ao master neste
  painel web;
- limpeza/remocao de usuario para liberar seat.

O dominio permitido dos usuarios e fixo: `arizona.global`. O email do master
pode usar outro dominio, por exemplo `jonatanmagrao.com.br`.

A tela tambem chama `master-get-license` depois do login para carregar a licenca
atual em modo edicao. O master admin pode usar o app Tauri sem consumir seat.
O backend aceita o OAuth somente quando a identidade inclui o provider Google,
o JWT registra `amr.method=oauth` depois do corte diÃ¡rio e o `auth_user_id`
continua vinculado a um `licensing.master_accounts` ativo. O Client Secret do
Google fica somente no provider do Supabase Auth.

Essa mudanÃ§a Ã© exclusiva do Admin web. O Tauri continua usando cÃ³digo de
ativaÃ§Ã£o, TOTP, sessÃ£o local, device e validaÃ§Ã£o de licenÃ§a para masters,
gestores e usuÃ¡rios finais.

## Logs de atividade no Admin

A aba **Logs de atividade** consulta os registros jÃ¡ existentes em
`licensing.audit_log` por meio da Edge Function `master-list-audit-log`. A
consulta Ã© paginada, somente leitura e exige a mesma sessÃ£o master recente via
Google OAuth usada pelo restante do Admin.

A resposta apresenta apenas identidades e contexto necessÃ¡rios para a
interface. Metadados brutos, cÃ³digos de ativaÃ§Ã£o e identificadores de instalaÃ§Ã£o
nÃ£o sÃ£o enviados ao navegador. A funÃ§Ã£o nÃ£o cria logs, nÃ£o altera tabelas e nÃ£o
precisa de migration.

## Primeiro acesso no Tauri

UsuÃ¡rios finais nÃ£o escolhem senha. Um master ou gestor emite pelo Tauri um
cÃ³digo de 12 caracteres e uso Ãºnico. Somente o hash Ã© salvo em
`licensing.activation_codes`; o valor em claro Ã© retornado uma vez e expira
conforme a polÃ­tica da licenÃ§a (15 minutos por padrÃ£o).

O usuÃ¡rio informa e-mail + cÃ³digo no Tauri. A Edge Function `app-activate`
consome o cÃ³digo, cria ou vincula o usuÃ¡rio Auth autorizado e entrega ao Rust
somente um token hash de troca. O Tauri entÃ£o exige cadastro/validaÃ§Ã£o TOTP.
Na recuperaÃ§Ã£o de device, um fator TOTP jÃ¡ verificado nÃ£o Ã© removido: o usuÃ¡rio
confirma o mesmo autenticador. MatrÃ­culas incompletas podem ser descartadas e
um novo QR Ã© criado somente quando nÃ£o existe TOTP verificado. A interface web
do Tauri nunca recebe access token, refresh token ou recibo.

### Rate limits e polÃ­ticas de acesso

Os valores abaixo sÃ£o os padrÃµes:

| AÃ§Ã£o interna | Escopo | Limite |
|---|---|---:|
| `activation.generate.target` | membro destinatÃ¡rio | 3 |
| `activation.generate.actor` | master/gestor emissor | 10 |
| `activation.generate.ip` | endereÃ§o IP | 20 |
| `activation.consume.email` | e-mail normalizado | 8 |
| `activation.consume.ip` | endereÃ§o IP | 30 |

O painel master grava a polÃ­tica configurÃ¡vel diretamente em
`licensing.organizations`:

| Coluna | PadrÃ£o | Intervalo | Significado |
|---|---:|---:|---|
| `activation_code_ttl_minutes` | 15 | 5 a 60 min | Tempo de validade do cÃ³digo emitido |
| `activation_attempt_limit` | 8 | 1 a 100 | Tentativas, vÃ¡lidas ou invÃ¡lidas, para o mesmo e-mail |
| `activation_attempt_window_minutes` | 60 | 1 a 1440 min | Janela mÃ³vel que conta as tentativas |
| `activation_generation_limit` | 3 | 1 a 50 | CÃ³digos emitidos para o mesmo usuÃ¡rio |
| `activation_generation_window_minutes` | 60 | 1 a 1440 min | Janela mÃ³vel que conta as emissÃµes |
| `device_release_limit` | 10 | 1 a 100 | Devices liberados para o mesmo usuÃ¡rio |
| `device_release_window_minutes` | 60 | 1 a 1440 min | Janela mÃ³vel que conta as liberaÃ§Ãµes |
| `device_switch_interval_days` | 7 | 0 a 365 dias | Dias completos desde a ativaÃ§Ã£o da mÃ¡quina atual atÃ© permitir outra liberaÃ§Ã£o |
| `device_recovery_window_minutes` | 15 | 5 a 60 min | Prazo para concluir o TOTP e cadastrar o device apÃ³s usar o cÃ³digo |

Os limites de ator e IP permanecem fixos como guardrails globais. As janelas
configurÃ¡veis usam `licensing.consume_rate_limit_v2`, que retorna tambÃ©m
`retry_after_seconds`. As Edge Functions convertem esse valor em
`error.retryAfterSeconds` e `error.retryAt`.

`device_switch_cooldown_days` e `device_switch_cooldown_minutes` permanecem
somente como fallbacks legados. O campo atual nÃ£o atrasa a ativaÃ§Ã£o da prÃ³xima
mÃ¡quina: ele bloqueia a liberaÃ§Ã£o da mÃ¡quina ativa atÃ© que o intervalo seja
completado. Depois da liberaÃ§Ã£o, o novo device pode ser ativado imediatamente.

Os identificadores sÃ£o armazenados em `licensing.rate_limit_events` somente
como hashes SHA-256. A retenÃ§Ã£o operacional padrÃ£o desses eventos Ã© de 2 dias.
Uma nova emissÃ£o revoga cÃ³digos anteriores ainda abertos para o mesmo membro.

O Admin web oferece **Zerar tempos** em cada usuÃ¡rio. A Edge Function
`master-reset-member-rate-limits` exige sessÃ£o master iniciada recentemente
pelo Google,
recalcula os hashes do ID, e-mail e identidade de ator do membro e remove
somente os contadores correspondentes. Limites de IP e de outros atores sÃ£o
preservados. A operaÃ§Ã£o Ã© registrada em `licensing.audit_log` e nÃ£o altera
usuÃ¡rio, TOTP, licenÃ§a, device, sessÃ£o ou cÃ³digo de ativaÃ§Ã£o.

Em desenvolvimento, ajuste a polÃ­tica no Admin ou reutilize o cÃ³digo enquanto
ele estiver vÃ¡lido; nÃ£o gere sucessivos cÃ³digos para repetir o mesmo teste.
Depois que um cÃ³digo
vÃ¡lido Ã© reivindicado, qualquer falha interna antes da resposta final faz
`app-activate` liberar esse mesmo cÃ³digo e retornar `activation_unavailable`;
o cliente pode tentar novamente sem nova emissÃ£o. Reset manual Ã© uma operaÃ§Ã£o
de incidente/teste e deve remover somente os eventos do membro, e-mail e ator
envolvidos â€” nunca toda a tabela em produÃ§Ã£o.

O acesso privilegiado ao Data API usa `SUPABASE_SECRET_KEYS`. O cliente
separado de Auth Admin usa `SUPABASE_SERVICE_ROLE_KEY` dentro de
`app-activate`, porque operaÃ§Ãµes administrativas de identidades exigem um JWT
com papel `service_role` e rejeitam a chave opaca `sb_secret` com `bad_jwt`.
Essa exceÃ§Ã£o nÃ£o pode chegar a clientes e deve ser reavaliada quando o endpoint
do Auth Admin aceitar integralmente as chaves novas.

Nos acessos seguintes, o refresh token continua no Windows Credential Manager,
mas a autorizaÃ§Ã£o diÃ¡ria depende de TOTP confirmado depois do corte das 04:00.
O endpoint legado `app-set-password` responde HTTP 410 e nÃ£o cria nem altera
senhas.

O device Ã© criado somente por `app-activate-device`, depois de JWT vÃ¡lido e
TOTP atual. `validate-license` apenas valida um device ativo existente; nÃ£o faz
upsert nem reativa device revogado. Se o usuÃ¡rio for removido da licenÃ§a,
devices e sessÃµes sÃ£o revogados.

O painel master permite configurar a hora da renovacao diaria por licenca. O
campo `licensing.organizations.daily_auth_reset_hour` usa
`America/Sao_Paulo` e tem padrao `04:00`. Isso controla o corte da validacao
diÃ¡ria e do recibo CEP; nÃ£o altera a expiraÃ§Ã£o global do refresh token do
Supabase. O recibo CEP dura no mÃ¡ximo 15 minutos. Antes de publicar as Functions
atualizadas, aplique tambÃ©m a migration
`20260723210000_security_activation_mfa.sql`.

Em toda desinstalacao real (mas nao durante update), o Tauri chama
`app-release-device` com o JWT do proprio usuario. A function revoga apenas os
devices e sessoes desse membro antes que o NSIS apague a credencial segura.
Falha de rede ou function indisponivel e registrada como aviso, mas nao bloqueia
a remocao local. O `install_id` e os demais dados locais so sao apagados quando
a caixa correspondente do desinstalador estiver marcada.
