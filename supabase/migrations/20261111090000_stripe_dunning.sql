-- =============================================================================
-- Managing payments (step 23.2): the payment history, failed payments, the
-- owner's digest and the payment metrics
--   * payments: the plan, the billing period and the service period an
--     invoice paid for (the history shows them; Stripe's line items say it,
--     nothing is computed later). Null on rows before this step.
--   * billing_record_payment() takes them (new parameters with defaults, so
--     the old call still works). A refund keeps what the payment was for.
--   * billing_alerts: what the app's owner hears about in one e-mail a day at
--     most: the first payment of an account and a subscription Stripe ended
--     after its last failed attempt. Server only (service role); the
--     @gradus.local accounts never get a row.
--   * metric_payments(): revenue, refunds, paying accounts and still failed
--     payments in a period, per currency (currencies never add up), live
--     mode only unless internal accounts are asked for too.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a payment paid for
-- -----------------------------------------------------------------------------
alter table public.payments
  add column plan_key text check (plan_key is null or plan_key in ('solo', 'pro', 'team')),
  add column billing text check (billing is null or billing in ('monthly', 'yearly')),
  add column period_start timestamptz,
  add column period_end timestamptz;

alter table public.payments
  add constraint payments_period_order check (
    period_start is null or period_end is null or period_end >= period_start
  );

comment on column public.payments.plan_key is
  'The plan the invoice was for (from the Stripe subscription at the time); null before step 23.2.';
comment on column public.payments.period_start is
  'The start of the service period the invoice paid for (its line items); null before step 23.2.';

-- -----------------------------------------------------------------------------
-- billing_record_payment(), now with what the payment was for
-- -----------------------------------------------------------------------------
drop function if exists public.billing_record_payment(
  uuid, text, timestamptz, text, text, numeric, numeric, text, timestamptz, text);

