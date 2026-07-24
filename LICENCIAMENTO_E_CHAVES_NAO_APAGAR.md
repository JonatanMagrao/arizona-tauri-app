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

O ciclo de autenticação diária é separado do refresh token do Supabase. Cada
licença possui `daily_auth_reset_hour`, configurável no painel Admin como
“Renovação diária”, em `America/Sao_Paulo`. O padrão é `04:00`; horários
anteriores ao corte ainda pertencem ao ciclo do dia anterior. A Edge Function
`validate-license` limita o recibo CEP a 15 minutos e nunca o estende além do
próximo corte ou da validade da licença.

Build de diagnóstico:

```text
cd ARIZONA-EXTENSION
npm run build:debug
```

Somente esse build grava `cep-license-debug.json`.

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
