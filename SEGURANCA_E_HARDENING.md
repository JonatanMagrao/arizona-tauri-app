# Segurança e hardening — Arizona

Última revisão: 23/07/2026

Este documento registra os riscos de segurança e operação encontrados no
Arizona App, na extensão CEP, no instalador NSIS, no painel Admin e no backend
Supabase. Ele também propõe correções e critérios objetivos para considerar
cada item resolvido.

O documento deve ser revisado antes de releases públicos e sempre que houver
mudanças em autenticação, licenciamento, armazenamento de tokens, instalação
do CEP, chaves de assinatura ou Edge Functions.

## Estado da implementação em 23/07/2026

Os achados detalhados abaixo preservam o diagnóstico original. O estado atual
do código já inclui:

- ativação sem senha por código aleatório, com hash no banco, validade de 15
  minutos, tentativas limitadas, uso único e resposta não enumerável;
- emissão do código por master/gestor no Tauri, com segregação de papéis,
  proteção de identidades master e cópia pelo ícone `file_copy`;
- TOTP obrigatório no primeiro acesso e em cada ciclo diário após as 04:00
  (substituído em agosto de 2026 — ver a atualização abaixo);
- tokens e recibo sob autoridade do Rust/Windows Credential Manager, sem
  exposição para o JavaScript do Tauri;
- signup público desabilitado na configuração versionada e endpoint antigo de
  senha encerrado com HTTP 410;
- device criado somente por ativação autenticada, sem upsert/reativação na
  validação comum, com revogação durável de devices e sessões;
- recibo CEP limitado a 15 minutos, sessões reutilizadas por dia e auditoria de
  relógio limitada;
- CSP ativa, capabilities separadas, Asset Protocol restrito e abertura de
  arquivos sem `cmd.exe`;
- Admin master com senha + TOTP e tokens somente em memória (hoje o master
  entra apenas por Google OAuth e a sessão fica em `sessionStorage`, presa à
  aba — ver a atualização abaixo);
- rate limiting no banco, respostas genéricas e função de retenção;
- payload CEP de produção sem `.debug` e sem source maps;
- validação de caminhos do instalador, PowerShell invisível e desinstalação
  local não bloqueada por falha de rede;
- dependências JavaScript auditadas sem vulnerabilidades conhecidas;
- JSX legível em dev e JSXBIN embutido no release.

As únicas etapas que dependem de acesso/decisão externa estão em
[`ACOES_MANUAIS_SEGURANCA.md`](./ACOES_MANUAIS_SEGURANCA.md): opções do
Dashboard, agendamento `pg_cron`, controles operacionais, teste coordenado e o
build final. As migrations e Edge Functions foram publicadas no Supabase em
23/07/2026 e atualizadas em 03/08/2026 com a confiança de máquina (ver a
atualização abaixo). Assinatura de distribuição e SMTP continuam fora do escopo
por decisão do responsável.

## Atualização de 03/08/2026: confiança de máquina no lugar do TOTP

O autenticador TOTP foi removido do Arizona App. A prova diária deixou de ser
um código de 6 dígitos e passou a ser a identidade do hardware:

- `validate-license` e `app-activate-device` não exigem mais AAL2 nem um AMR
  `totp` do ciclo do dia; a janela de login do Tauri é só de ativação, com
  e-mail e código de 12 caracteres;
- o Tauri envia `deviceFingerprintHash`, o SHA-256 de
  `arizona-device-fp:v1:{MachineGuid}`; a classificação do valor fica em
  `ADMIN/supabase/functions/_shared/device-fingerprint.ts`. Fingerprint
  divergente — e também o device que já gravou um e para de enviá-lo — devolve
  `403 device_not_active` e grava `device.fingerprint_mismatch` em
  `licensing.audit_log`, com apenas 12 caracteres de cada hash;
- o fingerprint só é gravado por uma ativação respaldada por código.
  `validate-license` não grava mais nada; `app-activate-device` grava apenas
  com a concessão de vínculo. Gravar o primeiro valor que aparecesse deixaria
  uma credencial copiada reivindicar a máquina e trancar o dono para fora;
- vincular hardware exige essa concessão de uso único, emitida por
  `app-activate` ao consumir um código (`device_bind_not_before` e
  `device_bind_expires_at` em `licensing.members`, migration
  `20260803120000_device_bind_grant.sql`, 30 minutos). Ela só é aceita de uma
  sessão criada em ou depois de `device_bind_not_before`, é gasta por um UPDATE
  condicional antes de o device ser gravado, é restaurada se essa gravação
  falhar e é apagada pelo rollback se a ativação falhar. É esse requisito que
  impede um registro copiado do Windows Credential Manager de cadastrar outra
  máquina; a validação na máquina para onde ele foi copiado é recusada pela
  divergência de fingerprint — e um device sem fingerprint gravado nem valida,
  como descrito no parágrafo seguinte;
- sem concessão, a resposta é `device_activation_expired` para uma instalação
  que nunca foi cadastrada e `device_revoked` para uma instalação já liberada
  que tenta voltar sozinha; nos dois casos a saída é um código novo;
- a expiração da licença passou de `23:59:59.999Z` para a hora da renovação
  diária do dia seguinte a `license_expires_on`, em `America/Sao_Paulo`;
- a Gestão saiu do Tauri e o master autentica apenas por Google OAuth.

Esse risco residual foi fechado no próprio deploy de 03/08/2026:
`validate-license` recusa toda validação sem fingerprint (`device_not_active`,
"Update the app to continue." — é o que a v2.1.1 aposentada sempre envia) e
também o device que **não tem** fingerprint gravado (`device_not_active`,
"Reactivate this machine.", auditoria `device.fingerprint_mismatch` com
`outcome: "unbound"`). Um cliente adulterado que envie o valor vazio não passa
em nenhum caso.

