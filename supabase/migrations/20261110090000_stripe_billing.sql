-- =============================================================================
-- Payments through Stripe (step 23.1)
--   * Stripe has a test and a live mode; the database is one for development
--     and production, so every row Stripe touches says which mode it came
--     from (stripe_mode) and the two never mix. The test mode may change only
--     internal accounts (the owner, the demo account and every
--     @gradus.local account are internal), the live mode only the others and
--     never an @gradus.local address (billing_mode_allowed()).
--   * subscriptions: the mode, when Stripe's state was last applied (an older
--     event never overwrites a newer one) and the recurring amount of one
--     period in its currency (for the MRR, which nothing else can compute).
--   * payments: the mode and when Stripe's state was last applied.
--   * billing_customers: the Stripe customer of a workspace per mode.
--   * stripe_events: every webhook event once (idempotency), with only its
--     identifiers and the outcome, never personal data.
--   * Written only by the server with the service role:
--     billing_apply_subscription / billing_record_payment (the webhook and
--     the daily reconciliation), billing_customer_save, billing_event_claim /
--     _finish. No client reads or writes billing_customers or stripe_events.
--   * The first paid payment of an account with a promo code still makes the
--     partner's payout through the payments_promo_payout trigger (22.2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which accounts a mode may change
-- -----------------------------------------------------------------------------
create or replace function public.billing_mode_allowed(_user_id uuid, _mode text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case _mode
      when 'test' then coalesce(p.is_internal, false) or coalesce(u.email, '') ilike '%@gradus.local'
      when 'live' then not coalesce(p.is_internal, false) and coalesce(u.email, '') not ilike '%@gradus.local'
      else false
    end
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = _user_id
  ), false);
$$;
revoke execute on function public.billing_mode_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_mode_allowed(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- New columns
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column stripe_mode text check (stripe_mode is null or stripe_mode in ('test', 'live')),
  add column provider_synced_at timestamptz,
  add column stripe_amount numeric(12, 2) check (stripe_amount is null or stripe_amount >= 0),
  add column stripe_currency text check (stripe_currency is null or stripe_currency ~ '^[A-Z]{3}$');

comment on column public.subscriptions.stripe_mode is
  'The Stripe mode of provider_ref (test | live); null while the row is not linked to Stripe.';
comment on column public.subscriptions.provider_synced_at is
  'When the gateway''s state was last applied (the event''s time); an older event is ignored.';
comment on column public.subscriptions.stripe_amount is
  'What one period of the Stripe subscription costs (plan and extra workers, before discounts), in stripe_currency.';

alter table public.payments
  add column stripe_mode text not null default 'test' check (stripe_mode in ('test', 'live')),
  add column provider_synced_at timestamptz;

comment on column public.payments.stripe_mode is
  'The Stripe mode the payment came from. Rows before Stripe are test rows of @gradus.local accounts.';

-- -----------------------------------------------------------------------------
-- Stripe customers
-- -----------------------------------------------------------------------------
create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_mode text not null default 'test' check (stripe_mode in ('test', 'live')),
  stripe_customer_id text not null unique
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,200}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customers_one_per_mode unique (user_id, stripe_mode)
);

comment on table public.billing_customers is
  'The Stripe customer of a workspace (user_id = the space) per mode. Server only.';

create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row execute function public.set_updated_at();

alter table public.billing_customers enable row level security;
revoke all on table public.billing_customers from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Webhook events, each once
-- -----------------------------------------------------------------------------
create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
  stripe_mode text not null default 'test' check (stripe_mode in ('test', 'live')),
  type text not null check (char_length(type) between 1 and 100),
  event_created timestamptz not null,
  received_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempts integer not null default 1 check (attempts >= 1),
  outcome text check (outcome is null or outcome in
    ('applied', 'unchanged', 'ignored', 'stale', 'rejected', 'error')),
  -- The workspace the event concerned, once known.
  user_id uuid references auth.users (id) on delete set null,
  -- Only identifiers and states (sub_…, in_…, a status, a reason key).
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048)
);
create index stripe_events_user_idx on public.stripe_events (user_id, received_at desc)
  where user_id is not null;

