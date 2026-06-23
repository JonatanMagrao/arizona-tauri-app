# Plano de licenciamento, seats e telemetria com Supabase

## Objetivo

Criar uma camada de controle para o Arizona App usando Supabase, permitindo que um admin gerencie empresas, seats, emails autorizados, dispositivos ativos e telemetria simples de uso.

A ideia nao e criar uma protecao impossivel de quebrar, porque apps desktop sempre podem ser modificados por alguem com tempo e conhecimento. O objetivo e criar uma validacao pratica, discreta e forte o suficiente para uso real: controlar acesso, limitar seats, revogar usuarios/dispositivos e entender quais botoes sao mais usados.

Decisao arquitetural: Supabase deve ser uma camada opcional, isolada e removivel. O app nao deve depender diretamente de Supabase nos fluxos principais. Se no futuro for preciso voltar para uma versao sem Supabase, a troca deve acontecer por provider/config/feature flag, sem reescrever o app.

## Escopo inicial

- Admin cadastra uma organizacao/cliente.
- Admin define a quantidade de seats permitidos.
- Admin registra emails autorizados.
- App valida o email/dispositivo ao abrir.
- App salva um token local temporario para permitir uso offline por um periodo curto.
- App registra telemetria apenas das acoes dos botoes.
- App evita que alterar data/hora do computador seja um bypass simples.

## Premissas de removibilidade

- React nao fala diretamente com Supabase.
- Rust/Tauri concentra toda regra sensivel de licenca.
- Supabase fica atras de interfaces internas, nao espalhado pelo app.
- Deve existir um modo `Noop` que sempre libera o app e ignora telemetria.
- Com Supabase desligado, o app deve funcionar como hoje.
- Telemetria deve passar por uma funcao central, como `track_event`.
- Remover Supabase deve significar trocar provider/desligar feature, nao apagar chamadas em dezenas de arquivos.

## Arquitetura plugavel

### Rust/Tauri

Estrutura sugerida:

```text
src-tauri/src/licensing/
  mod.rs
  provider.rs
  noop.rs
  supabase.rs
  local_token.rs
  clock_guard.rs
  types.rs

src-tauri/src/telemetry/
  mod.rs
  provider.rs
  noop.rs
  supabase.rs
  types.rs
```

Interfaces conceituais:

```rust
trait LicenseProvider {
    fn status(&self) -> Result<LicenseStatus, String>;
    fn activate(&self, input: ActivateLicenseInput) -> Result<LicenseStatus, String>;
    fn refresh(&self) -> Result<LicenseStatus, String>;
}

trait TelemetryProvider {
    fn track(&self, event: AppEvent) -> Result<(), String>;
    fn flush(&self) -> Result<(), String>;
}
```

Providers previstos:

- `SupabaseLicenseProvider`: valida online, renova token e consulta Edge Functions.
- `NoopLicenseProvider`: sempre libera o app.
- `SupabaseTelemetryProvider`: envia eventos para Supabase.
- `NoopTelemetryProvider`: ignora eventos.

### Feature flag e config

Usar dois niveis:

```toml
[features]
default = []
licensing = []
```

E tambem uma config runtime:

```json
{
  "licensingEnabled": true,
  "telemetryEnabled": true
}
```

Feature flag ajuda em builds realmente sem Supabase. Config runtime ajuda a desligar rapidamente sem recompilar.

### React

Estrutura sugerida:

```text
src/licensing/
  LicenseGate.jsx
  ActivationView.jsx
  LicenseBlockedView.jsx
  useLicenseStatus.js

src/lib/
  license.js
  telemetry.js
```

O app principal ficaria envolvido por:

```jsx
<LicenseGate>
  <MainApp />
</LicenseGate>
```

Em uma versao sem Supabase, o `LicenseGate` pode ser removido ou mantido usando o provider `Noop`.

### Comandos Tauri

Usar nomes genericos, sem Supabase no nome:

- `license_status`
- `license_activate`
- `license_refresh`
- `license_deactivate_device`
- `track_event`
- `telemetry_flush`

## Modelo de dados sugerido

### `organizations`

Representa uma empresa, cliente ou grupo autorizado.

Campos sugeridos:

- `id`
- `name`
- `seats_allowed`
- `status`: `active`, `paused`, `blocked`
- `created_at`
- `updated_at`

