-- =============================================================================
-- Fakturoid
--   * the connection (encrypted credentials) stays server-only; it also holds
--     the owner's choice whether a paid invoice moves its deal to a won stage
--     and the outcome of the last sync
--   * an invoice issued in Fakturoid is mirrored in `invoices` with its
--     fakturoid_id; Fakturoid is the source of truth for its number, amount,
--     dates and status, so the client cannot change them or the link itself
--   * the server applies Fakturoid's state through fakturoid_apply_invoice(),
--     which books the income the same way marking an invoice paid does
-- =============================================================================

alter table public.fakturoid_connections
  add column move_deal_on_paid boolean not null default false,
  add column last_sync_error text;

-- -----------------------------------------------------------------------------
-- Guard: fakturoid_id and a linked invoice's facts belong to the server
-- -----------------------------------------------------------------------------

create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.fakturoid_id := null;
    else
      new.fakturoid_id := old.fakturoid_id;
      if old.fakturoid_id is not null then
        new.number := old.number;
        new.amount := old.amount;
        new.currency := old.currency;
        new.status := old.status;
        new.issued_on := old.issued_on;
        new.due_on := old.due_on;
        new.paid_on := old.paid_on;
        new.deal_id := old.deal_id;
        new.contact_id := old.contact_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger invoices_guard
  before insert or update on public.invoices
  for each row execute function public.invoices_guard();
revoke execute on function public.invoices_guard() from public, anon;

-- -----------------------------------------------------------------------------
-- Booking the income of a paid invoice (shared by both paths)
-- -----------------------------------------------------------------------------

-- The deal's own income is linked to the invoice when there is one, otherwise a
-- new transaction is added. Internal: callers check ownership first.
create or replace function public.book_invoice_income(_invoice public.invoices, _paid_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _linked integer := 0;
begin
  if _invoice.deal_id is not null then
    update public.transactions set invoice_id = _invoice.id
    where user_id = _invoice.user_id and deal_id = _invoice.deal_id
      and source = 'deal_invoice' and invoice_id is null;
    get diagnostics _linked = row_count;
  end if;

  if _linked = 0 then
    insert into public.transactions
      (user_id, type, amount, currency, category, description, occurred_on,
       deal_id, invoice_id, source)
    values (
      _invoice.user_id, 'income', _invoice.amount, _invoice.currency, 'sales',
      coalesce(_invoice.customer_name || ' · ', '') || _invoice.number,
      _paid_on, _invoice.deal_id, _invoice.id, 'invoice'
    );
  end if;
end;
$$;
revoke execute on function public.book_invoice_income(public.invoices, date)
  from public, anon, authenticated, service_role;

-- Same behaviour as before for app-only invoices. An invoice issued in Fakturoid
-- is paid there (the server records the payment and syncs it back), so the
-- client cannot mark it paid here and drift away from the real one.
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
  if _invoice.fakturoid_id is not null then
    raise exception 'invoice_managed_by_fakturoid' using errcode = 'insufficient_privilege';
  end if;

  _today := public.user_today(_uid);
  update public.invoices set status = 'paid', paid_on = _today
  where id = _invoice_id returning * into _invoice;

  perform public.book_invoice_income(_invoice, _today);
  return _invoice;
end;
$$;
grant execute on function public.mark_invoice_paid(uuid) to authenticated;
revoke execute on function public.mark_invoice_paid(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Applying Fakturoid's state (server only)
-- -----------------------------------------------------------------------------

-- Updates the mirrored invoice from Fakturoid. A newly paid invoice books its
-- income on the day Fakturoid reports, and when the owner has asked for it,
-- moves an open deal into the first won stage (which runs the usual won
-- triggers: Clients, finance, worker rewards). "Paid" is final here: an invoice
-- already paid is left alone. Returns what happened, or null when the invoice
-- is not this user's.
create or replace function public.fakturoid_apply_invoice(
  _user_id uuid,
  _fakturoid_id bigint,
  _status public.invoice_status,
  _number text,
  _amount numeric,
  _due_on date,
  _paid_on date,
  _move_deal boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _invoice public.invoices;
  _stage public.pipeline_stages;
  _won_stage uuid;
  _deal_moved boolean := false;
  _paid_now boolean := false;
begin
  select * into _invoice from public.invoices
  where user_id = _user_id and fakturoid_id = _fakturoid_id for update;
  if not found then
    return null;
  end if;
  if _invoice.status = 'paid' then
    return jsonb_build_object('invoice_id', _invoice.id, 'paid_now', false, 'deal_moved', false);
  end if;

  update public.invoices set
    number = coalesce(nullif(_number, ''), number),
    amount = case when _amount > 0 then _amount else amount end,
    due_on = coalesce(_due_on, due_on),
    status = coalesce(_status, status),
    paid_on = case when _status = 'paid'
      then coalesce(_paid_on, public.user_today(_user_id)) else null end
  where id = _invoice.id
  returning * into _invoice;

  if _invoice.status = 'paid' then
    _paid_now := true;
    perform public.book_invoice_income(_invoice, _invoice.paid_on);

    if _move_deal and _invoice.deal_id is not null then
      select s.* into _stage
      from public.deals d join public.pipeline_stages s on s.id = d.stage_id
      where d.id = _invoice.deal_id and d.user_id = _user_id;
      if found and not _stage.is_won and not _stage.is_lost then
        select id into _won_stage from public.pipeline_stages
        where user_id = _user_id and is_won
        order by position, created_at limit 1;
        if _won_stage is not null then
          update public.deals set stage_id = _won_stage
          where id = _invoice.deal_id and user_id = _user_id;
          _deal_moved := true;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', _invoice.id, 'paid_now', _paid_now, 'deal_moved', _deal_moved
  );
end;
$$;
revoke execute on function public.fakturoid_apply_invoice(
  uuid, bigint, public.invoice_status, text, numeric, date, date, boolean
) from public, anon, authenticated;
grant execute on function public.fakturoid_apply_invoice(
  uuid, bigint, public.invoice_status, text, numeric, date, date, boolean
) to service_role;
