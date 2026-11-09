-- =============================================================================
-- 24.3 Scheduler: meeting types, availability, calendar subscriptions
--   * scheduler_profiles: one per person and space (the owner in their own
--     space, a worker with "scheduler: own" in the company's), with a handle
--     unique across Gradus for the public link (24.4), the name, a headline,
--     a bio, the time zone the availability is in and a permanent video link
--     (Google Meet, Teams, Zoom, Jitsi). The photo comes from the profile and
--     "no branding" from the space owner's add-on; neither is stored here.
--   * event_types: what a guest can book (length, place, buffers, notice,
--     horizon, a day's maximum, slot step, questions, reminders, approval, a
--     deal to open in a stage). Free (Solo) holds one active type; Pro and
--     Team any number (scheduler_types in the plan catalog's limits).
--   * availability_rules (weekly hours, several intervals a day; optionally
--     only for one meeting type) and availability_overrides (a date with other
--     hours or blocked as a whole: a holiday).
--   * calendar_subscriptions: secret ICS links of the person's other
--     calendars, encrypted by the server (INTEGRATIONS_ENCRYPTION_KEY), with
--     the busy intervals of the next 60 days as a cache. Only the server adds
--     one or refreshes it; the client reads its own (never the link), renames,
--     recolours, hides and removes.
--   * calendar_feed_tokens: the secret of the account's own ICS feed (only its
--     SHA-256), server only.
--   * bookings: what guests booked (24.4 writes them, only the server). The
--     host reads their own, the space's owner every one of the space.
--   * Rights: scheduler.view and scheduler.own in the permission catalog. Row
--     level security by the row's space and the person: a worker only their
--     own, the space's owner reads everyone's and may switch a type off.
-- Additive only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rights
-- -----------------------------------------------------------------------------

create or replace function public.permission_catalog()
returns table (section text, action text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('milestones', 'view', 'view'),
    ('milestones', 'update', 'write'),
    ('contacts', 'view', 'view'),
    ('contacts', 'create', 'write'),
    ('contacts', 'update', 'write'),
    ('contacts', 'delete', 'write'),
    ('contacts', 'export', 'read'),
    ('contacts', 'generate', 'write'),
    ('pipeline', 'view', 'view'),
    ('pipeline', 'view_all', 'view'),
    ('pipeline', 'see_amounts', 'view'),
    ('pipeline', 'create', 'write'),
    ('pipeline', 'update', 'write'),
    ('pipeline', 'change_stage', 'write'),
    ('pipeline', 'change_amount', 'write'),
    ('pipeline', 'delete', 'write'),
    ('tasks', 'view', 'view'),
    ('tasks', 'view_all', 'view'),
    ('tasks', 'create', 'write'),
    ('tasks', 'update', 'write'),
    ('tasks', 'assign_others', 'write'),
    ('tasks', 'delete', 'write'),
    ('cold_calling', 'view', 'view'),
    ('cold_calling', 'call', 'write'),
    ('cold_calling', 'view_others_stats', 'read'),
    ('calendar', 'view', 'view'),
    ('calendar', 'view_all', 'view'),
    ('calendar', 'create', 'write'),
    ('calendar', 'update', 'write'),
    ('scheduler', 'view', 'view'),
    ('scheduler', 'own', 'write'),
    ('finance', 'view', 'view'),
    ('finance', 'summaries', 'view'),
    ('finance', 'write', 'write'),
    ('invoices', 'view', 'view'),
    ('invoices', 'issue', 'write'),
    ('company', 'view', 'view'),
    ('company', 'view_all', 'read'),
    ('company', 'update', 'write')
  ) as c (section, action, kind);
$$;

-- -----------------------------------------------------------------------------
-- 2. The plan limit: active meeting types per person
-- -----------------------------------------------------------------------------

-- Beta and other plans outside the catalog, and catalog versions published
-- before 24.3 (their limits have no scheduler_types): null = no limit.
alter table public.plans
  add column scheduler_types_limit integer
    check (scheduler_types_limit is null or scheduler_types_limit >= 0);
update public.plans set scheduler_types_limit = 1 where key = 'solo';

-- The catalog accepts the new limit (empty = no limit); older versions without it stay valid.
create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'included_workers', 'limits',
      'features', 'recommended', 'order']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb',
      'scheduler_types']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    when not public.plan_catalog_money_ok(_p -> 'monthly') then false
    when not public.plan_catalog_money_ok(_p -> 'yearly') then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'yearly')
      and (select bool_and(coalesce(
             public.plan_catalog_number(_p -> 'yearly' -> c)
               <= 12 * public.plan_catalog_number(_p -> 'monthly' -> c), false))
           from jsonb_object_keys(_p -> 'monthly') as c)
      and (jsonb_typeof(_p -> 'per_worker') = 'null'
        or (public.plan_catalog_money_ok(_p -> 'per_worker')
          and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'per_worker')))
      and (not (_p ? 'included_workers') or public.plan_catalog_count_ok(_p -> 'included_workers', false))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and (not (_p -> 'limits' ? 'scheduler_types')
        or public.plan_catalog_count_ok(_p -> 'limits' -> 'scheduler_types', true))
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- How many meeting types a person of the space may have active: the space
-- owner's plan in the published catalog, else (beta, older versions) the
-- plans table. Null = no limit. For the server and the triggers.
create or replace function public.scheduler_types_limit_of(_space uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _key text;
  _limits jsonb;
begin
  select s.plan_key into _key from public.subscriptions s where s.user_id = _space;
  if _key is null then
    select p.key into _key from public.plans p where p.is_default limit 1;
  end if;
  _limits := public.published_plan(_key) -> 'limits';
  if _limits is not null and _limits ? 'scheduler_types' then
    return case when jsonb_typeof(_limits -> 'scheduler_types') = 'number'
      then (_limits ->> 'scheduler_types')::integer end;
  end if;
  return (select p.scheduler_types_limit from public.plans p where p.key = _key);
end;
$$;
revoke execute on function public.scheduler_types_limit_of(uuid) from public, anon, authenticated;
grant execute on function public.scheduler_types_limit_of(uuid) to service_role;

-- The same for the app: only for a space the caller belongs to.
create or replace function public.scheduler_types_limit(_space uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_space_member(_space) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public.scheduler_types_limit_of(_space);
end;
$$;
revoke execute on function public.scheduler_types_limit(uuid) from public, anon;
grant execute on function public.scheduler_types_limit(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Checks shared by the tables
-- -----------------------------------------------------------------------------

-- A handle of the public link /s/<handle>: 3–30 of a–z, 0–9 and inner single
-- hyphens; a few words stay with the application.
create or replace function public.scheduler_handle_ok(_handle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    _handle ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    and position('--' in _handle) = 0
    and _handle not in (
      'admin', 'api', 'app', 'gradus', 'help', 'login', 'www', 'support', 'static', 'public',
      'settings', 'booking', 'bookings', 'scheduler', 'cancel', 'manage'),
    false);
$$;

-- A placeholder until the person picks one (the setup always picks one).
create or replace function public.scheduler_random_handle()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'u' || substr(md5(gen_random_uuid()::text), 1, 9);
$$;

create or replace function public.scheduler_tone_ok(_tone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(_tone in ('neutral', 'violet', 'teal', 'gold', 'green', 'pink'), false);
$$;

-- Questions of a meeting type: [{key, label, type, required, options}], at
-- most 20, keys unique; name and e-mail are always asked and required. The
-- four built-in keys (name, email, phone, company) may go without a label
-- (the booking page names them in the guest's language).
create or replace function public.scheduler_questions_valid(_questions jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _q jsonb;
  _key text;
  _type text;
  _keys text[] := '{}';
  _builtin constant text[] := array['name', 'email', 'phone', 'company'];
begin
  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) > 20 then
    return false;
  end if;
  for _q in select * from jsonb_array_elements(_questions) loop
    if jsonb_typeof(_q) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(_q) k
               where k not in ('key', 'label', 'type', 'required', 'options')) then
      return false;
    end if;
    _key := _q ->> 'key';
    _type := _q ->> 'type';
    if _key is null or _key !~ '^[a-z][a-z0-9_]{0,39}$' or _key = any (_keys) then return false; end if;
    _keys := _keys || _key;
    if _type is null or _type not in ('text', 'textarea', 'phone', 'email', 'select', 'checkbox') then
      return false;
    end if;
    if jsonb_typeof(_q -> 'required') is distinct from 'boolean' then return false; end if;
    if jsonb_typeof(_q -> 'label') = 'string' then
      if char_length(btrim(_q ->> 'label')) not between 1 and 200 then return false; end if;
    elsif coalesce(jsonb_typeof(_q -> 'label'), 'null') = 'null' then
      if not (_key = any (_builtin)) then return false; end if;
    else
      return false;
    end if;
    if _type = 'select' then
      if jsonb_typeof(_q -> 'options') is distinct from 'array'
         or jsonb_array_length(_q -> 'options') not between 1 and 30
         or exists (select 1 from jsonb_array_elements(_q -> 'options') o
                    where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 100) then
        return false;
      end if;
    elsif coalesce(jsonb_typeof(_q -> 'options'), 'null') <> 'null' then
      return false;
    end if;
    if _key = 'name' and (_type <> 'text' or (_q ->> 'required')::boolean is not true) then return false; end if;
    if _key = 'email' and (_type <> 'email' or (_q ->> 'required')::boolean is not true) then return false; end if;
    if _key = 'phone' and _type <> 'phone' then return false; end if;
  end loop;
  return 'name' = any (_keys) and 'email' = any (_keys);
end;
$$;

-- Reminders of a meeting type: at most 5, each minutes before the start
-- (5 minutes to 7 days) by e-mail, no two at the same moment.
create or replace function public.scheduler_reminders_valid(_reminders jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(_reminders) = 'array'
    and jsonb_array_length(_reminders) <= 5
    and (select coalesce(bool_and(
           jsonb_typeof(r) = 'object'
           and (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['channel', 'offset_minutes']
           and jsonb_typeof(r -> 'offset_minutes') = 'number'
           and (r ->> 'offset_minutes') ~ '^\d+$'
           and (r ->> 'offset_minutes')::integer between 5 and 10080
           and r ->> 'channel' = 'email'), true)
         from jsonb_array_elements(_reminders) r)
    and (select count(distinct r ->> 'offset_minutes') = count(*) from jsonb_array_elements(_reminders) r),
    false);
$$;

create or replace function public.scheduler_time_zone_ok(_zone text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if _zone is null or char_length(_zone) not between 1 and 64 then
    return false;
  end if;
  perform now() at time zone _zone;
  return true;
exception when others then
  return false;
end;
$$;

grant execute on function public.scheduler_handle_ok(text), public.scheduler_tone_ok(text),
  public.scheduler_questions_valid(jsonb), public.scheduler_reminders_valid(jsonb),
  public.scheduler_time_zone_ok(text), public.scheduler_random_handle()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------

create table public.scheduler_profiles (
  id uuid primary key default gen_random_uuid(),
  -- The person whose scheduler it is; their own account (the session's, set by the guard).
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The space it belongs to: their own, or the company they work for.
  space_id uuid not null references auth.users (id) on delete cascade,
  handle text not null default public.scheduler_random_handle()
    check (public.scheduler_handle_ok(handle)),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  headline text check (headline is null or char_length(headline) <= 120),
  bio text check (bio is null or char_length(bio) <= 1000),
  time_zone text not null default 'Europe/Prague' check (public.scheduler_time_zone_ok(time_zone)),
  video_link text check (
    video_link is null or (char_length(video_link) <= 500 and video_link ~ '^https://[^\s/?#]+\.[^\s]+$')),
  -- The setup guide was finished (or skipped) once.
  setup_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, space_id)
);
create unique index scheduler_profiles_handle_idx on public.scheduler_profiles (lower(handle));
create index scheduler_profiles_space_idx on public.scheduler_profiles (space_id);

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.scheduler_profiles (id) on delete cascade,
  -- Copied from the profile by event_types_sync; the client never picks them.
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$' and position('--' in slug) = 0),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 2000),
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  location_kind text not null default 'video'
    check (location_kind in ('video', 'phone', 'in_person', 'custom')),
  location_text text check (location_text is null or char_length(location_text) <= 300),
  color text not null default 'violet' check (public.scheduler_tone_ok(color)),
  active boolean not null default true,
  position integer not null default 0 check (position between 0 and 10000),
  requires_approval boolean not null default false,
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min integer not null default 0 check (buffer_after_min between 0 and 240),
  min_notice_hours integer not null default 4 check (min_notice_hours between 0 and 720),
  -- The busy times of subscribed calendars reach 60 days ahead, so does booking.
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 60),
  max_per_day integer check (max_per_day is null or max_per_day between 1 and 100),
  slot_step_min integer not null default 30 check (slot_step_min in (15, 30, 60)),
  -- Own weekly hours (availability_rules with this type) instead of the profile's.
  custom_availability boolean not null default false,
  questions jsonb not null default '[
    {"key": "name", "label": null, "type": "text", "required": true},
    {"key": "email", "label": null, "type": "email", "required": true},
    {"key": "phone", "label": null, "type": "phone", "required": true},
    {"key": "company", "label": null, "type": "text", "required": false}
  ]'::jsonb check (public.scheduler_questions_valid(questions)),
  -- A deal opened in this stage of the space for a confirmed booking (24.4).
  deal_stage_id uuid,
  reminders jsonb not null default '[
    {"offset_minutes": 1440, "channel": "email"},
    {"offset_minutes": 60, "channel": "email"}
  ]'::jsonb check (public.scheduler_reminders_valid(reminders)),
  confirmation_note text check (confirmation_note is null or char_length(confirmation_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, slug),
  constraint event_types_location_text check (
    location_kind in ('video', 'phone') or location_text is not null),
  constraint event_types_deal_stage_fkey foreign key (deal_stage_id, space_id)
    references public.pipeline_stages (id, user_id) on delete set null (deal_stage_id)
);
create index event_types_profile_idx on public.event_types (profile_id, position);
create index event_types_space_idx on public.event_types (space_id);
create index event_types_user_idx on public.event_types (user_id);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.scheduler_profiles (id) on delete cascade,
  -- Null = the profile's weekly hours; else the hours of one meeting type.
  event_type_id uuid references public.event_types (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday (Postgres dow, JavaScript getDay).
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  -- 24:00 ends the day.
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint availability_rules_order check (start_time < end_time)
);
create index availability_rules_profile_idx on public.availability_rules (profile_id, event_type_id, weekday);
create index availability_rules_space_idx on public.availability_rules (space_id);
create index availability_rules_user_idx on public.availability_rules (user_id);

create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.scheduler_profiles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  -- Both empty = the whole day blocked; else these hours instead of the week's.
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  constraint availability_overrides_pair check ((start_time is null) = (end_time is null)),
  constraint availability_overrides_order check (start_time is null or start_time < end_time)
);
create index availability_overrides_profile_idx on public.availability_overrides (profile_id, date);
create index availability_overrides_space_idx on public.availability_overrides (space_id);
create index availability_overrides_user_idx on public.availability_overrides (user_id);

create table public.calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- The account's own; a person's other calendars, whatever space is active.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default 'neutral' check (public.scheduler_tone_ok(color)),
  -- The secret link, encrypted by the server; never in the client's grants.
  url_cipher text not null check (char_length(url_cipher) <= 4000),
  -- Only the host name, shown in place of the link.
  url_hint text not null check (char_length(url_hint) between 1 and 255),
  show_in_calendar boolean not null default true,
  last_fetched_at timestamptz,
  last_status text not null default 'pending' check (last_status in ('pending', 'ok', 'error')),
  last_error text check (last_error is null or last_error ~ '^[A-Za-z]{1,32}$'),
  -- [{"start": ISO, "end": ISO, "allDay"?: true}] for the next 60 days.
  busy jsonb not null default '[]'::jsonb check (jsonb_typeof(busy) = 'array'),
  busy_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_subscriptions_user_idx on public.calendar_subscriptions (user_id, created_at);
create index calendar_subscriptions_fetched_idx on public.calendar_subscriptions (last_fetched_at nulls first);

create table public.calendar_feed_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- SHA-256 of the secret in the feed's address, hex; the secret itself is shown once.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid references public.event_types (id) on delete set null,
  host_user_id uuid references auth.users (id) on delete set null,
  space_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  guest_name text not null check (char_length(btrim(guest_name)) between 1 and 120),
  guest_email text not null check (char_length(guest_email) between 3 and 254 and guest_email like '%_@_%'),
  guest_phone text check (guest_phone is null or guest_phone ~ '^\+[1-9][0-9]{6,14}$'),
  guest_company text check (guest_company is null or char_length(guest_company) <= 160),
  guest_time_zone text check (guest_time_zone is null or char_length(guest_time_zone) <= 64),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status text not null default 'held'
    check (status in ('held', 'pending', 'confirmed', 'cancelled', 'declined', 'rescheduled')),
  hold_expires_at timestamptz,
  manage_token_hash text unique check (manage_token_hash is null or manage_token_hash ~ '^[0-9a-f]{64}$'),
  contact_id uuid references public.contacts (id) on delete set null,
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  reminder_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(reminder_ids) = 'array'),
  cancelled_by text check (cancelled_by is null or cancelled_by in ('host', 'guest')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_order check (ends_at > starts_at)
);
-- Two guests never get the same time of one host.
create unique index bookings_host_slot_idx on public.bookings (host_user_id, starts_at)
  where status in ('held', 'pending', 'confirmed');
create index bookings_space_idx on public.bookings (space_id, starts_at);
create index bookings_host_idx on public.bookings (host_user_id, starts_at);
create index bookings_type_idx on public.bookings (event_type_id, starts_at);

create trigger set_updated_at before update on public.scheduler_profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.event_types
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.calendar_subscriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- Read-only after the trial (and over the plan's limits), like the rest of the space.
create trigger scheduler_profiles_writable
  before insert or update or delete on public.scheduler_profiles
  for each row execute function public.enforce_workspace_writable('space_id');
create trigger event_types_writable
  before insert or update or delete on public.event_types
  for each row execute function public.enforce_workspace_writable('space_id');
create trigger availability_rules_writable
  before insert or update or delete on public.availability_rules
  for each row execute function public.enforce_workspace_writable('space_id');
create trigger availability_overrides_writable
  before insert or update or delete on public.availability_overrides
  for each row execute function public.enforce_workspace_writable('space_id');

-- -----------------------------------------------------------------------------
-- 5. Guards
-- -----------------------------------------------------------------------------

-- A profile is the signed-in person's and stays with its person and space.
create or replace function public.scheduler_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.space_id is distinct from old.space_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.scheduler_profiles_guard() from public, anon, authenticated;
create trigger scheduler_profiles_guard before insert or update on public.scheduler_profiles
  for each row execute function public.scheduler_profiles_guard();

-- The person and space of a row under a profile always come from the profile.
create or replace function public.scheduler_profile_owner(_profile uuid, out _user uuid, out _space uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.space_id from public.scheduler_profiles p where p.id = _profile;
$$;
revoke execute on function public.scheduler_profile_owner(uuid) from public, anon, authenticated;

create or replace function public.event_types_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner record;
  _limit integer;
  _active integer;
begin
  if tg_op = 'INSERT' then
    select * into _owner from public.scheduler_profile_owner(new.profile_id);
    if _owner._user is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    new.user_id := _owner._user;
    new.space_id := _owner._space;
  else
    if new.profile_id is distinct from old.profile_id
       or new.user_id is distinct from old.user_id
       or new.space_id is distinct from old.space_id then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    -- The space's owner may only switch somebody else's type off.
    if auth.uid() is not null and auth.uid() is distinct from new.user_id then
      if (to_jsonb(new) - 'active' - 'updated_at') is distinct from (to_jsonb(old) - 'active' - 'updated_at')
         or (new.active and not old.active) then
        raise exception 'not_allowed' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.deal_stage_id is not null and (tg_op = 'INSERT' or new.deal_stage_id is distinct from old.deal_stage_id) then
    if not exists (
      select 1 from public.pipeline_stages s
      where s.id = new.deal_stage_id and s.user_id = new.space_id and not s.is_lost
    ) then
      raise exception 'invalid_stage' using errcode = '23514';
    end if;
  end if;

  -- The plan's limit on active types, per person in the space.
  if new.active and (tg_op = 'INSERT' or not old.active) then
    perform 1 from public.scheduler_profiles p where p.id = new.profile_id for update;
    _limit := public.scheduler_types_limit_of(new.space_id);
    if _limit is not null then
      select count(*)::integer into _active
      from public.event_types t
      where t.user_id = new.user_id and t.space_id = new.space_id and t.active and t.id <> new.id;
      if _active >= _limit then
        raise exception 'scheduler_type_limit' using errcode = 'P0001', detail = _limit::text;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.event_types_guard() from public, anon, authenticated;
create trigger event_types_guard before insert or update on public.event_types
  for each row execute function public.event_types_guard();

-- Hours and exceptions: the profile decides whose they are; a type's own
-- hours only for a type of the same profile.
create or replace function public.availability_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner record;
  _rows integer;
begin
  if tg_op = 'INSERT' then
    select * into _owner from public.scheduler_profile_owner(new.profile_id);
    if _owner._user is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    new.user_id := _owner._user;
    new.space_id := _owner._space;
  elsif new.profile_id is distinct from old.profile_id
     or new.user_id is distinct from old.user_id
     or new.space_id is distinct from old.space_id then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if tg_table_name = 'availability_rules' then
    if new.event_type_id is not null and not exists (
      select 1 from public.event_types t where t.id = new.event_type_id and t.profile_id = new.profile_id
    ) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if tg_op = 'INSERT' then
      select count(*)::integer into _rows from public.availability_rules r
      where r.profile_id = new.profile_id and r.event_type_id is not distinct from new.event_type_id;
      if _rows >= 70 then
        raise exception 'too_many' using errcode = '54000';
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    select count(*)::integer into _rows from public.availability_overrides o
    where o.profile_id = new.profile_id and o.date >= current_date - 1;
    if _rows >= 400 then
      raise exception 'too_many' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.availability_guard() from public, anon, authenticated;
create trigger availability_rules_guard before insert or update on public.availability_rules
  for each row execute function public.availability_guard();
create trigger availability_overrides_guard before insert or update on public.availability_overrides
  for each row execute function public.availability_guard();

-- At most ten subscribed calendars per account (the server adds them).
create or replace function public.calendar_subscriptions_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.calendar_subscriptions s where s.user_id = new.user_id) >= 10 then
    raise exception 'too_many' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_subscriptions_limit() from public, anon, authenticated;
create trigger calendar_subscriptions_limit before insert on public.calendar_subscriptions
  for each row execute function public.calendar_subscriptions_limit();

-- -----------------------------------------------------------------------------
-- 6. Row level security
-- -----------------------------------------------------------------------------

alter table public.scheduler_profiles enable row level security;
alter table public.event_types enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_overrides enable row level security;
alter table public.calendar_subscriptions enable row level security;
alter table public.calendar_feed_tokens enable row level security;
alter table public.bookings enable row level security;

-- The person's own rows in a space where they have the scheduler, and every
-- row of the own space for its owner (read; a type they may switch off).
do $$
declare
  _table text;
begin
  foreach _table in array array['scheduler_profiles', 'event_types', 'availability_rules', 'availability_overrides'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         (user_id = auth.uid() and space_id = any (public.permitted_spaces(''scheduler'', ''view'')))
         or space_id = auth.uid())',
      _table || '_select', _table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         user_id = auth.uid() and space_id = any (public.permitted_spaces(''scheduler'', ''own'')))',
      _table || '_insert', _table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (user_id = auth.uid() and space_id = any (public.permitted_spaces(''scheduler'', ''own'')))
         with check (user_id = auth.uid() and space_id = any (public.permitted_spaces(''scheduler'', ''own'')))',
      _table || '_update', _table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         user_id = auth.uid() and space_id = any (public.permitted_spaces(''scheduler'', ''own'')))',
      _table || '_delete', _table);
    execute format('revoke all on public.%I from anon', _table);
  end loop;
