-- =============================================================================
-- metric_admin_user_detail: add the last activity (docs/metrics.md #10 asks
-- for it explicitly; the list already had it, the detail did not).
-- =============================================================================

create or replace function public.metric_admin_user_detail(_user_id uuid, _tz text default 'Europe/Prague')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  _profile jsonb;
  _sections jsonb;
  _timeline jsonb;
  _ai jsonb;
  _active_days integer;
  _workers integer;
  _nps integer;
  _ideas integer;
  _last_active timestamptz;
begin
  select jsonb_build_object(
    'plan', cp.plan_key, 'status', cp.status, 'mode', d.mode, 'industry', d.industry,
    'country', d.country, 'role', d.role, 'is_internal', d.is_internal,
    'signed_up_at', d.signed_up_at, 'path_key', p.path_key, 'seen_level', p.seen_level
  )
  into _profile
  from public.metric_user_dims(_tz) d
  join public.profiles p on p.id = d.user_id
  cross join lateral public.current_plan(d.user_id) cp
  where d.user_id = _user_id;

  if _profile is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('section', x.section, 'actions', x.actions) order by x.actions desc), '[]'::jsonb)
  into _sections
  from (
    select c.section, count(*) as actions
    from public.analytics_events e
    join public.analytics_event_catalog c on c.event = e.event
    where e.user_id = _user_id
    group by c.section
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('event', y.event, 'at', y.created_at) order by y.created_at desc), '[]'::jsonb)
  into _timeline
  from (
    select e.event, e.created_at
    from public.analytics_events e
    where e.user_id = _user_id
    order by e.created_at desc
    limit 50
  ) y;

  select jsonb_build_object(
    'calls', count(*),
    'cost_usd', coalesce(sum(a.cost_usd), 0),
    'input_tokens', coalesce(sum(a.input_tokens), 0),
    'output_tokens', coalesce(sum(a.output_tokens), 0)
  )
  into _ai
  from public.ai_usage a
  where a.user_id = _user_id;

  select count(distinct date_trunc('day', e.created_at at time zone _tz))::integer
  into _active_days
  from public.analytics_events e
  join public.analytics_event_catalog c on c.event = e.event and c.active
  where e.user_id = _user_id and e.created_at > now() - interval '30 days';

  select max(e.created_at) into _last_active
  from public.analytics_events e
  where e.user_id = _user_id;

  select count(*)::integer into _workers from public.workers w where w.owner_id = _user_id;
  select count(*)::integer into _ideas from public.feature_requests fr where fr.user_id = _user_id;
  select n.score into _nps
  from public.nps_responses n
  where n.user_id = _user_id
  order by n.created_at desc
  limit 1;

  return _profile
    || jsonb_build_object(
      'active_days_30', coalesce(_active_days, 0),
      'last_active_at', _last_active,
      'sections', _sections,
      'timeline', _timeline,
      'ai', _ai,
      'workers', coalesce(_workers, 0),
      'feature_requests', coalesce(_ideas, 0),
      'nps_score', _nps
    );
end;
$$;

revoke all on function public.metric_admin_user_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.metric_admin_user_detail(uuid, text) to service_role;
