-- =============================================================================
-- Satisfaction survey instead of NPS
--   * satisfaction_responses: overall satisfaction 1-5 and two optional texts
--     (what the user likes, what to improve); asked after 14 days of use and
--     again 30 days after the last answer. nps_responses stays as history.
--   * profiles.nps_snoozed_until / nps_dismiss_streak: a closed card waits
--     until the next day; three closes in a row wait 30 days. The client
--     writes both on its own profile.
--   * admin_satisfaction_responses: the Feedback page's list, same filters as
--     admin_nps_comments.
--   * metric_admin_user_detail gains the last satisfaction.
-- =============================================================================

create table public.satisfaction_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  satisfaction smallint not null check (satisfaction between 1 and 5),
  liked text check (liked is null or char_length(liked) between 1 and 1000),
  improve text check (improve is null or char_length(improve) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index satisfaction_responses_user_idx on public.satisfaction_responses (user_id, created_at desc);
create index satisfaction_responses_created_idx on public.satisfaction_responses (created_at desc);

alter table public.satisfaction_responses enable row level security;
create policy "satisfaction_responses_select_own" on public.satisfaction_responses
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "satisfaction_responses_insert_own" on public.satisfaction_responses
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
-- No update or delete policy: an answer, once given, stays as it was.

alter table public.profiles
  add column nps_snoozed_until timestamptz,
  add column nps_dismiss_streak smallint not null default 0
    check (nps_dismiss_streak between 0 and 3);
comment on column public.profiles.nps_snoozed_until is
  'The satisfaction survey stays hidden until this moment (next day after a close, 30 days after three closes in a row).';
comment on column public.profiles.nps_dismiss_streak is
  'Closes of the satisfaction survey in a row since the last answer or month-long pause.';

insert into public.analytics_event_catalog (event, section, active) values
  ('satisfaction_submitted', 'platform', false),
  ('satisfaction_dismissed', 'platform', false);

-- Answers with at least one text in the period, of the accounts in the view.
create function public.admin_satisfaction_responses(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}',
  _limit integer default 50
)
returns table (user_id uuid, satisfaction smallint, liked text, improve text, created_at timestamptz)
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
  select s.user_id, s.satisfaction, s.liked, s.improve, s.created_at
  from public.satisfaction_responses s
  where s.user_id = any(_users)
    and (s.liked is not null or s.improve is not null)
    and s.created_at >= public.metric_day_start(_from, _tz)
    and s.created_at < public.metric_day_start(_to + 1, _tz)
  order by s.created_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$$;

revoke all on function public.admin_satisfaction_responses(date, date, text, boolean, jsonb, integer) from public, anon, authenticated;
grant execute on function public.admin_satisfaction_responses(date, date, text, boolean, jsonb, integer) to service_role;

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
  _satisfaction integer;
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
  select s.satisfaction into _satisfaction
  from public.satisfaction_responses s
  where s.user_id = _user_id
  order by s.created_at desc
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
      'nps_score', _nps,
      'satisfaction', _satisfaction
    );
end;
$$;

revoke all on function public.metric_admin_user_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.metric_admin_user_detail(uuid, text) to service_role;
