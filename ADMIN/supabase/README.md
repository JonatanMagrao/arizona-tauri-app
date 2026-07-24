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

SOMENTE no primeiro setup de um projeto novo (ou em rotacao planejada — leia
`../../LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`):

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

O ciclo de desinstalacao do Tauri depende de `app-release-device`. Para publicar
somente essa funcao, sem alterar secrets ou as demais functions:

```powershell
cd ADMIN
npx supabase functions deploy app-release-device --project-ref <PROJECT_REF> --use-api --no-verify-jwt
```

As functions validam a publishable key e o JWT do usuario dentro do proprio codigo.

## 8. Criar o primeiro master

Crie primeiro o usuário no Supabase Auth, confirme o e-mail e copie o UUID do
usuário. Depois, no SQL Editor, vincule a identidade explicitamente:

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

O runtime não vincula master ou membro apenas por coincidência de e-mail. A
migration de hardening faz uma única compatibilização dos masters antigos que
já existiam, estavam confirmados no Auth e ainda não tinham `auth_user_id`.

## Admin local

A tela local e o app React/Vite deste projeto. Rode:

```powershell
cd ADMIN
npm run dev
```

Ela usa Supabase Auth com e-mail/senha + TOTP para o master e chama
`master-create-organization` para salvar:

- licenca do Grupo Arizona;
- seats;
- data limite ou validade indefinida;
- usuarios da licenca;
- papel de gestor por usuario, definido apenas pelo master;
- liberacao de device ativo por usuario;
- limpeza/remocao de usuario para liberar seat.

O dominio permitido dos usuarios e fixo: `arizona.global`. O email do master
pode usar outro dominio, por exemplo `jonatanmagrao.com.br`.

A tela tambem chama `master-get-license` depois do login para carregar a licenca
atual em modo edicao. O master admin pode usar o app Tauri sem consumir seat.

## Primeiro acesso no Tauri

Usuários finais não escolhem senha. Um master ou gestor emite pelo Tauri um
código de 12 caracteres e uso único. Somente o hash é salvo em
`licensing.activation_codes`; o valor em claro é retornado uma vez e expira
conforme a política da licença (15 minutos por padrão).

O usuário informa e-mail + código no Tauri. A Edge Function `app-activate`
consome o código, cria ou vincula o usuário Auth autorizado e entrega ao Rust
somente um token hash de troca. O Tauri então exige cadastro/validação TOTP.
Na recuperação de device, um fator TOTP já verificado não é removido: o usuário
confirma o mesmo autenticador. Matrículas incompletas podem ser descartadas e
um novo QR é criado somente quando não existe TOTP verificado. A interface web
do Tauri nunca recebe access token, refresh token ou recibo.

### Rate limits e políticas de acesso

Os valores abaixo são os padrões:

| Ação interna | Escopo | Limite |
|---|---|---:|
| `activation.generate.target` | membro destinatário | 3 |
| `activation.generate.actor` | master/gestor emissor | 10 |
| `activation.generate.ip` | endereço IP | 20 |
| `activation.consume.email` | e-mail normalizado | 8 |
| `activation.consume.ip` | endereço IP | 30 |

O painel master grava a política configurável diretamente em
`licensing.organizations`:

| Coluna | Padrão | Intervalo | Significado |
|---|---:|---:|---|
| `activation_code_ttl_minutes` | 15 | 5 a 60 min | Tempo de validade do código emitido |
| `activation_attempt_limit` | 8 | 1 a 100 | Tentativas, válidas ou inválidas, para o mesmo e-mail |
| `activation_attempt_window_minutes` | 60 | 1 a 1440 min | Janela móvel que conta as tentativas |
| `activation_generation_limit` | 3 | 1 a 50 | Códigos emitidos para o mesmo usuário |
| `activation_generation_window_minutes` | 60 | 1 a 1440 min | Janela móvel que conta as emissões |
| `device_release_limit` | 10 | 1 a 100 | Devices liberados para o mesmo usuário |
| `device_release_window_minutes` | 60 | 1 a 1440 min | Janela móvel que conta as liberações |
| `device_switch_interval_days` | 7 | 0 a 365 dias | Dias completos desde a ativação da máquina atual até permitir outra liberação |
| `device_recovery_window_minutes` | 15 | 5 a 60 min | Prazo para concluir o TOTP e cadastrar o device após usar o código |