Consequência que precisa ser dita sem eufemismo: **o vínculo de máquina vale
para a frota inteira desde o primeiro dia**. Como só a ativação com código
grava o fingerprint e o servidor recusa quem não o tem gravado, todo device que
estava em campo é forçado a uma rodada de reativação: instalar a 2.2.0 e
consumir um código de ativação novo. Não existe mais gravação de valor vazio:
`app-activate-device` recusa a máquina que não se identifica com
`device_identity_required` antes de gastar a concessão, e o cliente 2.2.0 falha
localmente, sem consumir código nem chamar a rede, quando o `MachineGuid` não
pode ser lido.

A ordem de publicação é parte do controle: a migration precisa estar aplicada e
visível pelo PostgREST antes das Functions, sob pena de derrubar toda ativação e
toda recuperação (`docs/impacto-mudancas-backend-e-versoes.md`, seção 8).

Consequência operacional deliberada: o papel de gestor saiu das Functions. Em
03/08/2026, `admin-add-member`, `admin-list-members` e
`master-reset-member-totp` foram apagadas do projeto Supabase e do repositório,
junto com `_shared/mfa-recovery.ts`; as Functions `admin-*` restantes aceitam
somente o master, com `forbidden` para qualquer outro ator. Quem administrava
pela Gestão do Tauri precisa recorrer ao master.

O MFA do Supabase Auth pode ser desligado no painel do projeto: nenhum fluxo o
utiliza mais. O backend não consulta fatores e a v2.1.1 — a única que cadastrava
o fator sozinha durante a ativação — está bloqueada na validação. Desligar é
opcional e apenas remove um resíduo cosmético.

> Antes de alterar ou remover qualquer chave, leia
> `LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`. Não apague, regenere ou substitua
> chaves privadas sem uma rotação planejada.

## Resumo executivo

O projeto possui boas fundações:

- dados de licenciamento separados no schema `licensing`;
- RLS habilitado e forçado nas migrations;
- acesso direto revogado para `anon` e `authenticated`;
- recibo CEP assinado com ES256 e chave pública embutida;
- refresh token salvo no Windows Credential Manager;
- instalador com validações de caminho, fingerprint e rollback;
- AEX removido do bundle e `arizona://` não registrado;
- testes de Rust, Admin, instalador, NSIS e paridade de chaves.

Ainda existem bloqueadores para uma distribuição segura:

| Prioridade | Problema | Impacto principal |
|---|---|---|
| P0 | Primeiro acesso sem prova de posse do e-mail | Tomada de conta |
| P0 | Reautenticação diária declarada pelo cliente | Bypass da senha diária |
| P0 | Revogação de licença/dispositivo não é durável | Usuário bloqueado pode continuar |
| P0 | Sessão local confiada ao JavaScript do Tauri | Bypass da autoridade local |
| P0 | EXE, NSIS e CEP sem assinatura de distribuição | Origem não verificável e CEP ausente |
| P1 | CSP desativada e Asset Protocol com `**` | Amplificação de XSS para acesso local |
| P1 | `.debug` no CEP de produção | DevTools/depuração habilitada |
| P1 | Abertura de arquivos por `cmd /C start` | Injeção por nomes de arquivo |
| P1 | Tokens master do Admin em `localStorage` | Roubo de sessão administrativa |
| P1 | Ausência de rate limit nos endpoints próprios | Enumeração, abuso e custo |
| P1 | Crescimento ilimitado das tabelas de auditoria | Banco, custo e disponibilidade |
| P2 | Dependências antigas de build | Risco de supply chain |
| P2 | Versões e payloads de release divergentes | Bundle incorreto ou desatualizado |
| P0 | Vínculo permanente de conta por e-mail em `resolveMember`/`resolveMaster`, sem prova de posse | Sequestro de conta sem rota de recuperação |
| P2 | `open_media_native` abre qualquer arquivo de mídia sem confinar ao diretório do job | Abuso local de leitura de mídia fora do escopo |
| P2 | Flags de CLI de desinstalação sem autenticação de origem | Logout/liberação de assento por outro processo local |
| P2 | Scripts de instalação de assets Adobe sem ancoragem de caminho confiável | Exclusão elevada fora do escopo (apenas em instalação não padrão) |

## 1. Primeiro acesso e criação de senha

### Situação atual

`ADMIN/supabase/functions/app-set-password/index.ts` recebe e-mail e senha sem
exigir uma sessão autenticada. A Function usa a chave administrativa para:

- criar um usuário Auth;
- marcar o e-mail como confirmado;
- aceitar a senha escolhida pelo solicitante;
- vincular o usuário ao registro em `licensing.members`;
- redefinir a senha de um usuário Auth existente quando o membro ainda não está
  vinculado.

O endpoint `checkOnly` também informa se um e-mail é autorizado e se já possui
senha. Como a publishable key é pública por definição, ela não representa uma
prova de identidade.

### Risco

Qualquer pessoa que descubra ou adivinhe um e-mail convidado pode registrar a
conta antes do usuário legítimo. Em alguns estados intermediários, também pode
alterar a senha de um usuário Auth existente.

### Resolução recomendada

Substituir o primeiro acesso por um fluxo que comprove a posse do e-mail:

1. O Admin adiciona o membro.
2. O backend gera um convite aleatório de uso único ou solicita ao Supabase o
   envio de OTP/invite.
3. O usuário recebe um código ou link por e-mail.
4. O Tauri solicita o código de uso único.
5. O backend valida hash, destinatário, expiração, tentativas e uso anterior.
6. Somente depois da validação o usuário pode criar a senha.

Como `arizona://` foi aposentado, o fluxo não precisa reintroduzir deep link.
É possível usar OTP digitado no Tauri ou uma página HTTPS que mostre um código
curto para confirmação no aplicativo.

Regras obrigatórias:

- nunca redefinir senha de usuário existente por endpoint não autenticado;
- não retornar se um e-mail existe, foi convidado ou já possui senha;
- usar respostas externas genéricas;
- limitar tentativas por IP, e-mail e convite;
- expirar e invalidar o convite após o primeiro uso;
- registrar a criação no `audit_log`, sem guardar senha, token ou OTP em claro;
- exigir senha forte e bloquear senhas conhecidas como vazadas.

