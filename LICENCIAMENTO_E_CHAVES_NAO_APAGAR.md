# LICENCIAMENTO E CHAVES - NAO APAGAR

Este arquivo documenta a arquitetura de licenciamento do Arizona App.

NAO APAGUE este arquivo.
NAO APAGUE, regenere, sobrescreva ou troque chaves de licenca sem uma rotacao planejada.
NAO rode scripts de geracao de chaves como parte de build, teste, debug ou deploy comum.

As chaves descritas aqui funcionam como certificados de infraestrutura. Se uma chave privada do backend nao combinar com uma chave publica confiada pela extensao CEP ou pelo plugin AEX, o usuario valido fica bloqueado mesmo com licenca ativa.

## Diagnostico rapido

Antes de mexer em qualquer coisa, rode na raiz do arizona-tauri-app:

```text
npm run license:check
```

Esse comando confere a paridade entre: env local, manifesto de chaves, PEM versionado, fonte da extensao, extensao instalada no Adobe CEP e o recibo atual em disco (que e assinado pelo Supabase remoto, entao tambem denuncia secrets remotos fora de sincronia). Ele diz exatamente qual lado esta divergente e o que fazer.

## Resumo critico

Existem dois fluxos independentes de licenciamento:

1. Extensao CEP (codigo em `ARIZONA-EXTENSION/` na raiz deste repo)
   - Usa o `cepLicenseReceipt`.
   - O backend assina um recibo de licenca (JWS ES256).
   - O Tauri salva esse recibo em disco.
   - A extensao CEP le esse arquivo e valida a assinatura contra a LISTA de chaves publicas confiaveis embutidas nela no build.

2. Plugin AEX / atalhos globais do After Effects
   - Usa o `bridgeToken`.
   - O backend assina um token curto para comandos do bridge.
   - O Tauri envia esse token para o plugin AEX pelo named pipe do Windows.
   - O plugin AEX valida a assinatura com outra chave publica embutida nele.

Esses fluxos nao sao a mesma coisa. Um pode estar funcionando enquanto o outro esta bloqueado.

## Fonte unica da verdade das chaves da extensao CEP

```text
ADMIN/supabase/license-trusted-keys.json
```

Esse manifesto (apenas chaves PUBLICAS, versionado no git) lista todas as chaves que a extensao aceita, por `kid`. A extensao NUNCA e editada na mao para trocar chave:

- `ARIZONA-EXTENSION/scripts/generate-license-trusted-keys.mjs` le o manifesto e gera `src/js/main/services/licenseTrustedKeys.generated.ts`;
- esse gerador roda automaticamente antes de `dev`, `watch`, `build`, `zxp` e `zip` (hooks `pre*` no package.json da extensao);
- o build FALHA se o manifesto estiver ausente, invalido ou divergente do PEM correspondente.

Como a extensao aceita uma lista de chaves, a rotacao e gradual: adicione a chave nova ao manifesto SEM remover a antiga, distribua a extensao, troque os secrets do backend e so entao remova a antiga.

## Arquivos e segredos que nao podem ser apagados

### Backend / Supabase

Arquivo local privado, gitignored:

```text
ADMIN/supabase/functions/.env.production.local
```

Contem os segredos usados pela Edge Function `validate-license`:

```text
LICENSE_TOKEN_KEY_ID
LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64
AEX_BRIDGE_TOKEN_KEY_ID
AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64
```

Esses valores precisam bater com as chaves publicas confiadas pelos clientes. Os keygens agora se recusam a sobrescrever esse arquivo sem `--force`, e com `--force` salvam backup datado (`.env.production.local.bak.<data>`) antes de escrever. Guarde esses backups: sao a unica copia da chave privada anterior.

### Chaves publicas versionadas

```text
ADMIN/supabase/license-trusted-keys.json
ADMIN/supabase/license-token-public-key.v1.pem
ADMIN/supabase/aex-bridge-token-public-key.v1.json
```

### Instalacao local do CEP

No Windows, a extensao instalada e uma junction:

```text
C:\Users\<usuario>\AppData\Roaming\Adobe\CEP\extensions\com.arizona-carrefour.cep
  -> <repo>\ARIZONA-EXTENSION\dist\cep
```

A junction e criada/atualizada pelo build da extensao (vite-cep-plugin, `symlink: "local"`). A extensao nao deve apontar para um `localhost` errado em producao; o painel empacotado carrega os assets locais da propria extensao.

## Fluxo da extensao CEP