end;
$$;

-- The space's owner switches a worker's type off (event_types_guard lets nothing else through).
create policy event_types_owner_deactivate on public.event_types for update to authenticated
  using (space_id = auth.uid())
  with check (space_id = auth.uid());

-- What the client may write: never the person, the space or the times.
revoke insert, update on public.scheduler_profiles from authenticated;
grant insert (space_id, handle, display_name, headline, bio, time_zone, video_link, setup_done_at)
  on public.scheduler_profiles to authenticated;
grant update (handle, display_name, headline, bio, time_zone, video_link, setup_done_at)
  on public.scheduler_profiles to authenticated;

revoke insert, update on public.event_types from authenticated;
grant insert (profile_id, slug, name, description, duration_min, location_kind, location_text, color,
  active, position, requires_approval, buffer_before_min, buffer_after_min, min_notice_hours,
  max_days_ahead, max_per_day, slot_step_min, custom_availability, questions, deal_stage_id,
  reminders, confirmation_note) on public.event_types to authenticated;
grant update (slug, name, description, duration_min, location_kind, location_text, color,
  active, position, requires_approval, buffer_before_min, buffer_after_min, min_notice_hours,
  max_days_ahead, max_per_day, slot_step_min, custom_availability, questions, deal_stage_id,
  reminders, confirmation_note) on public.event_types to authenticated;