### Critérios de aceite

- Conhecer apenas o e-mail não permite criar ou alterar a conta.
- `checkOnly` não permite enumeração.
- Convites expirados, usados ou com tentativas excedidas são rejeitados.
- Um teste automatizado comprova que uma conta Auth existente nunca tem a
  senha alterada pelo fluxo de primeiro acesso.

### Vetor adicional confirmado em auditoria (23/07/2026): signup nativo do GoTrue

Além do endpoint `app-set-password`, existe um segundo caminho independente
para o mesmo tipo de sequestro, e ele é mais grave porque não tem rota de
recuperação hoje:

- `ADMIN/supabase/config.toml` tem `enable_signup = true` (linha 176, `[auth]`,
  e linha 221, `[auth.email]`) e `enable_confirmations = false` (linha 226).
  Isso permite que qualquer pessoa com a publishable key (pública, embutida no
  app) crie uma conta válida direto em `/auth/v1/signup` com qualquer e-mail,
  sem provar posse da caixa de entrada.
- `admin-add-member` inseria o membro com `status: "invited"` e sem
  `auth_user_id`, sem gerar convite. A Function foi removida em 03/08/2026,
  mas o upsert de usuários de `master-create-organization` continua criando o
  membro do mesmo jeito (`status: "invited"`, sem `auth_user_id`), então este
  ponto do vetor permanece.
- `resolveMember`/`resolveMaster`
  (`ADMIN/supabase/functions/_shared/actors.ts:77-91` e `:28-38`) fazem
  fallback por e-mail quando não encontram o membro por `auth_user_id` e, ao
  achar, gravam `auth_user_id` **permanentemente** (`actors.ts:99`,
  `:105-112`) — sem nenhuma verificação adicional de que aquele usuário Auth é
  o dono legítimo do e-mail.
- Consequência: um atacante que se autocadastra primeiro com o e-mail de um
  membro recém-convidado consome o seat, valida a licença normalmente, e
  **tranca o usuário legítimo para sempre** — quando ele tentar
  `app-set-password`, recebe `password_already_set`
  (`app-set-password/index.ts:167-169`) e não há nenhuma Function que limpe
  `auth_user_id` (nem `admin-remove-member`, que só marca `status: "revoked"`).

Confirmar com prioridade no Dashboard do Supabase (não só no `config.toml`
local, já que o projeto é cloud-only) se `enable_signup`/`enable_confirmations`
realmente estão assim em produção — ver item 19.

Resolução recomendada (além do fluxo de convite desta seção): desabilitar
signup público do GoTrue em produção, ou exigir `email_confirmed_at` antes de
`resolveMember`/`resolveMaster` vincularem `auth_user_id` por fallback de
e-mail; criar uma rota administrativa para resetar `auth_user_id` de contas
sequestradas.

## 2. Reautenticação diária às 04:00

### Situação atual

`validate-license` confia no campo `authMethod` enviado pelo cliente. Quando o
valor é `"password"`, o backend atualiza `last_password_login_at`.

Um cliente modificado pode enviar esse valor mesmo tendo obtido a sessão por
refresh token.

### Risco

A exigência diária de senha pode ser contornada sem conhecer a senha.

### Resolução recomendada

A prova de login recente deve ser determinada pelo servidor, nunca por um
booleano ou texto declarado pelo cliente.

Alternativas:

- endpoint exclusivo de login diário que recebe e valida a senha no Supabase
  Auth e, após sucesso, grava um evento server-side;
- desafio de reautenticação de uso único;
- validação de claims confiáveis de autenticação, quando o provedor oferecer
  uma claim adequada e não controlável pelo cliente;
- sessão própria curta, emitida somente após autenticação por senha.

O campo `authMethod` pode continuar existindo apenas para telemetria, mas não
deve autorizar ou renovar nada.

### Critérios de aceite

- Alterar o body para `authMethod: "password"` não renova o ciclo.
- Um refresh token válido, sozinho, não satisfaz o login diário.
- Há testes para 03:59, 04:00, horário configurável e mudança de dia.
- A hora aplicada vem da organização no banco e é calculada em
  `America/Sao_Paulo`.

## 3. Revogação, bloqueio e liberação de dispositivo

### Situação atual

Há quatro problemas relacionados:

1. `validate-license` faz upsert do dispositivo com `status: "active"`.
   Portanto, um dispositivo liberado pelo Admin pode ser reativado pelo
   próximo polling do cliente.
2. O polling em `src/app/App.jsx` trata apenas alguns erros. Respostas como
   organização bloqueada ou membro revogado não limpam necessariamente a
   sessão local e o recibo CEP.
3. A extensão CEP trabalha offline e aceita o recibo até a expiração.
4. Na revisão de 23/07/2026, a Function remota `app-release-device` respondeu
   HTTP 404, embora o código exista localmente.

### Risco

- liberação administrativa pode ser desfeita automaticamente;
- usuário bloqueado pode continuar usando o Tauri e o CEP até o fim do recibo;
- desinstalação pode deixar o seat ocupado;
- o painel pode indicar estado diferente do estado efetivo do cliente.

### Resolução recomendada

- Não permitir que um upsert comum transforme dispositivo `revoked` ou
  `disabled` em `active`.
- Separar `devices` de `device_activations`, ou exigir uma operação explícita
  e autorizada para ativação.
- Introduzir um `revocation_version`, `license_version` ou `blocked_at`
  verificado em toda emissão.
- Ao receber 401/403 definitivo de licenciamento, o Tauri deve:
  - limpar a sessão Rust;
  - apagar `cep-license-receipt.json`;
  - limpar o estado de licença;
  - fechar ou restringir janelas administrativas;
  - voltar para o login.
- Diferenciar falha de rede temporária de revogação definitiva.
- Publicar `app-release-device` antes de validar o ciclo de desinstalação.
- Tornar a liberação idempotente.