1. O usuario valida a licenca no Arizona App.
2. O Tauri chama a Edge Function `validate-license`.
3. A funcao gera um `cepLicenseReceipt` assinado com `LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64` e `kid = LICENSE_TOKEN_KEY_ID`.
4. O Tauri salva o recibo em:

```text
C:\Users\<usuario>\AppData\Local\com.pc.arizona-app\cep-license-receipt.json
```

5. A extensao CEP rele esse arquivo a cada 5 segundos e valida:
   - `kid` presente na lista de chaves confiaveis;
   - assinatura ES256;
   - `iss=arizona-app`, `aud=arizona-license`;
   - `iat`, `nbf` (com tolerancia de 120s para relogio local) e `exp`;
   - feature `ae_panel`.

O Arizona App renova o recibo automaticamente enquanto estiver aberto (revalidacao a cada 30s). O recibo expira sozinho (login diario, 03:00 UTC). Fechar o Arizona App NAO apaga o recibo — a extensao continua funcionando ate o `exp`. O recibo so e apagado no logout explicito.

Se a validacao falhar, o painel CEP bloqueia mostrando o motivo entre parenteses:

```text
Plugin bloqueado. Valide a licenca novamente no Arizona App. (receipt_kid_unknown)
```

Motivos comuns de bloqueio:

```text
receipt_missing            nao existe cep-license-receipt.json (valide no Arizona App)
receipt_kid_unknown        backend assinou com chave que a extensao nao conhece (rode license:check)
receipt_signature_invalid  chave divergente entre backend e extensao (rode license:check)
receipt_expired            recibo venceu (login diario; valide no Arizona App)
feature_missing            recibo sem a feature ae_panel
```

### Build de diagnostico da extensao

O arquivo `cep-license-debug.json` (ao lado do recibo) so e gravado por builds de diagnostico:

```text
cd ARIZONA-EXTENSION
npm run build:debug
```

Builds normais (`npm run build`, `npm run zxp`) nao gravam diagnostico.

## Fluxo do plugin AEX / atalhos globais

1. O usuario valida a licenca no Arizona App.
2. O Tauri chama a Edge Function `validate-license`.
3. A funcao gera um `bridgeToken` assinado com `AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64`.
4. O Tauri mantem o token no estado da sessao e o renova automaticamente.
5. Ao executar um atalho global, o Tauri envia um comando para o named pipe:

```text
\\.\pipe\arizona-aegp-bridge
```

6. O payload inclui `protocolVersion=arizona.aex.v1`, `command`, `issuedAt`, `expiresAt` e `bridgeToken`.
7. O plugin AEX valida protocolo, tempo, assinatura ES256, `kid`, `iss=arizona-app`, `aud=arizona-aex-bridge` e a feature `ae_bridge`.

Se o token for recusado dentro do AEX, o Tauri pode nao receber resposta de erro (o bridge escreve no pipe sem canal de retorno). O sintoma pode ser: o atalho nao faz nada.

### Estado atual do plugin AEX (2026-07-02)

O codigo do plugin esta em `AE-PLUGIN-ARIZONA/` neste repo. A chave publica entra por defines de COMPILACAO (`ARIZONA_AEX_JWT_ES256_PUBLIC_X/Y`, `ARIZONA_AEX_JWT_KID`), via `sample/Win/build.ps1`.

O `.aex` atualmente instalado no After Effects e uma **build de desenvolvimento**: nao tem chave embutida e aceita apenas o dev-token (`npm run tauri:dev:bridge`). Com token real de producao ele recusa tudo silenciosamente. O `license:check` (secao 7) avisa sobre isso.

Para gerar a build de producao do AEX:

1. Pegue kid/X/Y com `cd ADMIN && node scripts/generate-aex-bridge-token-key.mjs --help` — ou simplesmente do `aex-bridge-token-public-key.v1.json`.
2. Rode `sample/Win/build.ps1` com `ARIZONA_AEX_JWT_KID`, `ARIZONA_AEX_JWT_ES256_PUBLIC_X/Y` e `ARIZONA_TAURI_CERT_SHA256` (thumbprint do certificado que assina o executavel do Tauri — a build Release exige cert pinning; sem exe assinado, o plugin de producao recusa o cliente).
3. Reinstale o `.aex` no After Effects e teste os atalhos.

## Por que dev/build pode quebrar licenca