### `members`

Representa os emails autorizados dentro de uma organizacao.

Campos sugeridos:

- `id`
- `organization_id`
- `email`
- `role`: `admin`, `member`
- `status`: `active`, `disabled`, `revoked`
- `created_at`
- `updated_at`

### `devices`

Representa uma instalacao autorizada do app.

Campos sugeridos:

- `id`
- `organization_id`
- `member_id`
- `install_id`
- `device_label`
- `app_version`
- `last_seen_at`
- `status`: `active`, `disabled`, `revoked`
- `created_at`
- `updated_at`

### `license_sessions`

Representa validacoes emitidas pelo servidor.

Campos sugeridos:

- `id`
- `organization_id`
- `member_id`
- `device_id`
- `issued_at`
- `expires_at`
- `server_time`
- `status`: `active`, `expired`, `revoked`

### `app_events`

Representa telemetria leve dos botoes.

Campos sugeridos:

- `id`
- `organization_id`
- `member_id`
- `device_id`
- `event_name`
- `app_version`
- `success`
- `error_code`
- `created_at`

Eventos iniciais sugeridos:

- `app_open`
- `open_jobao`
- `open_jobinho`
- `open_after`
- `open_video`
- `reveal_video`
- `open_audio`
- `open_script`
- `copy_files`
- `open_duplicate_identical`
- `open_history`
- `open_places_crf`
- `open_settings`
- `invalid_code`

## Fluxo de ativacao

1. Usuario abre o app.
2. App procura um token local valido.
3. Se nao existir token, abre uma tela simples pedindo email.
4. App envia para uma Supabase Edge Function:
   - email
   - `install_id`
   - versao do app
   - dados leves do ambiente, se necessario
5. Edge Function valida:
   - email existe em `members`
   - membro esta ativo
   - organizacao esta ativa
   - seats disponiveis
   - dispositivo nao esta revogado
6. Se aprovado:
   - cria ou atualiza `devices`
   - cria uma sessao em `license_sessions`
   - devolve um token assinado com validade curta
7. App salva o token localmente.
8. App libera a interface principal.

## Token local

O token local deve existir para evitar que o app dependa da internet em toda abertura.

Sugestao:

- validade curta: 24h a 7 dias
- emitido apenas pelo servidor
- assinado pela Edge Function
- salvo pelo Rust/Tauri, nao pelo React
- contem:
  - `organization_id`
  - `member_id`
  - `device_id`
  - `install_id`
  - `issued_at`
  - `expires_at`
  - `server_time_at_issue`

O frontend React nao deve decidir se a licenca e valida. Ele apenas pergunta ao Rust/Tauri se o app esta liberado.

## Protecao contra alteracao de data/hora

A fonte de verdade deve ser o horario do servidor.

Estrategia sugerida:

- Servidor sempre retorna `server_time`.
- App salva localmente:
  - ultimo horario confirmado pelo servidor
  - ultimo horario local visto
  - ultimo token valido
  - tempo monotonicamente observado durante a execucao
- Se o horario local voltar muito no tempo, o app marca o estado como suspeito.
- Em estado suspeito, o app exige validacao online.
- Se estiver offline e dentro do periodo de tolerancia, pode permitir uso limitado.
- Se estiver offline e houver forte indicio de manipulacao de relogio, bloquear ate reconectar.

Limite importante: nenhum app desktop consegue impedir 100% esse tipo de tentativa quando esta offline. O objetivo e impedir que mudar a data do PC seja um bypass simples.

## Telemetria

Telemetria deve ser minima e focada apenas nas acoes dos botoes.

Nao enviar:

- caminhos completos de arquivos
- nomes de projetos sensiveis
- conteudo de arquivos
- dados pessoais desnecessarios

Enviar:

- nome do evento
- sucesso ou erro
- versao do app
- usuario/organizacao/dispositivo
- timestamp do servidor

## Arquitetura sugerida

### Supabase

- Postgres para dados.
- Row Level Security para proteger tabelas.
- Edge Functions para validacao sensivel.
- Service role apenas no servidor, nunca dentro do app.

### Rust/Tauri

Responsavel por:

- gerar e manter `install_id`
- validar token local
- chamar Edge Functions
- controlar estado de licenca
- registrar eventos
- proteger dados sensiveis fora do React

### React

