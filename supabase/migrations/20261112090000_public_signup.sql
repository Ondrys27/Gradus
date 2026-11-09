-- =============================================================================
-- Public sign-up (step 23.3)
--
--   * profiles.terms_accepted_at / terms_version / marketing_consent_at: the
--     consent given in the registration form. Written by the server only (the
--     sign-up action with the admin client); a client can not set or change
--     them (profiles_consent_guard).
--   * subscriptions.chosen_plan_key / chosen_billing / chosen_at: the plan a
--     visitor picked on the website before registering (?tarif=pro&obdobi=rok).
--     Only a hint for Settings → Subscription ("Vybraný tarif, zaplatíš po
--     zkušebce") and for the pay button; the plan in force does not change.
--     The client has no write grant on subscriptions; the choice is dropped by
--     the database with any change of the plan, the billing, a scheduled
--     change or the gateway (subscriptions_chosen_reset).
--   * signup_code_attempts: wrong invite and promo codes per address and
--     e-mail, for the same 5 / 15 minutes pause as the administration's
--     sign-in. Only keyed hashes, no client access, kept a day.
--   * metric_signup_conversion(): of the accounts that registered in the
--     period (signup_completed), the share that has paid since, per source.
--   * analytics catalog: signup_completed.
-- Additive only: new nullable columns, a new table, new functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Consent in the profile
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column terms_version text check (terms_version is null or terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  add column marketing_consent_at timestamptz;

comment on column public.profiles.terms_accepted_at is
  'When the account accepted the terms and the privacy policy in the registration form. Server only.';
comment on column public.profiles.terms_version is
  'The version (date) of the terms the account accepted. Server only.';
comment on column public.profiles.marketing_consent_at is
  'When the account agreed to news by e-mail (optional); null = no. Server only.';

create or replace function public.profiles_consent_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and (new.terms_accepted_at is distinct from old.terms_accepted_at
       or new.terms_version is distinct from old.terms_version
       or new.marketing_consent_at is distinct from old.marketing_consent_at) then
    raise exception 'consent_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_consent_guard() from public, anon, authenticated;

create trigger profiles_consent_guard
  before update of terms_accepted_at, terms_version, marketing_consent_at on public.profiles
  for each row execute function public.profiles_consent_guard();

-- -----------------------------------------------------------------------------
-- The plan picked on the website
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column chosen_plan_key text check (chosen_plan_key is null or chosen_plan_key in ('solo', 'pro', 'team')),
  add column chosen_billing text check (chosen_billing is null or chosen_billing in ('monthly', 'yearly')),
  add column chosen_at timestamptz;

alter table public.subscriptions
  add constraint subscriptions_chosen_complete check (
    (chosen_plan_key is null) = (chosen_billing is null)
    and (chosen_plan_key is null) = (chosen_at is null)
  );

comment on column public.subscriptions.chosen_plan_key is
  'The plan picked on the website before registering; shown as the selected plan until the account pays or changes the plan. Server only.';

-- Any real change of the plan makes the website's choice history.
create or replace function public.subscriptions_chosen_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chosen_plan_key is not null
     and new.chosen_plan_key is not distinct from old.chosen_plan_key
     and new.chosen_billing is not distinct from old.chosen_billing
     and (new.plan_key is distinct from old.plan_key
       or new.billing is distinct from old.billing
       or new.scheduled_plan_key is distinct from old.scheduled_plan_key
       or new.scheduled_billing is distinct from old.scheduled_billing
       or new.provider_ref is distinct from old.provider_ref) then
    new.chosen_plan_key := null;
    new.chosen_billing := null;
    new.chosen_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.subscriptions_chosen_reset() from public, anon, authenticated;

create trigger subscriptions_chosen_reset
  before update on public.subscriptions
  for each row execute function public.subscriptions_chosen_reset();

-- -----------------------------------------------------------------------------
-- Wrong invite and promo codes
-- -----------------------------------------------------------------------------
create table public.signup_code_attempts (
  id bigint generated always as identity primary key,
  -- fingerprint("ip", …) of the visitor's address.
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  -- fingerprint("email", …) of the e-mail in the form, or of the signed-in account.
  account_hash text check (account_hash ~ '^[0-9a-f]{16,64}$'),
  kind text not null check (kind in ('invite', 'promo')),
  -- check = the promo field asking while typing; submit = a sent form.
  stage text not null check (stage in ('check', 'submit')),
  created_at timestamptz not null default now()
);
create index signup_code_attempts_ip_idx on public.signup_code_attempts (ip_hash, created_at);
create index signup_code_attempts_account_idx on public.signup_code_attempts (account_hash, created_at);
alter table public.signup_code_attempts enable row level security;
revoke all on table public.signup_code_attempts from anon, authenticated;

comment on table public.signup_code_attempts is
  'Wrong invite and promo codes (keyed hashes of the address and e-mail only) for the attempt limit of the registration. Server only, kept a day.';

-- -----------------------------------------------------------------------------
-- Registration → payment (Activation)
-- -----------------------------------------------------------------------------
create or replace function public.metric_signup_conversion(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (source text, signups bigint, paying bigint, pct numeric)
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
  with signups as (
    select distinct on (e.user_id) e.user_id, coalesce(e.props ->> 'from', 'web') as src
    from public.analytics_events e
    where e.event = 'signup_completed'
      and e.user_id = any(_users)
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
    order by e.user_id, e.created_at
  ),
  cohort as (
    select s.user_id, s.src,
      exists (
        select 1 from public.payments p
        where p.user_id = s.user_id and p.status in ('paid', 'refunded') and p.amount > 0
      ) as paid
    from signups s
  ),
  grouped as (
    select c.src, count(*) as n, count(*) filter (where c.paid) as p from cohort c group by c.src
    union all
    select 'all', count(*), count(*) filter (where c.paid) from cohort c
  )
  select g.src, g.n, g.p,
    case when g.n > 0 then round(100.0 * g.p / g.n, 1) else 0 end
  from grouped g
  order by (g.src = 'all') desc, g.n desc, g.src;
end;
$$;
revoke all on function public.metric_signup_conversion(date, date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_signup_conversion(date, date, text, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('signup_completed', 'account', false)
on conflict (event) do nothing;