-- A payment only moves forward: failed → paid → refunded. Another failed
-- attempt of the same invoice moves its time. `first` = the account's first
-- payment of money (an invoice of 0, the start of a trial or a free month,
-- is recorded but is not one). The first paid payment of an account with a
-- promo code makes the partner's payout (trigger payments_promo_payout, of
-- the amount without VAT). The plan, billing and period of a refund stay
-- what the payment was for.
create function public.billing_record_payment(
  _user_id uuid,
  _mode text,
  _event_at timestamptz,
  _invoice_ref text,
  _status text,
  _amount numeric,
  _vat_amount numeric,
  _currency text,
  _paid_at timestamptz,
  _invoice_url text default null,
  _plan_key text default null,
  _billing text default null,
  _period_start timestamptz default null,
  _period_end timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ranks constant text[] := array['failed', 'paid', 'refunded'];
  _row public.payments%rowtype;
  _sub_id uuid;
  _id uuid;
  _first boolean := false;
  _previous text;
  _url text := nullif(btrim(coalesce(_invoice_url, '')), '');
begin
  if _user_id is null or _mode is null or _mode not in ('test', 'live') or _event_at is null
     or _invoice_ref is null or _invoice_ref !~ '^in_[A-Za-z0-9_]{1,200}$'
     or array_position(_ranks, _status) is null
     or _amount is null or _amount < 0
     or coalesce(_vat_amount, 0) < 0 or coalesce(_vat_amount, 0) > _amount
     or _currency is null or _currency !~ '^[A-Z]{3}$'
     or _paid_at is null
     or (_url is not null and (_url !~ '^https://' or char_length(_url) > 2000))
     or (_plan_key is not null and _plan_key not in ('solo', 'pro', 'team'))
     or (_billing is not null and _billing not in ('monthly', 'yearly'))
     or (_period_start is not null and _period_end is not null and _period_end < _period_start) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not public.billing_mode_allowed(_user_id, _mode) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'mode');
  end if;

  perform pg_advisory_xact_lock(hashtext('public.billing_record_payment:' || _invoice_ref));
  select s.id into _sub_id from public.subscriptions s where s.user_id = _user_id;

  select * into _row from public.payments p
  where p.provider = 'stripe' and p.provider_ref = _invoice_ref
  for update;

  if found then
    if _row.user_id <> _user_id or _row.stripe_mode <> _mode then
      return jsonb_build_object('outcome', 'rejected', 'reason', 'other_account');
    end if;
    _previous := _row.status;
    if array_position(_ranks, _status) < array_position(_ranks, _row.status)
       or (_row.provider_synced_at is not null and _event_at < _row.provider_synced_at) then
      return jsonb_build_object('outcome', 'stale', 'payment_id', _row.id);
    end if;
    if _status = _row.status and _status <> 'failed' then
      update public.payments
      set invoice_url = coalesce(_url, invoice_url),
          plan_key = coalesce(plan_key, _plan_key),
          billing = coalesce(billing, _billing),
          period_start = coalesce(period_start, _period_start),
          period_end = coalesce(period_end, _period_end),
          provider_synced_at = _event_at
      where id = _row.id;
      return jsonb_build_object('outcome', 'unchanged', 'payment_id', _row.id, 'previous_status', _previous);
    end if;
    if _status = 'paid' and _amount > 0 then
      _first := not exists (
        select 1 from public.payments p
        where p.user_id = _user_id and p.id <> _row.id and p.status in ('paid', 'refunded')
          and p.amount > 0);
    end if;
    update public.payments
    set status = _status,
        amount = case when _status = 'refunded' then amount else _amount end,
        vat_amount = case when _status = 'refunded' then vat_amount else coalesce(_vat_amount, 0) end,
        currency = case when _status = 'refunded' then currency else _currency end,
        paid_at = case when _status = 'refunded' then paid_at else _paid_at end,
        invoice_url = coalesce(_url, invoice_url),
        plan_key = case when _status = 'refunded' then coalesce(plan_key, _plan_key) else coalesce(_plan_key, plan_key) end,
        billing = case when _status = 'refunded' then coalesce(billing, _billing) else coalesce(_billing, billing) end,
        period_start = case when _status = 'refunded' then coalesce(period_start, _period_start)
                            else coalesce(_period_start, period_start) end,
        period_end = case when _status = 'refunded' then coalesce(period_end, _period_end)
                          else coalesce(_period_end, period_end) end,
        subscription_id = coalesce(subscription_id, _sub_id),
        provider_synced_at = _event_at
    where id = _row.id;
    _id := _row.id;
  else
    if _status = 'paid' and _amount > 0 then
      _first := not exists (
        select 1 from public.payments p
        where p.user_id = _user_id and p.status in ('paid', 'refunded') and p.amount > 0);
    end if;
    insert into public.payments
      (user_id, subscription_id, amount, vat_amount, currency, paid_at, status, invoice_url,
       provider, provider_ref, stripe_mode, provider_synced_at,
       plan_key, billing, period_start, period_end)
    values
      (_user_id, _sub_id, _amount, coalesce(_vat_amount, 0), _currency, _paid_at, _status, _url,
       'stripe', _invoice_ref, _mode, _event_at,
       _plan_key, _billing, _period_start, _period_end)
    returning id into _id;
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'payment_id', _id,
    'previous_status', _previous,
    'first', _first
  );
end;
$$;
revoke execute on function public.billing_record_payment(
  uuid, text, timestamptz, text, text, numeric, numeric, text, timestamptz, text,
  text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_record_payment(
  uuid, text, timestamptz, text, text, numeric, numeric, text, timestamptz, text,
  text, text, timestamptz, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- The owner's digest: first payments and subscriptions ended for non-payment
-- -----------------------------------------------------------------------------
create table public.billing_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('first_payment', 'final_failure')),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  -- The invoice (first payment) or the subscription (final failure).
  ref text not null check (ref ~ '^(in|sub)_[A-Za-z0-9_]{1,200}$'),
  plan_key text check (plan_key is null or plan_key in ('solo', 'pro', 'team')),
  billing text check (billing is null or billing in ('monthly', 'yearly')),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint billing_alerts_once unique (kind, ref)
);
create index billing_alerts_pending_idx on public.billing_alerts (created_at) where notified_at is null;
create index billing_alerts_notified_idx on public.billing_alerts (notified_at desc) where notified_at is not null;

