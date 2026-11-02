-- =============================================================================
-- Settings → Subscription, ready for a payment gateway (none yet)
--   * subscriptions gains the billing period, the cancellation at the end of
--     the period (with the reason), a change scheduled for the end of the
--     period and the gateway's reference. The stored status stays one of
--     trialing | active | past_due | cancelled; "expired" is computed, never
--     stored (subscription_expired()), and makes the workspace read-only as
--     the end of the trial always did. Nothing changes for existing rows.
--   * every account that is a workspace gets a row (most have one already).
--   * payments: what a gateway will record. Empty until it exists.
--   * billing_profiles: who receipts are made out to, the owner's own.
--   * All writes to subscriptions and payments go through the server:
--     subscription_request_change / _cancel / _resume (service role, called
--     with the user id from the session) and admin_subscription_set (the
--     owner of the app with aal2 and a live admin session, into admin_audit).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Subscriptions
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column billing text not null default 'monthly'
    check (billing in ('monthly', 'yearly')),
  add column cancel_at_period_end boolean not null default false,
  add column cancel_reason text
    check (cancel_reason is null or cancel_reason in
      ('too_expensive', 'missing_features', 'not_using', 'switching', 'temporary', 'other')),
  add column cancel_note text check (cancel_note is null or char_length(cancel_note) between 1 and 1000),
  add column cancel_requested_at timestamptz,
  add column scheduled_plan_key text references public.plans (key) on update cascade,
  add column scheduled_billing text
    check (scheduled_billing is null or scheduled_billing in ('monthly', 'yearly')),
  add column scheduled_at timestamptz,
  add column provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  add column provider_ref text check (provider_ref is null or char_length(provider_ref) between 1 and 200);

alter table public.subscriptions
  add constraint subscriptions_schedule_complete check (
    (scheduled_plan_key is null) = (scheduled_billing is null)
    and (scheduled_plan_key is null) = (scheduled_at is null)
  ),
  add constraint subscriptions_cancel_consistent check (
    cancel_at_period_end
    or (cancel_reason is null and cancel_note is null and cancel_requested_at is null)
  );

create unique index subscriptions_provider_ref_idx
  on public.subscriptions (provider, provider_ref) where provider_ref is not null;

comment on column public.subscriptions.scheduled_plan_key is
  'A downgrade the user asked for, from scheduled_at (the end of the period). The gateway applies it.';

-- Read own only (since the first migration); never written by a client.
revoke insert, update, delete on table public.subscriptions from anon, authenticated;

-- Every workspace has its row, as current_plan() would see it today: the
-- default plan, open-ended. Accounts made for the administration have none
-- (no workspace); nothing else should be missing one.
insert into public.subscriptions (user_id, plan_key, status)
select p.id, d.key, 'active'
from public.profiles p
join auth.users u on u.id = p.id
cross join (select key from public.plans where is_default limit 1) d
where coalesce(u.raw_user_meta_data ->> 'admin_invite', '') <> 'true'
  and not exists (select 1 from public.subscriptions s where s.user_id = p.id)
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- Expired: computed, never stored
-- -----------------------------------------------------------------------------

-- The trial ended, a cancelled subscription reached the end of its period, or
-- the gateway cancelled it. The period of a trial is the trial.
create or replace function public.subscription_expired(
  _status public.subscription_status,
  _trial_ends_at timestamptz,
  _period_end timestamptz,
  _cancel_at_period_end boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (_status = 'trialing' and _trial_ends_at <= now())
    or (_cancel_at_period_end
        and (case when _status = 'trialing' then _trial_ends_at else _period_end end) <= now())
    or (_status = 'cancelled' and (_period_end is null or _period_end <= now())),
    false
  );