### Limite do modelo offline

Se a extensão não consulta a rede e o Tauri estiver fechado, não existe
bloqueio verdadeiramente instantâneo. As alternativas são:

- recibos mais curtos, renovados pelo Tauri;
- extensão consultando um estado online;
- serviço local sempre ativo;
- aceitar formalmente uma janela máxima de acesso offline.

Essa decisão deve ser documentada como requisito de produto.

### Critérios de aceite

- Dispositivo revogado não volta a `active` pelo polling.
- Membro ou organização bloqueados perdem acesso no Tauri no próximo polling.
- O recibo CEP é removido após revogação definitiva.
- O comportamento offline tem uma janela máxima documentada e testada.
- Instalação, logout e desinstalação liberam o seat de forma idempotente.

### Achado adicional (auditoria 23/07/2026): flags de CLI de desinstalação sem autenticação de origem

`arizona-app.exe` aceita `--release-device-for-uninstall` e
`--clear-local-auth-for-uninstall` em `main()` (`src-tauri/src/main.rs:4-10`),
**antes** até do guard de instância única ser adquirido. Nenhum dos dois
caminhos (`src-tauri/src/uninstall.rs`) verifica que quem invocou o binário é
de fato o desinstalador NSIS — sem segredo compartilhado, checagem de processo
pai ou confirmação. `hooks.nsh` chama essas flags como texto puro. Como a
instalação é `perMachine` e o app roda `asInvoker`, qualquer processo do mesmo
usuário Windows pode chamar `arizona-app.exe --release-device-for-uninstall`
a qualquer momento para deslogar o usuário e liberar o assento da licença,
mesmo com o app principal já aberto — sem aviso na tela (console oculto em
release).

Risco prático é baixo isoladamente (exige já ter execução de código como o
mesmo usuário, que por outras vias do Windows já teria acesso equivalente ao
keyring), mas é fácil de mitigar: exigir um token gerado pelo instalador e
verificado antes de executar essas ações, em vez de aceitar as flags livres.

## 4. Autoridade local do Tauri

### Situação atual

Em `src-tauri/src/lib.rs`:

- `complete_login` e `update_auth_session` aceitam `AuthSession` do JavaScript;
- a sessão não é validada criptograficamente no Rust;
- `require_authenticated` verifica apenas a existência de uma sessão;
- `load_secure_auth` devolve o refresh token ao frontend;
- diversos comandos locais não exigem autenticação.

### Risco

Uma falha no frontend, uma injeção de script ou acesso indevido ao IPC pode:

- criar uma sessão local falsa;
- executar ações protegidas do After Effects;
- chamar operações de arquivos e histórico;
- obter o refresh token;
- gravar um recibo arbitrário no arquivo usado pelo CEP.

O CEP ainda verifica a assinatura do recibo, mas os comandos Tauri protegidos
apenas pelo estado local podem ser liberados.

### Resolução recomendada

Mover a autoridade de sessão para Rust:

- JavaScript envia apenas credenciais ou inicia o fluxo.
- Rust chama/valida o backend e armazena a sessão.
- Rust verifica JWT e/ou recibo assinado antes de criar `AuthState`.
- O frontend recebe somente dados mínimos de apresentação.
- Refresh token nunca é retornado ao JavaScript.
- Comandos sensíveis exigem um guard central de licença e autenticação.
- O guard verifica também expiração e estado de revogação conhecido.

Separar comandos em grupos:

- públicos: versão, login, suporte;
- autenticados: arquivos e operações gerais;
- licenciados: extensão e After Effects;
- administrativos: gestão de membros/dispositivos.

### Critérios de aceite

- Invocar `complete_login` com dados inventados não cria sessão válida.
- Nenhum comando sensível depende apenas de `Option<AuthSession>`.
- O refresh token não aparece em payload de evento, variável global ou retorno
  de IPC.
- Testes Rust cobrem sessão ausente, expirada, forjada e revogada.

## 5. CSP, Asset Protocol e capabilities

### Situação atual

`src-tauri/tauri.conf.json` possui:

- `"csp": null`;
- Asset Protocol habilitado com `scope: ["**"]`.

`src-tauri/capabilities/default.json` aplica uma capability comum às janelas
`main`, `app` e `secondary`.

### Risco

Uma vulnerabilidade de frontend pode ser ampliada para:

- leitura de arquivos locais acessíveis ao usuário;
- uso de APIs Tauri em janelas que não precisam delas;
- roubo de tokens;
- execução de comandos locais expostos.

### Resolução recomendada

- Definir CSP restritiva para produção.
- Permitir conexão somente ao Supabase esperado e ao IPC local necessário.
- Não carregar scripts remotos.
- Restringir `assetProtocol.scope` às raízes realmente usadas.
- Considerar scopes persistidos/dinâmicos para arquivos selecionados.
- Criar capability separada para login, app principal e janela secundária.
- Conceder a cada janela apenas os plugins e comandos necessários.

### Critérios de aceite

- `csp` não é `null` no bundle de produção.
- Não existe `scope: ["**"]`.
- A janela de login não consegue chamar comandos administrativos ou de arquivo.
- Testes manuais confirmam previews de mídia e diálogos dentro dos novos
  scopes.

### Detalhe adicional (auditoria 23/07/2026): fallback de query string na janela secundária

`src/features/secondary/SecondaryWindow.jsx:1248-1268` tem um fallback que,
se `window.__ARIZONA_SECONDARY_STATE__` não estiver definido, lê
`view`/`path`/`kind`/`title` de `window.location.search` sem validação e passa
o `path` para `convertFileSrc()` (linha 1421), que soma com
`assetProtocol.scope: ["**"]` para embutir qualquer caminho absoluto num
`<video>/<audio>`. Hoje não há vetor (deep link, `WebviewWindowBuilder.url()`
parametrizada, window-state persistido) que consiga popular essa query string
com dado de atacante — é código morto/latente, não uma vulnerabilidade ativa.
Vale remover esse fallback (ou restringi-lo a build de desenvolvimento) como
parte do hardening desta seção, já que ele só existiria para contornar a
injeção normal de estado feita pelo Rust.