comment on table public.billing_alerts is
  'What the app''s owner hears about in one e-mail a day at most: first payments and subscriptions ended for non-payment. Server only.';

alter table public.billing_alerts enable row level security;
revoke all on table public.billing_alerts from anon, authenticated;

-- Records one alert once (the same invoice or subscription again is nothing).
create or replace function public.billing_alert_add(
  _kind text,
  _user_id uuid,
  _mode text,
  _ref text,
  _plan_key text default null,
  _billing text default null,
  _amount numeric default null,
  _currency text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _kind is null or _kind not in ('first_payment', 'final_failure') or _user_id is null
     or _mode is null or _mode not in ('test', 'live') or _ref is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into public.billing_alerts (kind, user_id, stripe_mode, ref, plan_key, billing, amount, currency)
  values (_kind, _user_id, _mode, _ref, _plan_key, _billing, _amount, _currency)
  on conflict (kind, ref) do nothing;
  return found;
end;
$$;
revoke execute on function public.billing_alert_add(text, uuid, text, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.billing_alert_add(text, uuid, text, text, text, text, numeric, text)
  to service_role;

-- The alerts of one digest: everything not sent yet, unless a digest already
-- went out today (in _tz). Marked as sent here, under a lock, so two callers
-- never send the same twice; billing_alerts_release() takes them back when
-- the e-mail could not be sent.
create or replace function public.billing_alerts_claim(_tz text default 'Europe/Prague')
returns table (
  id uuid,
  kind text,
  user_id uuid,
  stripe_mode text,
  plan_key text,
  billing text,
  amount numeric,
  currency text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _zone text := coalesce(nullif(_tz, ''), 'Europe/Prague');
  _today_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('public.billing_alerts_claim'));
  _today_start := (date_trunc('day', now() at time zone _zone)) at time zone _zone;
  if exists (select 1 from public.billing_alerts a where a.notified_at >= _today_start) then
    return;
  end if;
  return query
  update public.billing_alerts a
  set notified_at = now()
  where a.id in (
    select p.id from public.billing_alerts p
    where p.notified_at is null
    order by p.created_at
    limit 200
  )
  returning a.id, a.kind, a.user_id, a.stripe_mode, a.plan_key, a.billing, a.amount, a.currency, a.created_at;
end;
$$;
revoke execute on function public.billing_alerts_claim(text) from public, anon, authenticated;
grant execute on function public.billing_alerts_claim(text) to service_role;

create or replace function public.billing_alerts_release(_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.billing_alerts set notified_at = null where id = any(coalesce(_ids, '{}'));
$$;
revoke execute on function public.billing_alerts_release(uuid[]) from public, anon, authenticated;
grant execute on function public.billing_alerts_release(uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- Metrics (docs/metrics.md, 7. Náklady a ekonomika)
-- -----------------------------------------------------------------------------

-- Payments in a period per currency: revenue (paid, refunds left out), what
-- was refunded, the accounts that paid and the invoices whose payment failed
-- and has not gone through since. Live mode only, unless internal accounts
-- are asked for too (the test mode is internal accounts only).
create or replace function public.metric_payments(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (key text, revenue numeric, refunded numeric, paying_accounts bigint, failed_payments bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
  return query
  select
    p.currency,
    coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::numeric,
    coalesce(sum(p.amount) filter (where p.status = 'refunded'), 0)::numeric,
    count(distinct p.user_id) filter (where p.status = 'paid' and p.amount > 0),
    count(*) filter (where p.status = 'failed')
  from public.payments p
  where p.user_id = any(_users)
    and p.provider = 'stripe'
    and (p.stripe_mode = 'live' or coalesce(_include_internal, false))
    and p.paid_at >= public.metric_day_start(_from, _tz)
    and p.paid_at < public.metric_day_start(_to + 1, _tz)
  group by p.currency
  order by p.currency;
end;
$$;
revoke all on function public.metric_payments(date, date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_payments(date, date, text, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('billing_portal_opened', 'plan', false)
on conflict (event) do nothing;
