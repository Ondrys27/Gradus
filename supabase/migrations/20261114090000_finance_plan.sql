-- =============================================================================
-- 21.1 Finance plan: the month as a spreadsheet of income and expenses by week
--   * finance_plan_months: one row per space and month ('YYYY-MM') with the
--     opening capital, an optional reserve (warn below it), the currency the
--     plan is in and whether the month is closed (then nothing in it changes)
--   * finance_plan_rows: the items of the month, income or expense, in the
--     user's order; source says where a row came from (typed in, a contact,
--     a deal, a recurring payment, an invoice) so transactions find it
--   * finance_plan_cells: the planned number of a row in a week (1–5). The
--     weeks of a month are the ISO weeks whose Monday falls in it, so a month
--     has 4 or 5. `actual` is kept empty: the actuals are always computed
--     from transactions, never stored (CLAUDE.md, Data).
--   * Row level security like transactions: the space's own owner, or a
--     worker with finance "view" to read and finance "write" to change; by the
--     row's space, never by the active one.
--   * finance_plan_write_month(): a whole month written in one transaction
--     (a new month from the previous one, an imported sheet), as the caller.
-- Additive only.
-- =============================================================================

-- How many weeks a plan month has: its Mondays.
create or replace function public.finance_month_weeks(_month text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(
    to_date(_month || '-01', 'YYYY-MM-DD'),
    (to_date(_month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
    interval '1 day'
  ) as d
  where extract(isodow from d) = 1;
$$;
revoke execute on function public.finance_month_weeks(text) from public, anon;
grant execute on function public.finance_month_weeks(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.finance_plan_months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  opening_capital numeric(14, 2) not null default 0
    check (abs(opening_capital) < 1000000000000),
  reserve numeric(14, 2) check (reserve is null or (reserve >= 0 and reserve < 1000000000000)),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  closed boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create table public.finance_plan_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null,
  kind public.transaction_type not null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  position integer not null default 0 check (position between 0 and 100000),
  source text not null default 'manual'
    check (source in ('manual', 'contact', 'deal', 'recurring', 'invoice')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint finance_plan_rows_source_pair check ((source = 'manual') = (source_id is null)),
  constraint finance_plan_rows_month_fkey foreign key (user_id, month)
    references public.finance_plan_months (user_id, month) on delete cascade
);
-- One name per block of a month (transactions find their row by it), and one
-- row per source: carrying a month over twice never doubles a payment.
create unique index finance_plan_rows_label_idx
  on public.finance_plan_rows (user_id, month, kind, lower(btrim(label)));
create unique index finance_plan_rows_source_idx
  on public.finance_plan_rows (user_id, month, kind, source, source_id) where source_id is not null;
create index finance_plan_rows_month_idx on public.finance_plan_rows (user_id, month, kind, position);

create table public.finance_plan_cells (
  user_id uuid not null references auth.users (id) on delete cascade,
  row_id uuid not null,
  week smallint not null check (week between 1 and 5),
  planned numeric(14, 2) not null default 0 check (abs(planned) < 1000000000000),
  actual numeric(14, 2) check (actual is null or abs(actual) < 1000000000000),
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (row_id, week),
  constraint finance_plan_cells_row_fkey foreign key (row_id, user_id)
    references public.finance_plan_rows (id, user_id) on delete cascade
);
create index finance_plan_cells_user_idx on public.finance_plan_cells (user_id);

create trigger set_updated_at before update on public.finance_plan_months
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.finance_plan_rows
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.finance_plan_cells
  for each row execute function public.set_updated_at();

-- Read-only after the trial (and over the plan's limits), like the rest of the space.
create trigger finance_plan_months_writable
  before insert or update or delete on public.finance_plan_months
  for each row execute function public.enforce_workspace_writable('user_id');
create trigger finance_plan_rows_writable
  before insert or update or delete on public.finance_plan_rows
  for each row execute function public.enforce_workspace_writable('user_id');
create trigger finance_plan_cells_writable
  before insert or update or delete on public.finance_plan_cells
  for each row execute function public.enforce_workspace_writable('user_id');

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------

-- Whether a month of the space is closed (then its rows and cells stay as they are).
create or replace function public.finance_plan_month_closed(_space uuid, _month text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select closed from public.finance_plan_months where user_id = _space and month = _month),
    false
  );
$$;
revoke execute on function public.finance_plan_month_closed(uuid, text) from public, anon, authenticated;

-- The month and its currency are fixed once made; who made it is stamped.
create or replace function public.finance_plan_months_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_client_request() then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
  else
    if (new.user_id, new.month, new.currency) is distinct from (old.user_id, old.month, old.currency) then
      raise exception 'finance_plan_month_fixed' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- A closed month only opens again; nothing else of it changes meanwhile.
    if old.closed and new.closed
      and (new.opening_capital, new.reserve) is distinct from (old.opening_capital, old.reserve)
    then
      raise exception 'finance_plan_month_closed' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.finance_plan_months_guard() from public, anon;
create trigger finance_plan_months_guard
  before insert or update on public.finance_plan_months
  for each row execute function public.finance_plan_months_guard();

-- A row's source must be a record of the same space; month, block and source
-- never change afterwards; nothing changes in a closed month.
create or replace function public.finance_plan_rows_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ok boolean;
begin
  if tg_op = 'DELETE' then
    if public.finance_plan_month_closed(old.user_id, old.month) and pg_trigger_depth() = 1 then
      raise exception 'finance_plan_month_closed' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if public.finance_plan_month_closed(new.user_id, new.month) then
    raise exception 'finance_plan_month_closed' using errcode = 'check_violation';
  end if;

  new.label := btrim(regexp_replace(new.label, '\s+', ' ', 'g'));

  if tg_op = 'UPDATE' then
    if (new.user_id, new.month, new.kind, new.source, new.source_id)
      is distinct from (old.user_id, old.month, old.kind, old.source, old.source_id)
    then
      raise exception 'finance_plan_row_fixed' using errcode = 'check_violation';
    end if;
    new.created_at := old.created_at;
    return new;
  end if;

  new.created_at := now();
  if new.source <> 'manual' then
    _ok := case new.source
      when 'recurring' then exists (
        select 1 from public.recurring_payments where id = new.source_id and user_id = new.user_id)
      when 'invoice' then exists (
        select 1 from public.invoices where id = new.source_id and user_id = new.user_id)
      when 'deal' then exists (
        select 1 from public.deals where id = new.source_id and user_id = new.user_id)
      when 'contact' then exists (
        select 1 from public.contacts where id = new.source_id and user_id = new.user_id)
      else false
    end;
    if not _ok then
      raise exception 'finance_plan_source_invalid' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.finance_plan_rows_guard() from public, anon, authenticated;
create trigger finance_plan_rows_guard
  before insert or update or delete on public.finance_plan_rows
  for each row execute function public.finance_plan_rows_guard();

-- Only weeks the month has. `actual` is not in the client's grants at all.
create or replace function public.finance_plan_cells_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.finance_plan_rows;
begin
  if tg_op = 'DELETE' then
    select * into _row from public.finance_plan_rows where id = old.row_id;
    if found and public.finance_plan_month_closed(_row.user_id, _row.month) and pg_trigger_depth() = 1 then
      raise exception 'finance_plan_month_closed' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into _row from public.finance_plan_rows where id = new.row_id and user_id = new.user_id;
  if not found then
    -- Row level security and the foreign key refuse it; nothing to tell here.
    return new;
  end if;
  if new.week > public.finance_month_weeks(_row.month) then
    raise exception 'finance_plan_week_invalid' using errcode = 'check_violation';
  end if;
  if public.finance_plan_month_closed(_row.user_id, _row.month) then
    raise exception 'finance_plan_month_closed' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.row_id, new.week, new.user_id) is distinct from (old.row_id, old.week, old.user_id) then
    raise exception 'finance_plan_cell_fixed' using errcode = 'check_violation';
  end if;
  new.note := nullif(btrim(new.note), '');
  return new;
end;
$$;
revoke execute on function public.finance_plan_cells_guard() from public, anon, authenticated;
create trigger finance_plan_cells_guard
  before insert or update or delete on public.finance_plan_cells
  for each row execute function public.finance_plan_cells_guard();

-- -----------------------------------------------------------------------------
-- Row level security: by the row's space, like transactions
-- -----------------------------------------------------------------------------

do $$
declare
  _table text;
begin
  foreach _table in array array['finance_plan_months', 'finance_plan_rows', 'finance_plan_cells'] loop
    execute format('alter table public.%I enable row level security', _table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.section_spaces(''finance'', ''view''))::uuid[]))',
      _table || '_select_workspace', _table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         (select auth.uid()) = user_id
         or user_id = any ((select public.section_spaces(''finance'', ''edit''))::uuid[]))',
      _table || '_insert_workspace', _table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.section_spaces(''finance'', ''edit''))::uuid[]))
       with check (
         (select auth.uid()) = user_id
         or user_id = any ((select public.section_spaces(''finance'', ''edit''))::uuid[]))',
      _table || '_update_workspace', _table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.section_spaces(''finance'', ''edit''))::uuid[]))',
      _table || '_delete_workspace', _table
    );
    -- The fine rights: finance "view" to read, "write" to change.
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''view''))::uuid[]))',
      _table || '_finance_view', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_insert', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_update', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_delete', _table
    );
    execute format('revoke all on public.%I from anon', _table);
    execute format('revoke insert, update on public.%I from authenticated', _table);
  end loop;
