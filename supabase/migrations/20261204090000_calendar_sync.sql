-- =============================================================================
-- 28.10 Calendar: two-way sync with Google and Apple (iCloud)
--
--   * app_settings 'calendar_sync' = { mode: allowlist | everyone,
--     allow_created_before, allow_users }: who may connect, until Google
--     verifies the app. The default row lets in the accounts made before this
--     migration ran; the administration adds others or opens it to everyone
--     (admin_set_app_setting, valid_calendar_sync). calendar_sync_allowed()
--     is the rule; the guard of calendar_connections checks it again.
--   * calendar_connections: one per person and provider, the tokens (Google)
--     or the app-specific password (Apple) encrypted by the server with
--     INTEGRATIONS_ENCRYPTION_KEY; the client reads only the state.
--   * calendar_connection_calendars: the provider's calendars; which ones are
--     read (busy times + shown) and the one written to (one per person).
--   * calendar_external_links: a Gradus event <-> the provider's event (id,
--     etag, origin, the last conflict). Events read from a provider live in
--     calendar_events with source = 'external' in the person's own space.
--   * calendar_sync_outbox: every change of a person's event while they have
--     a calendar to write to, queued by a trigger and sent by the server
--     right after (and by the daily cron). Writes the server makes from the
--     provider (calendar_sync_apply / _forget) set a transaction flag that
--     the trigger respects: no loop.
--   * event_types.video_source 'google_meet', bookings.google_meet_link.
-- Additive: new tables and functions, wider checks, replaced functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The switch
-- -----------------------------------------------------------------------------

