-- =============================================================================
-- Issuing invoices with the supplier's own details (16.3)
--
--   * invoice_profiles: the supplier's details, one row per workspace; the
--     owner writes them, a worker with finance reads them to issue
--   * invoice_counters: the numbering series per workspace and year, written
--     only by next_invoice_number() inside the transaction that issues, so a
--     number is never skipped (a failed issue rolls the counter back) and never
--     repeated (the counter row is locked until the issue commits)
--   * invoices get the snapshot of both parties, the items and the totals;
--     a client writes drafts only, the totals are always computed here, and an
--     issued invoice is never changed or deleted by a client: issue_invoice(),
--     cancel_invoice() (a credit note with the next number of the series) and
--     mark_invoice_paid() are the only ways on
--   * create_invoice_from_deal() now makes a prefilled draft
--   * the PDFs live in the private bucket `invoices` under
--     `<workspace id>/<invoice id>.pdf`; only the server writes them, the
--     workspace (and a worker with finance) reads them through signed URLs
--   * old invoices get one item from their amount and the customer snapshot;
--     the supplier snapshot follows when the profile is first saved
--
-- Only additions, apart from two relaxed constraints: a draft has no number
-- yet, and a draft or a credit note is not a positive amount.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Supplier details
-- -----------------------------------------------------------------------------

create table public.invoice_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  company_reg_no text check (company_reg_no is null or char_length(company_reg_no) between 1 and 20),
  vat_no text check (vat_no is null or char_length(vat_no) between 1 and 20),
  vat_payer boolean not null default false,
  street text check (street is null or char_length(street) <= 200),
  city text check (city is null or char_length(city) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country text not null default 'CZ' check (country ~ '^[A-Z]{2}$'),
  email text check (email is null or char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) <= 30),
  account_number text check (account_number is null or account_number ~ '^(\d{1,6}-)?\d{2,10}$'),
  bank_code text check (bank_code is null or bank_code ~ '^\d{4}$'),
  iban text check (iban is null or iban ~ '^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$'),
  bic text check (bic is null or bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  due_days smallint not null default 14 check (due_days between 0 and 365),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  number_prefix text not null default '' check (number_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  footer_text text check (footer_text is null or char_length(footer_text) <= 500),
  style text not null default 'clean' check (style in ('clean', 'line', 'block', 'classic')),
  accent_color text not null default '#3B5BDB' check (accent_color ~ '^#[0-9A-F]{6}$'),
  qr_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_profiles_vat_no_required check (not vat_payer or vat_no is not null)
);

comment on table public.invoice_profiles is
  'The supplier on the invoices of a workspace (the owner''s account). Written by the owner only.';

alter table public.invoice_profiles enable row level security;

create policy invoice_profiles_select_workspace on public.invoice_profiles
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'finance', 'view'))
    )
  );
create policy invoice_profiles_insert_owner on public.invoice_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy invoice_profiles_update_owner on public.invoice_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.invoice_profiles from anon;
grant select, insert, update on public.invoice_profiles to authenticated;
revoke delete, truncate, references, trigger on public.invoice_profiles from authenticated;

-- The times are the database's; the row never changes hands.
create or replace function public.invoice_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.accent_color := upper(new.accent_color);
  return new;
end;
$$;
revoke execute on function public.invoice_profiles_guard() from public, anon, authenticated;

create trigger invoice_profiles_guard
  before insert or update on public.invoice_profiles
  for each row execute function public.invoice_profiles_guard();

-- What an issued invoice keeps of the supplier, whatever changes later.
create or replace function public.invoice_supplier_snapshot(_profile public.invoice_profiles)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', _profile.name,
    'company_reg_no', _profile.company_reg_no,
    'vat_no', _profile.vat_no,
    'vat_payer', _profile.vat_payer,
    'street', _profile.street,
    'city', _profile.city,
    'postal_code', _profile.postal_code,
    'country', _profile.country,
    'email', _profile.email,
    'phone', _profile.phone,
    'account_number', _profile.account_number,
    'bank_code', _profile.bank_code,
    'iban', _profile.iban,
    'bic', _profile.bic,
    'footer_text', _profile.footer_text
  ));
