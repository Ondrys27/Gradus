-- =============================================================================
-- Administration filters (step 14.5): every list and number a page offers a
-- filter for now really applies it.
--   * metric_admin_users: + _include_internal and _segment (the Users page
--     ignored both, so "plan: beta" changed nothing). Internal accounts are
--     left out unless the view includes them, like every metric.
--   * metric_trials, metric_workers: + _segment (the accounts, resp. the
--     owners, the counts are about).
--   * admin_feature_requests, admin_nps_comments: the Feedback page's lists
--     with the same internal and segment filter (the comments also by period).
--     They return the feedback the people wrote for the owner; service role only.
-- All of them pick the accounts through metric_users(), the one place that
-- turns the view into a set of accounts.
-- =============================================================================

drop function if exists public.metric_admin_users(text, text, text, integer, integer);

create function public.metric_admin_users(
  _tz text default 'Europe/Prague',
  _query text default null,
  _sort text default 'activity',
  _limit integer default 50,
  _offset integer default 0,
  _include_internal boolean default false,
  _segment jsonb default '{}'
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
  _users uuid[] := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
begin
  return query
  with activity as (
    select e.user_id, max(e.created_at) as last_active_at
    from public.analytics_events e
    where e.user_id = any(_users)
    group by e.user_id
  ),
  cost as (
    select a.user_id, sum(a.cost_usd) as ai_cost_usd
    from public.ai_usage a
    where a.user_id = any(_users)
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
  where d.user_id = any(_users)
    and (
      _q is null
      or d.user_id::text like (_literal || '%') escape '\'
      or public.search_norm(p.display_name) like ('%' || _literal || '%') escape '\'
      or public.search_norm(u.email) like ('%' || _literal || '%') escape '\'
    )
  order by
    case when _sort = 'cost' then coalesce(c.ai_cost_usd, 0) end desc nulls last,
    case when _sort = 'signup' then d.signed_up_at end desc nulls last,
    act.last_active_at desc nulls last,
    d.signed_up_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
end;
$$;

revoke all on function public.metric_admin_users(text, text, text, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_admin_users(text, text, text, integer, integer, boolean, jsonb) to service_role;

-- Trials now, of the accounts in the view.
drop function if exists public.metric_trials(text, boolean);

create function public.metric_trials(
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (running bigint, ending_this_week bigint, expired bigint, converted bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _week_end timestamptz := public.metric_day_start(
    date_trunc('week', now() at time zone _tz)::date + 7, _tz);
  _users uuid[] := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
begin
  return query
  select
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at > now()),
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at > now() and s.trial_ends_at < _week_end),
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at <= now()),
    count(*) filter (where s.status = 'active' and s.trial_ends_at is not null
                       and s.plan_key in ('solo', 'pro', 'team'))
  from public.subscriptions s
  where s.user_id = any(_users);
end;
$$;

revoke all on function public.metric_trials(text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_trials(text, boolean, jsonb) to service_role;

-- Workers: invitations in the range, workers now, and how many were active —
-- of the owners in the view.
drop function if exists public.metric_workers(date, date, text, boolean);

create function public.metric_workers(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  invites_sent bigint,
  invites_accepted bigint,
  invites_expired bigint,
  workers bigint,
  owners_with_workers bigint,
  active_workers bigint,
  workers_per_owner numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _owners uuid[];
  _active text[] := public.metric_active_events();
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
begin
  perform public.metric_check_range(_from, _to);
  _owners := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));

  return query
  with ws as (
    select w.owner_id, w.user_id from public.workers w
    where w.owner_id = any(_owners) and w.status = 'active'
  )
  select
    (select count(*) from public.worker_invites i
     where i.owner_id = any(_owners) and i.created_at >= _start and i.created_at < _end),
    (select count(*) from public.worker_invites i
     where i.owner_id = any(_owners) and i.accepted_at >= _start and i.accepted_at < _end),
    (select count(*) from public.worker_invites i
     where i.owner_id = any(_owners) and i.accepted_at is null
       and i.expires_at >= _start and i.expires_at < least(_end, now())),
    (select count(*) from ws),
    (select count(distinct ws.owner_id) from ws),
    (select count(distinct e.user_id) from public.analytics_events e
     where e.user_id in (select ws.user_id from ws) and e.event = any(_active)
       and e.created_at >= _start and e.created_at < _end),
    (select round(count(*)::numeric / nullif(count(distinct ws.owner_id), 0), 2) from ws);
end;
$$;

revoke all on function public.metric_workers(date, date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_workers(date, date, text, boolean, jsonb) to service_role;

-- The ideas list of the Feedback page: the backlog now (like its status
-- counts), of the accounts in the view, newest first.
create function public.admin_feature_requests(
  _status public.feature_request_status default null,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}',
  _limit integer default 200
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  description text,
  status public.feature_request_status,
  created_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[] := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
begin
  return query
  select fr.id, fr.user_id, fr.title, fr.description, fr.status, fr.created_at
  from public.feature_requests fr
  where fr.user_id = any(_users)
    and (_status is null or fr.status = _status)
  order by fr.created_at desc
  limit greatest(1, least(coalesce(_limit, 200), 500));
end;
$$;

revoke all on function public.admin_feature_requests(public.feature_request_status, text, boolean, jsonb, integer) from public, anon, authenticated;
grant execute on function public.admin_feature_requests(public.feature_request_status, text, boolean, jsonb, integer) to service_role;

-- NPS answers with a comment in the period, of the accounts in the view.
create function public.admin_nps_comments(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}',
  _limit integer default 50
)
returns table (user_id uuid, score smallint, comment text, created_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
  return query
  select n.user_id, n.score, n.comment, n.created_at
  from public.nps_responses n
  where n.user_id = any(_users)
    and n.comment is not null
    and n.created_at >= public.metric_day_start(_from, _tz)
    and n.created_at < public.metric_day_start(_to + 1, _tz)
  order by n.created_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$$;

revoke all on function public.admin_nps_comments(date, date, text, boolean, jsonb, integer) from public, anon, authenticated;
grant execute on function public.admin_nps_comments(date, date, text, boolean, jsonb, integer) to service_role;