$$;
revoke execute on function public.subscription_expired(public.subscription_status, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.subscription_expired(public.subscription_status, timestamptz, timestamptz, boolean)
  to service_role;

-- As before (trial over or over a limit), plus a cancelled subscription past its period.
create or replace function public.workspace_read_only(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = _owner
      and public.subscription_expired(s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end)
  ) or public.workspace_over_limit(_owner);
$$;
revoke execute on function public.workspace_read_only(uuid) from public, anon, authenticated;
grant execute on function public.workspace_read_only(uuid) to service_role;

-- Body as in 20261020180000_plan_catalog.sql; only "expired" is the shared rule now.
create or replace function public.current_plan(_user_id uuid)
returns table (
  plan_key text,
  status text,
  trial_ends_at timestamptz,
  read_only boolean,
  daily_generation_limit integer,
  monthly_generation_limit integer,
  ai_calls_limit integer,
  file_uploads_limit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
  _plan public.plans%rowtype;
  _catalog jsonb;
  _expired boolean;
  _read_only boolean;
begin
  if auth.uid() is not null
     and _user_id is distinct from auth.uid()
     and _user_id is distinct from public.current_workspace_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into _sub from public.subscriptions s where s.user_id = _user_id;
  if found then
    select * into _plan from public.plans p where p.key = _sub.plan_key;
  end if;
  if _plan.key is null then
    select * into _plan from public.plans p where p.is_default limit 1;
  end if;
  _catalog := public.published_plan(_plan.key) -> 'limits';

  _expired := public.subscription_expired(
    _sub.status, _sub.trial_ends_at, _sub.current_period_end, coalesce(_sub.cancel_at_period_end, false));
  _read_only := _expired or public.workspace_over_limit(_user_id);

  return query select
    _plan.key,
    case when _expired then 'expired' else coalesce(_sub.status::text, 'active') end,
    _sub.trial_ends_at,
    _read_only,
    case when _read_only then 0
      else coalesce((_catalog ->> 'daily_contacts')::integer, _plan.daily_generation_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'monthly_contacts')::integer, _plan.monthly_generation_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'ai_calls')::integer, _plan.ai_calls_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'ai_files')::integer, _plan.file_uploads_limit, 0) end;
