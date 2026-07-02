alter table licensing.organizations
  add column if not exists license_expires_on date;

create index if not exists organizations_license_expires_on_idx
  on licensing.organizations (license_expires_on)
  where license_expires_on is not null;