## 6. Abertura de arquivos sem shell intermediário

### Situação atual

`src-tauri/src/arizona/shell.rs` usa `cmd /C start` para abrir URL ou arquivo.

### Risco

Caracteres interpretados pelo `cmd.exe`, como `&`, `|`, `^`, `<` e `>`, podem
existir em nomes de arquivo. Um arquivo malicioso em pasta compartilhada pode
transformar uma ação de abertura em execução de outro comando.

### Resolução recomendada

- Usar `ShellExecuteW`, plugin opener com scope ou biblioteca equivalente.
- Nunca concatenar nem encaminhar caminhos de usuário para `cmd.exe`.
- Validar esquema de URLs e manter uma allowlist para links externos.

### Critérios de aceite

- Arquivos com espaços e metacaracteres abrem sem passar pelo `cmd.exe`.
- Testes cobrem nomes contendo `&`, `|`, `^`, aspas e caracteres Unicode.

### Achado adicional (auditoria 23/07/2026): `open_media_native` sem confinamento de diretório

Diferente dos outros comandos de mídia (que sempre derivam o caminho a partir
de `jobao_cod`/`jobinho_cod` dentro da árvore configurada, ver
`arizona/media_files.rs`), o comando `open_media_native(media_path)`
(`src-tauri/src/lib.rs:1557-1572`) só valida `path.is_file()` e a extensão
(`is_media_path`) — não confina o caminho a nenhuma pasta esperada. Combinado
com `assetProtocol.scope: ["**"]` (seção 5), qualquer caminho de mídia
existente no disco pode ser aberto no player padrão do SO
(`arizona::open_start_file`, `cmd /C start`) a partir de um `invoke()` do
frontend. Risco é baixo hoje (não há sink de XSS conhecido), mas deveria
seguir a mesma lógica de confinamento dos demais comandos de mídia como
defesa em profundidade.

## 7. Assinatura do Tauri e do instalador NSIS

### Situação atual

Existe `INSTALLER/scripts/sign-tauri.ps1`, mas o fluxo
`INSTALLER/scripts/build-release.ps1` não o chama. O check
`RequireSignedTauri` também não é obrigatório.

Na revisão, `arizona-app.exe` e o setup NSIS 2.1.0 estavam sem assinatura
Authenticode.

### Risco

- o Windows não consegue confirmar o fornecedor;
- SmartScreen pode bloquear ou alertar;
- um instalador alterado pode ser confundido com o oficial;
- o fingerprint interno do payload comprova consistência, não autenticidade.

### Resolução recomendada

- Configurar assinatura no próprio bundler Tauri por `signCommand`, certificado
  no Windows Certificate Store, token de hardware ou serviço de assinatura.
- Assinar o executável e o instalador final.
- Usar timestamp SHA-256.
- Tornar a assinatura obrigatória no fluxo oficial de release.
- Falhar o release quando a assinatura estiver ausente, inválida ou expirada.
- Nunca versionar PFX, senha ou credencial do serviço de assinatura.

### Critérios de aceite

- `Get-AuthenticodeSignature` retorna `Valid` para EXE e setup.
- O pipeline não produz artefato publicável quando a assinatura falha.
- O certificado e a cadeia esperados são registrados na documentação interna.

## 8. Empacotamento e assinatura do CEP

### Situação atual

O instalador copia `dist/cep` como pasta não assinada para
`%APPDATA%\Adobe\CEP\extensions`. Ele não habilita `PlayerDebugMode`.

O build gera `.debug` com porta de depuração. O CEP usa:

- `--enable-nodejs`;
- `--mixed-context`;
- acesso ao filesystem;
- execução de ExtendScript via `evalScript`.

`cep.config.ts` ainda contém uma senha de exemplo para ZXP.

### Risco

- em máquina limpa, a extensão não assinada pode não aparecer;
- `.debug` mantém a superfície de desenvolvimento no pacote;
- uma falha no HTML/React pode alcançar Node, filesystem e After Effects;
- senha de certificado versionada permite falsificação se for usada com um
  certificado real.

### Resolução recomendada

- Gerar e assinar um ZXP para distribuição.
- Guardar certificado e senha fora do Git.
- Instalar pelo mecanismo suportado ou validar uma estratégia corporativa de
  distribuição do ZXP.
- Remover `.debug` e qualquer `.map` do payload de produção.
- Fazer `verify-release.ps1` falhar se encontrar:
  - `.debug`;
  - `*.map`;
  - certificado ausente;
  - assinatura ZXP inválida;
  - código ExtendScript aberto quando JSXBIN for obrigatório.
- Manter Node/mixed-context somente se as funções atuais realmente exigirem.
- Adicionar CSP compatível com CEP e evitar conteúdo remoto.

### Critérios de aceite

- A extensão aparece em máquina limpa sem `PlayerDebugMode`.
- O pacote de produção não contém `.debug` nem source maps.
- O certificado ZXP não está no repositório.
- O instalador rejeita payload CEP sem assinatura/fingerprint esperado.

## 9. Admin e sessão master

### Situação atual

`ADMIN/src/App.jsx` persiste access token e refresh token em `localStorage`.
O Admin também não define CSP.

### Risco

Uma injeção de script, extensão maliciosa do navegador ou acesso ao perfil pode
roubar uma sessão master persistente.

### Resolução recomendada

Em ordem de preferência:

1. Executar o Admin dentro do Tauri e guardar o refresh token somente no
   Credential Manager.
2. Usar um backend/BFF com cookie `HttpOnly`, `Secure` e `SameSite`.
3. Como mitigação intermediária, manter access token apenas em memória e exigir
   novo login após fechar o painel.

Também:

- exigir MFA para contas master;
- limitar a vida das sessões administrativas;
- reautenticar para operações críticas;
- adicionar CSP;
- não registrar tokens em console ou mensagens de erro.

