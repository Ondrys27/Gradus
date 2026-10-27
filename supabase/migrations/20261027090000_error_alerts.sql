-- =============================================================================
-- E-mail to the owner about every error (step 16.2)
--
--   * app_settings key 'error_alerts': { emails: string[] (0–10, lower case,
--     distinct), mode: 'every' | 'digest', digest_minutes: 5–1440 }. Checked
--     by valid_error_alerts() in a check constraint and in the writer. The
--     first value is the owner account's e-mail, mode 'every'.
--   * admin_set_app_setting() now accepts 'error_alerts' too (owner with aal2
--     and a live admin session, as before). The audit keeps the number of
--     addresses and a short hash of the list, never the addresses.
--   * error_events: every error the app catches, in the browser (the error
--     page, window errors) and on the server (render, route, action, cron),
--     one row per error code. Technical only: the page with ids taken out,
--     the scrubbed message, the first stack frames, the browser class. The
--     server writes it through error_event_record() (service role only), which
--     limits what one browser can send per hour. Nobody reads it but the
--     server: no policies, no grants.
--   * error_alert_sends: every e-mail the alerts sent or decided to send, the
--     memory of the flood rules. transport 'mock' is the end-to-end tests'
--     (their accounts outside production): nothing goes to Resend, the
--     message is kept in `message` so the test can read what would have gone.
--   * error_alert_claim(): the decision for one error in one transaction
--     (advisory lock): the same error (fingerprint) at most once per 15
--     minutes, at most 30 e-mails per hour and then one "there are more"
--     e-mail, in digest mode only when nothing went out in digest_minutes.
--   * error_alert_digest_claim(): the daily summary of what waited (cron at
--     7:00 UTC, digest mode only). purge_error_events(): 13 months.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The setting
-- ---------------------------------------------------------------------------

-- The same pattern as ALERT_EMAIL_PATTERN in src/features/errors/alerts/settings.ts.
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
      and (_value ->> 'mode') in ('every', 'digest')
      and jsonb_typeof(_value -> 'digest_minutes') = 'number'
      and (_value ->> 'digest_minutes')::numeric between 5 and 1440
      and (_value ->> 'digest_minutes')::numeric = trunc((_value ->> 'digest_minutes')::numeric),
      false
    )
  end;
$$;

alter table public.app_settings
  add constraint app_settings_error_alerts_valid
  check (key <> 'error_alerts' or public.valid_error_alerts(value));

-- What the audit keeps of an error_alerts value: counts and a hash, no addresses.
create or replace function public.error_alerts_audit(_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when _value is null then null else jsonb_build_object(
    'emails', jsonb_array_length(_value -> 'emails'),
    'emails_id', left(md5(coalesce(
      (select string_agg(e #>> '{}', ',' order by e #>> '{}')
       from jsonb_array_elements(_value -> 'emails') as e), '')), 8),
    'mode', _value ->> 'mode',
    'digest_minutes', _value -> 'digest_minutes'
  ) end;
$$;

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
    case when _key = 'error_alerts'
      then jsonb_build_object(
        'key', _key,
        'from', public.error_alerts_audit(_old),
        'to', public.error_alerts_audit(_value))
      else jsonb_build_object('key', _key, 'from', _old, 'to', _value)
    end
  );
  return _old;
end;
$$;
revoke all on function public.admin_set_app_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb, text) to authenticated;

-- The first value: the owner account's e-mail, every error on its own. Without
-- an owner (a fresh database) nothing is stored and the defaults apply: no addresses.
insert into public.app_settings (key, value)
select 'error_alerts', jsonb_build_object(
  'emails', jsonb_build_array(lower(u.email)),
  'mode', 'every',
  'digest_minutes', 15
)
from public.user_roles r
join auth.users u on u.id = r.user_id
where r.role = 'owner'
  and char_length(u.email) <= 254
  and lower(u.email) ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$'
order by r.created_at
limit 1
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The errors
-- ---------------------------------------------------------------------------

create table public.error_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^GR-[A-Z0-9]{6}$'),
  -- Of the message and the place (page + action), src/features/errors/alerts/fingerprint.ts.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  source text not null check (source in (
    'boundary', 'onerror', 'unhandledrejection', 'render', 'route', 'action', 'middleware', 'cron'
  )),
  page text not null check (char_length(page) between 1 and 300),
  action text check (char_length(action) between 1 and 200),
  message text not null check (char_length(message) between 1 and 300),
  stack text check (char_length(stack) <= 4000),
  digest text check (digest ~ '^[A-Za-z0-9_@-]{1,64}$'),
  user_id uuid references auth.users (id) on delete set null,
  browser text check (browser ~ '^[a-z]{1,16}$'),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  viewport text check (viewport ~ '^[0-9]{1,5}x[0-9]{1,5}$'),
  locale text check (locale in ('cs', 'en')),
  app_version text check (app_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  ip_hash text check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  -- 'mock': an end-to-end test account outside production, never sent to Resend.
  transport text not null default 'resend' check (transport in ('resend', 'mock')),
  -- What the alerts did with it: waiting, e-mailed, held back by a rule, counted
  -- into a later e-mail, the browser's copy of a server error, or no addresses.
  alert text not null default 'pending' check (alert in (
    'pending', 'sent', 'throttled', 'digest', 'suppressed', 'counted', 'linked', 'off'
  )),
  created_at timestamptz not null default now()
);

