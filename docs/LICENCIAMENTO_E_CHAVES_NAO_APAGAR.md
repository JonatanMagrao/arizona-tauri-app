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

## Assinatura da extensão CEP (.zxp)

Essa é uma identidade criptográfica **diferente** da chave do recibo. A chave do
recibo diz *se o usuário tem licença*. O certificado de assinatura diz *quem
publicou a extensão*. As duas precisam ser preservadas, e por motivos distintos.

O fluxo antigo copiava a pasta compilada `ARIZONA-EXTENSION/dist/cep` — saída de
build **sem assinatura** — para `%APPDATA%\Adobe\CEP\extensions`. Uma árvore sem
assinatura só carrega com o `PlayerDebugMode` ligado; esse fluxo não faz mais
parte do instalador oficial.

Agora a extensão é distribuída como `.zxp` assinado. O instalador extrai o
pacote inteiro na pasta de extensões e o CEP confere a assinatura **da pasta
instalada** no momento de carregar. A árvore extraída precisa ser idêntica, byte
a byte, ao conteúdo do `.zxp` — inclusive `META-INF/signatures.xml`, `mimetype`
e `.debug`.

### Material privado crítico

```text
ARIZONA-EXTENSION/certs/arizona-cep-signing.p12
ARIZONA-EXTENSION/certs/cep-signing.json
```

Os dois **precisam estar gitignored** e **estão no mesmo patamar da chave
privada de licença**. O `.p12` é a identidade de publicador da Arizona. O
`cep-signing.json` guarda o caminho e a **senha do `.p12` em texto claro** — ele
não é menos sensível que o certificado, é a outra metade dele. Confira antes de
qualquer commit:

```powershell
git check-ignore -v ARIZONA-EXTENSION/certs/arizona-cep-signing.p12 ARIZONA-EXTENSION/certs/cep-signing.json
```

Os dois caminhos precisam aparecer na saída. Se `cep-signing.json` não aparecer,
**pare e corrija o `.gitignore` antes de commitar** (`*.p12` cobre o
certificado, mas não cobre o json).

Formato do `cep-signing.json`:

```json
{
  "p12Path": "<absoluto ou relativo ao repositório>",
  "password": "<gerada>",
  "commonName": "...",
  "createdAt": "<ISO>"
}
```

Faça backup dos dois **fora do repositório**. Perder o `.p12` não é uma
inconveniência de build: todo build seguinte sairia com outra identidade de
publicador, e os instaladores já distribuídos — que confiam na impressão digital
antiga — recusariam o `.zxp` novo. Voltar a instalar exigiria acrescentar a
impressão digital nova a `INSTALLER/cep-trusted-cert.json`, gerar um build novo
do app e distribuir esse instalador para toda a frota **antes** de qualquer
`.zxp` assinado pelo certificado novo poder ser instalado.

Em CI, `CEP_SIGNING_P12` e `CEP_SIGNING_PASSWORD` têm precedência sobre o json.

### Manifesto público dos certificados aceitos

```text
INSTALLER/cep-trusted-cert.json
```

Versionado no Git e com **apenas material público** — o mesmo papel que
`ADMIN/supabase/license-trusted-keys.json` cumpre para as chaves do recibo:

```json
{
  "schemaVersion": 1,
  "certificates": [
    {
      "id": "v1",
      "sha256": "<hex minúsculo do certificado DER>",
      "commonName": "...",
      "notAfter": "...",
      "addedAt": "..."
    }
  ]
}
```

É uma **lista** de propósito. A rotação é aditiva, igual à das chaves do recibo:
acrescente o certificado novo sem remover o antigo, distribua o app que confia
nos dois, só então volte a assinar com o novo e remova o antigo quando não
sobrar instalador antigo em campo. Remover primeiro deixa sem caminho de
atualização toda instalação já feita.

Duas propriedades desse manifesto explicam por que ele não pode ser apagado nem
esvaziado:

- ele é embutido no binário em tempo de compilação
  (`include_str!("../../INSTALLER/cep-trusted-cert.json")` em
  `src-tauri/src/cep_manager.rs`). Ninguém amplia a confiança editando um
  arquivo na máquina do cliente, e **mudar a lista exige um build novo do app**;
- ele **falha fechado**. Manifesto ausente é erro de compilação; manifesto
  inválido ou com a lista vazia resulta em zero impressões digitais confiáveis,
  e aí nenhum `.zxp` instala. Um `.zxp` sem assinatura é recusado exatamente
  como um assinado por outra pessoa.

O `notAfter` do manifesto é informativo, mas o prazo é real. O empacotador exige
TSA por padrão, normaliza somente o whitespace que o `ZXPSignCmd` insere dentro
de `SignatureValue` e depois valida o carimbo RFC 3161 sobre o XML canônico
final. O gate confere a assinatura CMS, a cadeia e o EKU do TSA, o `genTime` e o
`messageImprint`; não aceita apenas a presença de um bloco de timestamp. Não
use `--allow-skip-tsa` em um release publicável.

O mesmo `genTime` ancora a validade do certificado de assinatura da Arizona:
o Node exige que ele estivesse entre o `notBefore` e o `notAfter` do certificado
quando o TSA emitiu o token. Validar somente a cadeia e a validade do
certificado do TSA deixaria essa prova incompleta.

O `ZXPSignCmd` 4.1.3 ainda imprime `Invalid timestamp` para esse formato mesmo
quando o token RFC 3161 e seu `messageImprint` validam criptograficamente. Por
isso o pipeline usa o verificador próprio para o timestamp e continua usando o
`ZXPSignCmd -verify` para a assinatura Adobe do conteúdo. O certificado atual
também permanece válido até 2046; não trate a mensagem textual da ferramenta
como prova isolada de validade ou invalidade.

### Definição da impressão digital

Uma definição só, usada por Node, PowerShell e Rust: **SHA-256 em hex minúsculo
sobre os bytes DER crus do certificado X.509 de assinatura**. O documento XML
precisa conter exatamente uma `Signature`, um `KeyInfo`, um `X509Data` e um
`X509Certificate`; o certificado fica no caminho direto
`Signature > KeyInfo > X509Data > X509Certificate`, todos no namespace XMLDSig.
`KeyInfo` e `X509Data` não podem conter material de chave alternativo nem existir
como elementos-isca em outro ponto do documento.
Comentários, certificados-isca, namespaces errados, múltiplas assinaturas e
qualquer estrutura ambígua são recusados.

### O que o pin prova e o que não prova

**O pin é uma checagem de identidade, não uma verificação de assinatura.** Por
isso ele nunca é usado sozinho: app e instalador também verificam a XMLDSig com
a chave do certificado pinado e comparam os digests SHA-256 de todos os arquivos
da árvore; o CEP da Adobe repete a verificação ao carregar. O pipeline de
release ainda valida o timestamp RFC 3161. Antes de trocar a instalação, o fluxo
`per-user` do Tauri desliga `PlayerDebugMode` para que um ajuste legado não
elimine a última barreira do CEP. O helper elevado do instalador Full não toca
em HKCU; ligar esse modo continua sendo uma exceção explícita de
desenvolvimento/suporte que relaxa essa barreira externa.

Quando a checagem de identidade falha, tanto a inspeção quanto a instalação
devolvem (convenção `code: message` já usada por `src-tauri/src/cep_manager.rs`):

```text
cep_zxp_untrusted -> "Este .zxp não foi assinado pelo certificado da Arizona."
```

### `.debug` não pode ser removido do pacote

`.debug` está **dentro do manifesto de assinatura** do `.zxp`, junto com
`mimetype` e `META-INF/signatures.xml`. Apagá-lo depois de assinar quebra a
verificação da Adobe: a extensão volta a exigir `PlayerDebugMode` ou
simplesmente não carrega. Por isso o pipeline de release não remove mais
`.debug`, e a verificação de release não pode mais falhar por encontrá-lo.

