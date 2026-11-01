-- =============================================================================
-- Review of phase 12: a deleted account keeps counting in Jarvis's budget.
--
--   * Deleting an account takes its ai_usage rows with it (on delete cascade),
--     so this month's spend of all accounts used to drop and Jarvis could
--     spend more than the monthly cap allows: the API credits were used all
--     the same.
--   * ai_usage_retired keeps only when and how much each model call of a
--     deleted account cost (no person, no model, no tokens).
--     account_prepare_deletion() copies the rows right before the account
--     goes; jarvis_month_spend() and jarvis_range_spend() add them to the
--     spend of all accounts. Per-user caps are unaffected (the user is gone).
--   * Server only: row security without any policy, no grants to clients.
-- Only additive: a new table and new versions of three functions.
-- =============================================================================

create table public.ai_usage_retired (
  -- The id the row had in ai_usage: preparing a deletion twice (the first
  -- attempt failed later) copies nothing twice.
  usage_id uuid primary key,
  created_at timestamptz not null,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0)
);

comment on table public.ai_usage_retired is
  'Cost and time of the model calls of deleted accounts, so the monthly AI budget still counts them. Server only.';

create index ai_usage_retired_created_idx on public.ai_usage_retired (created_at);

alter table public.ai_usage_retired enable row level security;
revoke all on table public.ai_usage_retired from public, anon, authenticated;

create or replace function public.jarvis_month_spend(_since timestamptz)
returns table (cost_usd numeric, calls bigint)
language sql
stable
set search_path = ''
as $$
  with spend as (
    select u.cost_usd from public.ai_usage u where u.created_at >= _since
    union all
    select r.cost_usd from public.ai_usage_retired r where r.created_at >= _since
  )
  select coalesce(sum(s.cost_usd), 0), count(*) from spend s;
$$;
revoke all on function public.jarvis_month_spend(timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_month_spend(timestamptz) to service_role;

create or replace function public.jarvis_range_spend(_since timestamptz, _until timestamptz)
returns table (cost_usd numeric, calls bigint, top_user_cost_usd numeric)
language sql
stable
set search_path = ''
as $$
  with per_user as (
    select u.user_id, coalesce(sum(u.cost_usd), 0) as cost, count(*) as calls
    from public.ai_usage u
    where u.created_at >= _since and u.created_at < _until
    group by u.user_id
  ),
  retired as (
    select coalesce(sum(r.cost_usd), 0) as cost, count(*) as calls
    from public.ai_usage_retired r
    where r.created_at >= _since and r.created_at < _until
  )
  select
    coalesce((select sum(p.cost) from per_user p), 0) + (select cost from retired),
    (coalesce((select sum(p.calls) from per_user p), 0) + (select calls from retired))::bigint,
    (select max(p.cost) from per_user p);
$$;
revoke all on function public.jarvis_range_spend(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_range_spend(timestamptz, timestamptz) to service_role;

-- As in 20261101180000, plus: the account's AI spend stays in the budget.
create or replace function public.account_prepare_deletion(_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _blockers text[] := public.account_deletion_blockers(_user);
begin
  if _user is null then
    raise exception 'account_missing' using errcode = 'P0002';
  end if;
  if cardinality(_blockers) > 0 then
    raise exception '%', _blockers[1] using errcode = 'P0001';
  end if;
  update public.analytics_events set user_id = null where user_id = _user;
  update public.workers set status = 'inactive' where user_id = _user and status <> 'inactive';
  insert into public.ai_usage_retired (usage_id, created_at, cost_usd)
  select u.id, u.created_at, u.cost_usd
  from public.ai_usage u
  where u.user_id = _user
  on conflict (usage_id) do nothing;
end;
$$;

revoke all on function public.account_prepare_deletion(uuid) from public, anon, authenticated;
grant execute on function public.account_prepare_deletion(uuid) to service_role;