$$;
revoke execute on function public.invoice_supplier_snapshot(public.invoice_profiles) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Numbering series: server only
-- -----------------------------------------------------------------------------

create table public.invoice_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  year smallint not null check (year between 2000 and 2999),
  last_number integer not null check (last_number > 0),
  primary key (user_id, year)
);
comment on table public.invoice_counters is
  'The last number used per workspace and year. Only next_invoice_number() writes it, inside the issuing transaction.';
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;

-- The next number of the series, e.g. "2026-0001" or "FV2026-0001". The row
-- lock of the counter holds every other issue of the workspace until this
-- transaction ends; when it rolls back, so does the number. The first number
-- of a year continues after the ones the old one-tap flow gave ("2026-007").
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
begin
  select number_prefix into _prefix from public.invoice_profiles where user_id = _ws;
  select coalesce(max(substring(number from '(\d+)$')::integer), 0) into _seed
  from public.invoices
  where user_id = _ws and number ~ ('^' || _year || '-\d{1,3}$');

  insert into public.invoice_counters as c (user_id, year, last_number)
  values (_ws, _year, _seed + 1)
  on conflict (user_id, year) do update set last_number = c.last_number + 1
  returning last_number into _n;

  return coalesce(_prefix, '') || _year::text || '-'
    || case when _n < 10000 then lpad(_n::text, 4, '0') else _n::text end;
end;
$$;
revoke execute on function public.next_invoice_number(uuid, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Customer's company details on contacts
-- -----------------------------------------------------------------------------

alter table public.contacts
  add column company_reg_no text check (company_reg_no is null or char_length(company_reg_no) between 1 and 20),
  add column vat_no text check (vat_no is null or char_length(vat_no) between 1 and 20);

-- -----------------------------------------------------------------------------
-- Items and totals
-- -----------------------------------------------------------------------------

-- Items: [{id, name, quantity, unit, unit_price, vat_rate}]. Quantities with
-- up to three decimals, prices and rates with up to two.
create or replace function public.invoice_items_valid(_items jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_items) = 'array'
    and jsonb_array_length(_items) <= 100
    and not exists (
      select 1
      from jsonb_array_elements(_items) e
      -- CASE keeps the casts behind the type checks.
      where case
        when jsonb_typeof(e) <> 'object' then true
        when coalesce(jsonb_typeof(e -> 'id'), '') <> 'string'
          or coalesce(jsonb_typeof(e -> 'name'), '') <> 'string'
          or coalesce(jsonb_typeof(e -> 'unit'), '') <> 'string'
          or coalesce(jsonb_typeof(e -> 'quantity'), '') <> 'number'
          or coalesce(jsonb_typeof(e -> 'unit_price'), '') <> 'number'
          or coalesce(jsonb_typeof(e -> 'vat_rate'), '') <> 'number' then true
        else
          char_length(e ->> 'id') > 64
          or char_length(e ->> 'name') > 200
          or char_length(e ->> 'unit') > 20
          or abs((e ->> 'quantity')::numeric) > 1000000
          or round((e ->> 'quantity')::numeric, 3) <> (e ->> 'quantity')::numeric
          or abs((e ->> 'unit_price')::numeric) > 1000000000
          or round((e ->> 'unit_price')::numeric, 2) <> (e ->> 'unit_price')::numeric
          or (e ->> 'vat_rate')::numeric < 0
          or (e ->> 'vat_rate')::numeric > 100
          or round((e ->> 'vat_rate')::numeric, 2) <> (e ->> 'vat_rate')::numeric
      end
    );
$$;

-- Each line rounded to cents, VAT per rate from the sum of its lines (as the
-- recapitulation on the invoice), a CZK total rounded to whole crowns.
-- computeInvoiceTotals() in src/features/invoices/totals.ts does the same.
create or replace function public.invoice_totals(
  _items jsonb,
  _vat_mode text,
  _currency text,
  out subtotal numeric,
  out vat_total numeric,
  out rounding numeric,
  out total numeric
)
language sql
immutable
set search_path = ''
as $$
  with lines as (
    select
      round((e ->> 'quantity')::numeric * (e ->> 'unit_price')::numeric, 2) as base,
      case when _vat_mode = 'vat' then (e ->> 'vat_rate')::numeric else 0 end as rate
    from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) e
  ),
  rates as (
    select sum(base) as base, round(sum(base) * rate / 100, 2) as vat
    from lines
    group by rate
  ),
  sums as (
    select coalesce(sum(base), 0) as sub, coalesce(sum(vat), 0) as vat from rates
  )
  select
    sub,
    vat,
    case when _currency = 'CZK' then round(sub + vat, 0) - (sub + vat) else 0 end,
    case when _currency = 'CZK' then round(sub + vat, 0) else sub + vat end
  from sums;
