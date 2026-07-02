alter table licensing.members
  add column if not exists name text;

alter table licensing.members
  drop constraint if exists members_name_length_check;

alter table licensing.members
  add constraint members_name_length_check
  check (name is null or length(name) between 2 and 160);