end;
$$;
revoke execute on function public.current_plan(uuid) from public, anon;
grant execute on function public.current_plan(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The user's requests (server only, with the user id from the session)
-- -----------------------------------------------------------------------------

-- Another plan or billing period. Up (a higher plan, or a year instead of a
-- month) applies now; down waits for the end of the period; the current plan
-- drops a scheduled change. Without a period end, or once expired, it applies
-- now. The status and the period never change here: that is the gateway's.
-- Beta and other plans outside the catalog are changed by the administration.
create or replace function public.subscription_request_change(
  _user_id uuid,
  _plan_key text,
  _billing text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ranks constant text[] := array['solo', 'pro', 'team'];
  _sub public.subscriptions%rowtype;
  _from integer;
  _to integer := array_position(_ranks, _plan_key);
  _expired boolean;
  _period_end timestamptz;
  _direction text;
  _when text;
begin
  if _user_id is null or _to is null or _billing is null or _billing not in ('monthly', 'yearly') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  _from := array_position(_ranks, _sub.plan_key);
  if _from is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  _expired := public.subscription_expired(
    _sub.status, _sub.trial_ends_at, _sub.current_period_end, _sub.cancel_at_period_end);
  if _sub.cancel_at_period_end and not _expired then
    raise exception 'cancel_pending' using errcode = '55000';
  end if;

  _direction := case
    when _to > _from then 'upgrade'
    when _to < _from then 'downgrade'
    when _billing = _sub.billing then 'same'
    when _billing = 'yearly' then 'upgrade'
    else 'downgrade'
  end;
  _period_end := case when _sub.status = 'trialing' then _sub.trial_ends_at else _sub.current_period_end end;

  if _direction = 'same' then
    update public.subscriptions
    set scheduled_plan_key = null, scheduled_billing = null, scheduled_at = null, updated_at = now()
    where user_id = _user_id;
    _when := 'none';
  elsif _direction = 'upgrade' or _expired or _period_end is null or _period_end <= now() then
    update public.subscriptions
    set plan_key = _plan_key, billing = _billing,
        scheduled_plan_key = null, scheduled_billing = null, scheduled_at = null, updated_at = now()
    where user_id = _user_id;
    _when := 'immediate';
  else
    update public.subscriptions
    set scheduled_plan_key = _plan_key, scheduled_billing = _billing, scheduled_at = _period_end,
        updated_at = now()
    where user_id = _user_id;
    _when := 'scheduled';
  end if;

  return jsonb_build_object(
    'when', _when,
    'direction', _direction,
    'from_plan', _sub.plan_key,
    'from_billing', _sub.billing,
    'trialing', _sub.status = 'trialing',
    'at', case when _when = 'scheduled' then _period_end end
  );
end;
$$;
revoke execute on function public.subscription_request_change(uuid, text, text) from public, anon, authenticated;
grant execute on function public.subscription_request_change(uuid, text, text) to service_role;

-- Cancels at the end of the period (the trial's end while trialing). Twice is once.
create or replace function public.subscription_cancel(
  _user_id uuid,
  _reason text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
  _period_end timestamptz;
  _clean_note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if _user_id is null or _reason is null or _reason not in
     ('too_expensive', 'missing_features', 'not_using', 'switching', 'temporary', 'other')
     or char_length(coalesce(_clean_note, '')) > 1000 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  if array_position(array['solo', 'pro', 'team'], _sub.plan_key) is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if public.subscription_expired(
       _sub.status, _sub.trial_ends_at, _sub.current_period_end, _sub.cancel_at_period_end) then
    raise exception 'expired' using errcode = '55000';
  end if;
  _period_end := case when _sub.status = 'trialing' then _sub.trial_ends_at else _sub.current_period_end end;
  if _period_end is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if not _sub.cancel_at_period_end then
    update public.subscriptions
    set cancel_at_period_end = true, cancel_reason = _reason, cancel_note = _clean_note,
        cancel_requested_at = now(), updated_at = now()
    where user_id = _user_id;
  end if;

  return jsonb_build_object(
    'already', _sub.cancel_at_period_end,
    'ends_at', _period_end,
    'plan', _sub.plan_key,
    'billing', _sub.billing,
    'trialing', _sub.status = 'trialing'
  );
end;
$$;
revoke execute on function public.subscription_cancel(uuid, text, text) from public, anon, authenticated;
grant execute on function public.subscription_cancel(uuid, text, text) to service_role;

-- Takes the cancellation back while the period still runs.
create or replace function public.subscription_resume(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
begin
  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  if not _sub.cancel_at_period_end then
    return jsonb_build_object('resumed', false, 'plan', _sub.plan_key);
  end if;
  if public.subscription_expired(
       _sub.status, _sub.trial_ends_at, _sub.current_period_end, _sub.cancel_at_period_end) then
    raise exception 'expired' using errcode = '55000';
  end if;
  update public.subscriptions
  set cancel_at_period_end = false, cancel_reason = null, cancel_note = null,
      cancel_requested_at = null, updated_at = now()
  where user_id = _user_id;
  return jsonb_build_object('resumed', true, 'plan', _sub.plan_key);
end;
$$;
revoke execute on function public.subscription_resume(uuid) from public, anon, authenticated;
grant execute on function public.subscription_resume(uuid) to service_role;

-- What a downgrade is compared with: active workers and stored files.
create or replace function public.subscription_usage(_owner uuid)
returns table (workers integer, storage_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.workers w
      where w.owner_id = _owner and w.status <> 'inactive'),
    (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a
      where a.user_id = _owner);
$$;
revoke execute on function public.subscription_usage(uuid) from public, anon, authenticated;
grant execute on function public.subscription_usage(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The administration
-- -----------------------------------------------------------------------------

-- The owner of the app sets an account's subscription by hand (until the
-- gateway does). A scheduled change is dropped: what is set is what holds.
-- Going from trialing to active keeps trial_ends_at (the trial happened).
create or replace function public.admin_subscription_set(
  _user_id uuid,
  _plan_key text,
  _billing text,
  _status text,
  _period_end timestamptz,
  _cancel_at_period_end boolean,
  _ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old public.subscriptions%rowtype;
  _cancel boolean := coalesce(_cancel_at_period_end, false);
  _status_value public.subscription_status;
  _before jsonb;
begin
  perform public.admin_require_owner();
  if _user_id is null
     or not exists (select 1 from public.plans p where p.key = _plan_key)
     or _billing is null or _billing not in ('monthly', 'yearly')
     or _status is null or _status not in ('trialing', 'active', 'past_due', 'cancelled')
     or (_status = 'trialing' and _period_end is null)
     or (_cancel and _period_end is null) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = _user_id) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  _status_value := _status::public.subscription_status;

  select * into _old from public.subscriptions s where s.user_id = _user_id for update;
  if found then
    _before := jsonb_build_object(
      'plan', _old.plan_key, 'billing', _old.billing, 'status', _old.status,
      'period_end', _old.current_period_end, 'cancel', _old.cancel_at_period_end,
      'scheduled', _old.scheduled_plan_key);
    update public.subscriptions
    set plan_key = _plan_key,
        billing = _billing,
        status = _status_value,
        current_period_start = case
          when _period_end is distinct from _old.current_period_end then now()
          else current_period_start end,
        current_period_end = _period_end,
        trial_ends_at = case when _status_value = 'trialing' then _period_end else trial_ends_at end,
        cancel_at_period_end = _cancel,
        cancel_reason = case when _cancel then cancel_reason end,
        cancel_note = case when _cancel then cancel_note end,
        cancel_requested_at = case when _cancel then coalesce(cancel_requested_at, now()) end,
        scheduled_plan_key = null, scheduled_billing = null, scheduled_at = null,
        updated_at = now()
    where user_id = _user_id;
  else
    insert into public.subscriptions
      (user_id, plan_key, billing, status, current_period_end, trial_ends_at,
       cancel_at_period_end, cancel_requested_at)
    values
      (_user_id, _plan_key, _billing, _status_value, _period_end,
       case when _status_value = 'trialing' then _period_end end,
       _cancel, case when _cancel then now() end);
  end if;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'users.subscription', _ip_hash,
    jsonb_build_object(
      'user', _user_id,
      'from', _before,
      'to', jsonb_build_object(
        'plan', _plan_key, 'billing', _billing, 'status', _status,
        'period_end', _period_end, 'cancel', _cancel)
    )
  );
  return _before;
end;
$$;
revoke all on function public.admin_subscription_set(uuid, text, text, text, timestamptz, boolean, text)
  from public, anon;
grant execute on function public.admin_subscription_set(uuid, text, text, text, timestamptz, boolean, text)
  to authenticated;

-- Settings → Plans: accounts per plan key (internal accounts left out).
create or replace function public.admin_plan_user_counts()
returns table (plan_key text, accounts integer, trialing integer, cancelling integer, expired integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.plan_key,
    (count(*) filter (where not x.expired))::integer,
    (count(*) filter (where not x.expired and s.status = 'trialing'))::integer,
    (count(*) filter (where not x.expired and s.cancel_at_period_end))::integer,
    (count(*) filter (where x.expired))::integer
  from public.subscriptions s
  join public.profiles p on p.id = s.user_id
  cross join lateral (
    select public.subscription_expired(
      s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end) as expired
  ) x
  where not p.is_internal
  group by s.plan_key;
$$;
revoke execute on function public.admin_plan_user_counts() from public, anon, authenticated;
grant execute on function public.admin_plan_user_counts() to service_role;

-- -----------------------------------------------------------------------------
-- Payments: written by the gateway's webhook (server), read by the owner
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz not null default now(),
  status text not null check (status in ('paid', 'failed', 'refunded')),
  invoice_url text check (invoice_url is null or (char_length(invoice_url) <= 2000 and invoice_url ~ '^https://')),
  provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_ref text check (provider_ref is null or char_length(provider_ref) between 1 and 200),
  created_at timestamptz not null default now()
);
create index payments_user_paid_idx on public.payments (user_id, paid_at desc);
create unique index payments_provider_ref_idx
  on public.payments (provider, provider_ref) where provider_ref is not null;

comment on table public.payments is
  'Payments of a subscription as the gateway reports them. Server only; empty until a gateway exists.';

alter table public.payments enable row level security;
create policy payments_select_own on public.payments
  for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete on table public.payments from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Billing details for receipts: the owner's own row
-- -----------------------------------------------------------------------------
create table public.billing_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  company_reg_no text check (company_reg_no is null or char_length(company_reg_no) between 1 and 20),
  vat_no text check (vat_no is null or char_length(vat_no) between 1 and 20),
  street text check (street is null or char_length(street) <= 200),
  city text check (city is null or char_length(city) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country text not null default 'CZ' check (country ~ '^[A-Z]{2}$'),
  email text check (email is null or (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_profiles is
  'Who the receipts of the subscription are made out to. The workspace owner''s own row; writable in read-only too.';

create trigger billing_profiles_set_updated_at
  before update on public.billing_profiles
  for each row execute function public.set_updated_at();

alter table public.billing_profiles enable row level security;
create policy billing_profiles_select_own on public.billing_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);
-- Only in one's own workspace: an active worker does not pay for anything.
create policy billing_profiles_insert_own on public.billing_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.current_workspace_id()) = user_id);
create policy billing_profiles_update_own on public.billing_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id and (select public.current_workspace_id()) = user_id)
  with check ((select auth.uid()) = user_id and (select public.current_workspace_id()) = user_id);
revoke delete on table public.billing_profiles from anon, authenticated;
