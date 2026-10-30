-- =============================================================================
-- Numbering series: never stuck on a number an older invoice already holds
--
-- The first number of a year continued only after old numbers of up to three
-- digits ("2026-007"). An invoice that kept a four-digit number from the
-- Fakturoid era ("2026-0001") or an old one past 999 ("2026-1000") made the
-- series hand out a number that already exists: the unique index refused the
-- issue, the counter rolled back with it, and every later issue of the year
-- failed the same way.
--
-- Now the seed takes the old numbers of any length, and a number another
-- invoice of the workspace already holds is passed over while the counter row
-- is locked. Still in the issuing transaction, so a rollback returns the
-- number and two issues never get the same one.
-- =============================================================================

create or replace function public.next_invoice_number(_ws uuid, _issued_on date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _year smallint := extract(year from _issued_on)::smallint;
  _prefix text;
  _seed integer;
  _n integer;
  _number text;
begin
  select number_prefix into _prefix from public.invoice_profiles where user_id = _ws;
  select coalesce(max(substring(number from '-(\d{1,9})$')::integer), 0) into _seed
  from public.invoices
  where user_id = _ws and number ~ ('^' || _year || '-\d{1,9}$');

  insert into public.invoice_counters as c (user_id, year, last_number)
  values (_ws, _year, _seed + 1)
  on conflict (user_id, year) do update set last_number = c.last_number + 1
  returning last_number into _n;

  loop
    _number := coalesce(_prefix, '') || _year::text || '-'
      || case when _n < 10000 then lpad(_n::text, 4, '0') else _n::text end;
    exit when not exists (
      select 1 from public.invoices where user_id = _ws and number = _number
    );
    -- Taken by an older invoice: the next one, the counter row stays locked.
    update public.invoice_counters set last_number = last_number + 1
    where user_id = _ws and year = _year
    returning last_number into _n;
  end loop;

  return _number;
end;
$$;
revoke execute on function public.next_invoice_number(uuid, date) from public, anon, authenticated;
