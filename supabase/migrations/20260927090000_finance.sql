-- =============================================================================
-- Finance
--   * every transaction knows where it came from; only the server sets the
--     source and raises the "needs review" mark, the owner can clear it
--   * a deal moved into the deposit stage books a deposit, into a won stage the
--     rest of its value; moving back only marks the income for review
--   * recurring payments are booked by a daily job, one transaction per due day
--   * invoices are created from a deal in one call; "overdue" is never stored
-- =============================================================================

create type public.transaction_source as enum (
  'manual', 'recurring', 'deal_deposit', 'deal_invoice', 'invoice'
);

alter table public.transactions
  add column source public.transaction_source not null default 'manual',
  add column needs_review boolean not null default false,
  add constraint transactions_amount_positive check (amount > 0);

alter table public.recurring_payments
  add column due_day smallint check (due_day between 1 and 31),
  add constraint recurring_payments_amount_positive check (amount > 0);

alter table public.invoices
  add constraint invoices_amount_positive check (amount > 0);

-- A deal books each kind of income once, however often it is dragged around.
create unique index transactions_deal_source_idx
  on public.transactions (deal_id, source)
  where source in ('deal_deposit', 'deal_invoice');
-- A recurring payment books each due day once, so a repeated job run adds nothing.
create unique index transactions_recurring_day_idx
  on public.transactions (recurring_payment_id, occurred_on)
  where recurring_payment_id is not null;
create unique index invoices_user_number_idx on public.invoices (user_id, number);

-- Which stage means "deposit paid", and how much of the deal value it is.
alter table public.pipeline_stages
  add column deposit_percent smallint not null default 30
  check (deposit_percent between 1 and 100);
create unique index pipeline_stages_deposit_idx
  on public.pipeline_stages (user_id) where system_key = 'deposit_paid';

-- -----------------------------------------------------------------------------
-- Guard: the source is the server's; a client can only clear the review mark
-- -----------------------------------------------------------------------------

create or replace function public.transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.source := 'manual';
      new.needs_review := false;
    else
      new.source := old.source;
      new.needs_review := old.needs_review and new.needs_review;
    end if;
  end if;
  return new;
end;
$$;
create trigger transactions_guard
  before insert or update on public.transactions
  for each row execute function public.transactions_guard();

-- -----------------------------------------------------------------------------
-- Dates: the user's today, never UTC. Runs as the caller, so a client only sees
-- their own settings; the server and the definer functions see everyone's.
-- -----------------------------------------------------------------------------

create or replace function public.user_today(_user_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select timezone from public.user_settings where user_id = _user_id), 'Europe/Prague'
  ))::date;
