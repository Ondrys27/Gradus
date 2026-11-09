-- =============================================================================
-- Step 24.1: currencies of the world
--
-- 1. exchange_rates: the last rate of every currency against EUR, written by
--    the daily cron (server only); exchange_rate_sources: how each source did.
-- 2. The plan catalog: prices in EUR plus manual prices in any currency
--    (before: exactly CZK and EUR); currency_digits() for whole currencies.
-- 3. Add-ons of the catalog (plan_catalog_versions.add_ons, no_branding) and
--    the ones a subscription has (subscriptions.add_ons, server only).
-- 4. finance_totals_by_currency(): the summary per currency, never added up.
-- Additive only: nothing is dropped, renamed or retyped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Exchange rates
-- -----------------------------------------------------------------------------

create table public.exchange_rates (
  base text not null default 'EUR' check (base = 'EUR'),
  code text not null check (code ~ '^[A-Z]{3}$' and code <> 'EUR'),
  rate numeric not null check (rate > 0 and rate < 1000000000),
  fetched_at timestamptz not null,
  source text not null check (source in ('ecb', 'open_er')),
  primary key (base, code)
);
comment on table public.exchange_rates is
  'Units of a currency per one EUR, the last fetched rate of each. Written by the daily cron only; a failed source leaves the last rate. Display only: no stored amount is ever converted.';

alter table public.exchange_rates enable row level security;
-- No policies: the server reads it (src/features/currency/server/rates.ts) and passes it on.
revoke all on public.exchange_rates from anon, authenticated;

create table public.exchange_rate_sources (
  source text primary key check (source in ('ecb', 'open_er')),
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  -- A short code (http_503, timeout, invalid), never a response body.
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  rates integer not null default 0 check (rates >= 0)
);
comment on table public.exchange_rate_sources is
  'How each source of exchange rates did on its last run; shown in Administration → Health. Server only.';

alter table public.exchange_rate_sources enable row level security;
revoke all on public.exchange_rate_sources from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Prices in any currency
-- -----------------------------------------------------------------------------

-- Decimals an amount is written with (src/config/currencies.ts, compared by
-- currencies-schema.test.ts): 0 for JPY, HUF, KRW…, 3 for KWD…, else 2.
create or replace function public.currency_digits(_code text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when _code = any (array[
      'AFN', 'ALL', 'BIF', 'CLP', 'COP', 'DJF', 'GNF', 'HUF', 'IDR', 'IQD', 'IRR', 'ISK',
      'JPY', 'KMF', 'KPW', 'KRW', 'LAK', 'LBP', 'MGA', 'MMK', 'PKR', 'PYG', 'RWF', 'SOS',
      'SYP', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'YER']) then 0
    when _code = any (array['BHD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) then 3
    else 2
  end;
$$;

-- Prices of one thing: EUR always, other currencies as the owner set them by
-- hand; each above 0, at most 1 000 000 000 and with at most the currency's
-- decimals (never more than cents). Same as validatePlanCatalog().
create or replace function public.plan_catalog_money_ok(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when not (_value ? 'EUR') then false
    when (select count(*) from jsonb_object_keys(_value)) > 60 then false
    else coalesce(
      (select bool_and(coalesce(
         c ~ '^[A-Z]{3}$'
         and public.plan_catalog_number(_value -> c) > 0
         and public.plan_catalog_number(_value -> c) <= 1000000000
         and round(public.plan_catalog_number(_value -> c), least(public.currency_digits(c), 2))
           = public.plan_catalog_number(_value -> c), false))
       from jsonb_object_keys(_value) as c),
      false)
  end;
$$;

-- The same currencies in two prices of a plan (a manual CZK monthly price
-- needs a manual CZK yearly one), and a year never above twelve months.
create or replace function public.plan_catalog_same_currencies(_a jsonb, _b jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(k order by k) from jsonb_object_keys(_a) as k)
      = (select array_agg(k order by k) from jsonb_object_keys(_b) as k),
    false);
$$;

create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'included_workers', 'limits',
      'features', 'recommended', 'order']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    when not public.plan_catalog_money_ok(_p -> 'monthly') then false
    when not public.plan_catalog_money_ok(_p -> 'yearly') then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'yearly')
      and (select bool_and(coalesce(
             public.plan_catalog_number(_p -> 'yearly' -> c)
               <= 12 * public.plan_catalog_number(_p -> 'monthly' -> c), false))
           from jsonb_object_keys(_p -> 'monthly') as c)
      and (jsonb_typeof(_p -> 'per_worker') = 'null'
        or (public.plan_catalog_money_ok(_p -> 'per_worker')
          and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'per_worker')))
      and (not (_p ? 'included_workers') or public.plan_catalog_count_ok(_p -> 'included_workers', false))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Add-ons
