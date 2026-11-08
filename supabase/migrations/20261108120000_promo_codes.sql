-- =============================================================================
-- Promo codes and partner commissions (step 22.2)
--   * promo_codes: a code a partner (an influencer, a partner, a campaign)
--     hands out. Capital letters and digits without diacritics, 4–16
--     characters. It gives one benefit: extra trial days, a percentage off
--     the first month, or free months; the partner gets a percentage of the
--     user's first payment without VAT.
--   * promo_redemptions: at most one code per account (unique user_id), with
--     what the code gave at that moment, so a later edit of the code changes
--     nothing for accounts that already have it.
--   * partner_payouts: made by the database when the first payment of an
--     account with a code arrives (payments_promo_payout), pending → approved
--     → paid in the administration.
--   * payments.vat_amount: the VAT inside a payment's amount, filled by the
--     gateway; the commission is a share of amount − vat_amount.
-- No client reads or writes any of it: the server checks and redeems codes
-- (service role, the user id from the session), the administration writes
-- through admin_* functions that check the live admin session themselves.
-- Only additive.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Payments: the VAT inside the amount
-- -----------------------------------------------------------------------------
alter table public.payments
  add column vat_amount numeric(12, 2) not null default 0;
alter table public.payments
  add constraint payments_vat_amount_valid check (vat_amount >= 0 and vat_amount <= amount);
comment on column public.payments.vat_amount is
  'The VAT included in amount, as the gateway reports it; amount − vat_amount is the payment without VAT.';

-- -----------------------------------------------------------------------------
-- Codes
-- -----------------------------------------------------------------------------
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  partner_name text not null check (char_length(btrim(partner_name)) between 1 and 120),
  partner_email text check (
    partner_email is null
    or (char_length(partner_email) <= 254 and partner_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  partner_note text check (partner_note is null or char_length(partner_note) <= 1000),
  kind text not null check (kind in ('influencer', 'partner', 'campaign')),
  benefit text not null check (benefit in ('trial_days_extra', 'percent_off_first', 'months_free')),
  benefit_value integer not null,
  commission_percent_first numeric(5, 2) not null default 0
    check (commission_percent_first between 0 and 100),
  max_uses integer check (max_uses is null or max_uses between 1 and 1000000),
  valid_from timestamptz,
  valid_to timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_benefit_value check (
    (benefit = 'trial_days_extra' and benefit_value between 1 and 90)
    or (benefit = 'percent_off_first' and benefit_value between 1 and 100)
    or (benefit = 'months_free' and benefit_value between 1 and 12)
  ),
  constraint promo_codes_validity check (valid_from is null or valid_to is null or valid_to > valid_from)
);
create index promo_codes_created_idx on public.promo_codes (created_at desc);

comment on table public.promo_codes is
  'Partner promo codes. Server and administration only (admin_promo_code_save / _set_active).';

alter table public.promo_codes enable row level security;
revoke all on table public.promo_codes from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Redemptions: one code per account
-- -----------------------------------------------------------------------------
create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.promo_codes (id) on delete restrict,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  source text not null check (source in ('signup', 'checkout', 'settings')),
  -- What the code gave when it was redeemed.
  benefit text not null check (benefit in ('trial_days_extra', 'percent_off_first', 'months_free')),
  benefit_value integer not null check (benefit_value between 1 and 100),
  commission_percent_first numeric(5, 2) not null check (commission_percent_first between 0 and 100)
);
create index promo_redemptions_code_idx on public.promo_redemptions (code_id, redeemed_at desc);

comment on table public.promo_redemptions is
  'Which code an account used (at most one), with the benefit and commission frozen at that moment. Server only.';

alter table public.promo_redemptions enable row level security;
revoke all on table public.promo_redemptions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Payouts: the partner's share of the first payment
-- -----------------------------------------------------------------------------
create table public.partner_payouts (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.promo_codes (id) on delete restrict,
  -- Kept when the account is deleted: the partner earned it.
  user_id uuid references auth.users (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  -- The first payment without VAT.
  base_amount numeric(12, 2) not null check (base_amount > 0),
  commission_percent numeric(5, 2) not null check (commission_percent between 0 and 100),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid')),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint partner_payouts_status_consistent check (
    (status = 'pending' and approved_at is null and paid_at is null)
    or (status = 'approved' and approved_at is not null and paid_at is null)
    or (status = 'paid' and approved_at is not null and paid_at is not null)
  )
);
-- One payout per account and per payment: only the first payment counts.
create unique index partner_payouts_user_idx on public.partner_payouts (user_id) where user_id is not null;
create unique index partner_payouts_payment_idx on public.partner_payouts (payment_id) where payment_id is not null;
create index partner_payouts_code_idx on public.partner_payouts (code_id, created_at desc);

