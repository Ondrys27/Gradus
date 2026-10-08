-- =============================================================================
-- Metric calculations (step 11.2)
--
-- Everything docs/metrics.md lists is computed here from analytics_events and
-- the app's tables; src/lib/analytics/metrics.ts says which function and
-- arguments compute each metric.
--
--   * Only the server reads metrics: every function is SECURITY INVOKER (it
--     sees only what its caller may read) and executable by service_role
--     alone. The admin client calls them after the owner's checks.
--   * Internal accounts (profiles.is_internal) are left out unless
--     _include_internal is true.
--   * A segment is a jsonb object with any of plan, mode, industry, locale,
--     country, role, device, signup_week. User attributes are the current
--     ones; device filters the events and sessions themselves. An unknown key
--     is refused, so a typo never returns unfiltered numbers.
--   * Days are calendar days in _tz (Europe/Prague by default, the owner's).
--   * An active user did at least one meaningful action: an event whose
--     catalog entry is active. Signing in or viewing a page is not one.
--     analytics_event_catalog mirrors src/lib/analytics/events.ts (a test
--     keeps them equal).
--   * metrics_daily keeps finished days of the daily metrics for the common
--     segments, filled every night by /api/cron/metrics-daily and once for the
--     history by `bun run metrics:backfill`. Today is always computed live.
--   * Money is never added up across currencies: functions return one row
--     per currency.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The event catalog as the database knows it
-- -----------------------------------------------------------------------------

create table public.analytics_event_catalog (
  event text primary key check (event ~ '^[a-z][a-z0-9_]{1,63}$'),
  section text not null check (section ~ '^[a-z_]{1,32}$'),
  active boolean not null
);
alter table public.analytics_event_catalog enable row level security;
revoke all on public.analytics_event_catalog from anon, authenticated;

insert into public.analytics_event_catalog (event, section, active) values
  ('page_viewed', 'platform', false),
  ('app_opened', 'platform', false),
  ('client_error', 'platform', false),
  ('server_call', 'platform', false),
  ('cron_run', 'platform', false),
  ('account_registered', 'account', false),
  ('signed_in', 'account', false),
  ('signed_out', 'account', false),
  ('waitlist_joined', 'account', false),
  ('waitlist_confirmed', 'account', false),
  ('settings_changed', 'settings', false),
  ('onboarding_step_completed', 'onboarding', false),
  ('onboarding_completed', 'onboarding', false),
  ('tour_step_viewed', 'onboarding', false),
  ('tour_finished', 'onboarding', false),
  ('game_mode_changed', 'game', false),
  ('path_chosen', 'game', false),
  ('xp_awarded', 'game', false),
  ('level_reached', 'game', false),
  ('achievement_earned', 'game', false),
  ('section_unlocked', 'game', false),
  ('celebration_shown', 'game', false),
  ('level_dialog_opened', 'game', false),
  ('milestone_created', 'milestones', true),
  ('milestone_updated', 'milestones', true),
  ('milestone_completed', 'milestones', true),
  ('milestone_reopened', 'milestones', true),
  ('milestone_deleted', 'milestones', true),
  ('milestone_review_requested', 'milestones', true),
  ('task_created', 'milestones', true),
  ('task_updated', 'milestones', true),
  ('task_completed', 'milestones', true),
  ('task_reopened', 'milestones', true),
  ('task_deleted', 'milestones', true),
  ('tasks_reordered', 'milestones', true),
  ('view_selected', 'milestones', false),
  ('deal_created', 'pipeline', true),
  ('deal_updated', 'pipeline', true),
  ('deal_moved', 'pipeline', true),
  ('deal_won', 'pipeline', true),
  ('deal_lost', 'pipeline', true),
  ('deal_deleted', 'pipeline', true),
  ('pipeline_stage_edited', 'pipeline', true),
  ('reengage_filter_used', 'pipeline', false),
  ('contact_created', 'contacts', true),
  ('contact_updated', 'contacts', true),
  ('contact_deleted', 'contacts', true),
  ('contact_moved', 'contacts', true),
  ('contact_activity_logged', 'contacts', true),
  ('contact_activity_deleted', 'contacts', true),
  ('contact_duplicate_warned', 'contacts', false),
  ('contact_table_edited', 'contacts', true),
  ('contact_field_edited', 'contacts', true),
  ('places_request', 'generation', false),
  ('contacts_generated', 'generation', true),
  ('timer_started', 'cold_calling', true),
  ('timer_paused', 'cold_calling', true),
  ('calendar_event_created', 'calendar', true),
  ('calendar_event_updated', 'calendar', true),
  ('calendar_event_deleted', 'calendar', true),
  ('transaction_created', 'finance', true),
  ('transaction_updated', 'finance', true),
  ('transaction_deleted', 'finance', true),
  ('transaction_confirmed', 'finance', true),
  ('recurring_payment_saved', 'finance', true),
  ('recurring_payment_toggled', 'finance', true),
  ('recurring_payment_deleted', 'finance', true),
  ('invoice_issued', 'finance', true),
  ('invoice_paid_marked', 'finance', true),
  ('invoice_deleted', 'finance', true),
  ('fakturoid_connected', 'finance', true),
  ('fakturoid_disconnected', 'finance', true),
  ('fakturoid_synced', 'finance', false),
  ('worker_invited', 'workers', true),
  ('worker_invite_renewed', 'workers', true),
  ('worker_invite_accepted', 'workers', false),
  ('worker_updated', 'workers', true),
  ('worker_permissions_saved', 'workers', true),
  ('worker_task_saved', 'workers', true),
  ('worker_task_status_changed', 'workers', true),
  ('worker_task_deleted', 'workers', true),
  ('worker_earnings_approved', 'workers', true),
  ('worker_payment_recorded', 'workers', true),
  ('work_timer_started', 'workers', true),
  ('work_timer_paused', 'workers', true),
  ('reward_rules_confirmed', 'workers', true),
  ('search_opened', 'search', false),
  ('search_performed', 'search', false),
  ('search_result_opened', 'search', false),
  ('search_quick_action_used', 'search', false),
  ('email_sent', 'email', true),
  ('email_draft_requested', 'email', true),
  ('jarvis_opened', 'jarvis', false),
  ('jarvis_message_sent', 'jarvis', true),
  ('jarvis_file_attached', 'jarvis', false),
  ('jarvis_file_rejected', 'jarvis', false),
  ('jarvis_limit_reached', 'jarvis', false),
  ('jarvis_proactive_reacted', 'jarvis', false),
  ('jarvis_suggestion_reacted', 'jarvis', false),
  ('jarvis_auto_action', 'jarvis', false),
  ('jarvis_auto_action_undone', 'jarvis', true),
  ('sales_analysis_requested', 'jarvis', true),
  ('plan_interest_clicked', 'plan', false),
  ('trial_notice_shown', 'plan', false);

-- -----------------------------------------------------------------------------
-- Daily summaries
-- -----------------------------------------------------------------------------

create table public.metrics_daily (
  date date not null,
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- The normalised segment ({} = everyone but internal accounts; "internal": true includes them).
  segment jsonb not null default '{}' check (jsonb_typeof(segment) = 'object'),
  value numeric not null,
  computed_at timestamptz not null default now(),
  primary key (metric_key, segment, date)
);
alter table public.metrics_daily enable row level security;
revoke all on public.metrics_daily from anon, authenticated;

-- The zone metrics_daily's days are cut in.
create or replace function public.metrics_timezone()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Europe/Prague'::text;
$$;

-- -----------------------------------------------------------------------------
-- Population and segments
-- -----------------------------------------------------------------------------

-- Every account with the attributes segments filter by. A worker's plan is
-- the plan of the workspace they work in.
create or replace function public.metric_user_dims(_tz text default 'Europe/Prague')
returns table (
  user_id uuid,
  signed_up_at timestamptz,
  is_internal boolean,
  plan text,
  mode text,
  industry text,
  locale text,
  country text,
  role text,
  signup_week date
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.created_at,
    p.is_internal,
    coalesce(
      case when s.status = 'trialing' then 'trial' else s.plan_key end,
      (select pl.key from public.plans pl where pl.is_default order by pl.key limit 1)
    ),
    p.mode,
    p.industry,
    us.locale,
    us.country_code,
    case when w.owner_id is null then 'owner' else 'worker' end,
    date_trunc('week', p.created_at at time zone _tz)::date
  from public.profiles p
  left join lateral (
    select wk.owner_id
    from public.workers wk
    where wk.user_id = p.id and wk.status = 'active'
    order by wk.created_at
    limit 1
  ) w on true
  left join public.subscriptions s on s.user_id = coalesce(w.owner_id, p.id)
  left join public.user_settings us on us.user_id = p.id;
$$;

-- Refuses unknown segment keys and non-text values.
create or replace function public.metric_check_segment(_segment jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  _key text;
begin
  if _segment is null then
    return;
  end if;
  if jsonb_typeof(_segment) <> 'object' then
    raise exception 'metric segment must be an object' using errcode = '22023';
  end if;
  for _key in select jsonb_object_keys(_segment) loop
    if _key not in ('plan', 'mode', 'industry', 'locale', 'country', 'role', 'device', 'signup_week') then
      raise exception 'unknown metric segment %', _key using errcode = '22023';
    end if;
    if jsonb_typeof(_segment -> _key) not in ('string', 'null') then
      raise exception 'metric segment % must be text', _key using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- The segment as metrics_daily stores it: no empty values, "internal": true
-- when internal accounts count.
create or replace function public.metric_segment_key(_segment jsonb, _include_internal boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_object_agg(k, v)
     from jsonb_each(coalesce(_segment, '{}')) as e(k, v)
     where jsonb_typeof(v) = 'string' and v #>> '{}' <> ''),
    '{}'::jsonb
  ) || case when _include_internal then '{"internal": true}'::jsonb else '{}'::jsonb end;
$$;

-- Does the segment filter by anything about the user (not just the device)?
create or replace function public.metric_segment_has_user_keys(_segment jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_each(coalesce(_segment, '{}')) as e(k, v)
    where k <> 'device' and jsonb_typeof(v) = 'string' and v #>> '{}' <> ''
  );
$$;

-- The accounts a metric counts.
create or replace function public.metric_users(
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  _seg jsonb := public.metric_segment_key(_segment, false);
  _ids uuid[];
begin
  perform public.metric_check_segment(_segment);
  select coalesce(array_agg(d.user_id), '{}')
  into _ids
  from public.metric_user_dims(_tz) d
  where (_include_internal or not d.is_internal)
    and (_seg ->> 'plan' is null or d.plan = _seg ->> 'plan')
    and (_seg ->> 'mode' is null or d.mode = _seg ->> 'mode')
    and (_seg ->> 'industry' is null or d.industry = _seg ->> 'industry')
    and (_seg ->> 'locale' is null or d.locale = _seg ->> 'locale')
    and (_seg ->> 'country' is null or d.country = _seg ->> 'country')
    and (_seg ->> 'role' is null or d.role = _seg ->> 'role')
    and (_seg ->> 'signup_week' is null or d.signup_week::text = _seg ->> 'signup_week');
  return _ids;
end;
$$;

create or replace function public.metric_active_events()
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(c.event order by c.event), '{}')
  from public.analytics_event_catalog c
  where c.active;
$$;

-- Local midnight of a day as an instant.
create or replace function public.metric_day_start(_day date, _tz text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select _day::timestamp at time zone _tz;
$$;

create or replace function public.metric_check_range(_from date, _to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if _from is null or _to is null or _to < _from then
    raise exception 'metric range is empty' using errcode = '22023';
  end if;
  if _to - _from > 800 then
    raise exception 'metric range is too long' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Daily metrics
-- -----------------------------------------------------------------------------

-- The metrics metric_series() and metrics_daily know, and whether a segment
-- applies to them (system ones count everything).
create or replace function public.metric_daily_keys()
returns table (metric_key text, segmentable boolean, device boolean)
language sql
immutable
set search_path = ''
as $$
  values
    ('signups', true, false),
    ('users_total', true, false),
    ('dau', true, true),
    ('wau', true, true),
    ('mau', true, true),
    ('stickiness', true, true),
    ('new_active', true, true),
    ('returning_active', true, true),
    ('churned', true, true),
    ('sessions', true, true),
    ('app_minutes', true, true),
    ('ai_calls', true, false),
    ('ai_cost_usd', true, false),
    ('places_requests', true, true),
    ('emails_sent', true, true),
    ('xp_awarded', true, false),
    ('events', true, true),
    ('errors', false, false);
$$;

-- One daily metric for one day. _users is metric_users() for the segment;
-- null when the metric does not apply to a device segment.
create or replace function public.metric_daily_value(
  _metric text,
  _day date,
  _tz text,
  _users uuid[],
  _device text default null
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  _start timestamptz := public.metric_day_start(_day, _tz);
  _end timestamptz := public.metric_day_start(_day + 1, _tz);
  _active text[] := public.metric_active_events();
  _supports_device boolean;
  _a numeric;
  _b numeric;
begin
  select k.device into _supports_device from public.metric_daily_keys() k where k.metric_key = _metric;
  if not found then
    raise exception 'unknown daily metric %', _metric using errcode = '22023';
  end if;
  if _device is not null and not _supports_device then
    return null;
  end if;

  case _metric
  when 'signups' then
    select count(*) into _a from public.profiles p
    where p.id = any(_users) and p.created_at >= _start and p.created_at < _end;
  when 'users_total' then
    select count(*) into _a from public.profiles p
    where p.id = any(_users) and p.created_at < _end;
  when 'dau', 'wau', 'mau' then
    select count(distinct e.user_id) into _a
    from public.analytics_events e
    where e.user_id = any(_users)
      and e.event = any(_active)
      and (_device is null or e.device = _device)
      and e.created_at >= public.metric_day_start(
            _day - case _metric when 'dau' then 0 when 'wau' then 6 else 29 end, _tz)
      and e.created_at < _end;
  when 'stickiness' then
    _a := public.metric_daily_value('dau', _day, _tz, _users, _device);
    _b := public.metric_daily_value('mau', _day, _tz, _users, _device);
    _a := case when _b > 0 then round(_a / _b, 4) else 0 end;
  when 'new_active', 'returning_active' then
    -- New: the day is the first day they were ever active.
    select count(*) filter (where not earlier.any_before), count(*) filter (where earlier.any_before)
    into _a, _b
    from (
      select distinct e.user_id
      from public.analytics_events e
      where e.user_id = any(_users) and e.event = any(_active)
        and (_device is null or e.device = _device)
        and e.created_at >= _start and e.created_at < _end
    ) today
    cross join lateral (
      select exists (
        select 1 from public.analytics_events p
        where p.user_id = today.user_id and p.event = any(_active) and p.created_at < _start
      ) as any_before
    ) earlier;
    if _metric = 'returning_active' then
      _a := _b;
    end if;
  when 'churned' then
    -- Were active once, then 14 days without a meaningful action.
    select count(*) into _a
    from unnest(_users) as u(id)
    cross join lateral (
      select e.created_at
      from public.analytics_events e
      where e.user_id = u.id and e.event = any(_active) and e.created_at < _end
        and (_device is null or e.device = _device)
      order by e.created_at desc
      limit 1
    ) last_action
    where last_action.created_at < _end - interval '14 days';
  when 'sessions' then
    select count(*) into _a from public.app_sessions s
    where s.user_id = any(_users) and (_device is null or s.device = _device)
      and s.started_at >= _start and s.started_at < _end;
  when 'app_minutes' then
    select coalesce(round(sum(extract(epoch from s.last_seen_at - s.started_at)) / 60, 1), 0) into _a
    from public.app_sessions s
    where s.user_id = any(_users) and (_device is null or s.device = _device)
      and s.started_at >= _start and s.started_at < _end;
  when 'ai_calls' then
    select count(*) into _a from public.ai_usage u
    where u.user_id = any(_users) and u.created_at >= _start and u.created_at < _end;
  when 'ai_cost_usd' then
    select coalesce(sum(u.cost_usd), 0) into _a from public.ai_usage u
    where u.user_id = any(_users) and u.created_at >= _start and u.created_at < _end;
  when 'places_requests', 'emails_sent' then
    select count(*) into _a from public.analytics_events e
    where e.event = case _metric when 'places_requests' then 'places_request' else 'email_sent' end
      and e.user_id = any(_users) and (_device is null or e.device = _device)
      and e.created_at >= _start and e.created_at < _end;
  when 'xp_awarded' then
    select coalesce(sum(x.xp), 0) into _a from public.xp_events x
    where x.user_id = any(_users) and x.created_at >= _start and x.created_at < _end;
  when 'events' then
    select count(*) into _a from public.analytics_events e
    where e.user_id = any(_users) and (_device is null or e.device = _device)
      and e.created_at >= _start and e.created_at < _end;
  when 'errors' then
    -- Failed server calls and cron runs, and errors in the browser.
    select count(*) into _a from public.analytics_events e
    where e.created_at >= _start and e.created_at < _end
      and (e.event = 'client_error'
           or (e.event in ('server_call', 'cron_run') and e.props ->> 'ok' = 'false'));
  end case;

  return coalesce(_a, 0);
end;
$$;

-- Daily values of several metrics over a range: finished days from
-- metrics_daily when it has them, today and anything missing computed live.
create or replace function public.metric_series(
  _metrics text[],
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (metric_key text, day date, value numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _today date := (now() at time zone _tz)::date;
  _last date := least(_to, _today);
  _seg jsonb := public.metric_segment_key(_segment, _include_internal);
  _stored_tz boolean := _tz = public.metrics_timezone();
  _users uuid[];
  _system_users uuid[];
  _m text;
  _segmentable boolean;
  _d date;
  _v numeric;
begin
  perform public.metric_check_segment(_segment);
  perform public.metric_check_range(_from, _to);

  foreach _m in array _metrics loop
    select k.segmentable into _segmentable from public.metric_daily_keys() k where k.metric_key = _m;
    if not found then
      raise exception 'unknown daily metric %', _m using errcode = '22023';
    end if;

    for _d, _v in
      select g::date, md.value
      from generate_series(_from::timestamp, _last::timestamp, interval '1 day') g
      left join public.metrics_daily md
        on _stored_tz
       and md.metric_key = _m
       and md.date = g::date
       and md.segment = case when _segmentable then _seg else '{}'::jsonb end
      order by 1
    loop
      if _v is null or _d >= _today then
        if _segmentable then
          if _users is null then
            _users := public.metric_users(_tz, _include_internal, _segment);
          end if;
          _v := public.metric_daily_value(_m, _d, _tz, _users, _segment ->> 'device');
        else
          if _system_users is null then
            _system_users := public.metric_users(_tz, true, '{}');
          end if;
          _v := public.metric_daily_value(_m, _d, _tz, _system_users, null);
        end if;
      end if;
      metric_key := _m;
      day := _d;
      value := _v;
      return next;
    end loop;
  end loop;
end;
$$;

-- The segments metrics_daily keeps; anything else is computed live.
create or replace function public.metric_precomputed_segments()
returns setof jsonb
language sql
immutable
set search_path = ''
as $$
  select '{}'::jsonb
  union all select '{"internal": true}'::jsonb
  union all select jsonb_build_object('plan', v) from unnest(array['beta', 'trial', 'solo', 'pro', 'team']) v
  union all select jsonb_build_object('mode', v) from unnest(array['game', 'tool']) v
  union all select jsonb_build_object('role', v) from unnest(array['owner', 'worker']) v
  union all select jsonb_build_object('device', v) from unnest(array['mobile', 'tablet', 'desktop']) v
  union all select jsonb_build_object('locale', v) from unnest(array['cs', 'en']) v;
$$;

-- Computes and stores one finished day of every daily metric for every
-- precomputed segment. Returns the rows written.
create or replace function public.refresh_metrics_daily(_day date)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  _tz text := public.metrics_timezone();
  _seg jsonb;
  _users uuid[];
  _k record;
  _v numeric;
  _written integer := 0;
begin
  if _day is null or _day >= (now() at time zone _tz)::date then
    raise exception 'only finished days are stored' using errcode = '22023';
  end if;

  for _seg in select s from public.metric_precomputed_segments() s loop
    _users := public.metric_users(_tz, coalesce((_seg ->> 'internal')::boolean, false), _seg - 'internal');
    for _k in select * from public.metric_daily_keys() loop
      continue when not _k.segmentable and _seg <> '{}'::jsonb;
      _v := public.metric_daily_value(
        _k.metric_key, _day, _tz,
        case when _k.segmentable then _users else public.metric_users(_tz, true, '{}') end,
        _seg ->> 'device'
      );
      continue when _v is null;
      insert into public.metrics_daily (date, metric_key, segment, value, computed_at)
      values (_day, _k.metric_key, _seg, _v, now())
      on conflict (metric_key, segment, date)
      do update set value = excluded.value, computed_at = excluded.computed_at;
      _written := _written + 1;
    end loop;
  end loop;
  return _written;
end;
$$;

-- -----------------------------------------------------------------------------
-- Activation: funnel, activated users
-- -----------------------------------------------------------------------------

-- Sign-ups in the range and how far they got. A user counts at a step when
-- they reached it and every step before it (in any order); times between
-- steps are in hours, never negative.
create or replace function public.metric_funnel(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  step integer,
  step_key text,
  users bigint,
  pct_of_start numeric,
  pct_of_previous numeric,
  median_hours_from_previous numeric,
  median_hours_from_start numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _keys constant text[] := array[
    'registered', 'onboarding_completed', 'first_milestone', 'first_task_completed',
    'first_contact', 'first_deal', 'first_meeting', 'first_won_deal'
  ];
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with cohort as (
    select p.id, p.created_at, p.onboarding_completed_at
    from public.profiles p
    where p.id = any(_users)
      and p.created_at >= public.metric_day_start(_from, _tz)
      and p.created_at < public.metric_day_start(_to + 1, _tz)
  ),
  firsts as (
    select c.id, array[
      c.created_at,
      coalesce(c.onboarding_completed_at,
        (select min(e.created_at) from public.analytics_events e
         where e.user_id = c.id and e.event = 'onboarding_completed')),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'milestone_created'),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'task_completed'),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'contact_created'),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'deal_created'),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'contact_moved' and e.props ->> 'meeting_booked' = 'true'),
      (select min(e.created_at) from public.analytics_events e
       where e.user_id = c.id and e.event = 'deal_won')
    ] as t
    from cohort c
  ),
  chained as (
    select f.t,
      coalesce((select min(i) - 1 from generate_subscripts(f.t, 1) i where f.t[i] is null), 8) as chain
    from firsts f
  ),
  steps as (
    select s.n,
      count(*) filter (where c.chain >= s.n) as reached,
      percentile_cont(0.5) within group (
        order by greatest(0, extract(epoch from c.t[s.n] - c.t[greatest(s.n - 1, 1)])) / 3600
      ) filter (where c.chain >= s.n and s.n > 1) as from_previous,
      percentile_cont(0.5) within group (
        order by greatest(0, extract(epoch from c.t[s.n] - c.t[1])) / 3600
      ) filter (where c.chain >= s.n and s.n > 1) as from_start
    from generate_series(1, 8) s(n)
    left join chained c on true
    group by s.n
  )
  select
    s.n,
    _keys[s.n],
    s.reached,
    case when first_value(s.reached) over w > 0
      then round(100.0 * s.reached / first_value(s.reached) over w, 1) else 0 end,
    case when s.n = 1 then 100.0
         when lag(s.reached) over w > 0 then round(100.0 * s.reached / lag(s.reached) over w, 1)
         else 0 end,
    round(s.from_previous::numeric, 1),
    round(s.from_start::numeric, 1)
  from steps s
  window w as (order by s.n)
  order by s.n;
end;
$$;

-- Activated: within 7 days of signing up, active on at least 3 different
-- days and in at least 2 different sections. Only sign-ups whose 7 days are
-- over are eligible.
create or replace function public.metric_activation(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (signups bigint, eligible bigint, activated bigint, pct numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with cohort as (
    select p.id, p.created_at
    from public.profiles p
    where p.id = any(_users)
      and p.created_at >= public.metric_day_start(_from, _tz)
      and p.created_at < public.metric_day_start(_to + 1, _tz)
  ),
  first_week as (
    select c.id,
      c.created_at + interval '7 days' <= now() as is_eligible,
      (select count(distinct (e.created_at at time zone _tz)::date)
       from public.analytics_events e
       where e.user_id = c.id and e.event = any(_active)
         and e.created_at >= c.created_at and e.created_at < c.created_at + interval '7 days') as days,
      (select count(distinct cat.section)
       from public.analytics_events e
       join public.analytics_event_catalog cat on cat.event = e.event and cat.active
       where e.user_id = c.id
         and e.created_at >= c.created_at and e.created_at < c.created_at + interval '7 days') as sections
    from cohort c
  )
  select
    count(*),
    count(*) filter (where f.is_eligible),
    count(*) filter (where f.is_eligible and f.days >= 3 and f.sections >= 2),
    case when count(*) filter (where f.is_eligible) > 0
      then round(100.0 * count(*) filter (where f.is_eligible and f.days >= 3 and f.sections >= 2)
                 / count(*) filter (where f.is_eligible), 1)
      else 0 end
  from first_week f;
end;
$$;

-- -----------------------------------------------------------------------------
-- Retention: cohorts, D1/D7/D30, usage heatmap, active days, sessions
-- -----------------------------------------------------------------------------

-- Week of sign-up × calendar weeks after it (0 = the sign-up week): how many
-- of the cohort were active. Weeks that have not started are left out.
create or replace function public.metric_cohorts(
  _from date,
  _to date,
  _weeks integer default 12,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (cohort_week date, cohort_size bigint, week integer, active_users bigint, pct numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _this_week date := date_trunc('week', now() at time zone _tz)::date;
begin
  perform public.metric_check_range(_from, _to);
  if _weeks is null or _weeks < 0 or _weeks > 52 then
    raise exception 'cohort weeks out of range' using errcode = '22023';
  end if;
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with cohort as (
    select p.id, date_trunc('week', p.created_at at time zone _tz)::date as wk
    from public.profiles p
    where p.id = any(_users)
      and p.created_at >= public.metric_day_start(date_trunc('week', _from)::date, _tz)
      and p.created_at < public.metric_day_start(_to + 1, _tz)
  ),
  sizes as (
    select c.wk, count(*) as size from cohort c group by c.wk
  ),
  activity as (
    select distinct c.wk, c.id,
      ((date_trunc('week', e.created_at at time zone _tz)::date - c.wk) / 7)::integer as idx
    from cohort c
    join public.analytics_events e
      on e.user_id = c.id and e.event = any(_active)
     and e.created_at >= public.metric_day_start(c.wk, _tz)
     and e.created_at < public.metric_day_start(c.wk + 7 * (_weeks + 1), _tz)
  )
  select s.wk, s.size, g.idx,
    count(a.id),
    round(100.0 * count(a.id) / s.size, 1)
  from sizes s
  cross join generate_series(0, _weeks) g(idx)
  left join activity a on a.wk = s.wk and a.idx = g.idx
  where s.wk + 7 * g.idx <= _this_week
  group by s.wk, s.size, g.idx
  order by s.wk, g.idx;
end;
$$;

-- Dn retention: of the people who signed up in the range, how many were
-- active exactly n days later (calendar days in _tz). Only sign-ups whose day
-- n is over count.
create or replace function public.metric_retention(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (day_n integer, eligible bigint, retained bigint, pct numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _today date := (now() at time zone _tz)::date;
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with cohort as (
    select p.id, (p.created_at at time zone _tz)::date as signup_day
    from public.profiles p
    where p.id = any(_users)
      and p.created_at >= public.metric_day_start(_from, _tz)
      and p.created_at < public.metric_day_start(_to + 1, _tz)
  )
  select n.n,
    count(*) filter (where c.signup_day + n.n < _today),
    count(*) filter (where c.signup_day + n.n < _today and exists (
      select 1 from public.analytics_events e
      where e.user_id = c.id and e.event = any(_active)
        and e.created_at >= public.metric_day_start(c.signup_day + n.n, _tz)
        and e.created_at < public.metric_day_start(c.signup_day + n.n + 1, _tz)
    )),
    case when count(*) filter (where c.signup_day + n.n < _today) > 0 then
      round(100.0 * count(*) filter (where c.signup_day + n.n < _today and exists (
        select 1 from public.analytics_events e
        where e.user_id = c.id and e.event = any(_active)
          and e.created_at >= public.metric_day_start(c.signup_day + n.n, _tz)
          and e.created_at < public.metric_day_start(c.signup_day + n.n + 1, _tz)
      )) / count(*) filter (where c.signup_day + n.n < _today), 1)
    else 0 end
  from unnest(array[1, 7, 30]) n(n)
  left join cohort c on true
  group by n.n
  order by n.n;
end;
$$;

-- When people work in the app: meaningful actions by ISO weekday (1 = Monday)
-- and hour in _tz.
create or replace function public.metric_usage_heatmap(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (weekday integer, hour integer, events bigint, users bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select
    extract(isodow from e.created_at at time zone _tz)::integer,
    extract(hour from e.created_at at time zone _tz)::integer,
    count(*),
    count(distinct e.user_id)
  from public.analytics_events e
  where e.user_id = any(_users) and e.event = any(_active)
    and (_device is null or e.device = _device)
    and e.created_at >= public.metric_day_start(_from, _tz)
    and e.created_at < public.metric_day_start(_to + 1, _tz)
  group by 1, 2
  order by 1, 2;
end;
$$;

-- How many days a week people are active: for every user and ISO week in the
-- range with any action, the number of active days (1–7).
create or replace function public.metric_active_days(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (days integer, user_weeks bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select w.days::integer, count(*)
  from (
    select e.user_id, date_trunc('week', e.created_at at time zone _tz) as wk,
      count(distinct (e.created_at at time zone _tz)::date) as days
    from public.analytics_events e
    where e.user_id = any(_users) and e.event = any(_active)
      and (_device is null or e.device = _device)
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
    group by 1, 2
  ) w
  group by w.days
  order by w.days;
end;
$$;

-- Sessions and time in the app (minutes).
create or replace function public.metric_sessions(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  sessions bigint,
  users bigint,
  sessions_per_user_day numeric,
  sessions_per_user_week numeric,
  median_minutes numeric,
  p90_minutes numeric,
  minutes_per_user_day numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with s as (
    select a.user_id,
      (a.started_at at time zone _tz)::date as day,
      date_trunc('week', a.started_at at time zone _tz) as wk,
      extract(epoch from a.last_seen_at - a.started_at) / 60 as minutes
    from public.app_sessions a
    where a.user_id = any(_users) and (_device is null or a.device = _device)
      and a.started_at >= public.metric_day_start(_from, _tz)
      and a.started_at < public.metric_day_start(_to + 1, _tz)
  ),
  per_day as (select s.user_id, s.day, count(*) as n, sum(s.minutes) as m from s group by 1, 2),
  per_week as (select s.user_id, s.wk, count(*) as n from s group by 1, 2)
  select
    (select count(*) from s),
    (select count(distinct s.user_id) from s),
    (select round(avg(d.n), 2) from per_day d),
    (select round(avg(w.n), 2) from per_week w),
    (select round(percentile_cont(0.5) within group (order by s.minutes)::numeric, 1) from s),
    (select round(percentile_cont(0.9) within group (order by s.minutes)::numeric, 1) from s),
    (select round(avg(d.m)::numeric, 1) from per_day d);
end;
$$;

-- -----------------------------------------------------------------------------
-- Events: series, breakdowns, percentiles, adoption (features and explorer)
-- -----------------------------------------------------------------------------

create or replace function public.metric_check_event(_event text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.analytics_event_catalog c where c.event = _event) then
    raise exception 'unknown event %', _event using errcode = '22023';
  end if;
end;
$$;

-- A numeric value of an event: a property, or `$since_signup_days` (days
-- from the user's sign-up to the event).
create or replace function public.metric_event_number(_props jsonb, _prop text, _created_at timestamptz, _user uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when _prop = '$since_signup_days' then
      (select round((extract(epoch from _created_at - p.created_at) / 86400)::numeric, 2)
       from public.profiles p where p.id = _user)
    when jsonb_typeof(_props -> _prop) = 'number' then (_props ->> _prop)::numeric
  end;
$$;

-- What an event is grouped by: a property, or one of the columns the
-- enrichment trigger fills ($device, $plan, $mode, $locale).
create or replace function public.metric_event_key(
  _by text, _props jsonb, _device text, _plan text, _mode text, _locale text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(case _by
    when '$device' then _device
    when '$plan' then _plan
    when '$mode' then _mode
    when '$locale' then _locale
    else _props ->> _by
  end, 'none');
$$;

create or replace function public.metric_check_prop(_prop text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if _prop is not null
     and _prop !~ '^[a-z][a-z0-9_]{0,39}$'
     and _prop not in ('$since_signup_days', '$device', '$plan', '$mode', '$locale') then
    raise exception 'bad metric property %', _prop using errcode = '22023';
  end if;
end;
$$;

-- One event over time: count, unique users, or the sum or average of a
-- numeric property, per day, week or month, or `all` for one bucket (dated
-- _from) over the whole range. _filter keeps events whose props
-- contain it. System events (no user) count only without a user segment.
create or replace function public.metric_event_series(
  _event text,
  _calc text,
  _from date,
  _to date,
  _grain text default 'day',
  _prop text default null,
  _filter jsonb default '{}',
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (bucket date, value numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _system boolean := not public.metric_segment_has_user_keys(_segment);
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_event(_event);
  perform public.metric_check_prop(_prop);
  perform public.metric_check_range(_from, _to);
  if _calc not in ('count', 'users', 'sum', 'avg') or (_calc in ('sum', 'avg') and _prop is null) then
    raise exception 'bad metric calculation %', _calc using errcode = '22023';
  end if;
  if _grain not in ('day', 'week', 'month', 'all') then
    raise exception 'bad metric grain %', _grain using errcode = '22023';
  end if;
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with buckets as (
    select distinct case when _grain = 'all' then _from else date_trunc(_grain, g)::date end as b
    from generate_series(_from::timestamp, _to::timestamp, interval '1 day') g
  ),
  ev as (
    select case when _grain = 'all' then _from
             else date_trunc(_grain, e.created_at at time zone _tz)::date end as b,
      e.user_id,
      case when _prop is not null then public.metric_event_number(e.props, _prop, e.created_at, e.user_id) end as num
    from public.analytics_events e
    where e.event = _event
      and (e.user_id = any(_users) or (e.user_id is null and _system))
      and (_device is null or e.device = _device)
      and e.props @> coalesce(_filter, '{}')
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
  )
  select bk.b,
    case _calc
      when 'count' then count(ev.b)::numeric
      when 'users' then count(distinct ev.user_id)::numeric
      when 'sum' then coalesce(sum(ev.num), 0)
      else round(avg(ev.num), 2)
    end
  from buckets bk
  left join ev on ev.b = bk.b
  group by bk.b
  order by bk.b;
end;
$$;

-- One event split by a property or column, for the whole range.
create or replace function public.metric_event_breakdown(
  _event text,
  _by text,
  _calc text,
  _from date,
  _to date,
  _prop text default null,
  _filter jsonb default '{}',
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}',
  _limit integer default 50
)
returns table (key text, value numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _system boolean := not public.metric_segment_has_user_keys(_segment);
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_event(_event);
  perform public.metric_check_prop(_by);
  perform public.metric_check_prop(_prop);
  perform public.metric_check_range(_from, _to);
  if _by is null or _by = '$since_signup_days' then
    raise exception 'bad metric grouping' using errcode = '22023';
  end if;
  if _calc not in ('count', 'users', 'sum', 'avg') or (_calc in ('sum', 'avg') and _prop is null) then
    raise exception 'bad metric calculation %', _calc using errcode = '22023';
  end if;
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select k.key, k.value from (
    select
      public.metric_event_key(_by, e.props, e.device, e.plan_key, e.game_mode, e.locale) as key,
      case _calc
        when 'count' then count(*)::numeric
        when 'users' then count(distinct e.user_id)::numeric
        when 'sum' then coalesce(sum(public.metric_event_number(e.props, _prop, e.created_at, e.user_id)), 0)
        else round(avg(public.metric_event_number(e.props, _prop, e.created_at, e.user_id)), 2)
      end as value
    from public.analytics_events e
    where e.event = _event
      and (e.user_id = any(_users) or (e.user_id is null and _system))
      and (_device is null or e.device = _device)
      and e.props @> coalesce(_filter, '{}')
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
    group by 1
  ) k
  order by k.value desc, k.key
  limit greatest(1, least(coalesce(_limit, 50), 500));
end;
$$;

-- Median, p90 and p95 of a numeric property (latencies, sizes, hours in a
-- stage), optionally per group.
create or replace function public.metric_event_percentiles(
  _event text,
  _prop text,
  _from date,
  _to date,
  _by text default null,
  _filter jsonb default '{}',
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (key text, n bigint, p50 numeric, p90 numeric, p95 numeric, average numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _system boolean := not public.metric_segment_has_user_keys(_segment);
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_event(_event);
  perform public.metric_check_prop(_prop);
  perform public.metric_check_prop(_by);
  perform public.metric_check_range(_from, _to);
  if _prop is null then
    raise exception 'percentiles need a property' using errcode = '22023';
  end if;
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select v.key, count(*),
    round(percentile_cont(0.5) within group (order by v.num)::numeric, 2),
    round(percentile_cont(0.9) within group (order by v.num)::numeric, 2),
    round(percentile_cont(0.95) within group (order by v.num)::numeric, 2),
    round(avg(v.num), 2)
  from (
    select
      case when _by is null then 'all'
        else public.metric_event_key(_by, e.props, e.device, e.plan_key, e.game_mode, e.locale) end as key,
      public.metric_event_number(e.props, _prop, e.created_at, e.user_id) as num
    from public.analytics_events e
    where e.event = _event
      and (e.user_id = any(_users) or (e.user_id is null and _system))
      and (_device is null or e.device = _device)
      and e.props @> coalesce(_filter, '{}')
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
  ) v
  where v.num is not null
  group by v.key
  order by v.key;
end;
$$;

-- Per section of the app: how many of the active users used it, its actions
-- and actions per user of the section.
create or replace function public.metric_adoption(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (section text, users bigint, active_users bigint, pct numeric, actions bigint, actions_per_user numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _device text := _segment ->> 'device';
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with ev as (
    select e.user_id, c.section
    from public.analytics_events e
    join public.analytics_event_catalog c on c.event = e.event and c.active
    where e.user_id = any(_users)
      and (_device is null or e.device = _device)
      and e.created_at >= public.metric_day_start(_from, _tz)
      and e.created_at < public.metric_day_start(_to + 1, _tz)
  ),
  total as (select count(distinct ev.user_id) as n from ev)
  select ev.section,
    count(distinct ev.user_id),
    t.n,
    case when t.n > 0 then round(100.0 * count(distinct ev.user_id) / t.n, 1) else 0 end,
    count(*),
    round(count(*)::numeric / nullif(count(distinct ev.user_id), 0), 2)
  from ev cross join total t
  group by ev.section, t.n
  order by 2 desc, 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Money: always per currency
-- -----------------------------------------------------------------------------

create or replace function public.metric_money_by_currency(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (metric text, currency text, items bigint, total numeric, average numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select m.metric, m.currency, count(*), coalesce(sum(m.amount), 0), round(avg(m.amount), 2)
  from (
    select 'deals_created'::text as metric, d.currency, d.value as amount
    from public.deals d
    where d.user_id = any(_users) and d.created_at >= _start and d.created_at < _end
    union all
    select 'deals_won', d.currency, d.value
    from public.deals d
    where d.user_id = any(_users) and d.won_at >= _start and d.won_at < _end
    union all
    select 'deals_lost', d.currency, d.value
    from public.deals d
    where d.user_id = any(_users) and d.lost_at >= _start and d.lost_at < _end
    union all
    select case t.type when 'income' then 'income' else 'expense' end, t.currency, t.amount
    from public.transactions t
    where t.user_id = any(_users) and t.occurred_on between _from and _to
    union all
    select 'invoices_issued', i.currency, i.amount
    from public.invoices i
    where i.user_id = any(_users) and i.issued_on between _from and _to
      and i.status not in ('draft', 'cancelled')
  ) m
  group by m.metric, m.currency
  order by m.metric, m.currency;
end;
$$;

-- -----------------------------------------------------------------------------
-- AI and costs
-- -----------------------------------------------------------------------------

-- Model calls grouped by feature (purpose), model, error code or day.
-- Latency in ms; the error code is the leading word of the stored error.
create or replace function public.metric_ai_usage(
  _from date,
  _to date,
  _by text default 'purpose',
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  key text,
  calls bigint,
  failed bigint,
  users bigint,
  input_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  output_tokens bigint,
  cost_usd numeric,
  p50_ms numeric,
  p95_ms numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  perform public.metric_check_range(_from, _to);
  if _by not in ('purpose', 'model', 'error', 'day', 'all') then
    raise exception 'bad ai grouping %', _by using errcode = '22023';
  end if;
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select
    case _by
      when 'purpose' then u.purpose
      when 'model' then u.model
      when 'error' then case when u.success then 'ok'
        else coalesce(substring(u.error from '^([A-Za-z_]{1,40})'), 'unknown') end
      when 'day' then ((u.created_at at time zone _tz)::date)::text
      else 'all'
    end,
    count(*),
    count(*) filter (where not u.success),
    count(distinct u.user_id),
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.cache_read_tokens), 0)::bigint,
    coalesce(sum(u.cache_write_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    coalesce(sum(u.cost_usd), 0),
    round(percentile_cont(0.5) within group (order by u.duration_ms)::numeric, 0),
    round(percentile_cont(0.95) within group (order by u.duration_ms)::numeric, 0)
  from public.ai_usage u
  where u.user_id = any(_users)
    and u.created_at >= public.metric_day_start(_from, _tz)
    and u.created_at < public.metric_day_start(_to + 1, _tz)
  group by 1
  order by 1;
end;
$$;

-- The most expensive accounts: identifier and plan only.
create or replace function public.metric_ai_top_users(
  _from date,
  _to date,
  _limit integer default 10,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (user_id uuid, plan text, calls bigint, cost_usd numeric)
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
  select u.user_id, d.plan, count(*), coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  join public.metric_user_dims(_tz) d on d.user_id = u.user_id
  where u.user_id = any(_users)
    and u.created_at >= public.metric_day_start(_from, _tz)
    and u.created_at < public.metric_day_start(_to + 1, _tz)
  group by u.user_id, d.plan
  order by 4 desc, 3 desc
  limit greatest(1, least(coalesce(_limit, 10), 100));
end;
$$;

-- Conversations with Jarvis: how many, messages from people and per
-- conversation (counts only, never content).
create or replace function public.metric_jarvis_conversations(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  conversations bigint,
  users bigint,
  user_messages bigint,
  messages_per_user numeric,
  median_messages_per_conversation numeric
)
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
  with m as (
    select jm.conversation_id, jm.user_id
    from public.jarvis_messages jm
    where jm.user_id = any(_users) and jm.role = 'user'
      and jm.created_at >= public.metric_day_start(_from, _tz)
      and jm.created_at < public.metric_day_start(_to + 1, _tz)
  ),
  per_conv as (select m.conversation_id, count(*) as n from m group by 1)
  select
    (select count(*) from per_conv),
    (select count(distinct m.user_id) from m),
    (select count(*) from m),
    (select round(count(*)::numeric / nullif(count(distinct m.user_id), 0), 2) from m),
    (select round(percentile_cont(0.5) within group (order by p.n)::numeric, 1) from per_conv p);
end;
$$;

-- What the costs are made of, per plan: active users, AI cost from ai_usage,
-- Places requests and sent e-mails. Prices are applied in src/config/costs.ts.
create or replace function public.metric_cost_inputs(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  plan text,
  users bigint,
  active_users bigint,
  ai_cost_usd numeric,
  ai_calls bigint,
  places_requests bigint,
  emails_sent bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  with pop as (
    select d.user_id, d.plan from public.metric_user_dims(_tz) d where d.user_id = any(_users)
  ),
  ev as (
    select e.user_id,
      bool_or(e.event = any(_active)) as was_active,
      count(*) filter (where e.event = 'places_request') as places,
      count(*) filter (where e.event = 'email_sent') as emails
    from public.analytics_events e
    where e.user_id = any(_users) and e.created_at >= _start and e.created_at < _end
    group by e.user_id
  ),
  ai as (
    select u.user_id, sum(u.cost_usd) as cost, count(*) as calls
    from public.ai_usage u
    where u.user_id = any(_users) and u.created_at >= _start and u.created_at < _end
    group by u.user_id
  )
  select pop.plan,
    count(*),
    count(*) filter (where ev.was_active),
    coalesce(sum(ai.cost), 0),
    coalesce(sum(ai.calls), 0)::bigint,
    coalesce(sum(ev.places), 0)::bigint,
    coalesce(sum(ev.emails), 0)::bigint
  from pop
  left join ev on ev.user_id = pop.user_id
  left join ai on ai.user_id = pop.user_id
  group by pop.plan
  order by pop.plan;
end;
$$;

-- -----------------------------------------------------------------------------
-- State of accounts: distributions, trials, waitlist, workers, cron jobs
-- -----------------------------------------------------------------------------

-- How the accounts split by one attribute today. `value` carries a number
-- where the kind has one (median days to an unlock).
create or replace function public.metric_distribution(
  _kind text,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (key text, users bigint, value numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  _users := public.metric_users(_tz, _include_internal, _segment);

  case _kind
  when 'plan', 'mode', 'industry', 'locale', 'country', 'role', 'signup_week' then
    return query
    select coalesce(case _kind
        when 'plan' then d.plan when 'mode' then d.mode when 'industry' then d.industry
        when 'locale' then d.locale when 'country' then d.country when 'role' then d.role
        else d.signup_week::text end, 'none'),
      count(*), null::numeric
    from public.metric_user_dims(_tz) d
    where d.user_id = any(_users)
    group by 1 order by 2 desc, 1;
  when 'currency', 'theme', 'jarvis_frequency', 'animations', 'sounds', 'jarvis_proactive' then
    return query
    select coalesce(case _kind
        when 'currency' then s.currency when 'theme' then s.theme
        when 'jarvis_frequency' then s.jarvis_frequency
        when 'animations' then s.animations_enabled::text
        when 'sounds' then s.sound_enabled::text
        else s.jarvis_proactive::text end, 'none'),
      count(*), null::numeric
    from public.user_settings s
    where s.user_id = any(_users)
    group by 1 order by 2 desc, 1;
  when 'device', 'browser' then
    -- The device and browser of each account's latest session.
    return query
    select case _kind when 'device' then l.device else l.browser end, count(*), null::numeric
    from (
      select distinct on (a.user_id) a.user_id, a.device, a.browser
      from public.app_sessions a
      where a.user_id = any(_users)
      order by a.user_id, a.last_seen_at desc
    ) l
    group by 1 order by 2 desc, 1;
  when 'level' then
    return query
    select public.game_level_for_xp(coalesce(x.total, 0))::text, count(*), null::numeric
    from unnest(_users) u(id)
    left join (
      select xe.user_id, sum(xe.xp)::bigint as total from public.xp_events xe
      where xe.user_id = any(_users) group by xe.user_id
    ) x on x.user_id = u.id
    group by public.game_level_for_xp(coalesce(x.total, 0))
    order by public.game_level_for_xp(coalesce(x.total, 0));
  when 'streak' then
    return query
    select g.streak::text, count(*), null::numeric
    from unnest(_users) u(id)
    cross join lateral public.game_streak(u.id, public.game_timezone(u.id)) g
    group by g.streak
    order by g.streak;
  when 'achievement' then
    return query
    select ua.achievement_key, count(*), null::numeric
    from public.user_achievements ua
    where ua.user_id = any(_users)
    group by 1 order by 2 asc, 1;
  when 'chapter_completed' then
    -- Template milestones completed, by their position in the path.
    return query
    select pm.path_key || ':' || pm.position::text, count(distinct m.user_id), null::numeric
    from public.milestones m
    join public.path_milestones pm on pm.id = m.template_id
    where m.user_id = any(_users) and m.status = 'completed'
    group by pm.path_key, pm.position
    order by pm.path_key, pm.position;
  when 'unlock_days' then
    return query
    select un.key, count(*),
      round(percentile_cont(0.5) within group (
        order by extract(epoch from un.unlocked_at - p.created_at) / 86400)::numeric, 1)
    from public.unlocks un
    join public.profiles p on p.id = un.user_id
    where un.user_id = any(_users)
    group by un.key order by un.key;
  when 'fakturoid_connected' then
    return query
    select (fc.user_id is not null)::text, count(*), null::numeric
    from unnest(_users) u(id)
    left join public.fakturoid_connections fc on fc.user_id = u.id
    group by 1 order by 1;
  when 'workers_per_owner' then
    -- Owners (not workers) by how many active workers they have.
    return query
    select c.n::text, count(*), null::numeric
    from (
      select u.id, count(w.id) as n
      from unnest(_users) u(id)
      left join public.workers w on w.owner_id = u.id and w.status = 'active'
      where not exists (
        select 1 from public.workers me where me.user_id = u.id and me.status = 'active')
      group by u.id
    ) c
    group by c.n
    order by c.n;
  when 'feature_request_status' then
    return query
    select fr.status::text, count(*), null::numeric
    from public.feature_requests fr
    where fr.user_id = any(_users)
    group by 1 order by 1;
  else
    raise exception 'unknown distribution %', _kind using errcode = '22023';
  end case;
end;
$$;

-- Trials right now: running, ending this week (in _tz), expired, converted
-- to a paid plan. Accounts are workspace owners.
create or replace function public.metric_trials(
  _tz text default 'Europe/Prague',
  _include_internal boolean default false
)
returns table (running bigint, ending_this_week bigint, expired bigint, converted bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  _week_end timestamptz := public.metric_day_start(
    date_trunc('week', now() at time zone _tz)::date + 7, _tz);
begin
  return query
  select
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at > now()),
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at > now() and s.trial_ends_at < _week_end),
    count(*) filter (where s.status = 'trialing' and s.trial_ends_at <= now()),
    count(*) filter (where s.status = 'active' and s.trial_ends_at is not null
                       and s.plan_key in ('solo', 'pro', 'team'))
  from public.subscriptions s
  join public.profiles p on p.id = s.user_id
  where _include_internal or not p.is_internal;
end;
$$;

-- The waitlist: sign-ups, confirmations and how many of the confirmed have
-- an account. SECURITY DEFINER to match e-mails with auth.users; only the
-- service role may call it and it returns counts.
create or replace function public.metric_waitlist(_from date, _to date, _tz text default 'Europe/Prague')
returns table (joined bigint, confirmed bigint, confirm_rate numeric, converted bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.metric_check_range(_from, _to);
  return query
  with w as (
    select wl.email, wl.confirmed_at
    from public.waitlist wl
    where wl.created_at >= public.metric_day_start(_from, _tz)
      and wl.created_at < public.metric_day_start(_to + 1, _tz)
  )
  select
    count(*),
    count(*) filter (where w.confirmed_at is not null),
    case when count(*) > 0
      then round(100.0 * count(*) filter (where w.confirmed_at is not null) / count(*), 1) else 0 end,
    count(*) filter (where w.confirmed_at is not null and exists (
      select 1 from auth.users u where lower(u.email) = lower(w.email)))
  from w;
end;
$$;

-- Workers: invitations in the range, workers now, and how many were active.
create or replace function public.metric_workers(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false
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
  _owners := public.metric_users(_tz, _include_internal, '{}');

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

-- Scheduled jobs: the latest run of each, and runs and failures in 7 days.
create or replace function public.metric_cron_runs()
returns table (job text, last_run_at timestamptz, last_ok boolean, last_duration_ms integer, runs_7d bigint, failures_7d bigint)
language sql
stable
set search_path = ''
as $$
  select j.job, l.created_at, l.ok, l.duration_ms, j.runs, j.failures
  from (
    select e.props ->> 'job' as job,
      count(*) filter (where e.created_at > now() - interval '7 days') as runs,
      count(*) filter (where e.created_at > now() - interval '7 days' and e.props ->> 'ok' = 'false') as failures
    from public.analytics_events e
    where e.event = 'cron_run'
    group by 1
  ) j
  cross join lateral (
    select e.created_at, (e.props ->> 'ok')::boolean as ok, (e.props ->> 'duration_ms')::integer as duration_ms
    from public.analytics_events e
    where e.event = 'cron_run' and e.props ->> 'job' = j.job
    order by e.created_at desc
    limit 1
  ) l
  order by j.job;
$$;

-- -----------------------------------------------------------------------------
-- Cold calling and contact generation
-- -----------------------------------------------------------------------------

-- Time on the call timer per person (segments clipped to the range, open ones
-- to their effective end), and booked meetings per hour of calling.
create or replace function public.metric_call_time(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (hours numeric, callers bigint, hours_per_caller numeric, meetings bigint, meetings_per_hour numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
  _hours numeric;
  _callers bigint;
  _meetings bigint;
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  select
    coalesce(sum(extract(epoch from least(t.ended_at, _end) - greatest(t.started_at, _start))), 0) / 3600,
    count(distinct t.actor_id)
  into _hours, _callers
  from (
    select s.actor_id, s.started_at, public.prospecting_effective_end(s) as ended_at
    from public.prospecting_segments s
    where s.actor_id = any(_users) and s.started_at < _end
      and coalesce(s.ended_at, now()) > _start
  ) t
  where t.ended_at > _start;

  select count(*) into _meetings
  from public.analytics_events e
  where e.event = 'contact_moved' and e.props ->> 'meeting_booked' = 'true'
    and e.user_id = any(_users)
    and e.created_at >= _start and e.created_at < _end;

  hours := round(_hours, 2);
  callers := _callers;
  hours_per_caller := case when _callers > 0 then round(_hours / _callers, 2) end;
  meetings := _meetings;
  meetings_per_hour := case when _hours > 0 then round(_meetings / _hours, 2) end;
  return next;
end;
$$;

-- What people generate contacts for: the most searched normalised keywords,
-- with no link to anyone (generation_keyword_stats keeps no user).
create or replace function public.metric_generation_keywords(
  _from date,
  _to date,
  _limit integer default 20
)
returns table (keyword text, searches bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.metric_check_range(_from, _to);
  return query
  select g.keyword, sum(g.searches)::bigint
  from public.generation_keyword_stats g
  where g.day between _from and _to
  group by g.keyword
  order by 2 desc, 1
  limit greatest(1, least(coalesce(_limit, 20), 100));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: only the server (service role) computes metrics
-- -----------------------------------------------------------------------------

do $$
declare
  _fn regprocedure;
begin
  for _fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'metric\_%' or p.proname in ('metrics_timezone', 'refresh_metrics_daily'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', _fn);
    execute format('grant execute on function %s to service_role', _fn);
  end loop;
end;
$$;