Pela mesma razão o instalador **não copia mais uma pasta de build**: ele extrai
o `.zxp` assinado. Copiar arquivos soltos volta a produzir uma árvore que não
corresponde à assinatura.

### Comandos

```text
npm run cep:cert           (uma vez; perigoso — recusa sem --force)
npm run cep:zxp            (gera o .zxp assinado em dist-cep/)
npm run cep:verify -- <zxp> (valida pin, assinatura Adobe e timestamp RFC 3161)
npm run release:installer  (agora produz um payload CEP assinado)
npm run installer:test
```

A coleta escolhe o `.zxp` somente pela versão de
`ARIZONA-EXTENSION/package.json`; a versão do app não é fallback para o nome do
artefato CEP. Sem `-ZxpPath`, a própria coleta gera um pacote novo antes de
copiá-lo para o payload.

`npm run cep:cert` cria a identidade de publicador. Rodar de novo por engano
troca o certificado de todos os builds futuros e invalida a impressão digital
fixada nos instaladores em campo; por isso ele se recusa a sobrescrever um
`.p12` existente sem `--force`, exatamente como os keygens de licença.

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

### Assinatura do .zxp da extensão CEP

Arquivos privados locais, que precisam estar gitignored — **faça backup fora do
repositório**:

```text
ARIZONA-EXTENSION/certs/arizona-cep-signing.p12
ARIZONA-EXTENSION/certs/cep-signing.json   (contém a senha do .p12)
```

Manifesto público versionado:

```text
INSTALLER/cep-trusted-cert.json
```

Perder o `.p12` troca a identidade de publicador de todos os builds futuros e os
instaladores em campo passam a recusar o `.zxp` novo. Apagar uma entrada do
manifesto antes de a frota inteira estar em um app que confia no certificado
novo tem o mesmo efeito prático. Ver "Assinatura da extensão CEP (.zxp)".

## Instalação local do CEP

Instalador Full oficial (`perMachine`, com preferência por
`CommonProgramW6432` para não cair em `Program Files (x86)`):

```text
%CommonProgramW6432%\Adobe\CEP\extensions\com.arizona-carrefour.cep
```

Staging e backups do Full ficam em
`%CommonProgramW6432%\Adobe\CEP\.arizona-install-work`, fora de
`extensions`. O helper elevado não escreve em `%APPDATA%` nem altera HKCU.

O atualizador independente do CEP executado pelo Tauri continua per-user em:

```text
C:\Users\<usuario>\AppData\Roaming\Adobe\CEP\extensions\com.arizona-carrefour.cep
```

O work root desse fluxo também é irmão de `extensions`, em
`%APPDATA%\Adobe\CEP\.arizona-install-work`; staging e backup nunca ficam em
uma pasta que o CEP possa carregar como outra cópia do bundle.

