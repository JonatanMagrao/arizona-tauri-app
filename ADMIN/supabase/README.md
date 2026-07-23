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

Crie primeiro o usuario no Supabase Auth com o email e a senha que serao usados
no painel local. Depois, no SQL Editor do projeto novo, libere o mesmo email:

```sql
insert into licensing.master_accounts (email, status)
values ('seu-email@empresa.com', 'active')
on conflict (email) do update
set status = 'active';
```

Na primeira chamada autenticada, a function vincula o `auth_user_id`
automaticamente pelo email. O painel local nao cria usuarios master.

## Admin local

A tela local e o app React/Vite deste projeto. Rode:

```powershell
cd ADMIN
npm run dev
```

Ela usa Supabase Auth com email/senha e chama `master-create-organization`
para salvar:

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

Usuarios cadastrados em `licensing.members` nao precisam mais ser criados
manualmente no Supabase Auth. No primeiro acesso, o app Tauri chama a Edge
Function `app-set-password` com email e senha. A function valida se o email ja
esta liberado em `licensing.members`, cria o usuario no Supabase Auth com a
senha informada, confirma o email e vincula `members.auth_user_id`.

Depois disso, o login diario usa Supabase Auth com email/senha e chama
`validate-license` para liberar a janela principal do Tauri.

Cada usuario pode ter apenas um device ativo. O device e registrado
automaticamente no login/validacao do Tauri. Se o usuario for removido da
licenca, devices e sessoes ativas sao revogados. Se apenas o device for liberado,
o usuario continua cadastrado e pode ativar outra maquina.

O painel master permite configurar a hora da renovacao diaria por licenca. O
campo `licensing.organizations.daily_auth_reset_hour` usa
`America/Sao_Paulo` e tem padrao `04:00`. Isso controla o corte da validacao
diaria e do recibo CEP; nao altera a expiracao global do refresh token do
Supabase. Antes de publicar as functions atualizadas, aplique a migration
`20260723170000_add_daily_auth_reset_hour.sql`.

Em toda desinstalacao real (mas nao durante update), o Tauri chama
`app-release-device` com o JWT do proprio usuario. A function revoga apenas os
devices e sessoes desse membro antes que o NSIS apague a credencial segura.
Falha de rede ou function indisponivel e registrada como aviso, mas nao bloqueia
a remocao local. O `install_id` e os demais dados locais so sao apagados quando
a caixa correspondente do desinstalador estiver marcada.