$$;

-- -----------------------------------------------------------------------------
-- Invoices: new columns
-- -----------------------------------------------------------------------------

alter table public.invoices
  add column kind text not null default 'invoice' check (kind in ('invoice', 'credit_note')),
  add column credited_invoice_id uuid,
  add column supplier jsonb check (
    supplier is null or (jsonb_typeof(supplier) = 'object' and pg_column_size(supplier) < 8000)
  ),
  add column customer jsonb not null default '{}'::jsonb check (
    jsonb_typeof(customer) = 'object' and pg_column_size(customer) < 4000
  ),
  add column items jsonb not null default '[]'::jsonb
    constraint invoices_items_valid check (public.invoice_items_valid(items)),
  add column vat_mode text not null default 'none' check (vat_mode in ('none', 'vat')),
  add column subtotal numeric(14, 2) not null default 0,
  add column vat_total numeric(14, 2) not null default 0,
  add column rounding numeric(14, 2) not null default 0,
  add column total numeric(14, 2) not null default 0,
  add column variable_symbol text check (variable_symbol is null or variable_symbol ~ '^\d{1,10}$'),
  add column note text check (note is null or char_length(note) <= 1000),
  add column taxable_on date,
  add column style text check (style is null or style in ('clean', 'line', 'block', 'classic')),
  add column accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-F]{6}$'),
  add column qr_enabled boolean not null default false,
  add column locale text not null default 'cs' check (locale in ('cs', 'en')),
  add column pdf_path text check (pdf_path is null or char_length(pdf_path) <= 200),
  add column sent_at timestamptz,
  add column cancelled_at timestamptz;

alter table public.invoices
  add constraint invoices_credited_invoice_fkey foreign key (credited_invoice_id, user_id)
    references public.invoices (id, user_id) on delete set null (credited_invoice_id);
create index invoices_credited_idx on public.invoices (credited_invoice_id)
  where credited_invoice_id is not null;
create index invoices_user_issued_idx on public.invoices (user_id, issued_on desc);

-- A draft is numbered only when it is issued.
alter table public.invoices alter column number drop not null;
-- A draft may still be empty and a credit note is negative.
alter table public.invoices drop constraint invoices_amount_positive;
alter table public.invoices add constraint invoices_amount_valid check (
  status = 'draft'
  or (kind = 'invoice' and amount > 0)
  or (kind = 'credit_note' and amount < 0)
);
alter table public.invoices add constraint invoices_number_issued check (
  status = 'draft' or number is not null
);

comment on column public.invoices.customer is
  'Snapshot of the customer: name, company_reg_no, vat_no, street, city, postal_code, country, email.';
comment on column public.invoices.supplier is
  'Snapshot of invoice_profiles taken when the invoice was issued.';
comment on column public.invoices.items is
  'Lines: [{id, name, quantity, unit, unit_price, vat_rate}]; prices without VAT.';

-- Old invoices: one item from the amount, the customer from the contact.
update public.invoices i
set
  items = jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', coalesce((select left(d.title, 200) from public.deals d where d.id = i.deal_id), ''),
    'quantity', 1,
    'unit', '',
    'unit_price', i.amount,
    'vat_rate', 0
  )),
  subtotal = i.amount,
  vat_total = 0,
  rounding = 0,
  total = i.amount,
  customer = coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(i.customer_name,
        nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')),
      'street', c.address,
      'city', c.city,
      'postal_code', c.postal_code,
      'country', c.country_code,
      'email', c.email
    ))
    from public.contacts c where c.id = i.contact_id
  ), jsonb_strip_nulls(jsonb_build_object('name', i.customer_name))),
  variable_symbol = nullif(right(regexp_replace(i.number, '\D', '', 'g'), 10), ''),
  style = 'clean',
  accent_color = '#3B5BDB'