### Critérios de aceite

- Refresh token master não existe em `localStorage`.
- Fechar o painel encerra ou reduz a sessão conforme política documentada.
- Operações administrativas sensíveis exigem sessão recente/MFA.

## 10. E-mail, SMTP e entregabilidade

### Situação atual

Não há fluxo próprio de envio de convite, OTP ou recuperação no código. O SMTP
do `ADMIN/supabase/config.toml` está comentado e representa apenas configuração
local. A configuração remota não foi validada.

### Resolução recomendada

- Configurar SMTP próprio no Supabase para produção.
- Usar remetente no domínio corporativo.
- Configurar SPF, DKIM e DMARC.
- Separar e-mail de autenticação de marketing.
- Desabilitar tracking de links nos e-mails de autenticação.
- Habilitar notificações de mudança de senha e e-mail.
- Monitorar bounce, complaint e falhas de entrega.
- Não guardar credenciais SMTP no repositório.

### Critérios de aceite

- Convite e recuperação chegam a destinatários fora da equipe do Supabase.
- SPF, DKIM e DMARC passam na validação do provedor.
- Existe um procedimento para troca emergencial do SMTP.

## 11. Rate limiting, enumeração e abuso

### Situação atual

As Edge Functions próprias não implementam rate limit. Os limites padrão do
Supabase Auth não substituem limites de negócio em endpoints personalizados.
O CORS está configurado como `Access-Control-Allow-Origin: *`.

### Resolução recomendada

- Aplicar limites por IP, usuário, organização, e-mail e ação.
- Proteger primeiro acesso, login, OTP, validação de licença e telemetria.
- Usar CAPTCHA/Turnstile em fluxos públicos quando adequado.
- Limitar tamanho do body e profundidade de `metadata`.
- Retornar `429` com `Retry-After`.
- Usar respostas genéricas para evitar enumeração.
- CORS pode continuar compatível com Tauri, mas não deve ser tratado como
  mecanismo de autenticação.

### Critérios de aceite

- Testes demonstram bloqueio após tentativas excessivas.
- Endpoints públicos não revelam existência ou estado de e-mails.
- Payloads grandes ou profundamente aninhados são rejeitados antes do banco.

### Detalhes adicionais confirmados em auditoria (23/07/2026)

- `master-create-organization` é a única Function que não usa mensagem de
  erro genérica: no fallback de erro desconhecido, `safeInternalMessage`
  (`ADMIN/supabase/functions/master-create-organization/index.ts:116-121`,
  usado na linha 451) repassa `${code}: ${message}` cru do Postgres ao
  cliente (constraints, nomes de coluna/tabela). Exploração exige sessão
  master já autenticada, mas é inconsistente com o resto do código — trocar
  pelo mesmo padrão de mensagem fixa usado nas demais Functions.
- Todas as Functions próprias, incluindo `app-set-password`, são publicadas
  com `--no-verify-jwt` (`ADMIN/supabase/README.md`), reforçando que o gate
  padrão de JWT do Supabase (com seus próprios rate limits) não protege
  nenhuma delas — o rate limiting recomendado acima precisa ser implementado
  dentro de cada Function, não pode depender de nenhuma proteção nativa do
  Supabase Auth.

## 12. Crescimento de `license_sessions`, `clock_audits` e eventos

### Situação atual

O Tauri valida a licença a cada 30 segundos. Cada validação cria uma sessão e
uma auditoria novas.

Isso pode gerar até 2.880 linhas por tabela, por usuário, por dia. Com cinco
usuários, são aproximadamente 14.400 linhas por tabela por dia, sem considerar
`app_events` e `audit_log`.

### Risco

- crescimento acelerado do banco;
- aumento de custo;
- degradação de índices e consultas;
- possibilidade de abuso por cliente autenticado.

### Resolução recomendada

- Atualizar uma sessão existente enquanto ela for válida, em vez de inserir
  uma nova a cada polling.
- Criar auditoria apenas em mudança de estado ou intervalo agregado.
- Definir retenção:
  - sessões expiradas: prazo curto;
  - clock audits: prazo necessário para investigação;
  - audit log administrativo: prazo maior;
  - eventos de produto: agregação ou exportação.
- Criar job de limpeza controlado e índices alinhados às consultas.
- Acompanhar tamanho por tabela e crescimento diário.

### Critérios de aceite

- Polling normal não cria milhares de sessões por dia.
- Retenção está documentada e testada.
- Limpeza não remove evidência administrativa ainda necessária.

## 13. Recibo CEP, dispositivo e relógio

### Situação atual

O CEP valida assinatura, algoritmo, chave, emissor, audiência e expiração.
Entretanto:

- a claim `device` é apenas verificada como presente;
- ela não é comparada a uma identidade local da máquina;
- um recibo copiado pode funcionar em outro ambiente até expirar;
- a expiração é avaliada pelo relógio local;
- os dados de relógio enviados ao backend podem ser omitidos ou fabricados
  pelo cliente.

### Resolução recomendada

- Definir formalmente se cópia de recibo faz parte do modelo de ameaça.
- Se necessário, vincular o recibo a um identificador local protegido.
- Manter expiração curta e renovação online.
- Persistir último horário confiável de forma resistente a rollback.
- Não usar campos opcionais enviados pelo cliente como única proteção.

Nenhuma identidade de máquina é perfeita contra um administrador local. O
objetivo deve ser aumentar custo de cópia sem coletar hardware excessivo ou
criar bloqueios falsos.

### Critérios de aceite

- O comportamento de recibo copiado está documentado e testado.
- Alterar o relógio para trás não prolonga indefinidamente o acesso.
- O produto define explicitamente a tolerância offline.

## 14. Segredos e chaves

### Estado positivo atual

- `.env.production.local` está ignorado pelo Git.
- A revisão não encontrou histórico desse arquivo.
- A chave pública versionada é esperada e não é segredo.
- `npm run license:check` valida paridade das chaves.

### Melhorias recomendadas

