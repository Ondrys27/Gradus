-- =============================================================================
-- The administration's overview of widgets, and errors without e-mails (29.2)
--
--   * admin_dashboard_layouts: the overview's tabs of one administrator (the
--     same shape as the app's dashboard_layouts, dashboard_items_valid). The
--     main tab (is_default) with null items follows the default live: the one
--     the owner set for administrators (app_settings 'admin_dashboard_default')
--     or the system's. Read and written only by the server (admin client after
--     the admin guard, always for the session's own account): no policies, no
--     grants, like everything of the administration.
--   * app_settings 'admin_dashboard_default': the layout new administrators
--     start with; written through admin_set_app_setting (owner or full admin
--     with aal2 and a live admin session), audited as widget counts.
--   * error_alerts.mode gains 'off' (no e-mails, the new default) and
--     'critical' (only the same error at 5+ users in an hour, or a crash of
--     signing in, signing up or payments). Every stored setting is switched to
--     'off': errors are watched in the overview's Errors widget, the badge in
--     the menu and the bell, not in the inbox.
--   * admin_error_overview() / admin_error_badge(): the numbers of the Errors
--     widget and the badge, from error_events and error_groups. Server only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admin_dashboard_layouts
-- -----------------------------------------------------------------------------

create table public.admin_dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null only for the main tab: then it is called "Overview" in the user's language.
  name text,
  position smallint not null default 0,
  items jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_dashboard_layouts_name check (
    (name is null and is_default) or (name is not null and char_length(btrim(name)) between 1 and 40)
  ),
  constraint admin_dashboard_layouts_position check (position between 0 and 5),
  constraint admin_dashboard_layouts_items check (
    (items is null and is_default) or public.dashboard_items_valid(items)
  )
);

comment on table public.admin_dashboard_layouts is
  'The administration overview''s tabs of one administrator (29.2). The main tab (is_default) with null items follows the default live. Server only.';

create unique index admin_dashboard_layouts_main_idx
  on public.admin_dashboard_layouts (user_id) where is_default;
-- At most six tabs: one per position 0–5.
create unique index admin_dashboard_layouts_position_idx
  on public.admin_dashboard_layouts (user_id, position);

create trigger set_updated_at before update on public.admin_dashboard_layouts
  for each row execute function public.set_updated_at();

alter table public.admin_dashboard_layouts enable row level security;
-- No policies: the browser neither reads nor writes it.
revoke all on table public.admin_dashboard_layouts from anon, authenticated;

-- -----------------------------------------------------------------------------
-- The error alert modes
-- -----------------------------------------------------------------------------