Ambos extraem o `.zxp` assinado; nenhum copia a pasta de build (ver "Assinatura
da extensão CEP (.zxp)"). Em desenvolvimento, o build da extensão pode criar
uma junction do caminho per-user para
`ARIZONA-EXTENSION\dist\cep` — essa árvore de desenvolvimento não é assinada e
continua exigindo `PlayerDebugMode`. A desinstalação remove apenas a junction,
nunca o conteúdo do alvo.

A assinatura ZXP não assina o Arizona App nem o setup. Authenticode continua
uma etapa externa e ainda precisa retornar `Valid` para os dois artefatos. O
smoke test do Full em máquina limpa, com `PlayerDebugMode` ausente, também é uma
validação separada e não foi substituído pelos testes criptográficos.

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

A ação **Resetar TOTP**, a Function `master-reset-member-totp` e o compartilhado
`_shared/mfa-recovery.ts` foram removidos em 03/08/2026: não sobrou nenhum
encanamento de TOTP no produto. `admin-add-member` e `admin-list-members`
continuam ativos, assim como a janela **Gestão** do Tauri para sessões com papel
`admin`. O painel Admin web permanece como fluxo separado para a conta master.

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

`validate-license` também recusa com `clock_suspicious` diferenças ou
retrocessos de relógio superiores a cinco minutos. A evidência permanece em
`licensing.clock_audits`, separada da auditoria administrativa, e as ocorrências
`suspicious` aparecem para a conta master na view somente leitura
`licensing.activity_log`. Repetições do mesmo estado são limitadas a uma por
hora por dispositivo. Uma falha ao gravar essa observabilidade é registrada nos
logs da Function, mas nunca muda nem bloqueia a decisão de licenciamento.

`license_expires_on` é o **último dia completo válido**. O bloqueio acontece na
hora da renovação diária do dia seguinte, em `America/Sao_Paulo`, e não mais às
`23:59:59.999Z`. O cálculo fica no helper `licenseExpiryInstant`
(`ADMIN/supabase/functions/_shared/auth-cycle.ts`) e é usado por
`validate-license`, `app-activate`, `app-activate-device`,
`admin-generate-activation-code`. O corte atinge o Tauri e a extensão CEP ao
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
npm run cep:cert             (raiz; identidade de publicador do .zxp)
```

`npm run cep:cert` é de uso único. Ele se recusa a sobrescrever um `.p12`
existente sem `--force`, e rodá-lo com `--force` sem uma rotação planejada
invalida a impressão digital fixada em todos os instaladores já distribuídos.

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

## Rotação correta do certificado do .zxp

A ordem é o inverso da intuição: **o app precisa confiar no certificado novo
antes de o certificado novo assinar qualquer coisa.**

1. Decidir explicitamente a rotação.
2. Gerar o certificado novo (`npm run cep:cert -- --force`) preservando o `.p12`
   antigo em backup fora do repositório.
3. **Adicionar** a entrada nova a `INSTALLER/cep-trusted-cert.json` sem remover
   a antiga.
4. Gerar e distribuir o instalador do app que confia nos dois.
5. Só então voltar a assinar (`npm run cep:zxp`, `npm run release:installer`)
   com o certificado novo.
6. Remover a entrada antiga do manifesto apenas quando não sobrar instalador
   antigo em campo.

Pular a etapa 4 é o erro caro: um `.zxp` assinado pelo certificado novo é
recusado com `cep_zxp_untrusted` por toda instalação que ainda fixa somente o
antigo.

## Checklist

- Li este arquivo.
- Rodei `npm run license:check`.
- Confirmei a extensão CEP instalada.
- Não vou rodar keygen sem rotação planejada.
- Não vou rodar `npm run cep:cert` de novo: o `.p12` de assinatura já existe e
  trocá-lo invalida a impressão digital fixada nos instaladores em campo.
- Tenho backup de `ARIZONA-EXTENSION/certs/arizona-cep-signing.p12` e de
  `ARIZONA-EXTENSION/certs/cep-signing.json` fora do repositório.
- Rodei `git check-ignore -v` nos dois e confirmei que nenhum deles vai para o
  commit — o json carrega a senha do `.p12`.
- Não vou apagar `INSTALLER/cep-trusted-cert.json` nem remover uma entrada dele
  antes de a frota inteira aceitar o certificado novo.
- Sei que `.debug` faz parte do pacote assinado e não pode ser removido da
  árvore empacotada.
- Sei que o pin do certificado é checagem de identidade; app e instalador
  verificam a XMLDSig e os digests antes da troca, e o CEP repete a verificação
  no carregamento.
- Sei que os atalhos atuais usam JSX embutido, não AEX.
- Não vou apagar chaves legadas enquanto a compatibilidade não for encerrada.
- Sei que desligar o MFA do Supabase Auth é opcional desde 03/08/2026: nada
  mais o utiliza, com a v2.1.1 bloqueada na validação.
