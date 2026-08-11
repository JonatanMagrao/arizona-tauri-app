-- O diagnostico tecnico do Tauri e da extensao CEP passa a ser somente local.
-- Preserve a assinatura desta funcao: um pg_cron remoto pode chama-la sem
-- argumentos ou usando os cinco parametros historicos.
create or replace function licensing.purge_operational_data(
  session_retention_days integer default 14,
  clock_retention_days integer default 30,
  event_retention_days integer default 90,
  rate_limit_retention_days integer default 2,
  activation_retention_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = licensing, public
as $$
declare
  deleted_sessions integer := 0;
  deleted_clock_audits integer := 0;
  -- Mantido no retorno para consumidores existentes da rotina operacional.
  deleted_events integer := 0;
  deleted_rate_limits integer := 0;
  deleted_activation_codes integer := 0;
begin
  -- event_retention_days continua validado para preservar o contrato anterior,
  -- embora eventos de aplicativo nao sejam mais armazenados remotamente.
  if session_retention_days < 1
    or clock_retention_days < 1
    or event_retention_days < 1
    or rate_limit_retention_days < 1
    or activation_retention_days < 1
  then
    raise exception 'invalid_retention';
  end if;

  delete from licensing.clock_audits
  where created_at < now() - make_interval(days => clock_retention_days);
  get diagnostics deleted_clock_audits = row_count;

  delete from licensing.license_sessions
  where status <> 'active'
    and updated_at < now() - make_interval(days => session_retention_days);
  get diagnostics deleted_sessions = row_count;

  delete from licensing.rate_limit_events
  where created_at < now() - make_interval(days => rate_limit_retention_days);
  get diagnostics deleted_rate_limits = row_count;

  delete from licensing.activation_codes
  where coalesce(used_at, revoked_at, expires_at) < now() - make_interval(days => activation_retention_days);
  get diagnostics deleted_activation_codes = row_count;

  return jsonb_build_object(
    'licenseSessions', deleted_sessions,
    'clockAudits', deleted_clock_audits,
    'appEvents', deleted_events,
    'rateLimitEvents', deleted_rate_limits,
    'activationCodes', deleted_activation_codes
  );
end;
$$;

-- A Function aposentada usava esta acao exata. Os demais rate limits sao
-- controles de seguranca/licenciamento e permanecem intactos.
delete from licensing.rate_limit_events
where action = 'event.track.member';

-- Nao use CASCADE: uma dependencia remota inesperada deve interromper a
-- migration para revisao, nunca ser removida silenciosamente.
drop table if exists licensing.app_events;

revoke all on function licensing.purge_operational_data(integer, integer, integer, integer, integer)
  from public, anon, authenticated;

grant execute on function licensing.purge_operational_data(integer, integer, integer, integer, integer)
  to service_role;