Responsavel por:

- tela de ativacao
- tela de bloqueio/licenca invalida
- mensagens amigaveis
- chamar comandos Tauri
- mostrar estados de loading/erro

## Fases de implementacao

### Fase 0: Casca removivel

- Criar modulos `licensing` e `telemetry` no Rust.
- Criar providers `Noop`.
- Criar comandos Tauri genericos:
  - `license_status`
  - `license_activate`
  - `license_refresh`
  - `track_event`
- Criar `LicenseGate` no React.
- Garantir que, usando `Noop`, o app funcione exatamente como hoje.

Resultado esperado: arquitetura pronta para receber Supabase sem acoplar o app principal.

### Fase 1: Fundacao

- Criar schema Supabase.
- Criar Edge Function `validate-license`.
- Implementar provider Supabase atras da interface `LicenseProvider`.
- Criar armazenamento local de `install_id`.
- Criar tela simples de ativacao por email.

Resultado esperado: app abre apenas para email autorizado.

### Fase 2: Seats e dispositivos

- Validar `seats_allowed`.
- Registrar dispositivo por `install_id`.
- Bloquear novos dispositivos quando seats acabarem.
- Permitir revogar dispositivo no banco.

Resultado esperado: admin controla quantas instalacoes podem usar o app.

### Fase 3: Token local e offline

- Emitir token local temporario.
- Validar token local no Rust.
- Renovar token silenciosamente quando online.
- Criar periodo de tolerancia offline.

Resultado esperado: app continua utilizavel sem internet por um periodo controlado.

### Fase 4: Relogio suspeito

- Salvar ultimo horario confirmado pelo servidor.
- Detectar grandes retornos no horario local.
- Exigir validacao online em caso suspeito.
- Melhorar mensagens para o usuario.

Resultado esperado: alterar a data do PC deixa de ser um bypass simples.

### Fase 5: Telemetria dos botoes

- Usar o comando Rust `track_event`.
- Enviar eventos pelo provider ativo.
- Registrar eventos principais dos botoes.
- Enviar eventos em lote quando fizer sentido.
- Ignorar falhas de telemetria para nao travar o uso do app.

Resultado esperado: admin consegue ver uso real do app sem coletar dados sensiveis.

### Fase 6: Admin

- Comecar com gestao manual direto no Supabase.
- Depois criar uma tela admin simples:
  - organizacoes
  - seats
  - emails
  - dispositivos
  - eventos recentes

Resultado esperado: controle operacional sem precisar mexer direto no banco.

## Plano de remocao ou rollback

Se for preciso voltar para uma versao sem Supabase:

1. Desligar `licensingEnabled` e `telemetryEnabled`, ou compilar sem a feature `licensing`.
2. Usar `NoopLicenseProvider` e `NoopTelemetryProvider`.
3. Manter comandos Tauri genericos retornando sucesso/noop.
4. Opcionalmente remover `LicenseGate` do React.
5. Remover dependencias Supabase/HTTP apenas se a remocao for definitiva.

Arquivos que devem concentrar a remocao:

- `src-tauri/src/licensing/`
- `src-tauri/src/telemetry/`
- `src/licensing/`
- `src/lib/license.js`
- `src/lib/telemetry.js`

O restante do app deve continuar com pouca ou nenhuma alteracao.

## Decisoes pendentes

- Login sera apenas por email validado ou tera magic link/codigo?
- Seat conta por email, por dispositivo, ou email + limite de dispositivos?
- Quantos dias offline serao permitidos?
- O admin ficara dentro do app, em uma janela separada, ou em uma pagina web?
- Telemetria ficara apenas como tabela ou tera dashboard visual?
- Licenca bloqueada deve impedir tudo ou permitir acesso parcial?
- O modo sem Supabase sera controlado por feature flag, config runtime, ou ambos?

## Primeira entrega recomendada

Implementar primeiro a casca removivel, ainda sem Supabase ativo:

1. Criar providers `Noop`.
2. Criar comandos genericos de licenca e telemetria.
3. Criar `LicenseGate`, mas deixando o app passar direto.
4. Criar `trackEvent` centralizado no frontend.
5. Confirmar que, com tudo desligado, o app funciona exatamente como hoje.

Depois disso, implementar Supabase por tras da interface, sem mexer no fluxo principal do app.