where i.items = '[]'::jsonb and i.amount > 0;

-- -----------------------------------------------------------------------------
-- Guard: a client writes drafts only
-- -----------------------------------------------------------------------------

create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _totals record;
begin
  if not public.is_client_request() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'invoice_issued' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'draft' then
      raise exception 'invoice_issued' using errcode = 'insufficient_privilege';
    end if;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  -- Issuing, paying and cancelling happen in their own functions only.
  new.status := 'draft';
  new.number := null;
  new.kind := 'invoice';
  new.credited_invoice_id := null;
  new.paid_on := null;
  new.supplier := null;
  new.style := null;
  new.accent_color := null;
  new.qr_enabled := false;
  new.pdf_path := null;
  new.sent_at := null;
  new.cancelled_at := null;
  new.fakturoid_id := null;

  new.customer_name := nullif(left(trim(coalesce(new.customer ->> 'name', '')), 200), '');
  if not public.invoice_items_valid(new.items) then
    raise exception 'invoice_items_invalid' using errcode = 'check_violation';
  end if;
  select * into _totals from public.invoice_totals(new.items, new.vat_mode, new.currency);
  new.subtotal := _totals.subtotal;
  new.vat_total := _totals.vat_total;
  new.rounding := _totals.rounding;
  new.total := _totals.total;
  new.amount := _totals.total;
  return new;
end;
$$;
revoke execute on function public.invoices_guard() from public, anon, authenticated;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before insert or update or delete on public.invoices
  for each row execute function public.invoices_guard();

-- The first saved profile completes the old invoices that have no supplier yet.
create or replace function public.invoice_profiles_backfill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.invoices
    set supplier = public.invoice_supplier_snapshot(new)
    where user_id = new.user_id and status <> 'draft' and supplier is null;
  exception when raise_exception then
    -- A read-only workspace keeps its old invoices as they are; the PDF reads the profile.
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.invoice_profiles_backfill() from public, anon, authenticated;

create trigger invoice_profiles_backfill
  after insert on public.invoice_profiles
  for each row execute function public.invoice_profiles_backfill();

-- -----------------------------------------------------------------------------
-- From a deal: a prefilled draft
-- -----------------------------------------------------------------------------

-- Runs with the caller's rights: RLS on deals, contacts and invoices decides,
-- and the guard computes the totals. A deal that already has a draft or an
-- unpaid invoice gets that one back instead of a second.
create or replace function public.create_invoice_from_deal(_deal_id uuid)
returns public.invoices
language plpgsql
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _deal public.deals;
  _invoice public.invoices;
  _contact public.contacts;
  _profile public.invoice_profiles;
  _locale text;
  _customer jsonb := '{}'::jsonb;
