-- =============================================================================
-- Usage analytics (step 11.1)
--
--   * analytics_events: one row per event from the catalog in
--     src/lib/analytics/events.ts. Only the server writes it (track() and the
--     /api/t route, both through the admin client); there are no client
--     policies at all. Props hold identifiers, enums, numbers and booleans,
--     never content: the catalog's zod schemas enforce that before insert.
--   * app_sessions: time in the app. The browser's heartbeat (once a minute,
--     only while the tab is visible and the person is doing something) extends
--     the open session; after 30 minutes without one a new session starts.
--   * usage_events stays for reading history only: its rows are copied here
--     and nobody can write it any more.
--   * profiles.is_internal: the owner, the demo account and @gradus.local
--     addresses, left out of metrics by default.
--   * purge_analytics(): events and sessions older than 13 months go.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal accounts
-- -----------------------------------------------------------------------------

alter table public.profiles add column is_internal boolean not null default false;

-- Owner or a test address. SECURITY DEFINER: reads auth.users.
create or replace function public.is_internal_account(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(_user_id, 'owner')
      or exists (
        select 1 from auth.users u
        where u.id = _user_id and lower(coalesce(u.email, '')) like '%@gradus.local'
      );
$$;
revoke execute on function public.is_internal_account(uuid) from public, anon, authenticated;

-- Set when the profile is created; a user can never change it. SECURITY
-- INVOKER, because is_client_request() must see the real caller.
create or replace function public.profiles_internal_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if public.is_client_request() then
      new.is_internal := old.is_internal;
    end if;
    return new;
  end if;
  new.is_internal := new.is_internal or public.is_internal_account(new.id);
  return new;
end;
$$;
create trigger profiles_internal_flag
  before insert or update on public.profiles
  for each row execute function public.profiles_internal_flag();

-- The owner role may come after the profile (the first account).
create or replace function public.user_roles_mark_internal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' then
    update public.profiles set is_internal = true where id = new.user_id and not is_internal;
  end if;
  return new;
end;
$$;
revoke execute on function public.user_roles_mark_internal() from public, anon, authenticated;
create trigger user_roles_mark_internal
  after insert on public.user_roles
  for each row execute function public.user_roles_mark_internal();

update public.profiles p set is_internal = true
where not p.is_internal and public.is_internal_account(p.id);

-- -----------------------------------------------------------------------------
-- Sessions
-- -----------------------------------------------------------------------------

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  device text not null default 'desktop' check (device in ('mobile', 'tablet', 'desktop')),
  browser text not null default 'other'
    check (browser in ('chrome', 'safari', 'firefox', 'edge', 'samsung', 'opera', 'other')),
  check (last_seen_at >= started_at)
);
create index app_sessions_user_seen_idx on public.app_sessions (user_id, last_seen_at desc);
create index app_sessions_started_idx on public.app_sessions (started_at);

alter table public.app_sessions enable row level security;
revoke all on public.app_sessions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Events
-- -----------------------------------------------------------------------------

create table public.analytics_events (
  id bigint generated always as identity primary key,
  -- Who did it; null for system events (cron runs, the waitlist, server timings).
  user_id uuid references auth.users (id) on delete cascade,
  -- The workspace owner: the user themselves, or the owner a worker works for.
  owner_id uuid references auth.users (id) on delete set null,
  event text not null check (event ~ '^[a-z][a-z0-9_]{1,63}$'),
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  session_id uuid references public.app_sessions (id) on delete set null,
  device text check (device in ('mobile', 'tablet', 'desktop')),
  locale text check (locale ~ '^[a-z]{2}$'),
  -- The workspace's plan when it happened; 'trial' while the trial runs or has run out.
  plan_key text check (plan_key ~ '^[a-z_]{1,32}$'),
  game_mode text check (game_mode in ('game', 'tool')),
  created_at timestamptz not null default now()
);
create index analytics_events_event_created_idx on public.analytics_events (event, created_at);
create index analytics_events_user_created_idx on public.analytics_events (user_id, created_at);
-- Plan limits (generated contacts, files) are counted per workspace and event.
create index analytics_events_owner_event_created_idx
  on public.analytics_events (owner_id, event, created_at);

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

-- Fills what the server does not pass: workspace owner, plan, mode, language
-- and the open session with its device. Values given explicitly are kept.
create or replace function public.analytics_events_enrich()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _session uuid;
  _device text;
