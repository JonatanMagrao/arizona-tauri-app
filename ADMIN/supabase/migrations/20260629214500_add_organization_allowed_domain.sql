alter table licensing.organizations
  add column if not exists allowed_email_domain text;

alter table licensing.organizations
  drop constraint if exists organizations_allowed_email_domain_check;

alter table licensing.organizations
  add constraint organizations_allowed_email_domain_check
  check (
    allowed_email_domain is null
    or allowed_email_domain = lower(allowed_email_domain)
    and allowed_email_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

create or replace function licensing.email_domain(email_value text)
returns text
language sql
immutable
as $$
  select lower(split_part(trim(email_value), '@', 2));
$$;

create or replace function licensing.enforce_member_email_domain()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
declare
  expected_domain text;
  actual_domain text;
begin
  select o.allowed_email_domain
    into expected_domain
  from licensing.organizations o
  where o.id = new.organization_id;

  if expected_domain is null or expected_domain = '' then
    return new;
  end if;

  actual_domain := licensing.email_domain(new.email::text);
  if actual_domain <> expected_domain then
    raise exception 'email_domain_not_allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists members_enforce_email_domain on licensing.members;
create trigger members_enforce_email_domain
before insert or update of organization_id, email on licensing.members
for each row execute function licensing.enforce_member_email_domain();
