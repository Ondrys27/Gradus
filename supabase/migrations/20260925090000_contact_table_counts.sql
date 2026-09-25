-- =============================================================================
-- Contact tables: counts for the switcher, and Clients stays exactly the
-- contacts with a won deal
-- =============================================================================

-- Contacts per table. security_invoker keeps the RLS of the entries.
create view public.contact_table_counts
with (security_invoker = true)
as
select table_id, count(*)::integer as contacts
from public.contact_table_entries
group by table_id;

revoke all on public.contact_table_counts from anon;
grant select on public.contact_table_counts to authenticated;

-- A won deal puts its contact into Clients (deals_after_won). When the contact
-- loses its last won deal — the deal leaves the won stage, is deleted or gets
-- another contact — it goes back to the table it came to Clients from, or to
-- Unreached when that table no longer exists.
create or replace function public.deals_after_unwon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clients uuid;
  _back uuid;
begin
  if old.won_at is null or old.contact_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.won_at is not null and new.contact_id = old.contact_id then
    return null;
  end if;
  -- The contact itself is being deleted (its deals lose it on the way).
  if not exists (select 1 from public.contacts where id = old.contact_id) then
    return null;
  end if;
  if exists (
    select 1 from public.deals
    where contact_id = old.contact_id and user_id = old.user_id and won_at is not null
  ) then
    return null;
  end if;

  select e.table_id into _clients
  from public.contact_table_entries e
  join public.contact_tables t on t.id = e.table_id
  where e.user_id = old.user_id and e.contact_id = old.contact_id and t.system_key = 'clients';
  if _clients is null then
    return null;
  end if;

  select m.from_table_id into _back
  from public.contact_table_moves m
  where m.user_id = old.user_id and m.contact_id = old.contact_id and m.to_table_id = _clients
    and m.from_table_id is not null and m.from_table_id <> _clients
  order by m.created_at desc
  limit 1;
  if _back is null then
    select id into _back from public.contact_tables
    where user_id = old.user_id and system_key = 'unreached';
  end if;
  if _back is null then
    return null;
  end if;

  update public.contact_table_entries
    set table_id = _back, answers = '{}'::jsonb, moved_at = now()
    where user_id = old.user_id and contact_id = old.contact_id;
  insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
  values (old.user_id, old.contact_id, _clients, _back, jsonb_build_object('deal_id', old.id));
  return null;
end;
$$;
create trigger deals_after_unwon
  after update of stage_id, contact_id or delete on public.deals
  for each row execute function public.deals_after_unwon();

-- Giving a won deal to another contact makes that contact a client too.
create or replace function public.deals_after_won()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clients_table_id uuid;
  _from uuid;
begin
  if new.won_at is null or new.contact_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.won_at is not null
     and old.contact_id is not distinct from new.contact_id then
    return new;
  end if;

  select id into _clients_table_id from public.contact_tables
  where user_id = new.user_id and system_key = 'clients';
  if _clients_table_id is null then
    return new;
  end if;

  select table_id into _from from public.contact_table_entries
  where user_id = new.user_id and contact_id = new.contact_id;
  if _from = _clients_table_id then
    return new;
  end if;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (new.user_id, new.contact_id, _clients_table_id, '{}'::jsonb, now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id, answers = '{}'::jsonb, moved_at = excluded.moved_at;

  insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
  values (new.user_id, new.contact_id, _from, _clients_table_id, jsonb_build_object('deal_id', new.id));

  return new;
end;
$$;
drop trigger deals_after_won on public.deals;
create trigger deals_after_won
  after insert or update of stage_id, contact_id on public.deals
  for each row execute function public.deals_after_won();

revoke execute on function public.deals_after_unwon(), public.deals_after_won() from public, anon;