end;
$$;

-- What the client names; the rest is stamped or fixed.
grant insert (user_id, month, opening_capital, reserve, currency, closed) on public.finance_plan_months to authenticated;
grant update (opening_capital, reserve, closed) on public.finance_plan_months to authenticated;
grant insert (user_id, month, kind, label, position, source, source_id) on public.finance_plan_rows to authenticated;
grant update (label, position) on public.finance_plan_rows to authenticated;
-- row_id and week in the update grant only so an upsert on (row_id, week) works; the guard keeps them fixed.
grant insert (user_id, row_id, week, planned, note) on public.finance_plan_cells to authenticated;
grant update (row_id, week, user_id, planned, note) on public.finance_plan_cells to authenticated;

-- -----------------------------------------------------------------------------
-- A whole month in one go
-- -----------------------------------------------------------------------------

-- Writes a month with its rows and cells as the caller (row level security,
-- the guards and the read-only rule all apply). `_rows` is
-- [{kind, label, position, source, source_id, cells: [{week, planned}]}].
-- Without _replace an existing month is refused (month_exists), so creating
-- a month twice never doubles it; with _replace the month's rows are swapped
-- for the new ones and the opening capital set (an imported sheet).
create or replace function public.finance_plan_write_month(
  _space uuid,
  _month text,
  _opening numeric,
  _reserve numeric,
  _currency text,
  _rows jsonb,
  _replace boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  _id uuid;
  _row jsonb;
  _cell jsonb;
  _row_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(coalesce(_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(_rows, '[]'::jsonb)) > 300 then
    raise exception 'finance_plan_rows_invalid' using errcode = 'check_violation';
  end if;

  insert into public.finance_plan_months (user_id, month, opening_capital, reserve, currency)
  values (_space, _month, coalesce(_opening, 0), _reserve, coalesce(_currency, 'CZK'))
  on conflict (user_id, month) do nothing
  returning id into _id;

  if _id is null then
    if not coalesce(_replace, false) then
      raise exception 'month_exists' using errcode = 'unique_violation';
    end if;
    update public.finance_plan_months
      set opening_capital = coalesce(_opening, opening_capital)
      where user_id = _space and month = _month
      returning id into _id;
    if _id is null then
      raise exception 'month_exists' using errcode = 'unique_violation';
    end if;
    delete from public.finance_plan_rows where user_id = _space and month = _month;
  end if;

  for _row in select value from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) loop
    insert into public.finance_plan_rows (user_id, month, kind, label, position, source, source_id)
    values (
      _space,
      _month,
      (_row ->> 'kind')::public.transaction_type,
      _row ->> 'label',
      coalesce((_row ->> 'position')::integer, 0),
      coalesce(_row ->> 'source', 'manual'),
      nullif(_row ->> 'source_id', '')::uuid
    )
    returning id into _row_id;
    for _cell in select value from jsonb_array_elements(coalesce(_row -> 'cells', '[]'::jsonb)) loop
      if coalesce((_cell ->> 'planned')::numeric, 0) <> 0 then
        insert into public.finance_plan_cells (user_id, row_id, week, planned)
        values (_space, _row_id, (_cell ->> 'week')::smallint, (_cell ->> 'planned')::numeric);
      end if;
    end loop;
  end loop;
  return _id;
end;
$$;
revoke execute on function public.finance_plan_write_month(uuid, text, numeric, numeric, text, jsonb, boolean) from public, anon;
grant execute on function public.finance_plan_write_month(uuid, text, numeric, numeric, text, jsonb, boolean) to authenticated;

-- The transactions of a period as the plan reads them, with the contact of
-- their invoice or deal (what the caller may see of it). As the caller, so
-- row level security decides; at most 5 000, newest first.
create or replace function public.finance_plan_transactions(_space uuid, _from date, _to date)
returns table (
  id uuid,
  type public.transaction_type,
  amount numeric,
  currency text,
  category text,
  description text,
  occurred_on date,
  recurring_payment_id uuid,
  invoice_id uuid,
  deal_id uuid,
  contact_id uuid
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.type, t.amount, t.currency, t.category, t.description, t.occurred_on,
         t.recurring_payment_id, t.invoice_id, t.deal_id,
         coalesce(i.contact_id, d.contact_id) as contact_id
  from public.transactions t
  left join public.invoices i on i.id = t.invoice_id and i.user_id = t.user_id
  left join public.deals d on d.id = t.deal_id and d.user_id = t.user_id
  where t.user_id = _space
    and t.occurred_on between _from and _to
    and _to - _from <= 400
  order by t.occurred_on desc, t.id
  limit 5000;
$$;
revoke execute on function public.finance_plan_transactions(uuid, date, date) from public, anon;
grant execute on function public.finance_plan_transactions(uuid, date, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Jarvis: the cashLow suggestion (the capital of the month plan drops below
-- zero or the reserve). Same lists as 20261109090000, with 'cashLow' added.
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'overdueCrmTask', 'workerInvite', 'cashLow', 'taskCompleted', 'insight', 'pathReady', 'briefing', 'question'
));

create or replace function public.valid_jarvis_rules(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when jsonb_typeof(_value -> 'suggestion_types') is distinct from 'object' then false
    else coalesce(
      (select count(*) = 7 and bool_and(k in (
         'suggestion_types', 'questions', 'min_gap_hours', 'questions_per_week',
         'suggestion_fresh_days', 'page_settle_seconds', 'instructions'))
       from jsonb_object_keys(_value) as k)
      and (select coalesce(bool_and(
             t.key in ('insight', 'stalledDeal', 'overdueTask', 'overdueInvoice',
                       'overdueCrmTask', 'milestoneReady', 'followUps', 'pathReady', 'workerInvite', 'cashLow')
             and jsonb_typeof(t.value) = 'boolean'), true)
           from jsonb_each(_value -> 'suggestion_types') as t)
      and jsonb_typeof(_value -> 'questions') = 'boolean'
      and jsonb_typeof(_value -> 'min_gap_hours') = 'number'
      and jsonb_typeof(_value -> 'questions_per_week') = 'number'
      and jsonb_typeof(_value -> 'suggestion_fresh_days') = 'number'
      and jsonb_typeof(_value -> 'page_settle_seconds') = 'number'
      and (_value ->> 'min_gap_hours')::numeric between 2 and 72
      and (_value ->> 'min_gap_hours')::numeric = trunc((_value ->> 'min_gap_hours')::numeric)
      and (_value ->> 'questions_per_week')::numeric between 0 and 7
      and (_value ->> 'questions_per_week')::numeric = trunc((_value ->> 'questions_per_week')::numeric)
      and (_value ->> 'suggestion_fresh_days')::numeric between 1 and 30
      and (_value ->> 'suggestion_fresh_days')::numeric = trunc((_value ->> 'suggestion_fresh_days')::numeric)
      and (_value ->> 'page_settle_seconds')::numeric between 10 and 600
      and (_value ->> 'page_settle_seconds')::numeric = trunc((_value ->> 'page_settle_seconds')::numeric)
      and jsonb_typeof(_value -> 'instructions') = 'string'
      and char_length(_value ->> 'instructions') <= 2000,
      false
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('finance_plan_month_created', 'finance', true),
  ('finance_plan_month_updated', 'finance', true),
  ('finance_plan_cell_saved', 'finance', true),
  ('finance_plan_row_added', 'finance', true),
  ('finance_plan_row_updated', 'finance', true),
  ('finance_plan_row_deleted', 'finance', true),
  ('finance_plan_view_changed', 'finance', false),
  ('finance_plan_exported', 'finance', false),
  ('finance_plan_imported', 'finance', true)
on conflict (event) do nothing;