revoke insert, update on public.availability_rules from authenticated;
grant insert (profile_id, event_type_id, weekday, start_time, end_time) on public.availability_rules to authenticated;
grant update (weekday, start_time, end_time) on public.availability_rules to authenticated;

revoke insert, update on public.availability_overrides from authenticated;
grant insert (profile_id, date, start_time, end_time) on public.availability_overrides to authenticated;
grant update (date, start_time, end_time) on public.availability_overrides to authenticated;

-- Subscriptions: the account reads its own (never the link), renames, recolours, hides, removes.
create policy calendar_subscriptions_select on public.calendar_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy calendar_subscriptions_update on public.calendar_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calendar_subscriptions_delete on public.calendar_subscriptions for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.calendar_subscriptions from anon, authenticated;
grant select (id, user_id, name, color, url_hint, show_in_calendar, last_fetched_at, last_status,
  last_error, busy, busy_until, created_at, updated_at) on public.calendar_subscriptions to authenticated;
grant update (name, color, show_in_calendar) on public.calendar_subscriptions to authenticated;
grant delete on public.calendar_subscriptions to authenticated;

-- The feed's secret: the server alone.
revoke all on public.calendar_feed_tokens from anon, authenticated;

-- Bookings: the host their own (with the scheduler of that space), the space's owner all; only the server writes.
create policy bookings_select on public.bookings for select to authenticated using (
  (host_user_id = auth.uid() and space_id = any (public.permitted_spaces('scheduler', 'view')))
  or space_id = auth.uid());