begin
  select * into _deal from public.deals where id = _deal_id and user_id = _ws;
  if not found then
    raise exception 'deal_not_found' using errcode = 'no_data_found';
  end if;

  select * into _invoice from public.invoices
  where deal_id = _deal_id and user_id = _ws and kind = 'invoice'
    and status in ('draft', 'open', 'sent', 'overdue')
  order by created_at desc limit 1;
  if found then
    return _invoice;
  end if;

  select * into _profile from public.invoice_profiles where user_id = _ws;
  select locale into _locale from public.user_settings where user_id = auth.uid();

  if _deal.contact_id is not null then
    select * into _contact from public.contacts where id = _deal.contact_id and user_id = _ws;
    if found then
      _customer := jsonb_strip_nulls(jsonb_build_object(
        'name', left(coalesce(nullif(_contact.company_name, ''),
          nullif(trim(concat_ws(' ', _contact.first_name, _contact.last_name)), '')), 200),
        'company_reg_no', _contact.company_reg_no,
        'vat_no', _contact.vat_no,
        'street', _contact.address,
        'city', _contact.city,
        'postal_code', _contact.postal_code,
        'country', _contact.country_code,
        'email', _contact.email
      ));
    end if;
  end if;

  insert into public.invoices (user_id, currency, status, customer, contact_id, deal_id, items, vat_mode, locale, number, amount)
  values (
    _ws,
    _deal.currency,
    'draft',
    _customer,
    _deal.contact_id,
    _deal.id,
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', left(_deal.title, 200),
      'quantity', 1,
      'unit', '',
      'unit_price', coalesce(round(_deal.value, 2), 0),
      'vat_rate', case when coalesce(_profile.vat_payer, false) and _profile.country = 'CZ' then 21 else 0 end
    )),
    case when coalesce(_profile.vat_payer, false) then 'vat' else 'none' end,
    case when _locale in ('cs', 'en') then _locale else 'cs' end,
    null,
    0
  )
  returning * into _invoice;
  return _invoice;