Build e modo dev nao quebram a licenca por si so. O que quebra e mudar a identidade criptografica sem atualizar todos os lados. Historico real: em 2026-07-02 a extensao bloqueou porque os secrets remotos passaram a usar uma chave nova (kid `v1`) enquanto a extensao instalada so confiava na chave antiga — e a chave privada antiga tinha sido sobrescrita pelo keygen. As protecoes atuais (manifesto + gerador no build + guard de sobrescrita + license:check) existem para impedir a repeticao disso.

Quebra quando:

- a chave privada do Supabase muda sem a extensao ganhar a chave publica nova no manifesto;
- um `.env.production.local` incorreto e enviado para os secrets remotos;
- uma extensao/plugin antigo continua instalado depois de rotacionar chaves;
- a extensao CEP instalada aponta para um `localhost` errado.

## Comandos perigosos

Nao rode sem uma rotacao planejada:

```text
npm run license:keygen:env   (ADMIN/)
npm run bridge:keygen:env    (ADMIN/)
```

Ambos agora se recusam a sobrescrever chave existente sem `--force` e fazem backup datado com `--force`. Ainda assim: gerar chave nova sem reconstruir e reinstalar todos os consumidores causa bloqueio.

Tenha cuidado extremo com:

```text
npx supabase secrets set --env-file supabase\functions\.env.production.local
```

Antes de enviar secrets, rode `npm run license:check` e confirme que tudo esta em paridade. Atencao: a Edge Function pode continuar servindo a chave antiga ate a instancia ser reciclada — a troca de secrets nao tem efeito imediato.

## Comandos normalmente seguros

```text
npm run build                      (raiz ou ARIZONA-EXTENSION)
npm run tauri:dev:bridge           (raiz; habilita token dev do bridge AEX)
npx supabase functions deploy validate-license --project-ref nizchnscqkixawqxrwzd --use-api --no-verify-jwt
```

## Rotacao correta de chaves (CEP)

1. Decidir explicitamente que a chave sera rotacionada.
2. `cd ADMIN && npm run license:keygen:env -- --force` — gera par novo com kid unico, faz backup do env, adiciona a chave nova ao manifesto SEM remover a antiga e grava o PEM.
3. `cd ARIZONA-EXTENSION && npm run build` — a extensao passa a confiar na chave antiga E na nova.
4. Reinstalar/distribuir a extensao em todas as maquinas.
5. `npx supabase secrets set --env-file supabase\functions\.env.production.local` e redeploy da `validate-license`.
6. `npm run license:check` na raiz ate tudo passar.
7. Quando todas as maquinas tiverem a extensao nova, remover a chave antiga do manifesto e rebuildar.

Para o AEX: `npm run bridge:keygen:env -- --force`, recompilar o plugin com a chave publica nova, reinstalar no After Effects, enviar secrets e testar os atalhos.

Nunca rotacione apenas um lado.

## Bloqueios esperados

O Arizona App pode bloquear sessao quando: login diario expira; limite de dispositivos; usuario revogado; organizacao inativa; relogio local suspeito; licenca expirada; backend sem os tokens esperados.

A extensao CEP bloqueia independentemente quando: nao existe recibo; recibo expirado; assinatura/kid nao confere com o manifesto embutido; feature ausente; recibo apagado no logout.

O AEX pode bloquear ou ignorar atalhos quando: `bridgeToken` ausente/expirado; assinatura/kid nao bate; plugin compilado com outra chave publica; versao antiga do plugin instalada.

## Desenvolvimento local

Tauri com AEX em dev:

```text
npm run tauri:dev:bridge
```

Extensao CEP em dev (`cd ARIZONA-EXTENSION && npm run dev`): confirme que a extensao instalada aponta para o servidor/pasta corretos. Fora do CEP (navegador), a extensao roda destravada em modo `browser_dev`.

## Checklist antes de mexer em licenciamento

- Li este arquivo.
- Rodei `npm run license:check` e entendi o estado atual.
- Sei qual fluxo estou mexendo: CEP, AEX ou ambos.
- Nao vou rodar keygen sem rotacao planejada (e sei que ele exige --force para sobrescrever).
- Confirmei qual extensao CEP esta instalada no Adobe CEP (junction -> ARIZONA-EXTENSION/dist/cep).
- Confirmei qual plugin AEX esta instalado no After Effects.

## Regra final

Licenciamento nao e parte descartavel do projeto. Nao limpe, nao "organize", nao regenere e nao substitua estes arquivos por conveniencia.

Se algo parecer duplicado ou velho, investigue antes. Neste sistema, um arquivo aparentemente simples pode ser a unica coisa mantendo usuarios validos desbloqueados.