$$;
revoke execute on function public.user_today(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Deposit stage
-- -----------------------------------------------------------------------------

-- Marks one stage as the deposit stage (or, with null, none). Runs as the caller,
-- so RLS keeps it to their own stages.
create or replace function public.set_deposit_stage(_stage_id uuid, _percent smallint default 30)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  if _stage_id is not null then
    if not exists (
      select 1 from public.pipeline_stages
      where id = _stage_id and user_id = _uid and not is_won and not is_lost
    ) then
      raise exception 'stage_not_found' using errcode = 'no_data_found';
    end if;
  end if;

  update public.pipeline_stages set system_key = null
  where user_id = _uid and system_key = 'deposit_paid' and id is distinct from _stage_id;

  if _stage_id is not null then
    update public.pipeline_stages
      set system_key = 'deposit_paid', deposit_percent = coalesce(_percent, 30)
      where id = _stage_id and user_id = _uid;
  end if;
end;
$$;
grant execute on function public.set_deposit_stage(uuid, smallint) to authenticated;
revoke execute on function public.set_deposit_stage(uuid, smallint) from public, anon;

-- -----------------------------------------------------------------------------
-- Pipeline to finance
-- -----------------------------------------------------------------------------

create or replace function public.deals_after_stage_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.pipeline_stages;
  _new public.pipeline_stages;
  _booked numeric(14, 2);
  _amount numeric(14, 2);
begin
  select * into _new from public.pipeline_stages where id = new.stage_id;

  if tg_op = 'UPDATE' then
    select * into _old from public.pipeline_stages where id = old.stage_id;
    if _old.system_key = 'deposit_paid' and coalesce(_new.system_key, '') <> 'deposit_paid' then
      update public.transactions set needs_review = true
      where deal_id = new.id and source = 'deal_deposit';
    end if;
    if _old.is_won and not _new.is_won then
      update public.transactions set needs_review = true
      where deal_id = new.id and source = 'deal_invoice';
    end if;
  end if;

  if new.value is null or new.value <= 0 then
    return new;
  end if;

  if _new.system_key = 'deposit_paid' then
    insert into public.transactions
      (user_id, type, amount, currency, category, description, occurred_on, deal_id, source)
    values (
      new.user_id, 'income', round(new.value * _new.deposit_percent / 100, 2), new.currency,
      'sales', new.title, public.user_today(new.user_id), new.id, 'deal_deposit'
    )
    on conflict (deal_id, source) where source in ('deal_deposit', 'deal_invoice') do nothing;
  end if;

  if _new.is_won then
    -- Deposits and invoices already paid for this deal are not counted twice.
    select coalesce(sum(amount), 0) into _booked
    from public.transactions
    where deal_id = new.id and source in ('deal_deposit', 'invoice');
    _amount := new.value - _booked;
    if _amount > 0 then
      insert into public.transactions
        (user_id, type, amount, currency, category, description, occurred_on, deal_id, source)
      values (
        new.user_id, 'income', _amount, new.currency,
        'sales', new.title, public.user_today(new.user_id), new.id, 'deal_invoice'
      )
      on conflict (deal_id, source) where source in ('deal_deposit', 'deal_invoice') do nothing;
    end if;
  end if;

  return new;
end;
$$;
create trigger deals_after_stage_finance
  after insert or update of stage_id on public.deals
  for each row execute function public.deals_after_stage_finance();
revoke execute on function public.deals_after_stage_finance() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Recurring payments
-- -----------------------------------------------------------------------------

-- The due day after `_from`. A monthly payment on the 31st falls on the last day
-- of shorter months without drifting to the 30th afterwards.
create or replace function public.recurring_next_due(
  _from date,
  _frequency public.recurring_frequency,
  _due_day smallint default null
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  _months integer;
  _first date;
  _last_day integer;
begin
  if _frequency = 'weekly' then
    return _from + 7;
  end if;
  _months := case _frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
  _first := (date_trunc('month', _from::timestamp) + make_interval(months => _months))::date;
  _last_day := extract(day from (_first + interval '1 month - 1 day'))::integer;
  return _first + (least(coalesce(_due_day, extract(day from _from)::integer), _last_day) - 1);
end;
$$;

-- Books every payment that has come due, one transaction per due day, and moves
-- the next due day on. Days are the user's, not UTC. Safe to run again.
create or replace function public.post_due_recurring_payments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _payment public.recurring_payments;
  _today date;
  _next date;
  _last date;
  _guard integer;
  _inserted integer := 0;
  _rows integer;
begin
  for _payment in
    select * from public.recurring_payments
    where is_active and next_due_on <= (now() at time zone 'UTC')::date + 1
    for update
  loop
    _today := public.user_today(_payment.user_id);
    _next := _payment.next_due_on;
    _last := _payment.last_generated_on;
    _guard := 0;
    while _next <= _today
      and (_payment.ends_on is null or _next <= _payment.ends_on)
      and _guard < 400
    loop
      insert into public.transactions
        (user_id, type, amount, currency, category, description, occurred_on,
         recurring_payment_id, source)
      values (
        _payment.user_id, _payment.type, _payment.amount, _payment.currency,
        _payment.category, _payment.description, _next, _payment.id, 'recurring'
      )
      on conflict (recurring_payment_id, occurred_on) where recurring_payment_id is not null
        do nothing;
      get diagnostics _rows = row_count;
      _inserted := _inserted + _rows;
      _last := _next;
      _next := public.recurring_next_due(_next, _payment.frequency, _payment.due_day);
      _guard := _guard + 1;
    end loop;

    update public.recurring_payments
      set next_due_on = _next,
          last_generated_on = _last,
          is_active = case when ends_on is not null and _next > ends_on then false else is_active end
      where id = _payment.id;
  end loop;
  return _inserted;
end;
$$;
revoke execute on function public.post_due_recurring_payments() from public, anon, authenticated;
grant execute on function public.post_due_recurring_payments() to service_role;

-- -----------------------------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------------------------

-- One tap on a deal: an open invoice for its value, due in 14 days. A deal with an
-- unpaid invoice gets that one back instead of a second.
create or replace function public.create_invoice_from_deal(_deal_id uuid)
returns public.invoices
language plpgsql
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _deal public.deals;
  _invoice public.invoices;
  _today date;
  _year text;
  _next integer;
  _customer text;
begin
  select * into _deal from public.deals where id = _deal_id and user_id = _uid;
  if not found then
    raise exception 'deal_not_found' using errcode = 'no_data_found';
  end if;
  if _deal.value is null or _deal.value <= 0 then
    raise exception 'deal_value_required' using errcode = 'check_violation';
  end if;

  select * into _invoice from public.invoices
  where deal_id = _deal_id and user_id = _uid and status in ('draft', 'open', 'sent', 'overdue')
  order by created_at desc limit 1;
  if found then
    return _invoice;
  end if;

  _today := public.user_today(_uid);
  _year := to_char(_today, 'YYYY');
  select coalesce(max(substring(number from '-(\d+)$')::integer), 0) + 1 into _next
  from public.invoices where user_id = _uid and number ~ ('^' || _year || '-\d+$');

  select coalesce(nullif(company_name, ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''))
  into _customer from public.contacts where id = _deal.contact_id and user_id = _uid;

  insert into public.invoices
    (user_id, number, amount, currency, status, issued_on, due_on, customer_name, contact_id, deal_id)
  values (
    _uid, _year || '-' || lpad(_next::text, 3, '0'), _deal.value, _deal.currency, 'open',
    _today, _today + 14, _customer, _deal.contact_id, _deal.id
  )
  returning * into _invoice;
  return _invoice;
end;
$$;
grant execute on function public.create_invoice_from_deal(uuid) to authenticated;
revoke execute on function public.create_invoice_from_deal(uuid) from public, anon;

-- Marks an invoice paid and books the income: the deal's own income is linked to
-- it when there is one, otherwise a new transaction is added. SECURITY DEFINER so
-- the income keeps its server-set source; everything is filtered by the caller.
create or replace function public.mark_invoice_paid(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _invoice public.invoices;
  _today date;
  _linked integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _uid for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.status = 'paid' then
    return _invoice;
  end if;

  _today := public.user_today(_uid);
  update public.invoices set status = 'paid', paid_on = _today
  where id = _invoice_id returning * into _invoice;

  if _invoice.deal_id is not null then
    update public.transactions set invoice_id = _invoice.id
    where user_id = _uid and deal_id = _invoice.deal_id and source = 'deal_invoice'
      and invoice_id is null;
    get diagnostics _linked = row_count;
  end if;

  if _linked = 0 then
    insert into public.transactions
      (user_id, type, amount, currency, category, description, occurred_on,
       deal_id, invoice_id, source)
    values (
      _uid, 'income', _invoice.amount, _invoice.currency, 'sales',
      coalesce(_invoice.customer_name || ' · ', '') || _invoice.number,
      _today, _invoice.deal_id, _invoice.id, 'invoice'
    );
  end if;
  return _invoice;
end;
$$;
grant execute on function public.mark_invoice_paid(uuid) to authenticated;
revoke execute on function public.mark_invoice_paid(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Totals for the summary and the chart (calendar days as stored, per user)
-- -----------------------------------------------------------------------------

create or replace function public.finance_totals(
  _from date,
  _to date,
  _category text default null
)
returns table (income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(amount) filter (where type = 'income'), 0),
    coalesce(sum(amount) filter (where type = 'expense'), 0)
  from public.transactions
  where user_id = auth.uid()
    and occurred_on between _from and _to
    and (_category is null or category = _category);
$$;

create or replace function public.finance_monthly_totals(_from date, _to date)
returns table (month date, income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    m.month::date,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  from generate_series(
    date_trunc('month', _from::timestamp), date_trunc('month', _to::timestamp), interval '1 month'
  )
    as m(month)
  left join public.transactions t
    on t.user_id = auth.uid()
   and t.occurred_on >= m.month::date
   and t.occurred_on < (m.month + interval '1 month')::date
  group by m.month
  order by m.month;
$$;

grant execute on function public.finance_totals(date, date, text),
  public.finance_monthly_totals(date, date) to authenticated;
revoke execute on function public.finance_totals(date, date, text),
  public.finance_monthly_totals(date, date) from public, anon;