-- -----------------------------------------------------------------------------

-- The keys the code knows (src/config/pricing.ts ADD_ON_KEYS).
create or replace function public.add_on_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['no_branding'];
$$;

-- The add-ons of a catalog version: each known key once, a name and a short
-- description in both languages, a monthly price like a plan's, an order.
create or replace function public.valid_plan_add_ons(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'array' then false
    when jsonb_array_length(_value) > 10 then false
    when octet_length(_value::text) > 16000 then false
    else coalesce(
      (select bool_and(coalesce(
         jsonb_typeof(a) = 'object'
         and public.plan_catalog_keys_ok(a, array['key', 'name', 'description', 'monthly', 'order'])
         and a ->> 'key' = any (public.add_on_keys())
         and public.plan_catalog_text_ok(a -> 'name', 1, 40)
         and public.plan_catalog_text_ok(a -> 'description', 0, 160)
         and public.plan_catalog_money_ok(a -> 'monthly')
         and public.plan_catalog_number(a -> 'order') between 0 and 9
         and public.plan_catalog_number(a -> 'order') = trunc(public.plan_catalog_number(a -> 'order')),
         false))
       from jsonb_array_elements(_value) as a), true)
      and (select count(distinct a ->> 'key') = count(*) from jsonb_array_elements(_value) as a)
  end;
$$;

-- Null = a version from before step 24.1: it reads as the seed's add-ons.
alter table public.plan_catalog_versions
  add column add_ons jsonb
    constraint plan_catalog_versions_add_ons_valid
      check (add_ons is null or public.valid_plan_add_ons(add_ons));

-- A published or archived version keeps its add-ons as they were.
create or replace function public.plan_catalog_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
    return old;
  end if;
  -- The author's account was deleted: only the author columns become null.
  if (new.created_by is distinct from old.created_by or new.published_by is distinct from old.published_by)
     and (new.created_by is not distinct from old.created_by or new.created_by is null)
     and (new.published_by is not distinct from old.published_by or new.published_by is null)
     and new.id = old.id and new.created_at = old.created_at and new.status = old.status
     and new.payload = old.payload and new.add_ons is not distinct from old.add_ons
     and new.published_at is not distinct from old.published_at then
    return new;
  end if;
  if new.id <> old.id or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  if old.status = 'draft' then
    if new.status = 'archived' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  elsif old.status = 'published' then
    if new.status <> 'archived' or new.payload <> old.payload
       or new.add_ons is distinct from old.add_ons
       or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  else
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_catalog_versions_guard() from public, anon, authenticated;

-- Saves the draft with its add-ons (creates it when there is none).
create or replace function public.admin_plan_catalog_save_draft_full(
  _payload jsonb,
  _add_ons jsonb,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  perform public.admin_require_owner();
  if _payload is null or not public.valid_plan_catalog(_payload)
     or _add_ons is null or not public.valid_plan_add_ons(_add_ons) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  update public.plan_catalog_versions set payload = _payload, add_ons = _add_ons
  where status = 'draft'
  returning id into _id;
  if _id is null then
    insert into public.plan_catalog_versions (created_by, status, payload, add_ons)
    values (_uid, 'draft', _payload, _add_ons)
    returning id into _id;
  end if;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans.draft', _ip_hash,
          jsonb_build_object('action', 'save_draft', 'version', _id));
  return _id;
end;
$$;
revoke all on function public.admin_plan_catalog_save_draft_full(jsonb, jsonb, text) from public, anon;
grant execute on function public.admin_plan_catalog_save_draft_full(jsonb, jsonb, text) to authenticated;

-- Publishes the draft as confirmed: its plans and add-ons are what the owner
-- compared (`_add_ons` null = the draft has none and reads as the seed).
create or replace function public.admin_plan_catalog_publish_full(
  _payload jsonb,
  _add_ons jsonb,
  _expected uuid,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _draft public.plan_catalog_versions%rowtype;
  _current uuid;
begin
  perform public.admin_require_owner();
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  select * into _draft from public.plan_catalog_versions where status = 'draft' for update;
  select id into _current from public.plan_catalog_versions where status = 'published' for update;
  if _draft.id is null or _draft.payload is distinct from _payload
     or _draft.add_ons is distinct from _add_ons
     or _current is distinct from _expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  update public.plan_catalog_versions set status = 'archived' where id = _current;
  update public.plan_catalog_versions
  set status = 'published', published_at = now(), published_by = _uid
  where id = _draft.id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans', _ip_hash,
          jsonb_build_object('action', 'publish', 'from', _current, 'to', _draft.id));
  return _draft.id;
end;
$$;
revoke all on function public.admin_plan_catalog_publish_full(jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.admin_plan_catalog_publish_full(jsonb, jsonb, uuid, text) to authenticated;

-- Bringing back an earlier version brings back its add-ons too.
create or replace function public.admin_plan_catalog_restore(
  _version uuid,
  _expected uuid,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _payload jsonb;
  _add_ons jsonb;
  _current uuid;
  _id uuid;
begin
  perform public.admin_require_owner();
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  select payload, add_ons into _payload, _add_ons from public.plan_catalog_versions
  where id = _version and status = 'archived';
  if _payload is null or not public.valid_plan_catalog(_payload) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select id into _current from public.plan_catalog_versions where status = 'published' for update;
  if _current is distinct from _expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  update public.plan_catalog_versions set status = 'archived' where id = _current;
  insert into public.plan_catalog_versions (created_by, status, published_at, published_by, payload, add_ons)
  values (_uid, 'published', now(), _uid, _payload, _add_ons)
  returning id into _id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans', _ip_hash,
          jsonb_build_object('action', 'restore', 'from', _current, 'to', _id, 'source', _version));
  return _id;
end;
$$;

-- The add-ons a subscription has switched on. Written only by
-- subscription_set_add_on() (server); the client still has no write grant.
alter table public.subscriptions
  add column add_ons text[] not null default '{}'
    constraint subscriptions_add_ons_known check (add_ons <@ public.add_on_keys());

-- Switches an add-on of the account's own subscription on or off. The
-- server calls it with the user from the session (the owner of the space)
-- after Stripe agreed, when the subscription runs through Stripe. Not after
-- the subscription expired; works while the trial runs.
create or replace function public.subscription_set_add_on(_user_id uuid, _key text, _on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
  _next text[];
begin
  if _key is null or not (_key = any (public.add_on_keys())) or _on is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  if public.subscription_expired(
       _sub.status, _sub.trial_ends_at, _sub.current_period_end, _sub.cancel_at_period_end) then
    raise exception 'expired' using errcode = '55000';
  end if;
  _next := case
    when _on then (select array_agg(distinct k order by k) from unnest(_sub.add_ons || _key) as k)
    else array_remove(_sub.add_ons, _key)
  end;
  if _next is distinct from _sub.add_ons then
    update public.subscriptions set add_ons = _next, updated_at = now() where user_id = _user_id;
  end if;
  return jsonb_build_object('changed', _next is distinct from _sub.add_ons, 'add_ons', to_jsonb(_next));
end;
$$;
revoke execute on function public.subscription_set_add_on(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.subscription_set_add_on(uuid, text, boolean) to service_role;

-- Whether an account has an add-on now: switched on and the subscription not
-- expired (step 24.3 hides the Gradus branding with no_branding). Server only.
create or replace function public.account_has_add_on(_user_id uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select _key = any (s.add_ons)
      and not public.subscription_expired(s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end)
    from public.subscriptions s
    where s.user_id = _user_id
  ), false);
$$;
revoke execute on function public.account_has_add_on(uuid, text) from public, anon, authenticated;
grant execute on function public.account_has_add_on(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. The finance summary per currency
-- -----------------------------------------------------------------------------

-- Income and expenses of the active space per currency (finance_totals()
-- adds every currency together). The screen shows one currency as is and
-- several converted for orientation, never storing the conversion.
create or replace function public.finance_totals_by_currency(
  _from date,
  _to date,
  _category text default null
)
returns table (currency text, income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    t.currency,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  from public.transactions t
  where t.user_id = public.current_workspace_id()
    and t.occurred_on between _from and _to
    and (_category is null or t.category = _category)
  group by t.currency
  order by t.currency
  limit 200;
$$;
revoke execute on function public.finance_totals_by_currency(date, date, text) from public, anon;
grant execute on function public.finance_totals_by_currency(date, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The new event in the catalog that mirrors src/lib/analytics/events.ts
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('add_on_changed', 'plan', false)
on conflict (event) do nothing;