revoke all on public.bookings from anon, authenticated;
-- Every column but the guest's way back (24.4), which is never the client's.
grant select (id, event_type_id, host_user_id, space_id, starts_at, ends_at, guest_name, guest_email,
  guest_phone, guest_company, guest_time_zone, answers, status, hold_expires_at, contact_id,
  calendar_event_id, deal_id, reminder_ids, cancelled_by, cancel_reason, created_at, updated_at)
  on public.bookings to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Functions for the app
-- -----------------------------------------------------------------------------

-- Whether a handle is well formed and free (another profile of the caller's counts as taken).
create or replace function public.scheduler_handle_available(_handle text, _profile uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.scheduler_handle_ok(_handle)
    and not exists (
      select 1 from public.scheduler_profiles p
      where lower(p.handle) = lower(_handle) and p.id is distinct from _profile
    );
$$;
revoke execute on function public.scheduler_handle_available(text, uuid) from public, anon;
grant execute on function public.scheduler_handle_available(text, uuid) to authenticated;

-- Bookings per meeting type since a moment, of what the caller may see (RLS applies).
create or replace function public.scheduler_booking_counts(_since timestamptz)
returns table (event_type_id uuid, bookings integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.event_type_id, count(*)::integer
  from public.bookings b
  where b.created_at >= _since
    and b.event_type_id is not null
    and b.status in ('pending', 'confirmed')
  group by b.event_type_id;
$$;
revoke execute on function public.scheduler_booking_counts(timestamptz) from public, anon;
grant execute on function public.scheduler_booking_counts(timestamptz) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('scheduler_setup_completed', 'calendar', true),
  ('scheduler_event_type_created', 'calendar', true),
  ('scheduler_event_type_updated', 'calendar', true),
  ('scheduler_event_type_toggled', 'calendar', true),
  ('scheduler_event_type_deleted', 'calendar', true),
  ('scheduler_availability_saved', 'calendar', true),
  ('scheduler_link_copied', 'calendar', false),
  ('scheduler_plan_limit_hit', 'calendar', false),
  ('calendar_subscription_added', 'calendar', true),
  ('calendar_subscription_removed', 'calendar', true),
  ('calendar_subscription_refreshed', 'calendar', false),
  ('calendar_feed_created', 'calendar', true),
  ('booking_held', 'calendar', false),
  ('booking_created', 'calendar', true),
  ('booking_confirmed', 'calendar', true),
  ('booking_declined', 'calendar', true),
  ('booking_cancelled', 'calendar', true),
  ('booking_rescheduled', 'calendar', true)
on conflict (event) do nothing;
