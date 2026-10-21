-- =============================================================================
-- Fakturoid is gone: invoices live only in the app.
--   * invoices issued through Fakturoid become ordinary ones (they can be
--     marked paid and edited like any other)
--   * the stored, encrypted credentials are deleted
--   * fakturoid_connections and invoices.fakturoid_id stay, empty, until a
--     separate plan drops them; fakturoid_apply_invoice stays server-only and
--     unused
-- =============================================================================

update public.invoices set fakturoid_id = null where fakturoid_id is not null;

delete from public.fakturoid_connections;

delete from public.analytics_event_catalog
where event in ('fakturoid_connected', 'fakturoid_disconnected', 'fakturoid_synced');

-- The client still never writes fakturoid_id; nothing else is locked any more.
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
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.mark_invoice_paid(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _invoice public.invoices;
  _today date;
begin
  if _ws is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_section_access(_ws, 'finance', 'edit') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _ws for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.status = 'paid' then
    return _invoice;
  end if;

  _today := public.user_today(_ws);
  update public.invoices set status = 'paid', paid_on = _today
  where id = _invoice_id returning * into _invoice;

  perform public.book_invoice_income(_invoice, _today);
  return _invoice;
end;
$$;