create or replace function public.valid_calendar_sync(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_value) = 'object'
    and coalesce(
      (select bool_and(k in ('mode', 'allow_created_before', 'allow_users'))
       from jsonb_object_keys(_value) as k),
      false)
    and (_value ->> 'mode') in ('allowlist', 'everyone')
    and (
      _value -> 'allow_created_before' is null
      or jsonb_typeof(_value -> 'allow_created_before') = 'null'
      or (
        jsonb_typeof(_value -> 'allow_created_before') = 'string'
        and (_value ->> 'allow_created_before')
          ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$'
      )
    )
    and (
      _value -> 'allow_users' is null
      or (
        jsonb_typeof(_value -> 'allow_users') = 'array'
        and jsonb_array_length(_value -> 'allow_users') <= 500
        and coalesce(
          (select bool_and(jsonb_typeof(u) = 'string'
              and (u #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
           from jsonb_array_elements(_value -> 'allow_users') as u),
          true)
        and (select count(distinct u #>> '{}') from jsonb_array_elements(_value -> 'allow_users') as u)
          = jsonb_array_length(_value -> 'allow_users')
      )
    );
$$;

alter table public.app_settings
  add constraint app_settings_calendar_sync_valid
  check (key <> 'calendar_sync' or public.valid_calendar_sync(value));

-- Accounts made before this step went out may connect; others are added by hand.
insert into public.app_settings (key, value)
values (
  'calendar_sync',
  jsonb_build_object(
    'mode', 'allowlist',
    'allow_created_before', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'allow_users', '[]'::jsonb)
)
on conflict (key) do nothing;

-- The rule (src/features/calendar/sync/access.ts calendarSyncAllowed).
create or replace function public.calendar_sync_allowed(_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _setting jsonb;
  _created timestamptz;
  _before timestamptz;
begin
  if _user is null then
    return false;
  end if;
  select s.value into _setting from public.app_settings s where s.key = 'calendar_sync';
  if _setting is null or not public.valid_calendar_sync(_setting) then
    return false;
  end if;
  if _setting ->> 'mode' = 'everyone' then
    return true;
  end if;
  if coalesce(_setting -> 'allow_users', '[]'::jsonb) ? _user::text then
    return true;
  end if;
  if coalesce(jsonb_typeof(_setting -> 'allow_created_before'), 'null') <> 'string' then
    return false;
  end if;
  _before := (_setting ->> 'allow_created_before')::timestamptz;
  select u.created_at into _created from auth.users u where u.id = _user;
  return _created is not null and _created < _before;
end;
$$;
revoke execute on function public.calendar_sync_allowed(uuid) from public, anon, authenticated;
grant execute on function public.calendar_sync_allowed(uuid) to service_role;

-- The same function as in 20261202090000_mcp_server.sql, with 'calendar_sync'.
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

-- -----------------------------------------------------------------------------
-- 2. Connections and their calendars
-- -----------------------------------------------------------------------------

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  -- The person's own, whatever space is active (like calendar_subscriptions).
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'apple')),
  -- The Google account's address or the Apple ID, shown in Settings.
  account_label text check (account_label is null or char_length(account_label) <= 320),
  -- Encrypted JSON (tokens or the app-specific password); never in the client's grants.
  secret_cipher text not null check (char_length(secret_cipher) between 1 and 8000),
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text check (last_error is null or last_error ~ '^[A-Za-z]{1,32}$'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.calendar_connection_calendars (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Google's calendar id or the CalDAV collection's address.
  external_id text not null check (char_length(external_id) between 1 and 2000),
  name text not null check (char_length(name) between 1 and 200),
  is_primary boolean not null default false,
  can_write boolean not null default false,
  -- Busy times and shown in the calendar.
  read boolean not null default false,
  -- The one calendar Gradus writes the person's events to.
  write boolean not null default false,
  -- Google's syncToken or the collection's ctag; server only.
  sync_state text check (sync_state is null or char_length(sync_state) <= 4000),
  synced_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[A-Za-z]{1,32}$'),
  -- Google push channel (events.watch); the token only as SHA-256.
  channel_id text check (channel_id is null or channel_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  channel_resource_id text check (channel_resource_id is null or char_length(channel_resource_id) <= 500),
  channel_token_hash text check (channel_token_hash is null or channel_token_hash ~ '^[0-9a-f]{64}$'),
  channel_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  check (not write or (can_write and read))
);
create unique index calendar_connection_calendars_write_idx
  on public.calendar_connection_calendars (user_id) where write;
create unique index calendar_connection_calendars_channel_idx
  on public.calendar_connection_calendars (channel_id) where channel_id is not null;
create index calendar_connection_calendars_connection_idx
  on public.calendar_connection_calendars (connection_id);
create index calendar_connections_synced_idx
  on public.calendar_connections (last_synced_at nulls first);

create trigger set_updated_at before update on public.calendar_connections
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.calendar_connection_calendars
  for each row execute function public.set_updated_at();

-- A calendar's person is its connection's person.
create or replace function public.calendar_connection_calendars_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.user_id into new.user_id from public.calendar_connections c where c.id = new.connection_id;
  if new.user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_connection_calendars_guard() from public, anon, authenticated;
create trigger calendar_connection_calendars_guard
  before insert or update of connection_id, user_id on public.calendar_connection_calendars
  for each row execute function public.calendar_connection_calendars_guard();

-- Only an account the switch lets in gets a connection, whoever writes it.
create or replace function public.calendar_connections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'calendar_sync_user_fixed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not public.calendar_sync_allowed(new.user_id) then
    raise exception 'calendar_sync_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_connections_guard() from public, anon, authenticated;
create trigger calendar_connections_guard
  before insert or update on public.calendar_connections
  for each row execute function public.calendar_connections_guard();

-- -----------------------------------------------------------------------------
-- 3. Links between events
-- -----------------------------------------------------------------------------

alter table public.calendar_events drop constraint calendar_events_source_check;
alter table public.calendar_events add constraint calendar_events_source_check
  check (source in ('manual', 'contact_move', 'deal_deadline', 'booking', 'external'));

create table public.calendar_external_links (
  event_id uuid primary key references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  calendar_id uuid not null references public.calendar_connection_calendars (id) on delete cascade,
  -- Google's event (instance) id, or the CalDAV address with the instance after '#'.
  external_id text not null check (char_length(external_id) between 1 and 2000),
  -- The series an instance belongs to (Google's recurringEventId, the iCal UID).
  recurring_id text check (recurring_id is null or char_length(recurring_id) <= 2000),
  etag text check (etag is null or char_length(etag) <= 500),
  external_updated_at timestamptz,
  -- Where the event was made: in Gradus (written out) or in the other calendar (read in).
  origin text not null check (origin in ('gradus', 'external')),
  -- "Free" in the other calendar: shown, never busy.
  transparent boolean not null default false,
  -- calendar_events.updated_at the last time both sides agreed.
  synced_at timestamptz,
  -- The last time both sides changed at once, and which one won.
  conflict_at timestamptz,
  conflict_winner text check (conflict_winner is null or conflict_winner in ('gradus', 'external')),
  created_at timestamptz not null default now(),
  unique (calendar_id, external_id)
);
create index calendar_external_links_user_idx on public.calendar_external_links (user_id);
create index calendar_external_links_series_idx
  on public.calendar_external_links (calendar_id, recurring_id) where recurring_id is not null;
create index calendar_external_links_connection_idx on public.calendar_external_links (connection_id);

create table public.calendar_sync_outbox (
  id bigint generated always as identity primary key,
  -- The person whose calendar gets the change.
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  -- For a delete: the link as it was (the event and the link are gone by then).
  link jsonb check (link is null or jsonb_typeof(link) = 'object'),
  attempts integer not null default 0,
  last_error text check (last_error is null or last_error ~ '^[A-Za-z]{1,32}$'),
  -- Taken by a server run until then (another run leaves it alone).
  claimed_until timestamptz,
  created_at timestamptz not null default now()
);
create index calendar_sync_outbox_user_idx on public.calendar_sync_outbox (user_id, id);

-- Row protection: each person reads the state of their own; nobody writes.
alter table public.calendar_connections enable row level security;
alter table public.calendar_connection_calendars enable row level security;
alter table public.calendar_external_links enable row level security;
alter table public.calendar_sync_outbox enable row level security;

create policy calendar_connections_select on public.calendar_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy calendar_connection_calendars_select on public.calendar_connection_calendars
  for select to authenticated using (user_id = (select auth.uid()));
create policy calendar_external_links_select on public.calendar_external_links for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.calendar_connections from anon, authenticated;
revoke all on public.calendar_connection_calendars from anon, authenticated;
revoke all on public.calendar_external_links from anon, authenticated;
revoke all on public.calendar_sync_outbox from anon, authenticated;
grant select (id, user_id, provider, account_label, status, last_error, last_synced_at, created_at)
  on public.calendar_connections to authenticated;
grant select (id, connection_id, user_id, name, is_primary, can_write, read, write, synced_at, last_error)
  on public.calendar_connection_calendars to authenticated;
grant select (event_id, user_id, connection_id, origin, conflict_at, conflict_winner)
  on public.calendar_external_links to authenticated;

-- -----------------------------------------------------------------------------
-- 4. The outbox: a person's changed event goes to their calendar
-- -----------------------------------------------------------------------------

create or replace function public.calendar_events_sync_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.calendar_events;
  _person uuid;
  _link public.calendar_external_links;
begin
  -- What the server writes from the other calendar never goes back to it.
  if coalesce(current_setting('gradus.calendar_import', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  _row := case when tg_op = 'DELETE' then old else new end;

  select * into _link from public.calendar_external_links l where l.event_id = _row.id;

  if tg_op = 'DELETE' then
    -- Not while the account itself is being deleted (its rows go with it).
    if _link.event_id is not null
       and exists (select 1 from auth.users u where u.id = _link.user_id) then
      insert into public.calendar_sync_outbox (user_id, event_id, op, link)
      values (_link.user_id, old.id, 'delete', jsonb_build_object(
        'calendar_id', _link.calendar_id, 'connection_id', _link.connection_id,
        'external_id', _link.external_id, 'recurring_id', _link.recurring_id,
        'etag', _link.etag, 'origin', _link.origin));
    end if;
    return old;
  end if;

  if _row.is_demo or _row.source = 'deal_deadline' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.description is not distinct from old.description
     and new.location is not distinct from old.location
     and new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at
     and new.all_day is not distinct from old.all_day then
    return new;
  end if;

  if _link.event_id is not null then
    _person := _link.user_id;
  else
    _person := coalesce(_row.actor_id, _row.user_id);
    -- Only for someone with a calendar to write to.
    if not exists (
      select 1 from public.calendar_connection_calendars c
      join public.calendar_connections k on k.id = c.connection_id
      where c.user_id = _person and c.write and k.status = 'active'
    ) then
      return new;
    end if;
  end if;
  -- One waiting change per event is enough: it sends the event as it is then.
  if not exists (
    select 1 from public.calendar_sync_outbox o
    where o.event_id = _row.id and o.op = 'upsert' and o.claimed_until is null
  ) then
    insert into public.calendar_sync_outbox (user_id, event_id, op) values (_person, _row.id, 'upsert');
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_events_sync_enqueue() from public, anon, authenticated;

create trigger calendar_events_sync_enqueue
  after insert or update on public.calendar_events
  for each row execute function public.calendar_events_sync_enqueue();
-- Before the delete, while the link (cascading with the event) is still there.
create trigger calendar_events_sync_enqueue_delete
  before delete on public.calendar_events
  for each row execute function public.calendar_events_sync_enqueue();

-- A server run takes up to _limit of a person's waiting changes for two
-- minutes: the oldest of each event, never one whose event another run holds.
create or replace function public.calendar_sync_outbox_claim(_user uuid, _limit integer default 50)
returns setof public.calendar_sync_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.calendar_sync_outbox o set claimed_until = now() + interval '2 minutes'
  where o.id in (
    select x.id from public.calendar_sync_outbox x
    where x.user_id = _user
      and (x.claimed_until is null or x.claimed_until < now())
      and not exists (
        select 1 from public.calendar_sync_outbox y
        where y.event_id = x.event_id and y.id <> x.id
          and (y.id < x.id or (y.claimed_until is not null and y.claimed_until >= now())))
    order by x.id
    limit greatest(1, least(coalesce(_limit, 50), 200))
    for update skip locked
  )
  returning o.*;
end;
$$;
revoke execute on function public.calendar_sync_outbox_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.calendar_sync_outbox_claim(uuid, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 5. The server writes what came from the other calendar
-- -----------------------------------------------------------------------------

/**
 * One calendar's changes, in one transaction and without echo:
 *   _rows: [{ external_id, recurring_id, etag, external_updated_at, title,
 *             description, location, starts_at, ends_at, all_day, transparent,
 *             conflict ('gradus' | 'external' | null) }]
 *     a known link updates its event (a booking's meeting keeps its time:
 *     the scheduler moves it), an unknown one makes an event in the
 *     person's own space;
 *   _deletes: external ids gone from the calendar; _delete_series: whole
 *     series. An event read in goes with them; an event made in Gradus
 *     goes too, a booked meeting only loses its link.
 * Returns { inserted, updated, deleted }.
 */
create or replace function public.calendar_sync_apply(
  _calendar uuid,
  _rows jsonb default '[]'::jsonb,
  _deletes text[] default '{}',
  _delete_series text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _cal public.calendar_connection_calendars;
  _item jsonb;
  _link public.calendar_external_links;
  _event uuid;
  _source text;
  _stamp timestamptz;
  _inserted integer := 0;
  _updated integer := 0;
  _deleted integer := 0;
  _n integer;
  _title text;
begin
  perform set_config('gradus.calendar_import', 'on', true);
  select * into _cal from public.calendar_connection_calendars c where c.id = _calendar;
  if _cal.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  for _item in select * from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) loop
    _title := left(coalesce(nullif(btrim(_item ->> 'title'), ''), '—'), 200);
    select * into _link from public.calendar_external_links l
    where l.calendar_id = _calendar and l.external_id = _item ->> 'external_id';
    if _link.event_id is not null then
      select e.source into _source from public.calendar_events e where e.id = _link.event_id;
      if _source is distinct from 'booking' then
        update public.calendar_events set
          title = _title,
          description = left(nullif(_item ->> 'description', ''), 5000),
          location = left(nullif(_item ->> 'location', ''), 500),
          starts_at = (_item ->> 'starts_at')::timestamptz,
          ends_at = greatest((_item ->> 'ends_at')::timestamptz, (_item ->> 'starts_at')::timestamptz),
          all_day = coalesce((_item ->> 'all_day')::boolean, false)
        where id = _link.event_id
        returning updated_at into _stamp;
      else
        select e.updated_at into _stamp from public.calendar_events e where e.id = _link.event_id;
      end if;
      update public.calendar_external_links set
        etag = left(_item ->> 'etag', 500),
        external_updated_at = (_item ->> 'external_updated_at')::timestamptz,
        recurring_id = left(_item ->> 'recurring_id', 2000),
        transparent = coalesce((_item ->> 'transparent')::boolean, false),
        synced_at = _stamp,
        conflict_at = case when _item ->> 'conflict' is not null then now() else conflict_at end,
        conflict_winner = coalesce(_item ->> 'conflict', conflict_winner)
      where event_id = _link.event_id;
      -- What waited to go out is answered by this (the newer side won).
      delete from public.calendar_sync_outbox o
      where o.event_id = _link.event_id and o.op = 'upsert';
      _updated := _updated + 1;
    else
      insert into public.calendar_events (
        user_id, actor_id, title, kind, starts_at, ends_at, all_day, description, location, source)
      values (
        _cal.user_id, _cal.user_id, _title, 'meeting',
        (_item ->> 'starts_at')::timestamptz,
        greatest((_item ->> 'ends_at')::timestamptz, (_item ->> 'starts_at')::timestamptz),
        coalesce((_item ->> 'all_day')::boolean, false),
        left(nullif(_item ->> 'description', ''), 5000),
        left(nullif(_item ->> 'location', ''), 500),
        'external')
      returning id, updated_at into _event, _stamp;
      insert into public.calendar_external_links (
        event_id, user_id, connection_id, calendar_id, external_id, recurring_id, etag,
        external_updated_at, origin, transparent, synced_at)
      values (
        _event, _cal.user_id, _cal.connection_id, _calendar, _item ->> 'external_id',
        left(_item ->> 'recurring_id', 2000), left(_item ->> 'etag', 500),
        (_item ->> 'external_updated_at')::timestamptz, 'external',
        coalesce((_item ->> 'transparent')::boolean, false), _stamp);
      _inserted := _inserted + 1;
    end if;
  end loop;

  -- Gone from the other calendar.
  with gone as (
    select l.event_id, l.origin, e.source
    from public.calendar_external_links l
    join public.calendar_events e on e.id = l.event_id
    where l.calendar_id = _calendar
      and (l.external_id = any (coalesce(_deletes, '{}'))
        or l.recurring_id = any (coalesce(_delete_series, '{}')))
  ), dropped_links as (
    delete from public.calendar_external_links l
    using gone g
    where l.event_id = g.event_id and g.source = 'booking'
    returning l.event_id
  ), dropped_events as (
    delete from public.calendar_events e
    using gone g
    where e.id = g.event_id and g.source is distinct from 'booking'
    returning e.id
  )
  select (select count(*) from dropped_events) into _n;
  _deleted := _n;

  update public.calendar_connection_calendars set synced_at = now(), last_error = null
  where id = _calendar;
  return jsonb_build_object('inserted', _inserted, 'updated', _updated, 'deleted', _deleted);
end;
$$;
revoke execute on function public.calendar_sync_apply(uuid, jsonb, text[], text[]) from public, anon, authenticated;
grant execute on function public.calendar_sync_apply(uuid, jsonb, text[], text[]) to service_role;

/**
 * A calendar (or a whole connection) stops being read: the events read in
 * from it leave Gradus, the person's own events stay and only lose their
 * link. Nothing goes back to the other calendar. `_keep_written` keeps the
 * links of events written to it (a calendar still written to).
 */
create or replace function public.calendar_sync_forget(
  _connection uuid,
  _calendar uuid default null,
  _keep_written boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _n integer;
begin
  perform set_config('gradus.calendar_import', 'on', true);
  delete from public.calendar_events e
  using public.calendar_external_links l
  where l.event_id = e.id and l.connection_id = _connection
    and (_calendar is null or l.calendar_id = _calendar)
    and l.origin = 'external';
  get diagnostics _n = row_count;
  if not _keep_written then
    delete from public.calendar_external_links l
    where l.connection_id = _connection and (_calendar is null or l.calendar_id = _calendar);
    delete from public.calendar_sync_outbox o
    where o.link ->> 'connection_id' = _connection::text
      and (_calendar is null or o.link ->> 'calendar_id' = _calendar::text);
  end if;
  return _n;
end;
$$;
revoke execute on function public.calendar_sync_forget(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.calendar_sync_forget(uuid, uuid, boolean) to service_role;

-- A calendar read in is not "planned by hand": no line in the activity log.
create or replace function public.activity_calendar_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo or new.source in ('deal_deadline', 'external') then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'scheduled', 'event', new.id,
    jsonb_build_object('title', public.activity_title(new.title), 'kind', new.kind::text,
      'at', new.starts_at));
  return new;
end;
$$;

-- Events read in from another calendar are no achievement (the same function as in
-- 20261107120000_tutorial.sql, without source 'external').
create or replace function public.game_metrics(_uid uuid, _tz text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _path text;
  _this_month date := date_trunc('month', (now() at time zone _tz)::date)::date;
  _chapters integer;
  _chapters_done integer;
begin
  select p.path_key into _path from public.profiles p where p.id = _uid;

  with path as (
    select pm.chapter, pm.key from public.path_milestones pm where pm.path_key = _path
  ),
  done as (
    select distinct tpl.key
    from public.milestones m
    join public.path_milestones tpl on tpl.id = m.template_id
    where m.user_id = _uid and m.completed_at is not null and not m.is_demo
  ),
  chapters as (
    select path.chapter, bool_and(path.key in (select key from done)) as complete
    from path group by path.chapter
  )
  select count(*)::integer, (count(*) filter (where complete))::integer
  into _chapters, _chapters_done
  from chapters;

  return jsonb_build_object(
    'tasks_done', (select count(*) from public.tasks where user_id = _uid and status = 'done' and not is_demo),
    'milestones_completed',
      (select count(*) from public.milestones where user_id = _uid and completed_at is not null and not is_demo),
    'contacts', (select count(*) from public.contacts where user_id = _uid and not is_demo),
    'call_seconds', (
      select coalesce(sum(extract(epoch from public.prospecting_effective_end(s) - s.started_at)), 0)::bigint
      from public.prospecting_segments s
      where s.user_id = _uid and coalesce(s.actor_id, _uid) = _uid
    ),
    'deals_won', (select count(*) from public.deals where user_id = _uid and won_at is not null and not is_demo),
    'streak', (select g.streak from public.game_streak(_uid, _tz) g),
    'task_depth', (
      with recursive tree as (
        select t.id, 1 as depth from public.tasks t
        where t.user_id = _uid and t.parent_task_id is null and not t.is_demo
        union all
        select t.id, tree.depth + 1 from public.tasks t
        join tree on t.parent_task_id = tree.id
        where tree.depth < 10
      )
      select coalesce(max(depth), 0) from tree
    ),
    'calendar_events', (select count(*) from public.calendar_events where user_id = _uid and not is_demo and source <> 'external'),
    'meetings', (select count(*) from public.calendar_events where user_id = _uid and kind = 'meeting' and not is_demo and source <> 'external'),
    -- A finished month with both income and expenses recorded.
    'finance_complete_months', (
      select count(*) from (
        select date_trunc('month', t.occurred_on) as month
        from public.transactions t
        where t.user_id = _uid and t.occurred_on < _this_month
        group by 1
        having bool_or(t.type = 'income') and bool_or(t.type = 'expense')
      ) months
    ),
    'workers', (select count(*) from public.workers where owner_id = _uid and user_id is not null),
    'chapters_completed', coalesce(_chapters_done, 0),
    'path_completed', case when _chapters > 0 and _chapters_done = _chapters then 1 else 0 end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Google Meet for a meeting type
-- -----------------------------------------------------------------------------

alter table public.event_types drop constraint event_types_video_source_check;
alter table public.event_types add constraint event_types_video_source_check
  check (video_source in ('profile', 'jitsi', 'google_meet'));

alter table public.bookings
  -- The Meet conference Google made for this meeting (written by the server).
  add column google_meet_link text check (
    google_meet_link is null
    or (char_length(google_meet_link) <= 500 and google_meet_link ~ '^https://meet\.google\.com/[A-Za-z0-9/_-]+$'));
grant select (google_meet_link) on public.bookings to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('calendar_sync_connected', 'calendar', true),
  ('calendar_sync_disconnected', 'calendar', true),
  ('calendar_sync_calendars_saved', 'calendar', false),
  ('calendar_sync_run', 'calendar', false),
  ('calendar_sync_conflict', 'calendar', false)
on conflict (event) do nothing;
