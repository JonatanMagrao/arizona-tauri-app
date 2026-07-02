create or replace function licensing.is_active_master_email(email_value text)
returns boolean
language sql
stable
set search_path = licensing, public
as $$
  select exists (
    select 1
    from licensing.master_accounts ma
    where ma.email = lower(trim(email_value))::extensions.citext
      and ma.status = 'active'
  );
$$;

create or replace function licensing.consumed_seats(target_organization_id uuid)
returns integer
language sql
stable
set search_path = licensing, public
as $$
  select count(*)::integer
  from licensing.members m
  where m.organization_id = target_organization_id
    and m.role in ('admin', 'user')
    and m.status in ('invited', 'active')
    and not licensing.is_active_master_email(m.email::text);
$$;

create or replace function licensing.enforce_member_seat_limit()
returns trigger
language plpgsql
set search_path = licensing, public
as $$
declare
  org_status licensing.organization_status;
  allowed integer;
  consumed integer;
begin
  if new.status not in ('invited', 'active') or new.role not in ('admin', 'user') then
    return new;
  end if;

  if licensing.is_active_master_email(new.email::text) then
    return new;
  end if;

  select o.status, o.seats_allowed
    into org_status, allowed
  from licensing.organizations o
  where o.id = new.organization_id
  for update;

  if not found then
    raise exception 'organization_not_found';
  end if;

  if org_status <> 'active' then
    raise exception 'organization_not_active';
  end if;

  select count(*)::integer
    into consumed
  from licensing.members m
  where m.organization_id = new.organization_id
    and m.role in ('admin', 'user')
    and m.status in ('invited', 'active')
    and m.id <> new.id
    and not licensing.is_active_master_email(m.email::text);

  if consumed + 1 > allowed then
    raise exception 'seat_limit_exceeded';
  end if;

  return new;
end;
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
  if licensing.is_active_master_email(new.email::text) then
    return new;
  end if;

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
