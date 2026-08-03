# LICENCIAMENTO E CHAVES — NÃO APAGAR

Este arquivo documenta a arquitetura de licenciamento do Arizona App.

NÃO APAGUE este arquivo. NÃO apague, regenere, sobrescreva ou troque chaves de
licença sem uma rotação planejada. Não rode scripts de geração de chaves como
parte de build, teste, debug ou deploy comum.

## Diagnóstico rápido

Na raiz:

```text
npm run license:check
```

O comando confere a chave privada local de licença, o manifesto público, o PEM,
o módulo gerado da extensão, a extensão CEP instalada, o recibo atual e o
executor JSX embutido no Tauri. O recibo é assinado pelo Supabase remoto e
também denuncia secrets remotos fora de sincronia.

## Arquitetura atual

Existem dois comportamentos independentes:

1. **Extensão CEP**
   - Usa `cepLicenseReceipt`.
   - O backend assina um recibo JWS ES256.
   - O Tauri salva o recibo em disco.
   - A extensão lê o arquivo e valida a assinatura contra a lista de chaves
     públicas embutida no build.

2. **Atalhos do After Effects**
   - Não usam plugin AEX, named pipe nem `bridgeToken`.
   - O Tauri exige sua própria sessão autenticada.
   - O motor de ações fica em
     `src-tauri/src/after_effects/arizona_actions.jsx` e é embutido no binário
     com `include_str!`.
   - Ao executar um atalho, o Tauri materializa o JSX nos dados locais do app e
     chama `AfterFX.exe -r <acao.jsx>`.

O backend e o Tauri atuais não geram nem retornam `bridgeToken`. Os
secrets/chaves legadas do AEX continuam arquivados e não devem ser removidos
sem uma decisão explícita de rotação/aposentadoria definitiva.

## Fonte única da verdade das chaves da extensão CEP

```text
ADMIN/supabase/license-trusted-keys.json
```

Esse manifesto contém apenas chaves públicas e é versionado. A extensão nunca é
editada manualmente para trocar chave:

- `ARIZONA-EXTENSION/scripts/generate-license-trusted-keys.mjs` lê o manifesto
  e gera `src/js/main/services/licenseTrustedKeys.generated.ts`;
- o gerador roda antes de `dev`, `watch`, `build`, `zxp` e `zip`;
- o build falha se manifesto, módulo gerado e PEM divergirem.

A rotação é gradual: adicione a chave nova sem remover a antiga, distribua a
extensão, troque os secrets do backend e só então remova a antiga.

## Arquivos e segredos que não podem ser apagados

### Backend / Supabase

Arquivo privado local e gitignored:

```text
ADMIN/supabase/functions/.env.production.local
```

Segredos ativos da licença CEP:

```text
LICENSE_TOKEN_KEY_ID
LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64
```

Segredos legados do bridge, preservados durante a migração:

```text
AEX_BRIDGE_TOKEN_KEY_ID
AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64
```

### Chaves públicas versionadas

```text
ADMIN/supabase/license-trusted-keys.json
ADMIN/supabase/license-token-public-key.v1.pem
ADMIN/supabase/aex-bridge-token-public-key.v1.json   (legado; não apagar)
```

Os keygens se recusam a sobrescrever o env sem `--force` e criam backup datado
antes de escrever. Esses backups podem ser a única cópia da chave anterior.

## Instalação local do CEP

Produção:

```text
C:\Users\<usuario>\AppData\Roaming\Adobe\CEP\extensions\com.arizona-carrefour.cep
```

O instalador copia a pasta compilada para o perfil do usuário. Em
desenvolvimento, o build da extensão pode criar uma junction desse caminho para
`ARIZONA-EXTENSION\dist\cep`. A desinstalação remove apenas a junction, nunca o
conteúdo do alvo.

## Fluxo da extensão CEP

1. O usuário valida a licença no Arizona App.
2. O Tauri chama `validate-license`.
3. A função gera `cepLicenseReceipt` com
   `LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64` e `kid=LICENSE_TOKEN_KEY_ID`.