end;
$$;
grant execute on function public.create_invoice_from_deal(uuid) to authenticated;
revoke execute on function public.create_invoice_from_deal(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Issue, cancel, pay
-- -----------------------------------------------------------------------------

create or replace function public.require_invoice_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
begin
  if _ws is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_section_access(_ws, 'finance', 'edit') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  return _ws;
end;
$$;
revoke execute on function public.require_invoice_editor() from public, anon, authenticated;

-- Numbers the draft, freezes both parties, the totals, the style and the QR
-- choice. Issuing an invoice that is already issued returns it unchanged.
create or replace function public.issue_invoice(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.require_invoice_editor();
  _invoice public.invoices;
  _profile public.invoice_profiles;
  _vat_mode text;
  _totals record;
  _issued date;
  _number text;
  _country text;
begin
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _ws for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.status <> 'draft' then
    return _invoice;
  end if;

  select * into _profile from public.invoice_profiles where user_id = _ws;
  if not found then
    raise exception 'invoice_profile_required' using errcode = 'check_violation';
  end if;
  if coalesce(trim(_invoice.customer ->> 'name'), '') = '' then
    raise exception 'invoice_customer_required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(_invoice.items) = 0 or exists (
    select 1 from jsonb_array_elements(_invoice.items) e where trim(e ->> 'name') = ''
  ) then
    raise exception 'invoice_items_required' using errcode = 'check_violation';
  end if;

  _vat_mode := case when _profile.vat_payer then 'vat' else 'none' end;
  select * into _totals from public.invoice_totals(_invoice.items, _vat_mode, _invoice.currency);
  if _totals.total <= 0 then
    raise exception 'invoice_total_invalid' using errcode = 'check_violation';
  end if;

  _issued := coalesce(_invoice.issued_on, public.user_today(_ws));
  if _invoice.due_on is not null and _invoice.due_on < _issued then
    raise exception 'invoice_due_before_issue' using errcode = 'check_violation';
  end if;
  _number := public.next_invoice_number(_ws, _issued);
  select country_code into _country from public.user_settings where user_id = _ws;

  update public.invoices set
    status = 'open',
    number = _number,
    issued_on = _issued,
    due_on = coalesce(_invoice.due_on, _issued + _profile.due_days),
    taxable_on = case when _vat_mode = 'vat' then coalesce(_invoice.taxable_on, _issued) end,
    variable_symbol = coalesce(
      _invoice.variable_symbol,
      nullif(right(regexp_replace(_number, '\D', '', 'g'), 10), '')
    ),
    supplier = public.invoice_supplier_snapshot(_profile),
    customer_name = left(trim(_invoice.customer ->> 'name'), 200),
    vat_mode = _vat_mode,
    subtotal = _totals.subtotal,
    vat_total = _totals.vat_total,
    rounding = _totals.rounding,
    total = _totals.total,
    amount = _totals.total,
    style = _profile.style,
    accent_color = _profile.accent_color,
    qr_enabled = _profile.qr_enabled and _invoice.currency = 'CZK' and _country = 'CZ',
    pdf_path = null
  where id = _invoice.id
  returning * into _invoice;
  return _invoice;
end;
$$;
grant execute on function public.issue_invoice(uuid) to authenticated;
revoke execute on function public.issue_invoice(uuid) from public, anon;

-- Cancels an unpaid issued invoice with a credit note: the next number of the
-- series, the same lines with negative prices, the same parties. Returns the
-- credit note.
create or replace function public.cancel_invoice(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.require_invoice_editor();
  _invoice public.invoices;
  _credit public.invoices;
  _today date;
begin
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _ws for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.kind <> 'invoice' or _invoice.status not in ('open', 'sent', 'overdue') then
    raise exception 'invoice_not_cancellable' using errcode = 'check_violation';
  end if;

  _today := public.user_today(_ws);
  insert into public.invoices (
    user_id, kind, credited_invoice_id, number, status, issued_on, due_on, taxable_on,
    amount, currency, customer_name, contact_id, deal_id, supplier, customer, items, vat_mode,
    subtotal, vat_total, rounding, total, variable_symbol, style, accent_color, qr_enabled, locale
  )
  values (
    _ws, 'credit_note', _invoice.id, public.next_invoice_number(_ws, _today), 'cancelled',
    _today, null, case when _invoice.vat_mode = 'vat' then _today end,
    -_invoice.amount, _invoice.currency, _invoice.customer_name, _invoice.contact_id,
    _invoice.deal_id, _invoice.supplier, _invoice.customer,
    coalesce((
      select jsonb_agg(e || jsonb_build_object('unit_price', -(e ->> 'unit_price')::numeric) order by n)
      from jsonb_array_elements(_invoice.items) with ordinality as x(e, n)
    ), '[]'::jsonb),
    _invoice.vat_mode, -_invoice.subtotal, -_invoice.vat_total, -_invoice.rounding,
    -_invoice.total, _invoice.variable_symbol, _invoice.style, _invoice.accent_color, false,
    _invoice.locale
  )
  returning * into _credit;

  update public.invoices set status = 'cancelled', cancelled_at = now()
  where id = _invoice.id;
  return _credit;
end;
$$;
grant execute on function public.cancel_invoice(uuid) to authenticated;
revoke execute on function public.cancel_invoice(uuid) from public, anon;

-- Paid today, with the income booked; only an issued, uncancelled invoice.
create or replace function public.mark_invoice_paid(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.require_invoice_editor();
  _invoice public.invoices;
  _today date;
begin
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _ws for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.status = 'paid' then
    return _invoice;
  end if;
  if _invoice.kind <> 'invoice' or _invoice.status not in ('open', 'sent', 'overdue') then
    raise exception 'invoice_not_payable' using errcode = 'check_violation';
  end if;

  _today := public.user_today(_ws);
  update public.invoices set status = 'paid', paid_on = _today
  where id = _invoice_id returning * into _invoice;

  perform public.book_invoice_income(_invoice, _today);
  return _invoice;
end;
$$;
grant execute on function public.mark_invoice_paid(uuid) to authenticated;
revoke execute on function public.mark_invoice_paid(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- PDFs: private bucket, read by the workspace, written by the server
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- The first folder is the workspace; a worker needs finance to read.
create or replace function public.invoice_pdf_readable(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _folder text := split_part(_name, '/', 1);
begin
  if _folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.has_section_access(_folder::uuid, 'finance', 'view');
end;
$$;
revoke execute on function public.invoice_pdf_readable(text) from public, anon;
grant execute on function public.invoice_pdf_readable(text) to authenticated;

create policy "invoices_pdf_select_workspace" on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.invoice_pdf_readable(name));

-- -----------------------------------------------------------------------------
-- Jarvis: overdue invoices are a rule suggestion
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'taskCompleted', 'insight', 'pathReady', 'briefing', 'question'
));

-- -----------------------------------------------------------------------------
-- Analytics
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('invoice_sent', 'finance', true),
  ('invoice_paid', 'finance', true),
  ('invoice_cancelled', 'finance', true),
  ('invoice_profile_saved', 'finance', true)
on conflict (event) do nothing;