- Usar um gerenciador de segredos para CI/CD e Supabase.
- Separar segredos de desenvolvimento e produção.
- Registrar proprietário, finalidade, criação e plano de rotação de cada chave.
- Nunca imprimir chave privada ou token em logs.
- Fazer secret scanning no CI.
- Manter backup seguro das chaves necessárias para validar recibos existentes.

## 15. `bridgeToken` e chaves do AEX aposentado

### Situação atual

`validate-license` ainda chama `signAexBridgeToken` e retorna `bridgeToken`.
Isso mantém a Function dependente de uma chave privada de um componente que não
é usado pelo aplicativo atual.

### Risco

- segredo e código desnecessários;
- falha da chave legada pode derrubar toda validação de licença;
- maior superfície de manutenção.

### Resolução recomendada

Planejar a retirada em etapas:

1. Confirmar que nenhuma versão suportada consome `bridgeToken`.
2. Remover a emissão e a resposta do backend.
3. Publicar e monitorar.
4. Somente depois aposentar o segredo.
5. Atualizar documentação, testes e scripts de keygen.

Não remover a chave antes da atualização do backend.

## 16. Dependências e supply chain

### Resultado da revisão

- Admin: nenhuma vulnerabilidade npm conhecida.
- Dependências runtime do Tauri/React: nenhuma vulnerabilidade npm conhecida.
- Dependências runtime do CEP/React: nenhuma vulnerabilidade npm conhecida.
- Toolchain raiz: 7 alertas, 6 altos.
- Toolchain CEP: 34 alertas, 22 críticos, concentrados em dependências Babel
  antigas.
- `cargo-audit`/`cargo-deny` não estavam instalados.

Os alertas CEP são de desenvolvimento/build, mas ainda afetam máquinas de
desenvolvimento e CI.

### Resolução recomendada

- Remover `babel-preset-env` legado e dependências não utilizadas.
- Atualizar Vite, Rollup, Babel, PostCSS e Concurrently.
- Fixar versões e revisar mudanças antes de atualizar locks.
- Fixar versão exata de `@supabase/supabase-js` nas Functions.
- Adicionar lock/config Deno quando compatível com o fluxo Supabase.
- Executar `npm audit`, `cargo audit` e secret scanning no CI.
- Preferir builds reproduzíveis e runners descartáveis.

## 17. Pipeline, payload e versionamento

### Situação atual

As versões estão divergentes:

- raiz: `2.0.0`;
- `tauri.conf.json`: `2.1.0`;
- Cargo: `1.3.0`;
- CEP: `0.0.1`.

`npm run tauri build` empacota o payload existente em `INSTALLER/payload`; ele
não garante que o CEP foi reconstruído e coletado.

### Resolução recomendada

- Definir uma fonte única para a versão do release.
- Sincronizar metadados relevantes antes do build.
- Usar `npm run release:all` como única entrada de release oficial.
- Fazer o pipeline sempre:
  1. instalar dependências por lock;
  2. rodar testes;
  3. rodar auditorias;
  4. construir CEP;
  5. remover artefatos de debug;
  6. assinar CEP;
  7. coletar payload;
  8. verificar fingerprint;
  9. construir Tauri/NSIS;
  10. assinar EXE e setup;
  11. verificar assinaturas;
  12. publicar checksums.

### Critérios de aceite

- Build direto não usa payload antigo silenciosamente.
- Versões exibidas, manifestos e nome do instalador são coerentes.
- Release falha se `.debug`, mapas ou assinaturas estiverem ausentes/incorretos.

## 18. Dados locais e privacidade

### Dados encontrados

- refresh token no Windows Credential Manager;
- recibo CEP em `%LOCALAPPDATA%\com.pc.arizona-app`;
- histórico SQLite com códigos e caminhos de projetos;
- configurações com caminhos locais/de rede;
- logs de instalador com caminhos do usuário.

### Melhorias recomendadas

- Documentar quais dados são gravados e por quanto tempo.
- Restringir logs a informações necessárias.
- Não registrar tokens, senhas, recibos completos ou dados sensíveis de oferta.
- Oferecer limpeza clara de dados locais na desinstalação.
- Manter a opção padrão de preservar dados consciente e documentada.
- Avaliar requisitos da LGPD para e-mail, nome, dispositivo e auditorias.

## 19. Supabase de produção: validações restantes

Em 23/07/2026, a CLI confirmou no projeto remoto:

- migrations locais e remotas em paridade;
- `daily_auth_reset_hour` e o hardening de ativação/MFA aplicados;
- as 13 Edge Functions publicadas com status `ACTIVE`;
- `app-release-device` e as novas Functions de ativação publicadas.

Essa publicação não comprova as opções administrativas do projeto. Antes do
release, ainda é necessário validar no Dashboard:

- RLS habilitado e forçado no banco remoto;
- grants efetivos do schema `licensing`;
- Security Advisor sem alertas críticos;
- Auth signup público conforme política;
- confirmação de e-mail;
- MFA para owners e masters;
- força e proteção contra senhas vazadas;
- rate limits e CAPTCHA;
- SMTP próprio;
- SSL Enforcement;
- Network Restrictions;
- backups e PITR conforme RPO/RTO;
- retenção de logs e tabelas;
- secrets necessários presentes;

Guardar evidências da revisão sem copiar segredos para tickets ou para o Git.

## 20. Testes de segurança recomendados

### Autenticação

- tentativa de primeiro acesso conhecendo apenas o e-mail;
- enumeração de e-mails;
- replay de convite/OTP;
- refresh token usado após 04:00;
- `authMethod` falsificado;
- senha alterada com sessão antiga;
- conta member/master desabilitada.

### Revogação

- liberar dispositivo com o Tauri aberto;
- bloquear organização com o Tauri aberto e fechado;
- revogar membro com CEP aberto;
- trabalhar offline até e depois da expiração;
- desinstalar sem internet e com Supabase indisponível.

### Tauri/local