-- The same as errorAlertSettingsSchema in src/features/errors/alerts/settings.ts.
create or replace function public.valid_error_alerts(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when jsonb_typeof(_value -> 'emails') is distinct from 'array' then false
    else coalesce(
      (select coalesce(bool_and(k in ('emails', 'mode', 'digest_minutes')), true)
       from jsonb_object_keys(_value) as k)
      and jsonb_array_length(_value -> 'emails') <= 10
      and (select coalesce(bool_and(
             jsonb_typeof(e) = 'string'
             and char_length(e #>> '{}') <= 254
             and (e #>> '{}') ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$'
           ), true)
           from jsonb_array_elements(_value -> 'emails') as e)
      and (select count(distinct e #>> '{}') = count(*)
           from jsonb_array_elements(_value -> 'emails') as e)
      and (_value ->> 'mode') in ('off', 'critical', 'digest', 'every')
      and jsonb_typeof(_value -> 'digest_minutes') = 'number'
      and (_value ->> 'digest_minutes')::numeric between 5 and 1440
      and (_value ->> 'digest_minutes')::numeric = trunc((_value ->> 'digest_minutes')::numeric),
      false
    )
  end;
$$;

-- Errors light up in the administration now; the e-mails go quiet until someone turns them back on.
update public.app_settings
set value = jsonb_set(value, '{mode}', '"off"'::jsonb), updated_at = now()
where key = 'error_alerts' and value ->> 'mode' is distinct from 'off';

-- A crash where it hurts most: signing in, signing up, payments. The same
-- pattern as CRITICAL_PLACE_PATTERN in src/features/errors/alerts/critical.ts.
create or replace function public.error_alert_critical_place(_page text, _action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(_page, '') ~ '^/(en/)?(prihlaseni|login|registrace|register|nove-heslo|reset-password|zapomenute-heslo|forgot-password|admin/prihlaseni|auth|api/stripe|api/cron/recurring-payments|app/nastaveni/predplatne)(/|$)'
    or coalesce(_action, '') ~ '^/(en/)?(prihlaseni|login|registrace|register|nove-heslo|reset-password|zapomenute-heslo|forgot-password|admin/prihlaseni|auth|api/stripe|api/cron/recurring-payments|app/nastaveni/predplatne)(/|$)'
    or coalesce(_action, '') = 'recurring_payments';
$$;
revoke all on function public.error_alert_critical_place(text, text) from public, anon, authenticated;
grant execute on function public.error_alert_critical_place(text, text) to service_role;

-- "Only critical": the crash of a critical place, or the same error (fingerprint)
-- at 5 or more signed-in people within the last hour.
create or replace function public.error_alert_critical(_event_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.error_events e
    where e.id = _event_id
      and (
        public.error_alert_critical_place(e.page, e.action)
        or (
          select count(distinct x.user_id)
          from public.error_events x
          where x.fingerprint = e.fingerprint
            and x.transport = e.transport
            and x.user_id is not null
            and x.created_at > now() - interval '1 hour'
        ) >= 5
      )
  );
$$;
revoke all on function public.error_alert_critical(uuid) from public, anon, authenticated;
grant execute on function public.error_alert_critical(uuid) to service_role;

-- As in 20261027090000_error_alerts.sql, with the modes 'off' (nothing is
-- e-mailed, the default) and 'critical' (only what error_alert_critical()
-- says; the rest is kept as 'off'). The flood rules apply to what is left.
create or replace function public.error_alert_claim(
  _event_id uuid,
  _fingerprint_minutes integer default 15,
  _hourly_limit integer default 30
)
returns table (
  decision text,
  send_id uuid,
  recipients jsonb,
  since_last integer,
  day_count integer
)
language plpgsql
set search_path = ''
as $$
declare
  _event public.error_events;
  _settings jsonb;
  _emails jsonb;
  _mode text;
  _digest_minutes integer;
  _last_sent timestamptz;
  _hourly integer;
  _send uuid;
  _since integer := 0;
  _day integer := 0;
begin
  select * into _event from public.error_events e where e.id = _event_id;
  if not found then
    return query select 'skip'::text, null::uuid, null::jsonb, 0, 0;
    return;
  end if;

  -- One decision at a time per transport; the event is read again under the lock.
  perform pg_advisory_xact_lock(hashtextextended('error_alerts:' || _event.transport, 0));
  select * into _event from public.error_events e where e.id = _event_id;
  if _event.alert <> 'pending' then
    return query select 'skip'::text, null::uuid, null::jsonb, 0, 0;
    return;
  end if;

  select s.value into _settings from public.app_settings s where s.key = 'error_alerts';
  _emails := case when jsonb_typeof(_settings -> 'emails') = 'array'
    then _settings -> 'emails' else '[]'::jsonb end;
  _mode := coalesce(_settings ->> 'mode', 'off');
  _digest_minutes := coalesce((_settings ->> 'digest_minutes')::integer, 15);

  select count(*) into _day
  from public.error_events e
  where e.fingerprint = _event.fingerprint and e.created_at > now() - interval '24 hours';

  if jsonb_array_length(_emails) = 0
     or _mode = 'off'
     or (_mode = 'critical' and not public.error_alert_critical(_event_id)) then
    update public.error_events set alert = 'off' where id = _event_id;
    return query select 'off'::text, null::uuid, null::jsonb, 0, _day;
    return;
  end if;

  select max(s.created_at) into _last_sent
  from public.error_alert_sends s
  where s.transport = _event.transport and s.kind = 'error' and s.fingerprint = _event.fingerprint;

  if _last_sent is not null
     and _last_sent > now() - make_interval(mins => greatest(coalesce(_fingerprint_minutes, 15), 0)) then
    update public.error_events set alert = 'throttled' where id = _event_id;
    return query select 'throttled'::text, null::uuid, null::jsonb, 0, _day;
    return;
  end if;

  if _mode = 'digest' and exists (
    select 1 from public.error_alert_sends s
    where s.transport = _event.transport
      and s.kind in ('error', 'digest', 'overflow')
      and s.created_at > now() - make_interval(mins => _digest_minutes)
  ) then
    update public.error_events set alert = 'digest' where id = _event_id;
    return query select 'digest'::text, null::uuid, null::jsonb, 0, _day;
    return;
  end if;

  select count(*) into _hourly
  from public.error_alert_sends s
  where s.transport = _event.transport
    and s.kind in ('error', 'digest')
    and s.created_at > now() - interval '1 hour';

  if _hourly >= coalesce(_hourly_limit, 30) then
    update public.error_events set alert = 'suppressed' where id = _event_id;
    if exists (
      select 1 from public.error_alert_sends s
      where s.transport = _event.transport and s.kind = 'overflow'
        and s.created_at > now() - interval '1 hour'
    ) then
      return query select 'suppressed'::text, null::uuid, null::jsonb, 0, _day;
      return;
    end if;
    insert into public.error_alert_sends (kind, transport, event_id, events, recipients)
    values ('overflow', _event.transport, _event_id, 1, jsonb_array_length(_emails))
    returning id into _send;
    return query select 'overflow'::text, _send, _emails, 0, _day;
    return;
  end if;

  -- The same error since its last e-mail (or in the last 24 hours) that waited:
  -- counted into this e-mail, so a later summary does not count them again.
  with counted as (
    update public.error_events e
    set alert = 'counted'
    where e.fingerprint = _event.fingerprint
      and e.id <> _event_id
      and e.transport = _event.transport
      and e.alert in ('throttled', 'digest', 'suppressed')
      and e.created_at > coalesce(_last_sent, now() - interval '24 hours')
    returning 1
  )
  select count(*) into _since from counted;

  insert into public.error_alert_sends (kind, transport, fingerprint, event_id, events, recipients)
  values ('error', _event.transport, _event.fingerprint, _event_id, _since + 1,
          jsonb_array_length(_emails))
  returning id into _send;
  update public.error_events set alert = 'sent' where id = _event_id;

  return query select 'send'::text, _send, _emails, _since, _day;
end;
$$;

revoke all on function public.error_alert_claim(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.error_alert_claim(uuid, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- The Errors widget and the badge (server only)
-- -----------------------------------------------------------------------------

-- New errors for the badge in the menu, the tab's title and the bell: groups
-- in the state New (no row in error_groups, or 'new') that happened in the
-- last _days days. An old new error that stopped happening fades out.
create or replace function public.admin_error_badge(_days integer default 30)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from (
    select distinct e.fingerprint
    from public.error_events e
    where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 400)))
  ) f
  left join public.error_groups g on g.fingerprint = f.fingerprint
  where coalesce(g.status, 'new') = 'new';
$$;
revoke all on function public.admin_error_badge(integer) from public, anon, authenticated;
grant execute on function public.admin_error_badge(integer) to service_role;

-- The numbers of the Errors widget for a period (days in the metrics time zone):
--   new_today  groups that happened for the first time today, or came back today
--   open       groups of the period that are New or In progress
--   users      distinct signed-in people hit by those open groups in the period
--   returned   groups of the period that came back after being resolved
--   top        the three open groups with the most occurrences in the period
create or replace function public.admin_error_overview(_from date, _to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (_from::timestamp at time zone public.metrics_timezone()) as starts,
      ((_to + 1)::timestamp at time zone public.metrics_timezone()) as ends,
      ((now() at time zone public.metrics_timezone())::date::timestamp
        at time zone public.metrics_timezone()) as today
  ),
  ranged as (
    select e.fingerprint, e.user_id, e.created_at, e.code, e.message, e.page
    from public.error_events e, bounds b
    where e.created_at >= b.starts and e.created_at < b.ends
  ),
  grouped as (
    select
      r.fingerprint,
      count(*)::integer as n,
      count(distinct r.user_id)::integer as users,
      max(r.created_at) as last_at,
      (array_agg(r.code order by r.created_at desc))[1] as code,
      (array_agg(r.message order by r.created_at desc))[1] as message,
      (array_agg(r.page order by r.created_at desc))[1] as page,
      coalesce(g.status, 'new') as status,
      g.returned_at
    from ranged r
    left join public.error_groups g on g.fingerprint = r.fingerprint
    group by r.fingerprint, g.status, g.returned_at
  ),
  open_groups as (
    select * from grouped where status in ('new', 'in_progress')
  ),
  today_groups as (
    select distinct e.fingerprint
    from public.error_events e, bounds b
    where e.created_at >= b.today
  ),
  fresh as (
    select t.fingerprint
    from today_groups t
    left join public.error_groups g on g.fingerprint = t.fingerprint
    cross join bounds b
    where coalesce(g.status, 'new') = 'new'
      and (
        g.returned_at >= b.today
        or not exists (
          select 1 from public.error_events o
          where o.fingerprint = t.fingerprint and o.created_at < b.today
        )
      )
  )
  select jsonb_build_object(
    'new_today', (select count(*) from fresh),
    'open', (select count(*) from open_groups),
    'users', (
      select count(distinct r.user_id) from ranged r
      where r.user_id is not null and r.fingerprint in (select fingerprint from open_groups)
    ),
    'returned', (
      select count(*) from grouped gr, bounds b
      where gr.status = 'new' and gr.returned_at >= b.starts and gr.returned_at < b.ends
    ),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fingerprint', t.fingerprint, 'code', t.code, 'message', t.message, 'page', t.page,
        'occurrences', t.n, 'users', t.users, 'status', t.status, 'returned', t.returned_at is not null,
        'last_at', t.last_at
      ) order by t.n desc, t.last_at desc)
      from (select * from open_groups order by n desc, last_at desc limit 3) t
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.admin_error_overview(date, date) from public, anon, authenticated;
grant execute on function public.admin_error_overview(date, date) to service_role;

-- -----------------------------------------------------------------------------
-- The default overview for administrators, an app setting
-- -----------------------------------------------------------------------------

-- As in 20261204090000_calendar_sync.sql, with 'admin_dashboard_default' (the
-- shape of a layout, dashboard_items_valid; audited as widget counts).
create or replace function public.admin_set_app_setting(
  _key text,
  _value jsonb,
  _ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old jsonb;
begin
  perform public.admin_require_owner();
  if _key = 'ai_caps' then
    if _value is null or not public.valid_ai_caps(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'error_alerts' then
    if _value is null or not public.valid_error_alerts(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'jarvis_rules' then
    if _value is null or not public.valid_jarvis_rules(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'grady_models' then
    if _value is null or not public.valid_grady_models(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'showcase_mode' then
    if _value is null or not public.valid_showcase_mode(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'trash_retention' then
    if _value is null or not public.valid_trash_retention(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'calendar_sync' then
    if _value is null or not public.valid_calendar_sync(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'admin_dashboard_default' then
    if _value is null or not public.dashboard_items_valid(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  else
    raise exception 'unknown_setting' using errcode = '22023';
  end if;

  select s.value into _old from public.app_settings s where s.key = _key for update;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (_key, _value, now(), _uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.' || _key, _ip_hash,
    case
      when _key = 'error_alerts' then jsonb_build_object(
        'key', _key,
        'from', public.error_alerts_audit(_old),
        'to', public.error_alerts_audit(_value))
      when _key = 'admin_dashboard_default' then jsonb_build_object(
        'key', _key,
        'from', case when _old is null then null else jsonb_build_object('widgets', jsonb_array_length(_old)) end,
        'to', jsonb_build_object('widgets', jsonb_array_length(_value)))
      else jsonb_build_object('key', _key, 'from', _old, 'to', _value)
    end
  );
  return _old;
end;
$$;
revoke all on function public.admin_set_app_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Paying accounts that went quiet (the overview's "Users at risk", server only)
-- -----------------------------------------------------------------------------

-- Paying = a running Stripe subscription, the same as metric_mrr (live mode,
-- test mode only with internal accounts included); quiet = nothing in the
-- analytics for _days days. The quietest first, with how many there are.
create or replace function public.admin_users_at_risk(
  _days integer default 14,
  _limit integer default 10,
  _include_internal boolean default false
)
returns table (user_id uuid, plan_key text, billing text, last_active_at timestamptz, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  with paying as (
    select s.user_id, s.plan_key, s.billing
    from public.subscriptions s
    where s.user_id = any(public.metric_users(
        public.metrics_timezone(), coalesce(_include_internal, false), '{}'::jsonb))
      and s.provider = 'stripe'
      and (s.stripe_mode = 'live' or coalesce(_include_internal, false))
      and s.status in ('active', 'past_due')
      and not public.subscription_expired(
        s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end)
  ),
  seen as (
    select p.user_id, p.plan_key, p.billing,
      (select max(e.created_at) from public.analytics_events e where e.user_id = p.user_id)
        as last_active_at
    from paying p
  ),
  quiet as (
    select * from seen
    where last_active_at is null
       or last_active_at < now() - make_interval(days => greatest(1, least(coalesce(_days, 14), 365)))
  )
  select q.user_id, q.plan_key, q.billing, q.last_active_at, (select count(*) from quiet)::integer
  from quiet q
  order by q.last_active_at asc nulls first
  limit greatest(1, least(coalesce(_limit, 10), 50));
$$;
revoke all on function public.admin_users_at_risk(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.admin_users_at_risk(integer, integer, boolean) to service_role;
