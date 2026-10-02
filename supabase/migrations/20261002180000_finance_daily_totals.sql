-- Daily income/expense totals for the zoomable income chart (dashboard tile and
-- Finance page): one row per calendar day in the range, scoped to the workspace
-- the same way finance_monthly_totals is.

create or replace function public.finance_daily_totals(_from date, _to date)
returns table (day date, income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    d.day::date,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  from generate_series(_from::timestamp, _to::timestamp, interval '1 day') as d(day)
  left join public.transactions t
    on t.user_id = public.current_workspace_id()
   and t.occurred_on = d.day::date
  group by d.day
  order by d.day;
$$;

grant execute on function public.finance_daily_totals(date, date) to authenticated;
revoke execute on function public.finance_daily_totals(date, date) from public, anon;
