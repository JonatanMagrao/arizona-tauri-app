alter table licensing.organizations
  add column if not exists daily_auth_reset_hour smallint not null default 4;

alter table licensing.organizations
  drop constraint if exists organizations_daily_auth_reset_hour_check;

alter table licensing.organizations
  add constraint organizations_daily_auth_reset_hour_check
  check (daily_auth_reset_hour between 0 and 23);

comment on column licensing.organizations.daily_auth_reset_hour is
  'Hour in America/Sao_Paulo when the daily password-authentication cycle resets.';
