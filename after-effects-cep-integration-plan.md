# Plano: Licenciamento da Extensao CEP pelo Tauri

## Objetivo

Fazer a extensao CEP do After Effects responder ao licenciamento do Arizona App em Tauri sem usar o CEP como ponte de comandos.

A extensao deve apenas verificar um recibo de licenca assinado. Se o recibo for valido e liberar a feature `ae_panel`, a UI normal monta. Se nao for valido, a extensao fica bloqueada com uma mensagem estatica.

## Decisao Atual

O CEP nao sera mais usado como ponte de comandos entre Tauri e After Effects.

Os comandos automatizados que antes estavam planejados para passar pelo CEP foram movidos para o plugin nativo AEX. O AEX e o responsavel por receber os atalhos/comandos seguros do Tauri e executar a logica do After Effects.

O papel do CEP fica limitado a:

- ler o recibo local emitido pelo Tauri;
- verificar a assinatura do recibo;
- liberar ou bloquear a interface;
- manter a logica visual e os fluxos existentes da extensao quando licenciada.

## Arquitetura Final

```text
Backend de licenca
        |
        | valida plano, dispositivo, assento e expiracao
        | emite recibo JWS assinado
        v
Arizona App / Tauri
        |
        | grava snapshot local sem segredo
        v
cep-license-receipt.json
        |
        | leitura local + verificacao de assinatura
        v
Extensao CEP no After Effects
        |
        | monta UI somente quando ae_panel estiver liberado
        v
ExtendScript local da extensao
```

Em paralelo:

```text
Arizona App / Tauri
        |
        | canal seguro do AEX
        v
Plugin AEX nativo
        |
        v
After Effects
```

## Responsabilidades

### Backend

- Autenticar usuario e organizacao.
- Validar plano, assento, dispositivo e expiracao.
- Emitir a sessao usada pelo Tauri.
- Emitir o `bridgeToken` curto usado pelo AEX quando aplicavel.
- Emitir um recibo JWS assinado para o CEP quando a feature `ae_panel` estiver liberada.

### Tauri

- Ser a autoridade local da sessao/licenca.
- Guardar tokens sensiveis no cofre do sistema.
- Receber o recibo assinado do backend durante login, resume e refresh.
- Gravar `cep-license-receipt.json` no diretorio local da aplicacao.
- Apagar `cep-license-receipt.json` quando a sessao for limpa, o device for liberado, o keyring falhar ou o app sair.
- Remover `cep-bridge-session.json` legado no startup.
- Continuar enviando comandos After apenas para o AEX, nao para o CEP.

### Extensao CEP

- Ler `cep-license-receipt.json`.
- Verificar assinatura e validade temporal do recibo.
- Liberar a UI apenas se `licensed === true` e `allowedFeatures` contiver `ae_panel`.
- Mostrar estado bloqueado quando o recibo estiver ausente, expirado, invalido ou sem `ae_panel`.
- Nao guardar segredo permanente ou regra sensivel de licenca.
- Nao receber comandos do Tauri e nao executar `evalScript` por pedido do Tauri.

### ExtendScript

- Continuar como camada local da propria extensao.
- Nao conter regra de licenca.
- Nao ser alterado por esta etapa.

### Plugin AEX

- Continuar responsavel por comandos/atalhos After vindos do Tauri.
- Nao ser alterado por esta etapa.

## Contrato do Recibo

O backend retorna o recibo como string compact JWT/JWS no campo:

- `token`.

Por compatibilidade, o cliente tambem aceita:

- `cepLicenseReceipt`;
- `cep_license_receipt`;
- `licenseReceipt`;
- `license_receipt`;
- `receipt`.

O Tauri grava o arquivo local:

```json
{
  "version": 1,
  "receipt": "<compact-jws>",
  "updatedAt": "2026-07-01T12:00:00Z"
}
```

O JWS usa `ES256` e deve ser validado pela chave publica P-256 embutida na extensao.

Payload minimo esperado:

```json
{
  "iss": "arizona-app",
  "aud": "arizona-license",
  "jti": "<token-id>",
  "sub": "<member-id>",
  "org": "<organization-id>",
  "device": "<device-id>",
  "session": "<license-session-id>",
  "role": "admin",
  "exp": 1780000000,
  "email": "usuario@empresa.com"
}
```

Campos aceitos:

- `allowedFeatures`, `allowed_features` ou `features`;
- `organizationName` ou `organization_name`;
- `expiresAt`, `expires_at` ou `exp`;
- `nbf` para recibo ainda nao ativo;
- quando nao houver campo explicito de features, `aud: arizona-license` libera o painel CEP.

## O Que Foi Removido do Plano CEP

- WebSocket local do CEP;
- `cep-bridge-session.json` como arquivo ativo;
- token efemero do bridge CEP;
- `cep.hello`;
- `bridge.hello`;
- `cep.ping` e `cep.pong`;
- `license.status`;
- `blocked` vindo por socket;
- comandos como `ae.command`, `ae.result` e `cep.event`;
- captura de atalhos CEP para ponte com Tauri;
- `evalScript` acionado pelo Tauri.

## Comportamento Quando Bloqueado

O painel CEP deve bloquear quando:

- o arquivo `cep-license-receipt.json` nao existir;
- o recibo nao estiver assinado por chave confiavel;
- o recibo estiver expirado ou ainda nao ativo;
- `licensed` for falso;
- `allowedFeatures` nao incluir `ae_panel`.

UX atual:

- mensagem estatica: `Plugin bloqueado. Valide a licença novamente no Arizona App.`;
- sem botao de retry;
- sem oscilacao visual a cada checagem.

## O Que Manter

- Tauri como autoridade da sessao local;
- AEX como executor nativo dos comandos After;
- CEP como interface bloqueavel;
- recibo local sem segredo, protegido por assinatura;
- limpeza do recibo em logout, liberacao de device e perda de sessao segura.

## Fases de Implementacao

### Fase 1: Tauri

- Aceitar `cepLicenseReceipt` vindo do backend.
- Persistir o recibo no keyring junto com a sessao.
- Gravar `cep-license-receipt.json` quando a sessao for ativada.
- Apagar o recibo em logout, liberacao de device, keyring invalido e fechamento do app.
- Parar de iniciar o bridge WebSocket CEP.
- Remover `cep-bridge-session.json` legado no startup.

### Fase 2: Extensao

- Criar leitor/verificador de `cep-license-receipt.json`.
- Verificar JWS `ES256`.
- Liberar UI apenas com `ae_panel`.
- Mostrar bloqueio estatico quando invalido.

### Fase 3: Validacao

- Build da extensao.
- Build web do Tauri.
- `cargo check` do Tauri.
- Teste manual dos estados: sem recibo, recibo invalido, recibo expirado e recibo valido.

## Pendencias de Producao

- Inserir a chave publica de producao na extensao.
- Confirmar o `app_local_data_dir` final em Windows e macOS para instaladores assinados.

## Nao Objetivos

- Alterar logica do plugin AEX.
- Alterar logica de negocio da extensao.
- Mover comandos After para o Tauri.
- Executar ExtendScript por comando vindo do Tauri.
- Colocar segredo permanente dentro do CEP.
- Impedir adulteracao por usuario local com acesso total ao binario.

## Recomendacao Final

O recibo assinado e o desenho mais simples para producao nesta fase: o arquivo local nao precisa ser secreto, porque a extensao confia na assinatura, nao no conteudo cru do JSON.

Isso remove a superficie do bridge CEP, evita expor token local de socket e mantem o AEX como unico caminho de comandos nativos.