comment on table public.error_events is
  'Every error the app caught (browser and server), technical data only. Written by the server through error_event_record(); read only by the server.';

create index error_events_fingerprint_idx on public.error_events (fingerprint, created_at desc);
create index error_events_created_idx on public.error_events (created_at desc);
create index error_events_digest_idx on public.error_events (digest, created_at desc)
  where digest is not null;
create index error_events_user_idx on public.error_events (user_id, created_at desc);
create index error_events_ip_idx on public.error_events (ip_hash, created_at desc);

alter table public.error_events enable row level security;
revoke all on table public.error_events from anon, authenticated;

create table public.error_alert_sends (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('error', 'digest', 'overflow', 'test')),
  transport text not null default 'resend' check (transport in ('resend', 'mock')),
  fingerprint text check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  event_id uuid references public.error_events (id) on delete set null,
  -- Errors the e-mail covers (this one and the ones counted into it).
  events integer not null default 1 check (events >= 0),
  recipients integer not null default 0 check (recipients between 0 and 10),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  failure text check (char_length(failure) <= 300),
  -- Only for transport 'mock': what would have been sent (to, subject, text).
  message jsonb check (
    message is null or (transport = 'mock' and octet_length(message::text) <= 32000)
  ),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table public.error_alert_sends is
  'E-mails about errors (sent, failed or mocked), the memory of the flood rules. Server only.';

create index error_alert_sends_created_idx
  on public.error_alert_sends (transport, kind, created_at desc);
create index error_alert_sends_fingerprint_idx
  on public.error_alert_sends (transport, fingerprint, created_at desc)
  where fingerprint is not null;

alter table public.error_alert_sends enable row level security;
revoke all on table public.error_alert_sends from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recording one error (server only)
-- ---------------------------------------------------------------------------

-- 'created' with the new id, 'duplicate' (the code is there already) or
-- 'limited' (the browser of this account, or anonymously of this address, sent
-- too many in the last hour; only when limits are given, i.e. for browsers).
-- A browser's copy of a server error that is already recorded (same digest,
-- a few minutes ago) is kept as 'linked' and not e-mailed a second time.
create or replace function public.error_event_record(
  _code text,
  _fingerprint text,
  _source text,
  _page text,
  _message text,
  _action text default null,
  _stack text default null,
  _digest text default null,
  _user_id uuid default null,
  _browser text default null,
  _device text default null,
  _viewport text default null,
  _locale text default null,
  _app_version text default null,
  _ip_hash text default null,
  _transport text default 'resend',
  _limit_user integer default null,
  _limit_anonymous integer default null
)
returns table (event_id uuid, outcome text)
language plpgsql
set search_path = ''
as $$
declare
  _recent integer;
  _id uuid;
  _alert text := 'pending';
begin
  if exists (select 1 from public.error_events e where e.code = _code) then
    return query select null::uuid, 'duplicate'::text;
    return;
  end if;

  if _limit_user is not null or _limit_anonymous is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('error_event:' || coalesce(_user_id::text, 'ip:' || coalesce(_ip_hash, '')), 0)
    );
    if _user_id is not null then
      select count(*) into _recent
      from public.error_events e
      where e.user_id = _user_id
        and e.source in ('boundary', 'onerror', 'unhandledrejection')
        and e.created_at > now() - interval '1 hour';
      if _recent >= coalesce(_limit_user, 2147483647) then
        return query select null::uuid, 'limited'::text;
        return;
      end if;
    else
      select count(*) into _recent
      from public.error_events e
      where e.user_id is null
        and e.ip_hash is not distinct from _ip_hash
        and e.source in ('boundary', 'onerror', 'unhandledrejection')
        and e.created_at > now() - interval '1 hour';
      if _recent >= coalesce(_limit_anonymous, 2147483647) then
        return query select null::uuid, 'limited'::text;
        return;
      end if;
    end if;
  end if;

  if _source = 'boundary' and _digest is not null and exists (
    select 1 from public.error_events e
    where e.digest = _digest
      and e.source in ('render', 'route', 'action', 'middleware')
      and e.created_at > now() - interval '10 minutes'
  ) then
    _alert := 'linked';
  end if;

  insert into public.error_events (
    code, fingerprint, source, page, action, message, stack, digest, user_id, browser,
    device, viewport, locale, app_version, ip_hash, transport, alert
  ) values (
    _code, _fingerprint, _source, _page, nullif(btrim(_action), ''), _message,
    nullif(btrim(_stack), ''), _digest, _user_id, _browser, _device, _viewport, _locale,
    _app_version, _ip_hash, coalesce(_transport, 'resend'), _alert
  )
  on conflict (code) do nothing
  returning id into _id;

  return query select _id, (case when _id is null then 'duplicate' else 'created' end)::text;