- chamar todos os comandos sem sessão;
- sessão inventada enviada por IPC;
- tentativa de leitura fora do Asset Protocol permitido;
- XSS em cada janela;
- arquivo com metacaracteres do Windows;
- arquivo vindo de compartilhamento de rede.

### Instalador/CEP

- máquina limpa sem `PlayerDebugMode`;
- máquina com múltiplas versões do After Effects;
- upgrade com AEX legado;
- instalação e desinstalação com After Effects aberto;
- setup adulterado;
- payload CEP adulterado;
- ausência de rede/WebView2;
- assinatura expirada ou inválida.

### Supabase

- chamada direta com publishable key;
- JWT inválido, expirado e de usuário removido;
- acesso direto REST ao schema `licensing`;
- corrida para ocupar o último seat;
- spam de validação e eventos;
- payload de metadata grande.

## 21. Validação de caminhos nos scripts de instalação de assets Adobe

*(Achado novo da auditoria de 23/07/2026 — área não coberta pelas seções
anteriores.)*

### Situação atual

`INSTALLER/scripts/common.ps1` define `Assert-ArizonaCepPath` (linhas
201-219) e `Assert-ArizonaAexPath` (linhas 221-237), que validam apenas os
últimos 2-4 segmentos de nome do caminho (ex.:
`.../Adobe/CEP/extensions/com.arizona-carrefour.cep`), sem nunca ancorar numa
raiz confiável como `%ProgramFiles%` ou `%APPDATA%`. Todo chamador então passa
o próprio diretório pai do alvo como `AllowedParent` para
`Remove-PathSafe`/`Assert-PathInside` (ex.:
`uninstall-adobe-assets.ps1:87-89`), o que torna essa checagem de contenção
autorreferente e, na prática, um no-op. Os caminhos alvo vêm de
`installed-assets.json`, escrito por `install-adobe-assets.ps1:154-166` e lido
de volta sem validação adicional por `uninstall-adobe-assets.ps1:80-84`.

### Risco

Em instalação `perMachine` padrão (`Program Files`, ACLs de admin), não é
explorável por um usuário comum. Se o app for instalado num diretório não
padrão (o instalador NSIS não restringe a escolha na página de diretório) ou
se o ACL de `installed-assets.json` for enfraquecido, os hooks elevados de
instalação/desinstalação (`hooks.nsh`, rodando via `nsExec` com privilégio do
instalador) podem apagar qualquer caminho que bata com os nomes de pasta
esperados, fora do escopo pretendido.

### Resolução recomendada

- Ancorar `Assert-ArizonaCepPath`/`Assert-ArizonaAexPath` a uma raiz confiável
  conhecida (`[Environment]::GetFolderPath('ProgramFiles')\Adobe` ou
  `%APPDATA%\Adobe`), não só aos últimos segmentos do nome.
- Corrigir o `AllowedParent` para não ser o próprio pai do alvo — usar uma
  raiz fixa e validada independentemente do caminho que está sendo checado.
- Aplicar a mesma defesa contra junction/reparse point já existente em
  `Remove-PathSafe` (linhas 283-289) aos componentes intermediários do
  caminho, não só ao segmento final.

### Critérios de aceite

- Um `installed-assets.json` adulterado apontando para fora de `Adobe/CEP` ou
  `Adobe/.../Plug-ins/Arizona` é rejeitado antes de qualquer exclusão.
- Teste automatizado cobre instalação em diretório não padrão.

## Plano de execução sugerido

### Fase P0 — antes de qualquer distribuição

1. Substituir `app-set-password` por convite/OTP seguro; desabilitar signup
   público do GoTrue (ou exigir `email_confirmed_at`) para fechar também o
   vetor de `resolveMember`/`resolveMaster` (seção 1).
2. Tornar a reautenticação diária server-side.
3. Corrigir revogação e reativação de dispositivo.
4. Fazer o Rust ser a autoridade local de sessão.
5. Publicar `app-release-device`.
6. Assinar Tauri, NSIS e CEP.
7. Testar instalação CEP em máquina limpa.

### Fase P1 — hardening

1. Adicionar CSP e separar capabilities.
2. Restringir Asset Protocol.
3. Autenticar todos os comandos sensíveis.
4. Remover `.debug`, mapas e senhas de exemplo.
5. Substituir `cmd /C start`.
6. Retirar tokens master de `localStorage`.
7. Adicionar rate limits, CAPTCHA e limites de payload; padronizar mensagem
   de erro genérica também em `master-create-organization` (seção 11).
8. Implementar retenção das tabelas operacionais.
9. Confinar `open_media_native` ao diretório do job (seção 6); exigir token
   do instalador nas flags de CLI de desinstalação (seção 3).

### Fase P2 — operação e manutenção

1. Atualizar toolchain e adicionar auditoria no CI.
2. Unificar versões e tornar builds reproduzíveis.
3. Retirar `bridgeToken` de forma planejada.
4. Formalizar política offline e device binding.
5. Documentar privacidade, backup, RPO/RTO e resposta a incidentes.
6. Ancorar `Assert-ArizonaCepPath`/`Assert-ArizonaAexPath` a uma raiz
   confiável nos scripts do instalador (seção 21).

## Comandos úteis de validação

Executar sempre na pasta correta de cada projeto.

```powershell
# Raiz
npm run build
npm run license:check
npm run installer:test
npm run release:check
npm audit
npm audit --omit=dev

# Rust
cd src-tauri
cargo fmt --check
cargo test
cargo audit

# Extensão CEP
cd ARIZONA-EXTENSION
npm run build
npm audit
npm audit --omit=dev

# Admin
cd ADMIN
npm test
npm run build
npm audit

# Assinatura Windows
Get-AuthenticodeSignature .\src-tauri\target\release\arizona-app.exe
Get-AuthenticodeSignature .\src-tauri\target\release\bundle\nsis\*-setup.exe
```

O release oficial deve adicionar verificações automatizadas que falhem quando
algum requisito obrigatório deste documento não for atendido.
