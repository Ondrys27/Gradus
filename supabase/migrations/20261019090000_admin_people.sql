-- =============================================================================
-- Administration: people by name instead of id (step 14.3)
--   * admin_people(ids): the profile name and the sign-in e-mail of up to 500
--     accounts, for the administration to show a person by name. Read on the
--     server only (service role), never stored anywhere else: analytics,
--     usage_events and the metric_* functions keep identifiers only.
--   * metric_admin_users: the same signature and columns; the search now also
--     matches the name and the e-mail, without diacritics (search_norm), next
--     to the start of the id. SECURITY DEFINER because it reads auth.users;
--     still executable by the service role only.
-- =============================================================================

create or replace function public.admin_people(_ids uuid[])
returns table (user_id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, nullif(btrim(p.display_name), ''), nullif(btrim(u.email), '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = any ((coalesce(_ids, '{}'::uuid[]))[1:500]);
$$;

revoke all on function public.admin_people(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_people(uuid[]) to service_role;

create or replace function public.metric_admin_users(
  _tz text default 'Europe/Prague',
  _query text default null,
  _sort text default 'activity',
  _limit integer default 50,
  _offset integer default 0
)
returns table (
  user_id uuid,
  plan text,
  status text,
  mode text,
  industry text,
  country text,
  role text,
  is_internal boolean,
  signed_up_at timestamptz,
  last_active_at timestamptz,
  ai_cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  -- The query normalized, its own LIKE wildcards escaped.
  _literal text := replace(replace(replace(public.search_norm(_q), '\', '\\'), '%', '\%'), '_', '\_');
begin
  return query
  with activity as (
    select e.user_id, max(e.created_at) as last_active_at
    from public.analytics_events e
    where e.user_id is not null
    group by e.user_id
  ),
  cost as (
    select a.user_id, sum(a.cost_usd) as ai_cost_usd
    from public.ai_usage a
    group by a.user_id
  )
  select
    d.user_id, cp.plan_key, cp.status, d.mode, d.industry, d.country, d.role, d.is_internal,
    d.signed_up_at, act.last_active_at, coalesce(c.ai_cost_usd, 0)
  from public.metric_user_dims(_tz) d
  cross join lateral public.current_plan(d.user_id) cp
  left join activity act on act.user_id = d.user_id
  left join cost c on c.user_id = d.user_id
  left join public.profiles p on p.id = d.user_id
  left join auth.users u on u.id = d.user_id
  where _q is null
     or d.user_id::text like (_literal || '%') escape '\'
     or public.search_norm(p.display_name) like ('%' || _literal || '%') escape '\'
     or public.search_norm(u.email) like ('%' || _literal || '%') escape '\'
  order by
    case when _sort = 'cost' then coalesce(c.ai_cost_usd, 0) end desc nulls last,
    case when _sort = 'signup' then d.signed_up_at end desc nulls last,
    act.last_active_at desc nulls last,
    d.signed_up_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
end;
$$;

revoke all on function public.metric_admin_users(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.metric_admin_users(text, text, text, integer, integer) to service_role;
