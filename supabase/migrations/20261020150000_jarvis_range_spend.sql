-- =============================================================================
-- Step 15.4: AI spend for the period chosen in the administration.
--
--   * jarvis_range_spend(_since, _until): spend and model calls of all
--     accounts (internal ones too) in [_since, _until), and the largest spend
--     of one user in it. The administration's budget card and cap meters
--     compare it with the monthly caps scaled to the period. Server only,
--     like jarvis_month_spend(); the check before a model call is unchanged.
-- =============================================================================

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
  )
  select coalesce(sum(p.cost), 0), coalesce(sum(p.calls), 0)::bigint, max(p.cost)
  from per_user p;
$$;
revoke all on function public.jarvis_range_spend(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_range_spend(timestamptz, timestamptz) to service_role;
