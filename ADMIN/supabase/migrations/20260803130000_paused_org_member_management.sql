-- A suspensão ('paused') é um estado reversível de bloqueio dos usuários, não
-- da gestão: o master precisa continuar salvando a licença e administrando
-- membros enquanto ela vigora. O trigger de assentos só deve barrar estados
-- terminais ('blocked', 'deleted'); a contagem de assentos continua valendo.
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

  if org_status not in ('active', 'paused') then
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