end;
$$;

revoke all on function public.error_event_record(text, text, text, text, text, text, text, text, uuid, text, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.error_event_record(text, text, text, text, text, text, text, text, uuid, text, text, text, text, text, text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The decision for one error (server only)
-- ---------------------------------------------------------------------------

-- decision:
--   'send'       e-mail it now (send_id is the row to finish, since_last the
--                occurrences counted into it, day_count the same error in 24 h)
--   'overflow'   the hourly limit is reached: send the one "there are more" e-mail
--   'throttled'  the same error was e-mailed in the last _fingerprint_minutes
--   'digest'     digest mode and an e-mail went out in the last digest_minutes
--   'suppressed' over the hourly limit, "there are more" already sent
--   'off'        no addresses
--   'skip'       unknown event or already decided
-- The counts are per transport, so the tests' mock e-mails never hold back a real one.
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
  _mode := coalesce(_settings ->> 'mode', 'every');
  _digest_minutes := coalesce((_settings ->> 'digest_minutes')::integer, 15);

  select count(*) into _day
  from public.error_events e
  where e.fingerprint = _event.fingerprint and e.created_at > now() - interval '24 hours';

  if jsonb_array_length(_emails) = 0 then
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

-- ---------------------------------------------------------------------------
-- The daily summary (server only, digest mode)
-- ---------------------------------------------------------------------------

-- No row when there is nothing to say (another mode, no addresses, nothing
-- waited). Otherwise the errors that waited since the last summary (at most
-- 7 days back), grouped by fingerprint, most frequent first; they count as
-- reported from now on.
create or replace function public.error_alert_digest_claim(_max_groups integer default 50)
returns table (send_id uuid, recipients jsonb, since timestamptz, total integer, groups jsonb)
language plpgsql
set search_path = ''
as $$
declare
  _settings jsonb;
  _emails jsonb;
  _since timestamptz;
  _total integer;
  _groups jsonb;
  _send uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('error_alerts:resend', 0));

  select s.value into _settings from public.app_settings s where s.key = 'error_alerts';
  if coalesce(_settings ->> 'mode', 'every') <> 'digest' then
    return;
  end if;
  _emails := case when jsonb_typeof(_settings -> 'emails') = 'array'
    then _settings -> 'emails' else '[]'::jsonb end;
  if jsonb_array_length(_emails) = 0 then
    return;
  end if;

  select greatest(max(s.created_at), now() - interval '7 days') into _since
  from public.error_alert_sends s
  where s.transport = 'resend' and s.kind = 'digest';
  _since := coalesce(_since, now() - interval '7 days');

  select count(*) into _total
  from public.error_events e
  where e.transport = 'resend'
    and e.alert in ('throttled', 'digest', 'suppressed')
    and e.created_at > _since;
  if _total = 0 then
    return;
  end if;

  select jsonb_agg(g order by g.n desc, g.last_at desc) into _groups
  from (
    select
      e.fingerprint,
      count(*)::integer as n,
      count(distinct e.user_id)::integer as users,
      min(e.created_at) as first_at,
      max(e.created_at) as last_at,
      (array_agg(e.code order by e.created_at desc))[1] as code,
      (array_agg(e.page order by e.created_at desc))[1] as page,
      (array_agg(e.source order by e.created_at desc))[1] as source,
      (array_agg(e.action order by e.created_at desc))[1] as action,
      (array_agg(e.message order by e.created_at desc))[1] as message
    from public.error_events e
    where e.transport = 'resend'
      and e.alert in ('throttled', 'digest', 'suppressed')
      and e.created_at > _since
    group by e.fingerprint
    order by count(*) desc, max(e.created_at) desc
    limit greatest(1, least(coalesce(_max_groups, 50), 100))
  ) g;

  update public.error_events e
  set alert = 'counted'
  where e.transport = 'resend'
    and e.alert in ('throttled', 'digest', 'suppressed')
    and e.created_at > _since;

  insert into public.error_alert_sends (kind, transport, events, recipients)
  values ('digest', 'resend', _total, jsonb_array_length(_emails))
  returning id into _send;

  return query select _send, _emails, _since, _total, _groups;
end;
$$;

revoke all on function public.error_alert_digest_claim(integer) from public, anon, authenticated;
grant execute on function public.error_alert_digest_claim(integer) to service_role;

-- Errors and their e-mails older than 13 months go, like analytics events.
create or replace function public.purge_error_events()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  _removed integer;
begin
  delete from public.error_alert_sends where created_at < now() - interval '13 months';
  delete from public.error_events where created_at < now() - interval '13 months';
  get diagnostics _removed = row_count;
  return _removed;
end;
$$;

revoke all on function public.purge_error_events() from public, anon, authenticated;
grant execute on function public.purge_error_events() to service_role;