Os limites de ator e IP permanecem fixos como guardrails globais. As janelas
configuráveis usam `licensing.consume_rate_limit_v2`, que retorna também
`retry_after_seconds`. As Edge Functions convertem esse valor em
`error.retryAfterSeconds` e `error.retryAt`.

`device_switch_cooldown_days` e `device_switch_cooldown_minutes` permanecem
somente como fallbacks legados. O campo atual não atrasa a ativação da próxima
máquina: ele bloqueia a liberação da máquina ativa até que o intervalo seja
completado. Depois da liberação, o novo device pode ser ativado imediatamente.

Os identificadores são armazenados em `licensing.rate_limit_events` somente
como hashes SHA-256. A retenção operacional padrão desses eventos é de 2 dias.
Uma nova emissão revoga códigos anteriores ainda abertos para o mesmo membro.

Em desenvolvimento, ajuste a política no Admin ou reutilize o código enquanto
ele estiver válido; não gere sucessivos códigos para repetir o mesmo teste.
Depois que um código
válido é reivindicado, qualquer falha interna antes da resposta final faz
`app-activate` liberar esse mesmo código e retornar `activation_unavailable`;
o cliente pode tentar novamente sem nova emissão. Reset manual é uma operação
de incidente/teste e deve remover somente os eventos do membro, e-mail e ator
envolvidos — nunca toda a tabela em produção.

O acesso privilegiado ao Data API usa `SUPABASE_SECRET_KEYS`. O cliente
separado de Auth Admin usa `SUPABASE_SERVICE_ROLE_KEY` apenas dentro de
`app-activate`, porque operações administrativas de identidades e a remoção de
matrículas MFA incompletas exigem um JWT com papel `service_role` e rejeitam a
chave opaca `sb_secret` com `bad_jwt`. A recuperação de device nunca remove
fator TOTP verificado. Essa exceção não pode chegar a clientes e deve ser
reavaliada quando o endpoint do Auth Admin aceitar integralmente as chaves
novas.

Nos acessos seguintes, o refresh token continua no Windows Credential Manager,
mas a autorização diária depende de TOTP confirmado depois do corte das 04:00.
O endpoint legado `app-set-password` responde HTTP 410 e não cria nem altera
senhas.

O device é criado somente por `app-activate-device`, depois de JWT válido e
TOTP atual. `validate-license` apenas valida um device ativo existente; não faz
upsert nem reativa device revogado. Se o usuário for removido da licença,
devices e sessões são revogados.

O painel master permite configurar a hora da renovacao diaria por licenca. O
campo `licensing.organizations.daily_auth_reset_hour` usa
`America/Sao_Paulo` e tem padrao `04:00`. Isso controla o corte da validacao
diária e do recibo CEP; não altera a expiração global do refresh token do
Supabase. O recibo CEP dura no máximo 15 minutos. Antes de publicar as Functions
atualizadas, aplique também a migration
`20260723210000_security_activation_mfa.sql`.

Em toda desinstalacao real (mas nao durante update), o Tauri chama
`app-release-device` com o JWT do proprio usuario. A function revoga apenas os
devices e sessoes desse membro antes que o NSIS apague a credencial segura.
Falha de rede ou function indisponivel e registrada como aviso, mas nao bloqueia
a remocao local. O `install_id` e os demais dados locais so sao apagados quando
a caixa correspondente do desinstalador estiver marcada.