comment on table public.partner_payouts is
  'Commissions for partners, made by payments_promo_payout() on the first payment of an account with a code. Administration only.';

alter table public.partner_payouts enable row level security;
revoke all on table public.partner_payouts from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Whether a code may be used now
-- -----------------------------------------------------------------------------

-- ok | inactive | not_started | expired | exhausted
create or replace function public.promo_code_state(_code_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.id is null then 'not_found'
    when not c.active then 'inactive'
    when c.valid_from is not null and c.valid_from > now() then 'not_started'
    when c.valid_to is not null and c.valid_to <= now() then 'expired'
    when c.max_uses is not null
         and (select count(*) from public.promo_redemptions r where r.code_id = c.id) >= c.max_uses
      then 'exhausted'
    else 'ok'
  end
  from (select 1) one
  left join public.promo_codes c on c.id = _code_id;
$$;
revoke all on function public.promo_code_state(uuid) from public, anon, authenticated;
grant execute on function public.promo_code_state(uuid) to service_role;

-- What a code typed into a form would give, for the confirmation under the
-- field. Never names the partner.
create or replace function public.promo_check(_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _norm text := upper(btrim(coalesce(_code, '')));
  _row public.promo_codes%rowtype;
begin
  if _norm !~ '^[A-Z0-9]{4,16}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into _row from public.promo_codes c where c.code = _norm;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', public.promo_code_state(_row.id),
    'code', _row.code,
    'benefit', _row.benefit,
    'benefit_value', _row.benefit_value
  );
end;
$$;
revoke all on function public.promo_check(text) from public, anon, authenticated;
grant execute on function public.promo_check(text) to service_role;

-- -----------------------------------------------------------------------------
-- Redeeming (server only, the user id from the session)
-- -----------------------------------------------------------------------------

-- One code per account, before its first payment. Extra trial days extend a
-- trial that runs; from the settings such a code is refused without one
-- (no_trial), at sign-up it is kept for the partner either way. The code row
-- is locked, so max_uses holds under parallel requests. Answers a status,
-- never raises for a code that cannot be used.
create or replace function public.promo_redeem(_user_id uuid, _code text, _source text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _norm text := upper(btrim(coalesce(_code, '')));
  _row public.promo_codes%rowtype;
  _state text;
  _trial_running boolean;
  _trial_ends timestamptz;
  _inserted uuid;
begin
  if _user_id is null or _source is null or _source not in ('signup', 'checkout', 'settings') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if _norm !~ '^[A-Z0-9]{4,16}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into _row from public.promo_codes c where c.code = _norm for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  _state := public.promo_code_state(_row.id);
  if _state <> 'ok' then
    return jsonb_build_object('status', _state);
  end if;

  perform pg_advisory_xact_lock(hashtext('public.promo_redeem:' || _user_id::text));
  if exists (select 1 from public.promo_redemptions r where r.user_id = _user_id) then
    return jsonb_build_object('status', 'already_redeemed');
  end if;
  if exists (
    select 1 from public.payments p
    where p.user_id = _user_id and p.status = 'paid' and p.amount - p.vat_amount > 0
  ) then
    return jsonb_build_object('status', 'already_paid');
  end if;

  select s.status = 'trialing' and s.trial_ends_at > now(), s.trial_ends_at
    into _trial_running, _trial_ends
  from public.subscriptions s
  where s.user_id = _user_id
  for update;
  _trial_running := coalesce(_trial_running, false);
  if _row.benefit = 'trial_days_extra' and not _trial_running and _source <> 'signup' then
    return jsonb_build_object('status', 'no_trial');
  end if;

  insert into public.promo_redemptions
    (code_id, user_id, source, benefit, benefit_value, commission_percent_first)
  values
    (_row.id, _user_id, _source, _row.benefit, _row.benefit_value, _row.commission_percent_first)
  on conflict (user_id) do nothing
  returning id into _inserted;
  if _inserted is null then
    return jsonb_build_object('status', 'already_redeemed');
  end if;

  if _row.benefit = 'trial_days_extra' and _trial_running then
    -- Old values on the right: the period of a trial is the trial.
    update public.subscriptions
    set trial_ends_at = trial_ends_at + make_interval(days => _row.benefit_value),
        current_period_end = case
          when current_period_end is not distinct from trial_ends_at
            then trial_ends_at + make_interval(days => _row.benefit_value)
          else current_period_end end,
        updated_at = now()
    where user_id = _user_id
    returning trial_ends_at into _trial_ends;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'code_id', _row.id,
    'code', _row.code,
    'benefit', _row.benefit,
    'benefit_value', _row.benefit_value,
    'trial_extended', _row.benefit = 'trial_days_extra' and _trial_running,
    'trial_ends_at', _trial_ends
  );
end;
$$;
revoke all on function public.promo_redeem(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promo_redeem(uuid, text, text) to service_role;

-- The account's code, for Settings → Subscription and the onboarding (server
-- only, the user id from the session): what it gives and whether the account
-- has paid already (then no code can be added any more).
create or replace function public.promo_account_status(_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'redemption', (
      select jsonb_build_object(
        'code', c.code,
        'benefit', r.benefit,
        'benefit_value', r.benefit_value,
        'redeemed_at', r.redeemed_at
      )
      from public.promo_redemptions r
      join public.promo_codes c on c.id = r.code_id
      where r.user_id = _user_id
    ),
    'paid', exists (
      select 1 from public.payments p
      where p.user_id = _user_id and p.status = 'paid' and p.amount - p.vat_amount > 0
    )
  );
$$;
revoke all on function public.promo_account_status(uuid) from public, anon, authenticated;
grant execute on function public.promo_account_status(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The partner's commission on the first payment
-- -----------------------------------------------------------------------------

-- The first paid payment (without VAT above zero) of an account with a code
-- makes one pending payout: commission_percent_first of the payment without
-- VAT, rounded to the cent. Any later payment makes none.
create or replace function public.payments_promo_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _net numeric(12, 2) := new.amount - new.vat_amount;
  _redemption public.promo_redemptions%rowtype;
  _commission numeric(12, 2);
begin
  if new.status <> 'paid' or _net <= 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then
    return new;
  end if;
  if exists (select 1 from public.partner_payouts o where o.user_id = new.user_id) then
    return new;
  end if;
  if exists (
    select 1 from public.payments p
    where p.user_id = new.user_id
      and p.id <> new.id
      and p.status in ('paid', 'refunded')
      and p.amount - p.vat_amount > 0
      and p.paid_at <= new.paid_at
  ) then
    return new;
  end if;
  select * into _redemption from public.promo_redemptions r where r.user_id = new.user_id;
  if not found or _redemption.redeemed_at > new.paid_at then
    return new;
  end if;
  _commission := round(_net * _redemption.commission_percent_first / 100, 2);
  if _commission <= 0 then
    return new;
  end if;
  insert into public.partner_payouts
    (code_id, user_id, payment_id, base_amount, commission_percent, amount, currency)
  values
    (_redemption.code_id, new.user_id, new.id, _net, _redemption.commission_percent_first,
     _commission, new.currency)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.payments_promo_payout() from public, anon, authenticated;

create trigger payments_promo_payout
  after insert or update of status on public.payments
  for each row execute function public.payments_promo_payout();

-- -----------------------------------------------------------------------------
-- The administration: codes (owner and admin), payouts (owner)
-- -----------------------------------------------------------------------------

-- A new code (_id null) or an edit of one. The owner or an admin with a live
-- admin session (aal2), checked here from the signed token; into admin_audit
-- without the partner's name, e-mail or note. A code that accounts already
-- used keeps its text: the links that went out must keep working.
create or replace function public.admin_promo_code_save(
  _id uuid,
  _code text,
  _partner_name text,
  _partner_email text,
  _partner_note text,
  _kind text,
  _benefit text,
  _benefit_value integer,
  _commission_percent numeric,
  _max_uses integer,
  _valid_from timestamptz,
  _valid_to timestamptz,
  _active boolean,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _norm text := upper(btrim(coalesce(_code, '')));
  _old public.promo_codes%rowtype;
  _saved uuid;
  _before jsonb;
begin
  if coalesce(public.admin_session_touch(true) ->> 'status', '') <> 'ok' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if _norm !~ '^[A-Z0-9]{4,16}$' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  if _id is null then
    if exists (select 1 from public.promo_codes c where c.code = _norm) then
      raise exception 'code_taken' using errcode = '23505';
    end if;
    insert into public.promo_codes
      (code, partner_name, partner_email, partner_note, kind, benefit, benefit_value,
       commission_percent_first, max_uses, valid_from, valid_to, active, created_by)
    values
      (_norm, btrim(_partner_name), nullif(lower(btrim(coalesce(_partner_email, ''))), ''),
       nullif(btrim(coalesce(_partner_note, '')), ''), _kind, _benefit, _benefit_value,
       coalesce(_commission_percent, 0), _max_uses, _valid_from, _valid_to, coalesce(_active, true), _uid)
    returning id into _saved;
  else
    select * into _old from public.promo_codes c where c.id = _id for update;
    if not found then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
    if _norm <> _old.code then
      if exists (select 1 from public.promo_redemptions r where r.code_id = _id) then
        raise exception 'code_in_use' using errcode = '55000';
      end if;
      if exists (select 1 from public.promo_codes c where c.code = _norm) then
        raise exception 'code_taken' using errcode = '23505';
      end if;
    end if;
    _before := jsonb_build_object(
      'code', _old.code, 'kind', _old.kind, 'benefit', _old.benefit,
      'benefit_value', _old.benefit_value, 'commission', _old.commission_percent_first,
      'max_uses', _old.max_uses, 'valid_from', _old.valid_from, 'valid_to', _old.valid_to,
      'active', _old.active);
    update public.promo_codes
    set code = _norm,
        partner_name = btrim(_partner_name),
        partner_email = nullif(lower(btrim(coalesce(_partner_email, ''))), ''),
        partner_note = nullif(btrim(coalesce(_partner_note, '')), ''),
        kind = _kind,
        benefit = _benefit,
        benefit_value = _benefit_value,
        commission_percent_first = coalesce(_commission_percent, 0),
        max_uses = _max_uses,
        valid_from = _valid_from,
        valid_to = _valid_to,
        active = coalesce(_active, true),
        updated_at = now()
    where id = _id
    returning id into _saved;
  end if;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.promo_codes', _ip_hash,
    jsonb_build_object(
      'code_id', _saved,
      'from', _before,
      'to', jsonb_build_object(
        'code', _norm, 'kind', _kind, 'benefit', _benefit, 'benefit_value', _benefit_value,
        'commission', coalesce(_commission_percent, 0), 'max_uses', _max_uses,
        'valid_from', _valid_from, 'valid_to', _valid_to, 'active', coalesce(_active, true))
    )
  );
  return _saved;
end;
$$;
revoke all on function public.admin_promo_code_save(
  uuid, text, text, text, text, text, text, integer, numeric, integer, timestamptz, timestamptz, boolean, text
) from public, anon;
grant execute on function public.admin_promo_code_save(
  uuid, text, text, text, text, text, text, integer, numeric, integer, timestamptz, timestamptz, boolean, text
) to authenticated;

-- Deactivating (or activating again) from the list. Same rights as saving.
create or replace function public.admin_promo_code_set_active(_id uuid, _active boolean, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _was boolean;
begin
  if coalesce(public.admin_session_touch(true) ->> 'status', '') <> 'ok' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if _active is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select c.active into _was from public.promo_codes c where c.id = _id for update;
  if not found then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  update public.promo_codes set active = _active, updated_at = now() where id = _id;
  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.promo_codes', _ip_hash,
    jsonb_build_object('code_id', _id, 'from', jsonb_build_object('active', _was),
                       'to', jsonb_build_object('active', _active))
  );
end;
$$;
revoke all on function public.admin_promo_code_set_active(uuid, boolean, text) from public, anon;
grant execute on function public.admin_promo_code_set_active(uuid, boolean, text) to authenticated;

-- A payout moves pending → approved → paid; an approval can be taken back
-- (approved → pending) until it is paid. A paid payout never changes. The
-- owner only (aal2, live admin session); into admin_audit from → to.
create or replace function public.admin_partner_payout_set_status(
  _id uuid,
  _status text,
  _ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old public.partner_payouts%rowtype;
begin
  perform public.admin_require_owner();
  if _status is null or _status not in ('pending', 'approved', 'paid') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into _old from public.partner_payouts o where o.id = _id for update;
  if not found then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not (
    (_old.status = 'pending' and _status = 'approved')
    or (_old.status = 'approved' and _status in ('paid', 'pending'))
  ) then
    raise exception 'payout_transition' using errcode = '55000';
  end if;
  update public.partner_payouts
  set status = _status,
      approved_at = case when _status = 'pending' then null else coalesce(approved_at, now()) end,
      approved_by = case when _status = 'pending' then null else coalesce(approved_by, _uid) end,
      paid_at = case when _status = 'paid' then now() end,
      paid_by = case when _status = 'paid' then _uid end
  where id = _id;
  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.promo_payouts', _ip_hash,
    jsonb_build_object(
      'payout', _id, 'code_id', _old.code_id,
      'from', jsonb_build_object('status', _old.status),
      'to', jsonb_build_object('status', _status))
  );
  return jsonb_build_object('from', _old.status, 'to', _status);
end;
$$;
revoke all on function public.admin_partner_payout_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_partner_payout_set_status(uuid, text, text) to authenticated;

-- The list's figures per code: accounts that used it, those that paid, the
-- commissions to pay and paid per currency (never summed across currencies),
-- and the same since _since for "the best codes of the last 30 days". Every
-- account counts, internal ones too: this is the ledger the partners are
-- paid from, not a metric. Service role only (the server after the guard).
create or replace function public.admin_promo_code_stats(_since timestamptz)
returns table (
  code_id uuid,
  redemptions integer,
  redemptions_since integer,
  paying integer,
  paying_since integer,
  payouts_due jsonb,
  payouts_paid jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with first_paid as (
    select p.user_id, min(p.paid_at) as paid_at
    from public.payments p
    where p.status = 'paid' and p.amount - p.vat_amount > 0
    group by p.user_id
  ),
  uses as (
    select
      r.code_id,
      count(*)::integer as redemptions,
      (count(*) filter (where r.redeemed_at >= _since))::integer as redemptions_since,
      (count(f.user_id))::integer as paying,
      (count(f.user_id) filter (where f.paid_at >= _since))::integer as paying_since
    from public.promo_redemptions r
    left join first_paid f on f.user_id = r.user_id
    group by r.code_id
  ),
  money as (
    select
      o.code_id,
      jsonb_object_agg(o.currency, o.due) filter (where o.due > 0) as due,
      jsonb_object_agg(o.currency, o.paid) filter (where o.paid > 0) as paid
    from (
      select x.code_id, x.currency,
        sum(x.amount) filter (where x.status in ('pending', 'approved')) as due,
        sum(x.amount) filter (where x.status = 'paid') as paid
      from public.partner_payouts x
      group by x.code_id, x.currency
    ) o
    group by o.code_id
  )
  select
    c.id,
    coalesce(u.redemptions, 0),
    coalesce(u.redemptions_since, 0),
    coalesce(u.paying, 0),
    coalesce(u.paying_since, 0),
    coalesce(m.due, '{}'::jsonb),
    coalesce(m.paid, '{}'::jsonb)
  from public.promo_codes c
  left join uses u on u.code_id = c.id
  left join money m on m.code_id = c.id;
$$;
revoke all on function public.admin_promo_code_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_promo_code_stats(timestamptz) to service_role;

-- The accounts of one code, newest first, paged: when they used it, from
-- where, and when they first paid (null = not yet). Service role only.
create or replace function public.admin_promo_code_users(_code_id uuid, _limit integer, _offset integer)
returns table (
  user_id uuid,
  redeemed_at timestamptz,
  source text,
  first_paid_at timestamptz,
  is_internal boolean,
  total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.user_id,
    r.redeemed_at,
    r.source,
    (select min(p.paid_at) from public.payments p
      where p.user_id = r.user_id and p.status = 'paid' and p.amount - p.vat_amount > 0),
    coalesce(pr.is_internal, false),
    count(*) over ()
  from public.promo_redemptions r
  left join public.profiles pr on pr.id = r.user_id
  where r.code_id = _code_id
  order by r.redeemed_at desc, r.user_id
  limit least(greatest(coalesce(_limit, 50), 1), 200)
  offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.admin_promo_code_users(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_promo_code_users(uuid, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Activation: from a code to a payment
-- -----------------------------------------------------------------------------

-- Accounts that used a code in the period, and how many of them have paid
-- since (any time up to now).
create or replace function public.metric_promo_conversion(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (redeemed bigint, paying bigint, pct numeric)
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
    select r.user_id,
      exists (
        select 1 from public.payments p
        where p.user_id = r.user_id and p.status = 'paid' and p.amount - p.vat_amount > 0
      ) as paid
    from public.promo_redemptions r
    where r.user_id = any(_users)
      and r.redeemed_at >= public.metric_day_start(_from, _tz)
      and r.redeemed_at < public.metric_day_start(_to + 1, _tz)
  )
  select
    count(*),
    count(*) filter (where c.paid),
    case when count(*) > 0 then round(100.0 * count(*) filter (where c.paid) / count(*), 1) else 0 end
  from cohort c;
end;
$$;
revoke all on function public.metric_promo_conversion(date, date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_promo_conversion(date, date, text, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('promo_redeemed', 'plan', false)
on conflict (event) do nothing;