begin
  if new.user_id is null then
    return new;
  end if;

  if new.owner_id is null then
    select w.owner_id into new.owner_id
    from public.workers w
    where w.user_id = new.user_id and w.status = 'active'
    order by w.created_at
    limit 1;
    new.owner_id := coalesce(new.owner_id, new.user_id);
  end if;

  if new.plan_key is null then
    select case when s.status = 'trialing' then 'trial' else s.plan_key end
    into new.plan_key
    from public.subscriptions s
    where s.user_id = new.owner_id;
  end if;

  if new.game_mode is null then
    select p.mode into new.game_mode from public.profiles p where p.id = new.user_id;
  end if;

  if new.locale is null then
    select us.locale into new.locale from public.user_settings us where us.user_id = new.user_id;
  end if;

  if new.session_id is null or new.device is null then
    select s.id, s.device into _session, _device
    from public.app_sessions s
    where s.user_id = new.user_id and s.last_seen_at > now() - interval '30 minutes'
    order by s.last_seen_at desc
    limit 1;
    new.session_id := coalesce(new.session_id, _session);
    new.device := coalesce(new.device, _device);
  end if;

  return new;
end;
$$;
revoke execute on function public.analytics_events_enrich() from public, anon, authenticated;
create trigger analytics_events_enrich
  before insert on public.analytics_events
  for each row execute function public.analytics_events_enrich();

-- -----------------------------------------------------------------------------
-- The browser's batches: rate limit and session in one call
-- -----------------------------------------------------------------------------

-- One row per user: how many units (events or heartbeats) this minute.
create table public.analytics_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0)
);
alter table public.analytics_rate_limits enable row level security;
revoke all on public.analytics_rate_limits from anon, authenticated;

