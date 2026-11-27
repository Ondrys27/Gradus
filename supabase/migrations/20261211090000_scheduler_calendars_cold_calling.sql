-- =============================================================================
-- 30.4 Scheduler: its own calendars, and a meeting booked from Cold Calling
--
--   * scheduler_profiles.calendar_sources / event_types.calendar_sources:
--     where busy times come from for the scheduler — the Gradus calendar,
--     each connected Google / Apple calendar (by id), each subscribed ICS
--     calendar (by id) — and where a new booking is written ("write": a
--     connected calendar, null = Gradus only, missing = the calendar the
--     person writes to in Settings → Calendar). Independent of what the
--     Calendar section shows. Null on a profile = the behaviour before 30.4
--     (everything busy); new profiles start with only Gradus. Null on a type
--     = the profile's.
--   * scheduler_busy_cache: busy times of a connected calendar read live from
--     the provider for the scheduler (minutes old at most), server only.
--   * bookings.source (page | cold_calling | app) and bookings.created_by:
--     a booking made in the app by a caller for a host. Such a booking needs
--     no e-mail (the guest may not have given one).
--   * scheduler_hold_app / _hold_extend / _book_app: the dialog of Cold
--     Calling holds the time while it is open and books it (always
--     confirmed: it was agreed on the phone). "Book anyway" over a busy time
--     only from the app (_force); the same start twice never.
--   * cold_calling_meeting_settings: the owner decides whose meetings the
--     callers book (the caller, the owner, one person), the default meeting
--     type, whether the caller may change it, and whether the type's notice
--     counts on the phone.
--   * account_notifications 'booking_scheduled' with booking_id: "Jana
--     booked you a meeting with …".
--   * move_contact(): a meeting the scheduler already booked for the contact
--     at that time makes no second event.
--   * reward_on_booking(): a booking from the app is no booking received on
--     the page; the meeting's reward stays with the move (29.1).
--   * permission_catalog(): cold_calling.schedule_others.
--   * calendar_events_sync_enqueue(): a booked meeting is queued for anyone
--     with a connected calendar to write to (the scheduler's own target).
-- Additive: new tables, columns, functions; replaced functions and checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Where the scheduler's busy times come from, where bookings go
-- -----------------------------------------------------------------------------

create or replace function public.scheduler_calendar_sources_valid(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _value is null or coalesce(
    jsonb_typeof(_value) = 'object'
    and (select bool_and(k in ('gradus', 'calendars', 'subscriptions', 'write'))
         from jsonb_object_keys(_value) as k)
    and jsonb_typeof(_value -> 'gradus') = 'boolean'
    and jsonb_typeof(_value -> 'calendars') = 'array'
    and jsonb_array_length(_value -> 'calendars') <= 200
    and jsonb_typeof(_value -> 'subscriptions') = 'array'
    and jsonb_array_length(_value -> 'subscriptions') <= 20
    and (select coalesce(bool_and(jsonb_typeof(v) = 'string'
           and (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), true)
         from jsonb_array_elements(_value -> 'calendars') as v)
    and (select coalesce(bool_and(jsonb_typeof(v) = 'string'
           and (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), true)
         from jsonb_array_elements(_value -> 'subscriptions') as v)
    and (
      not (_value ? 'write')
      or jsonb_typeof(_value -> 'write') = 'null'
      or (jsonb_typeof(_value -> 'write') = 'string'
          and (_value ->> 'write') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    ),
    false);
$$;
grant execute on function public.scheduler_calendar_sources_valid(jsonb) to authenticated, service_role;

alter table public.scheduler_profiles
  add column calendar_sources jsonb
    constraint scheduler_profiles_calendar_sources_valid
    check (public.scheduler_calendar_sources_valid(calendar_sources));
-- Existing profiles keep null (everything busy, as before); new ones only Gradus.
alter table public.scheduler_profiles
  alter column calendar_sources set default '{"gradus": true, "calendars": [], "subscriptions": []}'::jsonb;

alter table public.event_types
  add column calendar_sources jsonb
    constraint event_types_calendar_sources_valid
    check (public.scheduler_calendar_sources_valid(calendar_sources));

grant update (calendar_sources) on public.scheduler_profiles to authenticated;
grant update (calendar_sources) on public.event_types to authenticated;

-- Busy times read live from a connected calendar, a few minutes at most; the server alone.
create table public.scheduler_busy_cache (
  calendar_id uuid primary key references public.calendar_connection_calendars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- [{"start": ISO, "end": ISO}] within the window.
  busy jsonb not null default '[]'::jsonb check (jsonb_typeof(busy) = 'array'),
  window_from timestamptz not null,
  window_to timestamptz not null,
  fetched_at timestamptz not null default now()
);
create index scheduler_busy_cache_user_idx on public.scheduler_busy_cache (user_id);
alter table public.scheduler_busy_cache enable row level security;
revoke all on public.scheduler_busy_cache from anon, authenticated;
grant all on public.scheduler_busy_cache to service_role;

-- -----------------------------------------------------------------------------
-- 2. Bookings made in the app
-- -----------------------------------------------------------------------------

alter table public.bookings
  add column source text not null default 'page' check (source in ('page', 'cold_calling', 'app')),
  -- Who booked it in the app (the caller); null for the public page.
  add column created_by uuid references auth.users (id) on delete set null;

-- A booking from the app may go without the guest's e-mail.
alter table public.bookings drop constraint bookings_guest_known;
alter table public.bookings add constraint bookings_guest_known
  check (status = 'held' or (guest_name is not null and (guest_email is not null or source <> 'page')));

grant select (source, created_by) on public.bookings to authenticated;

-- A time held from the app (the dialog of Cold Calling) for five minutes,
-- renewed while the dialog stays open. The server has checked who books for
-- whom and, without _force, that the time is free in the host's calendars;
-- under the host's lock this decides that no booking or hold has it. With
-- _force a busy time is held anyway (never the exact start of another).
create or replace function public.scheduler_hold_app(
  _type uuid,
  _starts_at timestamptz,
  _token_hash text,
  _actor uuid,
  _source text,
  _force boolean default false,
  _release uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _t public.event_types;
  _ends timestamptz;
  _expires timestamptz := now() + interval '5 minutes';
  _id uuid;
begin
  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' or _actor is null
     or _source not in ('cold_calling', 'app') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into _t from public.event_types t where t.id = _type and t.active;
  if _t.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  _ends := _starts_at + make_interval(mins => _t.duration_min);

  perform public.scheduler_host_lock(_t.user_id);

  delete from public.bookings b
  where b.host_user_id = _t.user_id
    and b.status = 'held'
    and (b.hold_expires_at is null or b.hold_expires_at <= now()
         or (b.id = _release and b.created_by = _actor));

  if _starts_at <= now() then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  if not coalesce(_force, false)
     and public.scheduler_host_busy(_t.user_id, _starts_at, _ends, _t.buffer_before_min, _t.buffer_after_min, null) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.host_user_id = _t.user_id and b.starts_at = _starts_at
      and (b.status in ('pending', 'confirmed') or (b.status = 'held' and b.hold_expires_at > now()))
  ) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    event_type_id, host_user_id, space_id, starts_at, ends_at, status, hold_expires_at,
    manage_token_hash, source, created_by)
  values (
    _t.id, _t.user_id, _t.space_id, _starts_at, _ends, 'held', _expires,
    _token_hash, _source, _actor)
  returning id into _id;

  return jsonb_build_object('id', _id, 'expires_at', _expires);
end;
$$;
revoke execute on function public.scheduler_hold_app(uuid, timestamptz, text, uuid, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.scheduler_hold_app(uuid, timestamptz, text, uuid, text, boolean, uuid)
  to service_role;

-- Five more minutes for a hold of the app that has not run out yet.
create or replace function public.scheduler_hold_extend(_booking uuid, _token_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  _expires timestamptz := now() + interval '5 minutes';
begin
  update public.bookings set hold_expires_at = _expires
  where id = _booking and status = 'held' and source <> 'page'
    and manage_token_hash = _token_hash and hold_expires_at > now();
  if not found then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  return _expires;
end;
$$;
revoke execute on function public.scheduler_hold_extend(uuid, text) from public, anon, authenticated;
grant execute on function public.scheduler_hold_extend(uuid, text) to service_role;

-- The app's hold becomes a confirmed booking (agreed on the phone, no
-- approval): the guest, the contact it is for, maybe the deal. The host
-- hears it when someone else booked it.
create or replace function public.scheduler_book_app(
  _booking uuid,
  _token_hash text,
  _new_token_hash text,
  _name text,
  _email text,
  _phone text,
  _company text,
  _time_zone text,
  _locale text,
  _contact uuid,
  _deal uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
begin
  if coalesce(_new_token_hash, '') !~ '^[0-9a-f]{64}$' or nullif(btrim(coalesce(_name, '')), '') is null then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.id is null or _b.status <> 'held' or _b.source = 'page'
     or _b.manage_token_hash is distinct from _token_hash then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if _b.hold_expires_at is null or _b.hold_expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if _contact is not null and not exists (
    select 1 from public.contacts c where c.id = _contact and c.user_id = _b.space_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if _deal is not null and not exists (
    select 1 from public.deals d where d.id = _deal and d.user_id = _b.space_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.bookings set
    status = 'confirmed',
    confirmed_at = now(),
    hold_expires_at = null,
    manage_token_hash = _new_token_hash,
    guest_name = left(btrim(_name), 120),
    guest_email = nullif(lower(btrim(coalesce(_email, ''))), ''),
    guest_phone = nullif(btrim(coalesce(_phone, '')), ''),
    guest_company = left(nullif(btrim(coalesce(_company, '')), ''), 160),
    guest_time_zone = left(coalesce(_time_zone, _b.guest_time_zone), 64),
    locale = case when _locale in ('cs', 'en') then _locale else 'cs' end,
    contact_id = _contact,
    deal_id = _deal
  where id = _b.id
  returning * into _b;

  if _b.host_user_id is not null and _b.created_by is not null
     and _b.created_by is distinct from _b.host_user_id then
    insert into public.account_notifications (user_id, kind, space_id, actor_id, booking_id)
    values (_b.host_user_id, 'booking_scheduled', _b.space_id, _b.created_by, _b.id);
  end if;

  return jsonb_build_object('id', _b.id, 'status', _b.status);
end;
$$;
revoke execute on function public.scheduler_book_app(uuid, text, text, text, text, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.scheduler_book_app(uuid, text, text, text, text, text, text, text, text, uuid, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. "Jana booked you a meeting with …"
-- -----------------------------------------------------------------------------

alter table public.account_notifications
  add column booking_id uuid references public.bookings (id) on delete cascade;

alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check
  check (kind in (
    'invite_accepted', 'invite_declined', 'worker_left', 'invite_requested',
    'note_shared', 'notes_transferred',
    'calendar_shared', 'calendar_share_requested', 'calendar_share_approved',
    'calendar_share_declined', 'calendar_invite', 'booking_scheduled'
  ));

-- Who booked and for whom, while the account is the booking's host.
create or replace function public.booking_notification_labels(_ids uuid[])
returns table (id uuid, actor_name text, guest_name text, starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
    case when a.actor_id is null or a.space_id is null then null
      else public.space_person_name(a.space_id, a.actor_id) end,
    b.guest_name,
    b.starts_at
  from public.account_notifications a
  left join public.bookings b on b.id = a.booking_id and b.host_user_id = auth.uid()
  where a.id = any (_ids[1:50]) and a.user_id = auth.uid() and a.kind = 'booking_scheduled';
$$;
revoke execute on function public.booking_notification_labels(uuid[]) from public, anon;
grant execute on function public.booking_notification_labels(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Cold Calling: whose meetings the callers book
-- -----------------------------------------------------------------------------

create table public.cold_calling_meeting_settings (
  space_id uuid primary key references auth.users (id) on delete cascade,
  -- caller: the caller picks (themselves; others with "schedule meetings for others"),
  -- owner: always the space's owner, person: always host_user_id.
  host_mode text not null default 'caller' check (host_mode in ('caller', 'owner', 'person')),
  host_user_id uuid references auth.users (id) on delete set null,
  -- The default meeting type (of the fixed host); null = the one nearest 30 minutes.
  event_type_id uuid references public.event_types (id) on delete set null,
  type_locked boolean not null default false,
  -- The type's minimum notice does not count when the time is agreed on the phone.
  ignore_notice boolean not null default false,
  updated_at timestamptz not null default now()
);

-- The person and the type belong to the space.
create or replace function public.cold_calling_meeting_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.space_id is distinct from old.space_id then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if new.host_user_id is not null and not public.space_member_of(new.space_id, new.host_user_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if new.event_type_id is not null and not exists (
    select 1 from public.event_types t where t.id = new.event_type_id and t.space_id = new.space_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.cold_calling_meeting_settings_guard() from public, anon, authenticated;
create trigger cold_calling_meeting_settings_guard
  before insert or update on public.cold_calling_meeting_settings
  for each row execute function public.cold_calling_meeting_settings_guard();

alter table public.cold_calling_meeting_settings enable row level security;
-- The space's people read it (the dialog), only the owner writes it.
create policy cold_calling_meeting_settings_select on public.cold_calling_meeting_settings
  for select to authenticated
  using (space_id = any ((select public.member_spaces())::uuid[]));
create policy cold_calling_meeting_settings_insert on public.cold_calling_meeting_settings
  for insert to authenticated
  with check (space_id = (select auth.uid()));
create policy cold_calling_meeting_settings_update on public.cold_calling_meeting_settings
  for update to authenticated
  using (space_id = (select auth.uid()))
  with check (space_id = (select auth.uid()));
create policy cold_calling_meeting_settings_delete on public.cold_calling_meeting_settings
  for delete to authenticated
  using (space_id = (select auth.uid()));
revoke all on public.cold_calling_meeting_settings from anon, authenticated;
grant select, delete on public.cold_calling_meeting_settings to authenticated;
grant insert (space_id, host_mode, host_user_id, event_type_id, type_locked, ignore_notice)
  on public.cold_calling_meeting_settings to authenticated;
grant update (host_mode, host_user_id, event_type_id, type_locked, ignore_notice)
  on public.cold_calling_meeting_settings to authenticated;
grant all on public.cold_calling_meeting_settings to service_role;

-- -----------------------------------------------------------------------------
-- 5. The right to book meetings for others
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
    ('cold_calling', 'schedule_others', 'write'),
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
    ('company', 'update', 'write'),
    ('company', 'rewards', 'write'),
    ('integrations', 'view', 'view'),
    ('integrations', 'mcp', 'read')
  ) as c (section, action, kind);
$$;

-- -----------------------------------------------------------------------------
-- 6. The meeting the scheduler booked is the contact's meeting
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.move_contact(_contact_id uuid, _to_table_id uuid, _answers jsonb DEFAULT '{}'::jsonb)
 RETURNS contact_table_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _actor uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _target public.contact_tables;
  _contact public.contacts;
  _from uuid;
  _entry public.contact_table_entries;
  _given jsonb := coalesce(_answers, '{}'::jsonb);
  _clean jsonb := '{}'::jsonb;
  _field public.contact_table_fields;
  _value jsonb;
  _text text;
  _starts timestamptz;
begin
  if _actor is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- The owner moves in their own space; a worker needs edit rights to contacts or cold calling.
  if not (public.has_section_access(_ws, 'contacts', 'edit')
          or public.has_section_access(_ws, 'cold_calling', 'edit')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select * into _target from public.contact_tables
  where id = _to_table_id and user_id = _ws;
  if _target.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _target.system_key = 'clients' then
    raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
  end if;
  select * into _contact from public.contacts where id = _contact_id and user_id = _ws;
  if _contact.id is null then
    raise exception 'contact_not_found' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(_given) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'check_violation';
  end if;

  -- Questions shown for these answers: no dependency, or the answer they hang on was given
  -- to a question that is itself shown.
  for _field in
    with recursive shown as (
      select f.id from public.contact_table_fields f
      where f.table_id = _target.id and f.depends_on_field_id is null
      union
      select f.id from public.contact_table_fields f
      join shown s on s.id = f.depends_on_field_id
      where f.table_id = _target.id
        and _given ->> f.depends_on_field_id::text = f.depends_on_value
    )
    select f.* from public.contact_table_fields f
    join shown s on s.id = f.id
    order by f.position
  loop
    _value := _given -> _field.id::text;
    if _value is null or jsonb_typeof(_value) = 'null'
       or (jsonb_typeof(_value) = 'string' and btrim(_value #>> '{}') = '') then
      if _field.required then
        raise exception 'answer_required' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      continue;
    end if;

    if _field.type = 'boolean' then
      if jsonb_typeof(_value) <> 'boolean' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
    else
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      _text := _value #>> '{}';
      if char_length(_text) > 5000
         or (_field.type = 'date' and _text !~ '^\d{4}-\d{2}-\d{2}$')
         or (_field.type = 'datetime' and _text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
         or (_field.type = 'select' and not exists (
               select 1 from jsonb_array_elements(_field.options) o where o ->> 'key' = _text
             )) then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      begin
        if _field.type = 'date' then
          perform _text::date;
        elsif _field.type = 'datetime' then
          perform _text::timestamptz;
        end if;
      exception when others then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end;
    end if;
    _clean := _clean || jsonb_build_object(_field.id::text, _value);
  end loop;

  select table_id into _from from public.contact_table_entries
  where user_id = _ws and contact_id = _contact_id;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (_ws, _contact_id, _to_table_id, _clean, now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id,
        answers = excluded.answers,
        moved_at = excluded.moved_at
  returning * into _entry;

  insert into public.contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, answers)
  values (_ws, _actor, _contact_id, _from, _to_table_id, _clean);

  -- The table's name at the time of the move; the history keeps it after a rename.
  insert into public.contact_activities (user_id, actor_id, contact_id, type, content)
  values (_ws, _actor, _contact_id, 'move', _target.name);

  for _field in
    select * from public.contact_table_fields
    where table_id = _target.id and type = 'datetime' and system_key = 'meeting_at'
  loop
    if _clean ? _field.id::text then
      _starts := (_clean ->> _field.id::text)::timestamptz;
      -- Booked through the scheduler (30.4): the meeting is already in the host's calendar.
      if not exists (
        select 1 from public.bookings b
        where b.space_id = _ws and b.contact_id = _contact_id and b.starts_at = _starts
          and b.status in ('pending', 'confirmed')
      ) then
        insert into public.calendar_events (user_id, actor_id, title, kind, starts_at, contact_id, source)
        values (
          _ws,
          _actor,
          coalesce(
            nullif(btrim(_contact.company_name), ''),
            nullif(btrim(concat_ws(' ', _contact.first_name, _contact.last_name)), '')
          ),
          'meeting',
          _starts,
          _contact_id,
          'contact_move'
        );
      end if;
    end if;
  end loop;

  return _entry;
end;
$function$
;

-- -----------------------------------------------------------------------------
-- 7. Rewards: a booking from the app is paid through the move
-- -----------------------------------------------------------------------------

create or replace function public.reward_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
  _facts jsonb;
begin
  if new.host_user_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status in ('pending', 'confirmed') and new.status in ('cancelled', 'declined') then
    perform public.reward_reconcile(new.space_id, 'booking', new.id, '{}', 'sync');
    return null;
  end if;
  if tg_op = 'UPDATE' and old.no_show_at is null and new.no_show_at is not null then
    delete from public.reward_entries e
    using public.reward_plan_rules r
    where r.id = e.rule_id and e.source_kind = 'booking' and e.source_id = new.id
      and r.definition -> 'event' ->> 'key' = 'meeting.held' and e.status <> 'paid'
      and e.corrects_id is null and e.reversed_at is null;
  end if;
  -- Booked in the app (Cold Calling, a contact, a deal): the move into
  -- "Meeting scheduled" pays the meeting, as before 30.4.
  if new.source is distinct from 'page' then
    return null;
  end if;
  _worker := public.reward_worker_of(new.space_id, new.host_user_id);
  if _worker is null then
    return null;
  end if;
  _facts := (case when new.contact_id is not null then public.reward_contact_facts(new.contact_id) else '{}'::jsonb end)
    || jsonb_build_object('did', true, 'on_record', true, 'subject_id', new.id, 'note', new.guest_company);
  if new.status in ('pending', 'confirmed')
     and (tg_op = 'INSERT' or old.status not in ('pending', 'confirmed')) then
    perform public.reward_fire(_worker, _facts || '{"event": "booking.received"}'::jsonb,
      'booking', new.id, coalesce(new.created_at, now()), 'add');
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    perform public.reward_fire(_worker, _facts || '{"event": "meeting.booked", "via": "scheduler"}'::jsonb,
      'booking', new.id, coalesce(new.confirmed_at, now()), 'add');
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. A booked meeting reaches the scheduler's own calendar to write to
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
    _person := coalesce(_row.calendar_owner_id, _row.actor_id, _row.user_id);
    -- Only for someone with a calendar to write to: the one of Settings →
    -- Calendar, or for a booked meeting any connected calendar that can be
    -- written (the scheduler names its own; the server decides, 30.4).
    if not exists (
      select 1 from public.calendar_connection_calendars c
      join public.calendar_connections k on k.id = c.connection_id
      where c.user_id = _person and k.status = 'active'
        and (c.write or (_row.source = 'booking' and c.can_write))
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

-- -----------------------------------------------------------------------------
-- 9. Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('scheduler_calendar_sources_saved', 'calendar', true),
  ('cold_calling_meeting_settings_saved', 'calendar', true),
  ('booking_dialog_opened', 'calendar', true),
  ('booking_from_app', 'calendar', true)
on conflict (event) do nothing;
