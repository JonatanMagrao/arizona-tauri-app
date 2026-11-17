alter table licensing.organizations
  add column if not exists clock_tolerance_minutes integer not null default 60
    check (clock_tolerance_minutes between 1 and 1440);

notify pgrst, 'reload schema';