comment on table public.stripe_events is
  'Every Stripe webhook event once, with its outcome. Identifiers and states only. Server only.';

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;

-- 'new' the first time, 'duplicate' once processed, 'busy' while another
-- delivery holds it (for five minutes), 'retry' after a failed attempt.
create or replace function public.billing_event_claim(
  _event_id text,
  _mode text,
  _type text,
  _created timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.stripe_events%rowtype;
begin
  if _event_id is null or _mode is null or _mode not in ('test', 'live')
     or _type is null or _created is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into public.stripe_events (event_id, stripe_mode, type, event_created, claimed_at)
  values (_event_id, _mode, _type, _created, now())
  on conflict (event_id) do nothing;
  if found then
    return 'new';
  end if;
  select * into _row from public.stripe_events e where e.event_id = _event_id for update;
  if _row.processed_at is not null then
    return 'duplicate';
  end if;
  if _row.claimed_at is not null and _row.claimed_at > now() - interval '5 minutes' then
    return 'busy';
  end if;
  update public.stripe_events
  set claimed_at = now(), attempts = attempts + 1
  where event_id = _event_id;
  return 'retry';
end;
$$;
revoke execute on function public.billing_event_claim(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_event_claim(text, text, text, timestamptz) to service_role;

-- The outcome of an event. 'error' leaves it unprocessed so Stripe's next
-- delivery takes it again at once.
create or replace function public.billing_event_finish(
  _event_id text,
  _outcome text,
  _user_id uuid default null,
  _detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _outcome is null or _outcome not in
     ('applied', 'unchanged', 'ignored', 'stale', 'rejected', 'error') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  update public.stripe_events
  set outcome = _outcome,
      processed_at = case when _outcome = 'error' then null else now() end,
      claimed_at = case when _outcome = 'error' then null else claimed_at end,
      user_id = coalesce(_user_id, user_id),
      detail = coalesce(_detail, '{}'::jsonb)
  where event_id = _event_id;
end;
$$;
revoke execute on function public.billing_event_finish(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.billing_event_finish(text, text, uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- The workspace's Stripe customer
-- -----------------------------------------------------------------------------

-- Saves the customer made for the workspace, or returns the one saved first
-- (two checkouts at once make one row; the server uses the returned id).
create or replace function public.billing_customer_save(
  _user_id uuid,
  _mode text,
  _customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _existing text;
begin
  if _user_id is null or _mode is null or _mode not in ('test', 'live') or _customer_id is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not public.billing_mode_allowed(_user_id, _mode) then
    raise exception 'mode_not_allowed' using errcode = '42501';
  end if;
  insert into public.billing_customers (user_id, stripe_mode, stripe_customer_id)
  values (_user_id, _mode, _customer_id)
  on conflict (user_id, stripe_mode) do nothing;
  select c.stripe_customer_id into _existing
  from public.billing_customers c
  where c.user_id = _user_id and c.stripe_mode = _mode;
  return _existing;
end;
$$;
revoke execute on function public.billing_customer_save(uuid, text, text) from public, anon, authenticated;
grant execute on function public.billing_customer_save(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- The subscription as Stripe has it
-- -----------------------------------------------------------------------------

-- Writes Stripe's state of a subscription into the workspace's row: plan,
-- billing period, status, period, trial end, cancellation at the period's
-- end (the reason and note stay as the user gave them) and a downgrade
-- scheduled for the end of the period. Refuses a mode the account may not
-- use and a row linked to the other mode; ignores an event older than the
-- state already applied, and a cancelled subscription that is not the one
-- the row follows (a new checkout replaced it).
create or replace function public.billing_apply_subscription(
  _user_id uuid,
  _mode text,
  _event_at timestamptz,
  _subscription_ref text,
  _plan_key text,
  _billing text,
  _status text,
  _period_start timestamptz,
  _period_end timestamptz,
  _trial_end timestamptz,
  _cancel_at_period_end boolean,
  _scheduled_plan_key text default null,
  _scheduled_billing text default null,
  _scheduled_at timestamptz default null,
  _amount numeric default null,
  _currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ranks constant text[] := array['solo', 'pro', 'team'];
  _sub public.subscriptions%rowtype;
  _status_value public.subscription_status;
  _cancel boolean := coalesce(_cancel_at_period_end, false);
  _trial timestamptz;
  _changed boolean;
begin
  if _user_id is null or _mode is null or _mode not in ('test', 'live') or _event_at is null
     or _subscription_ref is null or _subscription_ref !~ '^sub_[A-Za-z0-9_]{1,200}$'
     or array_position(_ranks, _plan_key) is null
     or _billing is null or _billing not in ('monthly', 'yearly')
     or _status is null or _status not in ('trialing', 'active', 'past_due', 'cancelled')
     or (_period_start is not null and _period_end is not null and _period_end < _period_start)
     or (_scheduled_plan_key is null) <> (_scheduled_billing is null)
     or (_scheduled_plan_key is null) <> (_scheduled_at is null)
     or (_scheduled_plan_key is not null and array_position(_ranks, _scheduled_plan_key) is null)
     or (_scheduled_billing is not null and _scheduled_billing not in ('monthly', 'yearly'))
     or (_amount is not null and _amount < 0)
     or (_currency is not null and _currency !~ '^[A-Z]{3}$') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not public.billing_mode_allowed(_user_id, _mode) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'mode');
  end if;

  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'no_subscription');
  end if;
  -- One Stripe subscription belongs to one workspace.
  if exists (
    select 1 from public.subscriptions o
    where o.provider = 'stripe' and o.provider_ref = _subscription_ref and o.user_id <> _user_id
  ) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'other_account');
  end if;
  if _sub.provider = 'stripe' and _sub.provider_ref is not null
     and _sub.stripe_mode is distinct from _mode then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'mode');
  end if;
  if _sub.provider_synced_at is not null and _event_at < _sub.provider_synced_at then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if _sub.provider = 'stripe' and _sub.provider_ref is not null
     and _sub.provider_ref <> _subscription_ref and _status = 'cancelled' then
    return jsonb_build_object('outcome', 'stale', 'reason', 'other_subscription');
  end if;

  _status_value := _status::public.subscription_status;
  -- The period of a trial is the trial; after it the trial's end stays as history.
  _trial := case when _status = 'trialing' then coalesce(_trial_end, _period_end) else _sub.trial_ends_at end;
  _changed := (_sub.plan_key, _sub.billing, _sub.status, _sub.current_period_end, _sub.trial_ends_at,
               _sub.cancel_at_period_end, _sub.scheduled_plan_key, _sub.scheduled_billing,
               _sub.scheduled_at, _sub.provider, _sub.provider_ref, _sub.stripe_mode,
               _sub.stripe_amount, _sub.stripe_currency)
    is distinct from
              (_plan_key, _billing, _status_value, _period_end, _trial,
               _cancel, _scheduled_plan_key, _scheduled_billing,
               _scheduled_at, 'stripe'::text, _subscription_ref, _mode,
               coalesce(_amount, _sub.stripe_amount), coalesce(_currency, _sub.stripe_currency));

  update public.subscriptions
  set plan_key = _plan_key,
      billing = _billing,
      status = _status_value,
      current_period_start = coalesce(_period_start, current_period_start),
      current_period_end = _period_end,
      trial_ends_at = _trial,
      cancel_at_period_end = _cancel,
      cancel_reason = case when _cancel then cancel_reason end,
      cancel_note = case when _cancel then cancel_note end,
      cancel_requested_at = case when _cancel then coalesce(cancel_requested_at, now()) end,
      scheduled_plan_key = _scheduled_plan_key,
      scheduled_billing = _scheduled_billing,
      scheduled_at = _scheduled_at,
      provider = 'stripe',
      provider_ref = _subscription_ref,
      stripe_mode = _mode,
      stripe_amount = coalesce(_amount, stripe_amount),
      stripe_currency = coalesce(_currency, stripe_currency),
      provider_synced_at = _event_at,
      updated_at = now()
  where user_id = _user_id;

  return jsonb_build_object(
    'outcome', case when _changed then 'applied' else 'unchanged' end,
    'changed', _changed,
    'previous_status', _sub.status,
    'previous_plan', _sub.plan_key,
    'linked', _sub.provider_ref is distinct from _subscription_ref
  );
end;
$$;
revoke execute on function public.billing_apply_subscription(
  uuid, text, timestamptz, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean,
  text, text, timestamptz, numeric, text) from public, anon, authenticated;
grant execute on function public.billing_apply_subscription(
  uuid, text, timestamptz, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean,
  text, text, timestamptz, numeric, text) to service_role;

-- -----------------------------------------------------------------------------
-- A payment as Stripe has it (one row per invoice)
-- -----------------------------------------------------------------------------

-- A payment only moves forward: failed → paid → refunded. Another failed
-- attempt of the same invoice moves its time. `first` = the account's first
-- payment of money (an invoice of 0, the start of a trial or a free month,
-- is recorded but is not one). The first paid payment of an account with a
-- promo code makes the partner's payout (trigger payments_promo_payout, of
-- the amount without VAT).
create or replace function public.billing_record_payment(
  _user_id uuid,
  _mode text,
  _event_at timestamptz,
  _invoice_ref text,
  _status text,
  _amount numeric,
  _vat_amount numeric,
  _currency text,
  _paid_at timestamptz,
  _invoice_url text default null
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
     or (_url is not null and (_url !~ '^https://' or char_length(_url) > 2000)) then
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
      set invoice_url = coalesce(_url, invoice_url), provider_synced_at = _event_at
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
       provider, provider_ref, stripe_mode, provider_synced_at)
    values
      (_user_id, _sub_id, _amount, coalesce(_vat_amount, 0), _currency, _paid_at, _status, _url,
       'stripe', _invoice_ref, _mode, _event_at)
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
  uuid, text, timestamptz, text, text, numeric, numeric, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.billing_record_payment(
  uuid, text, timestamptz, text, text, numeric, numeric, text, timestamptz, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- Metrics (docs/metrics.md, 7. Náklady a ekonomika)
-- -----------------------------------------------------------------------------

-- Monthly recurring revenue per currency (currencies never add up): the
-- running paid Stripe subscriptions, a year counted as a twelfth. Live mode
-- only, unless internal accounts are asked for too.
create or replace function public.metric_mrr(
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (key text, value numeric, accounts bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[] := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
begin
  return query
  select
    s.stripe_currency,
    round(sum(case when s.billing = 'yearly' then s.stripe_amount / 12 else s.stripe_amount end), 2),
    count(*)
  from public.subscriptions s
  where s.user_id = any(_users)
    and s.provider = 'stripe'
    and (s.stripe_mode = 'live' or coalesce(_include_internal, false))
    and s.status in ('active', 'past_due')
    and s.stripe_amount is not null
    and s.stripe_currency is not null
    and not public.subscription_expired(s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end)
  group by s.stripe_currency
  order by s.stripe_currency;
end;
$$;
revoke all on function public.metric_mrr(text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_mrr(text, boolean, jsonb) to service_role;

-- Trial → payment: accounts whose trial ended in the period (catalog plans,
-- not beta) and how many of them have a paid payment since.
create or replace function public.metric_trial_conversion(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (trials_ended bigint, trials_paid bigint, trial_paid_pct numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);
  return query
  with cohort as (
    select s.user_id,
      exists (
        select 1 from public.payments p
        where p.user_id = s.user_id and p.status in ('paid', 'refunded') and p.amount > 0
      ) as paid
    from public.subscriptions s
    where s.user_id = any(_users)
      and s.trial_ends_at is not null
      and s.plan_key in ('solo', 'pro', 'team')
      and s.trial_ends_at >= public.metric_day_start(_from, _tz)
      and s.trial_ends_at < public.metric_day_start(_to + 1, _tz)
      and s.trial_ends_at <= now()
  )
  select
    count(*),
    count(*) filter (where c.paid),
    case when count(*) > 0 then round(100.0 * count(*) filter (where c.paid) / count(*), 1) else 0 end
  from cohort c;
end;
$$;
revoke all on function public.metric_trial_conversion(date, date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_trial_conversion(date, date, text, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('checkout_started', 'plan', false),
  ('checkout_completed', 'plan', false),
  ('payment_succeeded', 'plan', false),
  ('payment_failed', 'plan', false),
  ('payment_refunded', 'plan', false)
on conflict (event) do nothing;
