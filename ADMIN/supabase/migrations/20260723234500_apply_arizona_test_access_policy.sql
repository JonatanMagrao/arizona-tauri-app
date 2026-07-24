-- Temporary-friendly values for the current Arizona validation cycle.
-- New organizations still use the safer schema defaults. The master can switch
-- this license back with "Padrao de producao" in the Admin at any time.
update licensing.organizations
set
  activation_code_ttl_minutes = 30,
  activation_attempt_limit = 30,
  activation_attempt_window_minutes = 5,
  activation_generation_limit = 10,
  activation_generation_window_minutes = 5,
  device_release_limit = 20,
  device_release_window_minutes = 5,
  device_switch_cooldown_minutes = 0,
  device_recovery_window_minutes = 30,
  updated_at = now()
where allowed_email_domain = 'arizona.global';