-- Takes up to _units from this minute's allowance and returns how many were
-- granted. The row lock makes parallel batches of one user count correctly.
create or replace function public.analytics_take_quota(_user_id uuid, _units integer, _limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _window timestamptz := date_trunc('minute', now());
  _started timestamptz;
  _used integer;
  _granted integer;
begin
  if _units <= 0 then
    return 0;
  end if;
  insert into public.analytics_rate_limits (user_id, window_start, used)
  values (_user_id, _window, 0)
  on conflict (user_id) do nothing;

  select r.window_start, r.used into _started, _used
  from public.analytics_rate_limits r
  where r.user_id = _user_id
  for update;

  if _started < _window then
    _used := 0;
  end if;
  _granted := greatest(0, least(_units, _limit - _used));
  update public.analytics_rate_limits
  set window_start = _window, used = _used + _granted
  where user_id = _user_id;
  return _granted;
end;
$$;
revoke execute on function public.analytics_take_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.analytics_take_quota(uuid, integer, integer) to service_role;

-- Extends the user's open session, or starts one after 30 minutes without a
-- signal. Returns the session's id.
create or replace function public.touch_app_session(_user_id uuid, _device text, _browser text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  select s.id into _id
  from public.app_sessions s
  where s.user_id = _user_id and s.last_seen_at > now() - interval '30 minutes'
  order by s.last_seen_at desc
  limit 1
  for update;

  if _id is null then
    insert into public.app_sessions (user_id, device, browser)
    values (_user_id, _device, _browser)
    returning id into _id;
  else
    update public.app_sessions set last_seen_at = now() where id = _id;
  end if;
  return _id;
end;
$$;
revoke execute on function public.touch_app_session(uuid, text, text) from public, anon, authenticated;
grant execute on function public.touch_app_session(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- What people generate contacts for: normalised keywords, no link to anyone
-- -----------------------------------------------------------------------------

create table public.generation_keyword_stats (
  day date not null,
  keyword text not null check (char_length(keyword) between 1 and 40),
  searches integer not null default 0 check (searches >= 0),
  primary key (day, keyword)
);
alter table public.generation_keyword_stats enable row level security;
revoke all on public.generation_keyword_stats from anon, authenticated;

create or replace function public.count_generation_keyword(_keyword text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.generation_keyword_stats (day, keyword, searches)
  values ((now() at time zone 'utc')::date, _keyword, 1)
  on conflict (day, keyword) do update set searches = public.generation_keyword_stats.searches + 1;
$$;
revoke execute on function public.count_generation_keyword(text) from public, anon, authenticated;
grant execute on function public.count_generation_keyword(text) to service_role;

-- -----------------------------------------------------------------------------
-- Retention: 13 months
-- -----------------------------------------------------------------------------

create or replace function public.purge_analytics(_before timestamptz default now() - interval '13 months')
returns table (events integer, sessions integer, usage integer, keywords integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _events integer;
  _sessions integer;
  _usage integer;
  _keywords integer;
begin
  delete from public.analytics_events where created_at < _before;
  get diagnostics _events = row_count;
  delete from public.app_sessions where last_seen_at < _before;
  get diagnostics _sessions = row_count;
  delete from public.usage_events where created_at < _before;
  get diagnostics _usage = row_count;
  delete from public.generation_keyword_stats where day < (_before at time zone 'utc')::date;
  get diagnostics _keywords = row_count;
  return query select _events, _sessions, _usage, _keywords;
end;
$$;
revoke execute on function public.purge_analytics(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_analytics(timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- usage_events: history only. Rows move over without free text (Google's and
-- the file check's messages stay behind); the table keeps them for reading.
-- -----------------------------------------------------------------------------

alter table public.analytics_events disable trigger analytics_events_enrich;

insert into public.analytics_events (user_id, owner_id, event, props, created_at)
select
  case
    when (u.metadata ->> 'actor_id') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from auth.users a where a.id = (u.metadata ->> 'actor_id')::uuid)
      then (u.metadata ->> 'actor_id')::uuid
    else u.user_id
  end,
  u.user_id,
  'places_request',
  jsonb_strip_nulls(jsonb_build_object(
    'ok', u.success,
    'saved', u.quantity,
    'page', case when jsonb_typeof(u.metadata -> 'page') = 'number' then (u.metadata ->> 'page')::int end,
    'results', case when jsonb_typeof(u.metadata -> 'results') = 'number' then (u.metadata ->> 'results')::int end,
    'duplicates', case when jsonb_typeof(u.metadata -> 'duplicates') = 'number' then (u.metadata ->> 'duplicates')::int end,
    'http_status', case when jsonb_typeof(u.metadata -> 'http_status') = 'number' then (u.metadata ->> 'http_status')::int end,
    'error_code', case
      when u.success then null
      when u.metadata ->> 'code' ~ '^[A-Za-z0-9_]{1,40}$' then u.metadata ->> 'code'
      else 'notConfigured'
    end
  )),
  u.created_at
from public.usage_events u
where u.event_type = 'generate_contacts';

insert into public.analytics_events (user_id, owner_id, event, props, created_at)
select
  u.user_id,
  u.user_id,
  case when u.success then 'jarvis_file_attached' else 'jarvis_file_rejected' end,
  case
    when u.success then jsonb_strip_nulls(jsonb_build_object(
      'kind', case when u.metadata ->> 'kind' in ('pdf', 'png', 'jpeg', 'txt', 'csv', 'docx', 'xlsx')
                then u.metadata ->> 'kind' end,
      'size_kb', case when jsonb_typeof(u.metadata -> 'size') = 'number'
                   then ceil((u.metadata ->> 'size')::numeric / 1024)::int end
    ))
    else jsonb_build_object(
      'reason', case
        when split_part(u.message, ':', 1) in ('fileType', 'fileTooLarge', 'fileUnreadable', 'fileMissing', 'fileLimit')
          then split_part(u.message, ':', 1)
        else 'fileUnreadable'
      end
    )
  end,
  u.created_at
from public.usage_events u
where u.event_type = 'file_upload';

insert into public.analytics_events (user_id, owner_id, event, props, created_at)
select
  u.user_id,
  u.user_id,
  'jarvis_proactive_reacted',
  jsonb_strip_nulls(jsonb_build_object(
    'reaction', u.metadata ->> 'reaction',
    'kind', u.metadata ->> 'kind',
    'type', case when u.metadata ->> 'type' ~ '^[A-Za-z0-9_]{1,40}$' then u.metadata ->> 'type' end,
    'tasks_created', case when u.metadata ->> 'reaction' = 'accept' then u.quantity end
  )),
  u.created_at
from public.usage_events u
where u.event_type = 'jarvis_proactive'
  and u.metadata ->> 'reaction' in ('shown', 'open', 'close', 'later', 'accept', 'answer')
  and u.metadata ->> 'kind' in ('briefing', 'suggestion', 'question');

insert into public.analytics_events (user_id, owner_id, event, props, created_at)
select
  u.user_id,
  u.user_id,
  'plan_interest_clicked',
  jsonb_build_object('plan', u.metadata ->> 'plan', 'ok', u.success),
  u.created_at
from public.usage_events u
where u.event_type = 'plan_interest'
  and u.metadata ->> 'plan' in ('solo', 'pro', 'team');

alter table public.analytics_events enable trigger analytics_events_enrich;

revoke insert, update, delete on public.usage_events from anon, authenticated, service_role;
