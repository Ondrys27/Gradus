-- =============================================================================
-- Jarvis's monthly budget (step 12.1)
--
--   * Jarvis runs on API credits with a monthly allowance shared by every
--     account. Before each model call the server reads this calendar month's
--     spend (UTC) from ai_usage through jarvis_month_spend(); internal
--     accounts count too, the credits are the same.
--   * jarvis_budget_alerts: one row per day and kind of e-mail to the owner
--     ('near_limit' from 80 %, 'paused' over 100 % or when the API has run out
--     of credit), so the owner gets each at most once a day. Server only.
-- =============================================================================

create index if not exists ai_usage_created_idx on public.ai_usage (created_at);

-- Spend and number of model calls since an instant, all accounts. Only the
-- server (service role) may call it: it sums across users.
create or replace function public.jarvis_month_spend(_since timestamptz)
returns table (cost_usd numeric, calls bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0), count(*)
  from public.ai_usage u
  where u.created_at >= _since;
$$;
revoke all on function public.jarvis_month_spend(timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_month_spend(timestamptz) to service_role;

create table public.jarvis_budget_alerts (
  day date not null,
  kind text not null check (kind in ('near_limit', 'paused')),
  created_at timestamptz not null default now(),
  primary key (day, kind)
);
comment on table public.jarvis_budget_alerts is
  'E-mails to the owner about Jarvis''s budget, at most one per day and kind. Written and read only by the server (admin client).';
alter table public.jarvis_budget_alerts enable row level security;
-- No policies: the client can neither read nor write it.
revoke all on public.jarvis_budget_alerts from anon, authenticated;

insert into public.analytics_event_catalog (event, section, active) values
  ('jarvis_paused', 'jarvis', false);