4. O Tauri salva:

```text
C:\Users\<usuario>\AppData\Local\com.pc.arizona-app\cep-license-receipt.json
```

5. A extensão relê o arquivo a cada 5 segundos e valida:
   - `kid` na lista confiável;
   - assinatura ES256;
   - `iss=arizona-app`, `aud=arizona-license`;
   - `iat`, `nbf` e `exp`;
   - feature `ae_panel`.

O app renova o recibo automaticamente enquanto está aberto. Fechar o app não
apaga o recibo; logout explícito apaga. Motivos comuns de bloqueio:

```text
receipt_missing
receipt_kid_unknown
receipt_signature_invalid
receipt_expired
feature_missing
```

Build de diagnóstico:

```text
cd ARIZONA-EXTENSION
npm run build:debug
```

Somente esse build grava `cep-license-debug.json`.

## Confiança de máquina no lugar do autenticador

O acesso do usuário no Arizona App não usa mais autenticador TOTP. A janela de
login do Tauri é só de ativação: e-mail + código de 12 caracteres. Depois da
ativação, aquele usuário não se autentica de novo naquela máquina. O que
substitui o TOTP é a identidade do hardware:

- o Tauri envia `deviceFingerprintHash`, o SHA-256 de
  `arizona-device-fp:v1:{MachineGuid}`, com o GUID lido de
  `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
  (`src-tauri/src/device_identity.rs`). Se o registro não puder ser lido, o
  cliente 2.2.0 falha localmente com `device_identity_required`, antes de
  consumir código ou chamar a rede;
- `ADMIN/supabase/functions/_shared/device-fingerprint.ts` classifica o valor
  que chega: igual ao gravado é `keep`; diferente do gravado é `mismatch`;
  ausente onde já existe um gravado é `missing`, o rebaixamento que um cliente
  adulterado tentaria para desligar a checagem naquela máquina;
- em `mismatch` ou `missing`, `validate-license` responde `403
  device_not_active` e grava `device.fingerprint_mismatch` em
  `licensing.audit_log`, registrando apenas os 12 primeiros caracteres de cada
  hash. `app-activate-device` faz o mesmo quando não há concessão de vínculo,
  em vez de deixar a tentativa chegar à gravação;
- **o fingerprint só é gravado por uma ativação respaldada por código.**
  `validate-license` nunca grava. `app-activate-device` só grava quando existe
  a concessão de vínculo descrita abaixo. Confiar no primeiro valor que
  aparecesse permitiria que uma credencial copiada reivindicasse a máquina e
  trancasse o dono para fora do próprio lugar;
- cadastrar uma máquina exige essa concessão de uso único. `app-activate` a
  emite ao consumir um código de ativação, gravando `device_bind_not_before` e
  `device_bind_expires_at` em `licensing.members` (migration
  `20260803120000_device_bind_grant.sql`, prazo de 30 minutos).
  `app-activate-device` só a aceita de uma sessão criada em ou depois de
  `device_bind_not_before`, gasta-a por um UPDATE condicional **antes** de
  gravar o device — quem apagar primeiro leva o vínculo —, restaura-a se a
  gravação do device falhar e recusa a segunda tentativa. Se a própria ativação
  falhar, o rollback de `app-activate` apaga a concessão junto com o código. É
  isso que impede um registro copiado do Windows Credential Manager de cadastrar
  outro computador; a validação no computador para onde ele foi copiado é
  recusada pela divergência de fingerprint — e, desde 03/08/2026, um device sem
  fingerprint gravado nem valida (ver abaixo);
- sem concessão, `app-activate-device` responde `device_activation_expired` a
  uma instalação que nunca foi cadastrada e `device_revoked` a uma instalação
  que já foi liberada e tenta voltar sozinha. Nos dois casos a saída é a mesma
  e, no suporte, a leitura também: "peça um código novo";
- revogar o device também anula a concessão ainda não gasta. Liberar dispositivo
  pelo painel (`admin-release-device`), liberar pelo próprio app
  (`app-release-device`) e remover membro (`admin-remove-member`) chamam
  `clearDeviceBindGrant` logo depois de
  revogar device e sessões. O portão de reativação de uma instalação liberada
  aceita a concessão como autoridade; sem essa limpeza, a máquina recém-liberada
  gastaria uma concessão pendente e retomaria o próprio lugar em silêncio por até
  30 minutos. Só um código consumido **depois** da liberação a traz de volta;
- a liberação feita pelo próprio app ("Liberar e sair") envia o `installId` junto
  com o `source`, e `app-release-device` recusa com `403 device_not_active` —
  registrando `device.self_release_rejected` — a liberação pedida por uma
  instalação que não é a dona do lugar. A checagem só vale de fato com a frota na
  2.2.0: a v2.1.1 não envia o campo e continua sendo aceita, assim como a
  liberação disparada pelo desinstalador.

O vínculo de máquina vale para a **frota inteira** desde 03/08/2026.
`validate-license` recusa também o device que **não tem** fingerprint gravado:
a resposta é `403 device_not_active` com "Reactivate this machine." e a
auditoria registra `device.fingerprint_mismatch` com `outcome: "unbound"`.
Distribuir a 2.2.0 não basta: cada máquina que estava em campo precisa passar
por uma ativação respaldada por código — é ela que grava o fingerprint —, então
cada usuário recebe um código novo junto com o instalador 2.2.0.

A lacuna do valor vazio foi fechada: hoje ele é recusado em todos os caminhos.
Na validação, `device_not_active` — "Update the app to continue." quando a
requisição chega sem fingerprint (é o que a v2.1.1 aposentada sempre envia) e
"Reactivate this machine." quando o device não tem valor gravado. Na ativação,
a máquina que não consegue se identificar é recusada com
`device_identity_required` **antes** de a concessão ser gasta, então o mesmo
código sobrevive para nova tentativa; o cliente 2.2.0 nem chega à rede nesse
caso — quando o `MachineGuid` não pode ser lido, ele falha localmente com
`device_identity_required`, sem consumir código. Não existe mais nenhuma
gravação deliberada de fingerprint vazio.

O MFA do Supabase Auth pode ser **desligado** no painel do projeto: nenhum
fluxo o utiliza mais. O backend não consulta fatores, o cliente 2.2.0 não
cadastra nada e a v2.1.1 — a única que cadastrava o fator TOTP sozinha, contra
o GoTrue — está bloqueada na validação. Desligar é opcional e apenas remove um
resíduo cosmético.

A ação **Resetar TOTP** e a Function `master-reset-member-totp` foram removidas
do painel, do projeto Supabase e do repositório em 03/08/2026, junto com
`admin-add-member`, `admin-list-members` e o compartilhado
`_shared/mfa-recovery.ts`: não sobrou nenhum encanamento de TOTP no produto.
A administração acontece somente no painel Admin web — a Gestão do Tauri foi
removida e essa capacidade nunca existiu dentro do app.

O mesmo painel oferece ao master **Zerar tempos** por usuário. Essa ação remove
somente os eventos de rate limit atribuíveis ao ID, e-mail e identidade de ator
daquele membro. Ela não muda a configuração das políticas, não remove dados de
acesso e preserva os limites globais de IP e de outros atores.

O ciclo de autenticação diária é separado do refresh token do Supabase. Cada
licença possui `daily_auth_reset_hour`, configurável no painel Admin como
“Renovação diária”, em `America/Sao_Paulo`. O padrão é `04:00`; horários
anteriores ao corte ainda pertencem ao ciclo do dia anterior. A Edge Function
`validate-license` limita o recibo CEP a 15 minutos e nunca o estende além do
próximo corte ou da validade da licença.

`license_expires_on` é o **último dia completo válido**. O bloqueio acontece na
hora da renovação diária do dia seguinte, em `America/Sao_Paulo`, e não mais às
`23:59:59.999Z`. O cálculo fica no helper `licenseExpiryInstant`
(`ADMIN/supabase/functions/_shared/auth-cycle.ts`) e é usado por
`validate-license`, `app-activate`, `app-activate-device`,
`admin-generate-activation-code` e `track-event`. O corte atinge o Tauri e a extensão CEP ao
mesmo tempo: o app percebe na próxima verificação de 30 segundos e o recibo
assinado já carrega esse limite, que o painel relê a cada 5 segundos. Como o
prazo está dentro do recibo e da sessão local, o bloqueio também vale offline.

## Fluxo dos atalhos via ExtendScript embutido

1. O Tauri registra os seis atalhos configuráveis.
2. No disparo, valida que a sessão local está autenticada.
3. Resolve a versão configurada do After Effects; se ela não existir, usa a
   versão instalada mais recente.
4. Gera os lançadores em:

```text
%LOCALAPPDATA%\com.pc.arizona-app\after-effects-scripts\
```

5. Executa:

```text
AfterFX.exe -r <acao.jsx>
```

As ações preservadas são:

```text
move_layers_backward
move_layers_forward
move_jump_marker
select_jump_marker_layer
adjust_markers_to_tail
render
```

Nenhum arquivo é instalado em `Support Files\Plug-ins` ou `Support Files\Scripts`.
O instalador novo remove com segurança o arquivo legado exato
`Plug-ins\Arizona\ArizonaBridgeTest.aex` durante upgrade/desinstalação e só
remove a pasta `Arizona` se ela ficar vazia.

## Chaves legadas do AEX

`AE-PLUGIN-ARIZONA/` e `aex-bridge-token-public-key.v1.json` são arquivos
históricos. Eles não entram no build ou instalador atuais. Não os “limpe” por
conveniência: clientes antigos ou rollback podem depender deles enquanto a
migração não for encerrada formalmente.

Não rode:

```text
npm run bridge:keygen:env
```

a menos que o usuário peça explicitamente uma rotação do sistema legado.

## Por que build pode quebrar licença

Build comum não quebra licença. O que quebra é mudar a identidade criptográfica
sem atualizar todos os consumidores. Exemplos:

- chave privada do Supabase muda antes de a extensão confiar na pública nova;
- env incorreto é enviado para os secrets remotos;
- extensão antiga continua instalada depois de rotação;
- extensão instalada aponta para bundle/local server incorreto.

## Comandos perigosos

Não rode sem rotação planejada:

```text
npm run license:keygen:env   (ADMIN/)
npm run bridge:keygen:env    (ADMIN/, legado)
```

Tenha cuidado extremo com:

```text
npx supabase secrets set --env-file supabase\functions\.env.production.local
```

Antes de enviar secrets, rode `npm run license:check`.

## Rotação correta da chave CEP

1. Decidir explicitamente a rotação.
2. Em `ADMIN`, rodar `npm run license:keygen:env -- --force`.
3. O keygen faz backup, adiciona a chave nova ao manifesto sem remover a antiga
   e grava o PEM.
4. Em `ARIZONA-EXTENSION`, rodar `npm run build`.
5. Distribuir a extensão nova.
6. Enviar secrets e redeployar `validate-license`.
7. Rodar `npm run license:check` até tudo passar.
8. Remover a chave antiga apenas quando todas as máquinas aceitarem a nova.

## Checklist

- Li este arquivo.
- Rodei `npm run license:check`.
- Confirmei a extensão CEP instalada.
- Não vou rodar keygen sem rotação planejada.
- Sei que os atalhos atuais usam JSX embutido, não AEX.
- Não vou apagar chaves legadas enquanto a compatibilidade não for encerrada.
- Sei que desligar o MFA do Supabase Auth é opcional desde 03/08/2026: nada
  mais o utiliza, com a v2.1.1 bloqueada na validação.
