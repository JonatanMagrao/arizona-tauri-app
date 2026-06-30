# Plano: Integracao Tauri + Extensao CEP do After Effects

## Objetivo

Conectar o Arizona App em Tauri a uma extensao CEP do After Effects para:

- validar e liberar uso com base em licenca;
- bloquear o painel CEP quando a licenca nao estiver valida;
- enviar comandos seguros do Tauri para o painel CEP;
- manter o ExtendScript dentro da extensao CEP, como camada local de execucao no After Effects;
- evitar que logica sensivel de licenca, tokens duradouros ou permissoes fiquem dentro do CEP.

## Premissa Principal

O Tauri deve ser a autoridade local de sessao/licenca. O CEP deve depender do Tauri para saber se esta liberado.

O CEP pode conter o ExtendScript necessario para controlar o After Effects, mas nao deve decidir sozinho se o usuario tem permissao para usar a ferramenta. Se o Tauri nao validar a licenca, o painel CEP entra em modo bloqueado.

## Arquitetura Recomendada

```text
Backend de licenca
        |
        | login, refresh, validacao de plano, dispositivo, expiracao
        v
Arizona App / Tauri
        |
        | canal local autenticado
        v
Painel CEP no After Effects
        |
        | CSInterface.evalScript(...)
        v
ExtendScript / After Effects
```

## Responsabilidades

### Backend

- Autenticar usuario e organizacao.
- Validar assinatura, plano, assento e status da licenca.
- Emitir tokens curtos para o Tauri.
- Controlar expiracao, revogacao e limite de dispositivos quando necessario.

### Tauri

- Fazer login e refresh de sessao.
- Guardar tokens sensiveis no cofre do sistema.
- Validar se a licenca local esta ativa.
- Abrir um canal local para o CEP.
- Autorizar ou negar conexoes do CEP.
- Enviar comandos estruturados para o CEP.
- Assinar mensagens da sessao local.
- Bloquear comandos quando a licenca expirar, for revogada ou estiver incompleta.

### CEP

- Conectar ao Tauri quando o painel abrir.
- Fazer handshake com o Tauri.
- Exibir estado bloqueado quando nao houver autorizacao.
- Receber apenas comandos conhecidos.
- Validar argumentos antes de chamar ExtendScript.
- Executar ExtendScript local via `CSInterface.evalScript(...)`.
- Nunca guardar token duradouro ou segredo de licenca.

### ExtendScript

- Ficar como camada de execucao do After Effects.
- Fazer operacoes especificas: trocar texto, importar arquivo, ajustar composicao, renderizar, localizar layer, etc.
- Nao conter regra de licenca.
- Nao aceitar codigo arbitrario vindo do Tauri; preferir funcoes conhecidas com argumentos controlados.

## Canal Local

Opcoes consideradas:

- WebSocket em `127.0.0.1` com porta aleatoria por sessao.
- HTTP local em `127.0.0.1`, bom para chamadas simples, menos ideal para eventos continuos.
- Named pipe no Windows, preferivel para controle mais fechado por usuario.

Recomendacao inicial:

- usar WebSocket local se a prioridade for simplicidade e compatibilidade com CEP;
- avaliar named pipe se for viavel no CEP e se quisermos reduzir superficie de rede local.

## Fluxo de Autorizacao

1. Usuario abre o Arizona App.
2. Tauri carrega sessao segura do cofre do sistema.
3. Tauri valida licenca com o backend ou com cache local de curta duracao.
4. Tauri cria uma sessao local para o CEP.
5. Usuario abre o painel CEP no After Effects.
6. CEP tenta conectar no Tauri.
7. Tauri exige handshake com nonce e token efemero.
8. Se a licenca estiver valida, Tauri libera comandos.
9. Se a licenca estiver invalida, expirada ou ausente, Tauri responde bloqueado.
10. CEP mostra tela bloqueada e nao executa ExtendScript sensivel.

## Formato de Comando

Evitar enviar ExtendScript bruto como texto livre. Preferir comandos estruturados:

```json
{
  "id": "cmd_001",
  "type": "ae.command",
  "command": "replace_text",
  "args": {
    "layerName": "PRECO",
    "value": "19,90"
  },
  "nonce": "session-message-nonce",
  "seq": 12,
  "expiresAt": "2026-06-30T21:00:00Z",
  "signature": "hmac..."
}
```

O CEP traduz esse comando para uma chamada interna conhecida, por exemplo:

```javascript
runReplaceText({ layerName: "PRECO", value: "19,90" });
```

## Seguranca

Medidas recomendadas:

- Conectar apenas em `127.0.0.1`, nunca em `0.0.0.0`.
- Usar porta aleatoria por execucao, quando for WebSocket/HTTP.
- Fazer handshake com nonce/desafio.
- Usar token local efemero por sessao.
- Assinar mensagens com HMAC ou chave de sessao.
- Usar `seq` ou nonce por mensagem para evitar replay.
- Expirar comandos rapidamente.
- Manter allowlist de comandos conhecidos.
- Validar argumentos no Tauri e no CEP.
- Nao permitir comando arbitrario tipo `evalScript(rawJsx)`.
- Nao colocar chaves, secrets ou refresh tokens dentro do CEP.
- Guardar tokens sensiveis somente no cofre do sistema via Tauri.
- Assinar o instalador/app Tauri.
- Assinar/distribuir a extensao CEP de forma controlada.
- Registrar logs sem tokens, sem signatures completas e sem payload sensivel.

## Limite Realista de Protecao

Nao existe protecao perfeita contra interceptacao em codigo rodando na maquina do usuario. Um usuario com controle local avancado pode tentar inspecionar memoria, trafego local, arquivos da extensao, DevTools do CEP ou binarios.

O objetivo e fazer com que uma interceptacao nao entregue nada valioso:

- sem segredo permanente no CEP;
- sem token reutilizavel por muito tempo;
- sem licenca decidida localmente apenas pelo CEP;
- sem comando bruto perigoso;
- sem permissao offline longa demais;
- sem endpoint local exposto para a rede.

## Comportamento Quando Bloqueado

O painel CEP deve bloquear quando:

- o Tauri nao estiver aberto;
- o Tauri nao conseguir validar sessao;
- o usuario nao tiver licenca ativa;
- a organizacao estiver sem assento disponivel;
- o token local expirar;
- a assinatura de mensagem falhar;
- a versao do CEP for incompatvel com a versao minima exigida pelo Tauri/backend.

Possivel UX:

- mostrar estado "Abra o Arizona App para validar sua licenca";
- botao "Tentar novamente";
- mensagem curta quando a licenca estiver expirada;
- sem revelar detalhes tecnicos de seguranca.

## Fases de Implementacao

### Fase 1: Contrato e Prototipo Local

- Definir lista inicial de comandos.
- Definir payload JSON padrao.
- Criar handshake simples entre CEP e Tauri.
- Fazer CEP bloquear quando nao houver conexao.
- Enviar um comando simples do Tauri para o CEP.

### Fase 2: Licenca como Autoridade

- Conectar estado real de licenca do Tauri ao canal local.
- Bloquear comandos quando a licenca estiver invalida.
- Adicionar cache local curto para tolerar oscilacao de internet.
- Garantir que o CEP nao consiga liberar a si mesmo.

### Fase 3: Endurecimento do Canal

- Adicionar nonce/desafio.
- Adicionar assinatura por mensagem.
- Adicionar expiracao e sequencia.
- Adicionar allowlist forte de comandos.
- Sanitizar logs.

### Fase 4: Distribuicao e Versoes

- Definir versao minima do CEP aceita pelo Tauri.
- Definir versao minima do Tauri aceita pelo backend.
- Assinar/distribuir a extensao.
- Criar fluxo de atualizacao quando houver incompatibilidade.

### Fase 5: Auditoria e Testes

- Testar CEP sem Tauri aberto.
- Testar licenca expirada.
- Testar comando com assinatura invalida.
- Testar replay de comando antigo.
- Testar porta local inacessivel de fora da maquina.
- Testar abertura/fechamento do After Effects sem derrubar o Tauri e vice-versa.

## Decisoes Pendentes

- WebSocket local ou named pipe.
- Quanto tempo o app pode funcionar offline.
- Como vincular dispositivo/usuario/organizacao.
- Quais comandos entram na primeira versao.
- Como o CEP descobre a porta/sessao do Tauri.
- Como distribuir a extensao CEP para usuarios finais.
- Se o Tauri deve abrir o After Effects e o painel, ou apenas validar quando o painel ja estiver aberto.

## Nao Objetivos

- Esconder completamente o ExtendScript de usuarios avancados.
- Colocar logica de licenca dentro do CEP.
- Enviar scripts arbitrarios do Tauri para o CEP.
- Expor servidor local na rede.
- Depender de segredo fixo embutido no painel CEP.

## Recomendacao Final

Manter o ExtendScript no CEP e usar o Tauri como autoridade de licenca e emissor de comandos e o caminho mais equilibrado.

Isso permite bloquear a extensao quando a licenca nao estiver valida, sem transformar o painel CEP no guardiao da seguranca. O CEP executa; o Tauri autoriza; o backend decide a licenca.
