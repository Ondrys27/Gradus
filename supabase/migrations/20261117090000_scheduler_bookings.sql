-- =============================================================================
-- 24.4 Scheduler: the public booking page and bookings
--   * bookings: a time clicked on the public page is held for five minutes
--     (status held, one advisory lock per host, so two guests never get the
--     same or an overlapping time); the guest's answers turn the hold into a
--     booking (confirmed, or pending when the type asks for approval). The
--     guest's language, a keyed hash of the visitor's address (the limit of
--     ten bookings an hour), when it was confirmed, moved, marked a no-show
--     and whether the meeting survey was skipped. Name and e-mail are only
--     known after the hold, so a hold goes without them.
--   * scheduler_rate_events: holds and bookings per visitor in the last hour
--     (only the hash, server only, purged after two days).
--   * Effects of a booking, in one transaction (scheduler_booking_effects):
--     the contact (matched by e-mail in the space, else new with source
--     'scheduler'), the meeting in the host's calendar (source 'booking',
--     which the client neither changes nor deletes), and once confirmed the
--     contact in "Meeting scheduled" (never out of Clients) and a deal in the
--     type's stage. A move made by the scheduler is no call, so it stays out
--     of the shared chart of calling times.
--   * meeting_surveys.booking_id: the meeting survey after a booked meeting.
--   * Every function is the server's (service role); the server decides who
--     may act (the guest by the secret of the link, the host by the session).
-- Additive only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contacts made by the scheduler
-- -----------------------------------------------------------------------------

alter type public.contact_source add value if not exists 'scheduler';

-- -----------------------------------------------------------------------------
-- 2. Bookings
-- -----------------------------------------------------------------------------

alter table public.bookings alter column guest_name drop not null;
alter table public.bookings alter column guest_email drop not null;
alter table public.bookings add constraint bookings_guest_known
  check (status = 'held' or (guest_name is not null and guest_email is not null));

alter table public.bookings
  -- The guest's language: the e-mails and the page for managing the booking.
  add column locale text not null default 'cs' check (locale in ('cs', 'en')),
  -- A keyed hash of the visitor's address (never the address), for the hourly limits.
  add column client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{16,64}$'),
  add column confirmed_at timestamptz,
  add column rescheduled_at timestamptz,
  add column reschedule_count integer not null default 0 check (reschedule_count between 0 and 1000),
  add column no_show_at timestamptz,
  add column survey_dismissed_at timestamptz;

create index bookings_pending_idx on public.bookings (host_user_id, starts_at) where status = 'pending';
create index bookings_held_idx on public.bookings (host_user_id, hold_expires_at) where status = 'held';
create index bookings_calendar_event_idx on public.bookings (calendar_event_id) where calendar_event_id is not null;
create index bookings_contact_idx on public.bookings (contact_id, starts_at) where contact_id is not null;

-- The client reads the new columns too; never the visitor's hash or the link's secret.
grant select (locale, confirmed_at, rescheduled_at, reschedule_count, no_show_at, survey_dismissed_at)
  on public.bookings to authenticated;

create table public.scheduler_rate_events (
  id bigint generated always as identity primary key,
  client_hash text not null check (client_hash ~ '^[0-9a-f]{16,64}$'),
  kind text not null check (kind in ('hold', 'book', 'manage')),
  created_at timestamptz not null default now()
);
create index scheduler_rate_events_idx on public.scheduler_rate_events (client_hash, kind, created_at);
alter table public.scheduler_rate_events enable row level security;
revoke all on public.scheduler_rate_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. The meeting in the calendar belongs to the booking
-- -----------------------------------------------------------------------------

alter table public.calendar_events drop constraint calendar_events_source_check;
alter table public.calendar_events add constraint calendar_events_source_check
  check (source in ('manual', 'contact_move', 'deal_deadline', 'booking'));

-- The client never makes, changes or deletes a deadline event or a booked
-- meeting; the deal and the booking do (moving and cancelling a booking go
-- through the scheduler, which tells the guest).
create or replace function public.calendar_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.source := 'manual';
    elsif old.source = 'deal_deadline' then
      raise exception 'calendar_event_from_deal' using errcode = '42501';
    elsif old.source = 'booking' then
      raise exception 'calendar_event_from_booking' using errcode = '42501';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.calendar_events_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() and old.source = 'deal_deadline' then
    raise exception 'calendar_event_from_deal' using errcode = '42501';
  end if;
  if public.is_client_request() and old.source = 'booking' then
    raise exception 'calendar_event_from_booking' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke execute on function public.calendar_events_guard_delete() from public, anon;

-- -----------------------------------------------------------------------------
-- 4. A move made by the scheduler is no call
-- -----------------------------------------------------------------------------

alter table public.contact_table_moves
  add column source text check (source is null or source = 'scheduler');

create or replace function public.refresh_call_time_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rows integer;
begin
  delete from public.call_time_stats where true;

  insert into public.call_time_stats (country_code, day_of_week, hour, attempts, meetings)
  with attempts as (
    select
      coalesce(m.actor_id, m.user_id) as person,
      upper(coalesce(c.country_code, s.country_code)) as country_code,
      (m.created_at at time zone s.timezone) as local_at,
      coalesce(t_to.system_key = 'meeting_scheduled', false) as meeting
    from public.contact_table_moves m
    join public.contact_tables t_from on t_from.id = m.from_table_id
    left join public.contact_tables t_to on t_to.id = m.to_table_id
    join public.user_settings s on s.user_id = m.user_id
    left join public.contacts c on c.id = m.contact_id
    where t_from.system_key in ('unreached', 'no_answer')
      -- A meeting the guest booked on the public page is no call.
      and m.source is distinct from 'scheduler'
      and m.created_at >= now() - interval '365 days'
      and coalesce(c.country_code, s.country_code) is not null
  ),
  per_person as (
    select
      country_code,
      local_at::date as day,
      extract(hour from local_at)::smallint as hour,
      least(count(*), 30) as attempts,
      least(count(*) filter (where meeting), least(count(*), 30)) as meetings
    from attempts
    group by person, country_code, local_at::date, extract(hour from local_at)
  )
  select
    country_code,
    extract(dow from day)::smallint,
    hour,
    sum(attempts)::integer,
    sum(meetings)::integer
  from per_person
  group by country_code, extract(dow from day), hour;

  get diagnostics _rows = row_count;
  return _rows;
end;
$$;
revoke execute on function public.refresh_call_time_stats() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. The meeting survey after a booked meeting
-- -----------------------------------------------------------------------------

alter table public.meeting_surveys
  add column booking_id uuid references public.bookings (id) on delete set null;
create unique index meeting_surveys_booking_idx on public.meeting_surveys (booking_id)
  where booking_id is not null;

-- A survey names only a booking of the same space and the same deal.
create or replace function public.meeting_surveys_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_id is not null
     and (tg_op = 'INSERT' or new.booking_id is distinct from old.booking_id)
     and not exists (
       select 1 from public.bookings b
       where b.id = new.booking_id and b.space_id = new.user_id and b.deal_id = new.deal_id
     ) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke execute on function public.meeting_surveys_booking_guard() from public, anon, authenticated;
create trigger meeting_surveys_booking_guard
  before insert or update of booking_id on public.meeting_surveys
  for each row execute function public.meeting_surveys_booking_guard();

-- -----------------------------------------------------------------------------
-- 6. Who may be booked
-- -----------------------------------------------------------------------------

-- The person of a profile may take bookings in its space: the space is their
-- own, or they actively work there with "scheduler: view" and "own".
create or replace function public.scheduler_host_active(_user uuid, _space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    _user = _space
    or exists (
      select 1 from public.memberships m
      where m.user_id = _user
        and m.space_id = _space
        and m.role = 'worker'
        and m.status = 'active'
        and public.worker_grant(m.worker_id, 'scheduler', 'view')
        and public.worker_grant(m.worker_id, 'scheduler', 'own')
    ),
    false);
$$;
revoke execute on function public.scheduler_host_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.scheduler_host_active(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Holding a time and booking it
-- -----------------------------------------------------------------------------

create or replace function public.scheduler_host_lock(_host uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('scheduler-host:' || _host::text, 0));
$$;
revoke execute on function public.scheduler_host_lock(uuid) from public, anon, authenticated;

-- Whether something active of the host touches [start − before, end + after]:
-- a pending or confirmed booking, or a hold that has not expired.
create or replace function public.scheduler_host_busy(
  _host uuid, _start timestamptz, _end timestamptz, _before integer, _after integer, _except uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.host_user_id = _host
      and b.id is distinct from _except
      and (b.status in ('pending', 'confirmed') or (b.status = 'held' and b.hold_expires_at > now()))
      and b.starts_at < _end + make_interval(mins => greatest(_after, 0))
      and b.ends_at > _start - make_interval(mins => greatest(_before, 0))
  );
$$;
revoke execute on function public.scheduler_host_busy(uuid, timestamptz, timestamptz, integer, integer, uuid)
  from public, anon, authenticated;

-- How often a visitor did something in the last hour; the attempt is counted.
create or replace function public.scheduler_rate_take(_client text, _kind text, _limit integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.scheduler_rate_events r
      where r.client_hash = _client and r.kind = _kind and r.created_at > now() - interval '1 hour') >= _limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.scheduler_rate_events (client_hash, kind) values (_client, _kind);
end;
$$;
revoke execute on function public.scheduler_rate_take(text, text, integer) from public, anon, authenticated;

-- A time clicked on the booking page, held for five minutes. The server has
-- already checked it is one of the type's free times; under the host's lock
-- this decides that nobody else has it. The visitor's previous hold (with the
-- same visitor hash) is released, expired holds of the host are cleared.
create or replace function public.scheduler_hold(
  _type uuid,
  _starts_at timestamptz,
  _token_hash text,
  _client_hash text,
  _guest_time_zone text default null,
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
  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(_client_hash, '') !~ '^[0-9a-f]{16,64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into _t from public.event_types t where t.id = _type and t.active;
  if _t.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  _ends := _starts_at + make_interval(mins => _t.duration_min);

  perform public.scheduler_host_lock(_t.user_id);
  perform public.scheduler_rate_take(_client_hash, 'hold', 30);

  delete from public.bookings b
  where b.host_user_id = _t.user_id
    and b.status = 'held'
    and (b.hold_expires_at is null or b.hold_expires_at <= now()
         or (b.id = _release and b.client_hash = _client_hash));

  if _starts_at <= now() then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  if public.scheduler_host_busy(_t.user_id, _starts_at, _ends, _t.buffer_before_min, _t.buffer_after_min, null) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    event_type_id, host_user_id, space_id, starts_at, ends_at, status, hold_expires_at,
    manage_token_hash, client_hash, guest_time_zone)
  values (
    _t.id, _t.user_id, _t.space_id, _starts_at, _ends, 'held', _expires,
    _token_hash, _client_hash, left(_guest_time_zone, 64))
  returning id into _id;

  return jsonb_build_object('id', _id, 'expires_at', _expires);
end;
$$;
revoke execute on function public.scheduler_hold(uuid, timestamptz, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.scheduler_hold(uuid, timestamptz, text, text, text, uuid) to service_role;

-- The guest's answers turn their unexpired hold into a booking: confirmed, or
-- pending when the type asks for approval. The hold's secret proves it is
-- theirs; the link of the e-mail gets a new one.
create or replace function public.scheduler_book(
  _booking uuid,
  _token_hash text,
  _new_token_hash text,
  _name text,
  _email text,
  _phone text,
  _company text,
  _time_zone text,
  _locale text,
  _answers jsonb,
  _client_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _approval boolean;
begin
  if coalesce(_new_token_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(_client_hash, '') !~ '^[0-9a-f]{16,64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  perform public.scheduler_rate_take(_client_hash, 'book', 10);

  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.id is null or _b.status <> 'held' or _b.manage_token_hash is distinct from _token_hash then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if _b.hold_expires_at is null or _b.hold_expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  select t.requires_approval into _approval from public.event_types t where t.id = _b.event_type_id;

  update public.bookings set
    status = case when coalesce(_approval, false) then 'pending' else 'confirmed' end,
    confirmed_at = case when coalesce(_approval, false) then null else now() end,
    hold_expires_at = null,
    manage_token_hash = _new_token_hash,
    guest_name = btrim(_name),
    guest_email = lower(btrim(_email)),
    guest_phone = nullif(btrim(_phone), ''),
    guest_company = nullif(btrim(_company), ''),
    guest_time_zone = left(coalesce(_time_zone, _b.guest_time_zone), 64),
    locale = case when _locale in ('cs', 'en') then _locale else 'cs' end,
    answers = coalesce(_answers, '{}'::jsonb),
    client_hash = _client_hash
  where id = _b.id
  returning * into _b;

  return jsonb_build_object('id', _b.id, 'status', _b.status);
end;
$$;
revoke execute on function public.scheduler_book(uuid, text, text, text, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.scheduler_book(uuid, text, text, text, text, text, text, text, text, jsonb, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 8. What a booking does in the space
-- -----------------------------------------------------------------------------

-- Idempotent: the contact (the booking's, else by e-mail in the space, else a
-- new one), the meeting in the host's calendar (made or moved to the
-- booking's time; removed for a cancelled or declined booking). With
-- _confirming (the moment it became confirmed) also the contact into
-- "Meeting scheduled" and a deal in the type's stage. The texts (title,
-- description with the answers, place, the deal's title) come from the
-- server in the host's language.
create or replace function public.scheduler_booking_effects(
  _booking uuid,
  _confirming boolean,
  _title text,
  _description text,
  _location text,
  _deal_title text,
  _country text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _stage_id uuid;
  _contact uuid;
  _created boolean := false;
  _event uuid;
  _deal uuid;
  _name text;
  _first text;
  _last text;
  _meeting public.contact_tables;
  _current uuid;
  _current_key text;
  _field uuid;
  _answers jsonb := '{}'::jsonb;
  _moved boolean := false;
  _currency text;
begin
  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if _b.status not in ('pending', 'confirmed') then
    if _b.calendar_event_id is not null then
      delete from public.calendar_events e where e.id = _b.calendar_event_id and e.source = 'booking';
      update public.bookings set calendar_event_id = null where id = _b.id;
    end if;
    return jsonb_build_object(
      'contact_id', _b.contact_id, 'calendar_event_id', null, 'deal_id', _b.deal_id,
      'created_contact', false, 'moved', false);
  end if;

  -- The contact ---------------------------------------------------------------
  _contact := _b.contact_id;
  if _contact is not null and not exists (
    select 1 from public.contacts c where c.id = _contact and c.user_id = _b.space_id
  ) then
    _contact := null;
  end if;
  if _contact is null then
    select c.id into _contact from public.contacts c
    where c.user_id = _b.space_id and not c.is_demo
      and lower(btrim(c.email)) = lower(btrim(_b.guest_email))
    order by c.created_at
    limit 1;
  end if;
  if _contact is null then
    _name := left(regexp_replace(btrim(_b.guest_name), '\s+', ' ', 'g'), 120);
    _first := split_part(_name, ' ', 1);
    _last := nullif(btrim(substr(_name, char_length(_first) + 1)), '');
    insert into public.contacts (user_id, first_name, last_name, email, phone, company_name, source, country_code)
    values (
      _b.space_id, nullif(_first, ''), _last, lower(btrim(_b.guest_email)), _b.guest_phone,
      nullif(btrim(_b.guest_company), ''), 'scheduler',
      case when _country ~ '^[A-Z]{2}$' then _country end)
    returning id into _contact;
    _created := true;
  end if;

  -- The meeting in the host's calendar ------------------------------------------
  _event := _b.calendar_event_id;
  if _event is not null then
    update public.calendar_events set
      title = left(_title, 200), description = left(_description, 5000), location = left(_location, 500),
      starts_at = _b.starts_at, ends_at = _b.ends_at, all_day = false, kind = 'meeting',
      contact_id = _contact, deal_id = coalesce(_b.deal_id, deal_id)
    where id = _event and user_id = _b.space_id and source = 'booking';
    if not found then
      _event := null;
    end if;
  end if;
  if _event is null then
    insert into public.calendar_events (
      user_id, actor_id, title, kind, starts_at, ends_at, all_day, description, location,
      contact_id, deal_id, source)
    values (
      _b.space_id, _b.host_user_id, left(_title, 200), 'meeting', _b.starts_at, _b.ends_at, false,
      left(_description, 5000), left(_location, 500), _contact, _b.deal_id, 'booking')
    returning id into _event;
  end if;

  _deal := _b.deal_id;
  if _confirming and _b.status = 'confirmed' then
    -- Cold Calling: into "Meeting scheduled", never out of Clients.
    select * into _meeting from public.contact_tables t
    where t.user_id = _b.space_id and t.system_key = 'meeting_scheduled';
    select e.table_id, t.system_key into _current, _current_key
    from public.contact_table_entries e
    left join public.contact_tables t on t.id = e.table_id
    where e.user_id = _b.space_id and e.contact_id = _contact;
    if _meeting.id is not null and _current is distinct from _meeting.id
       and _current_key is distinct from 'clients' then
      select f.id into _field from public.contact_table_fields f
      where f.table_id = _meeting.id and f.system_key = 'meeting_at'
      limit 1;
      if _field is not null then
        _answers := jsonb_build_object(
          _field::text, to_char(_b.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'));
      end if;
      insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
      values (_b.space_id, _contact, _meeting.id, _answers, now())
      on conflict (user_id, contact_id) do update
        set table_id = excluded.table_id, answers = excluded.answers, moved_at = excluded.moved_at;
      insert into public.contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, answers, source)
      values (_b.space_id, _b.host_user_id, _contact, _current, _meeting.id, _answers, 'scheduler');
      insert into public.contact_activities (user_id, actor_id, contact_id, type, content)
      values (_b.space_id, _b.host_user_id, _contact, 'move', _meeting.name);
      _moved := true;
    end if;

    -- A deal in the type's stage (an open or won stage of the space).
    if _deal is null and _b.event_type_id is not null then
      select s.id into _stage_id
      from public.event_types t
      join public.pipeline_stages s on s.id = t.deal_stage_id and s.user_id = _b.space_id and not s.is_lost
      where t.id = _b.event_type_id;
      if _stage_id is not null then
        -- The space's currency; without settings the column's default.
        select us.currency into _currency from public.user_settings us where us.user_id = _b.space_id;
        _name := left(coalesce(nullif(btrim(_deal_title), ''), _b.guest_name), 200);
        if _currency is null then
          insert into public.deals (user_id, stage_id, title, contact_id, created_by, assignee_id)
          values (_b.space_id, _stage_id, _name, _contact, _b.host_user_id, _b.host_user_id)
          returning id into _deal;
        else
          insert into public.deals (user_id, stage_id, title, contact_id, created_by, assignee_id, currency)
          values (_b.space_id, _stage_id, _name, _contact, _b.host_user_id, _b.host_user_id, _currency)
          returning id into _deal;
        end if;
        update public.calendar_events set deal_id = _deal where id = _event;
      end if;
    end if;
  end if;

  update public.bookings set contact_id = _contact, calendar_event_id = _event, deal_id = _deal
  where id = _b.id;

  return jsonb_build_object(
    'contact_id', _contact, 'calendar_event_id', _event, 'deal_id', _deal,
    'created_contact', _created, 'moved', _moved);
end;
$$;
revoke execute on function public.scheduler_booking_effects(uuid, boolean, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.scheduler_booking_effects(uuid, boolean, text, text, text, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 9. The host's decisions and the guest's changes
-- -----------------------------------------------------------------------------

-- Pending → confirmed (the host approves), before the meeting ends.
create or replace function public.scheduler_confirm(_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  update public.bookings set status = 'confirmed', confirmed_at = now()
  where id = _booking and status = 'pending' and ends_at > now()
  returning id into _id;
  if _id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', _id, 'status', 'confirmed');
end;
$$;

-- Pending → declined (the host, with a reason the guest reads).
create or replace function public.scheduler_decline(_booking uuid, _reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  update public.bookings set status = 'declined', cancelled_by = 'host',
    cancel_reason = nullif(left(btrim(coalesce(_reason, '')), 500), '')
  where id = _booking and status = 'pending'
  returning id into _id;
  if _id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', _id, 'status', 'declined');
end;
$$;

-- Pending or confirmed → cancelled, by the host or the guest, before it ends.
create or replace function public.scheduler_cancel(_booking uuid, _by text, _reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  if _by not in ('host', 'guest') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.bookings set status = 'cancelled', cancelled_by = _by,
    cancel_reason = nullif(left(btrim(coalesce(_reason, '')), 500), '')
  where id = _booking and status in ('pending', 'confirmed') and ends_at > now()
  returning id into _id;
  if _id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', _id, 'status', 'cancelled');
end;
$$;

-- A pending or confirmed booking at another time, of the same length, if the
-- host is free then (under the host's lock, the booking itself not counted).
create or replace function public.scheduler_reschedule(_booking uuid, _starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _before integer := 0;
  _after integer := 0;
  _ends timestamptz;
begin
  select * into _b from public.bookings b where b.id = _booking;
  if _b.id is null or _b.status not in ('pending', 'confirmed') or _b.ends_at <= now() then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  perform public.scheduler_host_lock(_b.host_user_id);
  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.status not in ('pending', 'confirmed') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if _starts_at <= now() then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  select t.buffer_before_min, t.buffer_after_min into _before, _after
  from public.event_types t where t.id = _b.event_type_id;
  _ends := _starts_at + (_b.ends_at - _b.starts_at);
  delete from public.bookings b
  where b.host_user_id = _b.host_user_id and b.status = 'held' and b.hold_expires_at <= now();
  if public.scheduler_host_busy(_b.host_user_id, _starts_at, _ends, coalesce(_before, 0), coalesce(_after, 0), _b.id) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  update public.bookings set starts_at = _starts_at, ends_at = _ends, rescheduled_at = now(),
    reschedule_count = reschedule_count + 1, survey_dismissed_at = null
  where id = _b.id;
  return jsonb_build_object('id', _b.id, 'status', _b.status, 'previous_starts_at', _b.starts_at);
end;
$$;

-- A confirmed meeting that has started: the guest did not come (or did after all).
create or replace function public.scheduler_set_no_show(_booking uuid, _no_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  update public.bookings set no_show_at = case when _no_show then coalesce(no_show_at, now()) end
  where id = _booking and status = 'confirmed' and starts_at <= now()
  returning id into _id;
  if _id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', _id, 'no_show', _no_show);
end;
$$;

-- The host skips the meeting survey of a booked meeting.
create or replace function public.scheduler_dismiss_survey(_booking uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bookings set survey_dismissed_at = coalesce(survey_dismissed_at, now())
  where id = _booking and status = 'confirmed';
$$;

-- The daily clean-up: expired holds and visitor counts older than two days.
create or replace function public.scheduler_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _holds integer;
begin
  delete from public.bookings where status = 'held' and (hold_expires_at is null or hold_expires_at <= now());
  get diagnostics _holds = row_count;
  delete from public.scheduler_rate_events where created_at < now() - interval '2 days';
  return _holds;
end;
$$;

do $$
declare
  _fn text;
begin
  foreach _fn in array array[
    'public.scheduler_confirm(uuid)',
    'public.scheduler_decline(uuid, text)',
    'public.scheduler_cancel(uuid, text, text)',
    'public.scheduler_reschedule(uuid, timestamptz)',
    'public.scheduler_set_no_show(uuid, boolean)',
    'public.scheduler_dismiss_survey(uuid)',
    'public.scheduler_cleanup()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', _fn);
    execute format('grant execute on function %s to service_role', _fn);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 10. Jarvis's bubble for the host: a booking to approve, a new booking
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'overdueCrmTask', 'workerInvite', 'cashLow', 'bookingPending', 'bookingNew', 'taskCompleted',
  'insight', 'pathReady', 'briefing', 'question'
));

-- The owner may switch the two new kinds off in Administration -> AI and Jarvis -> Rules.
create or replace function public.valid_jarvis_rules(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when jsonb_typeof(_value -> 'suggestion_types') is distinct from 'object' then false
    else coalesce(
      (select count(*) = 7 and bool_and(k in (
         'suggestion_types', 'questions', 'min_gap_hours', 'questions_per_week',
         'suggestion_fresh_days', 'page_settle_seconds', 'instructions'))
       from jsonb_object_keys(_value) as k)
      and (select coalesce(bool_and(
             t.key in ('insight', 'stalledDeal', 'overdueTask', 'overdueInvoice',
                       'overdueCrmTask', 'milestoneReady', 'followUps', 'pathReady', 'workerInvite', 'cashLow',
                       'bookingPending', 'bookingNew')
             and jsonb_typeof(t.value) = 'boolean'), true)
           from jsonb_each(_value -> 'suggestion_types') as t)
      and jsonb_typeof(_value -> 'questions') = 'boolean'
      and jsonb_typeof(_value -> 'min_gap_hours') = 'number'
      and jsonb_typeof(_value -> 'questions_per_week') = 'number'
      and jsonb_typeof(_value -> 'suggestion_fresh_days') = 'number'
      and jsonb_typeof(_value -> 'page_settle_seconds') = 'number'
      and (_value ->> 'min_gap_hours')::numeric between 2 and 72
      and (_value ->> 'min_gap_hours')::numeric = trunc((_value ->> 'min_gap_hours')::numeric)
      and (_value ->> 'questions_per_week')::numeric between 0 and 7
      and (_value ->> 'questions_per_week')::numeric = trunc((_value ->> 'questions_per_week')::numeric)
      and (_value ->> 'suggestion_fresh_days')::numeric between 1 and 30
      and (_value ->> 'suggestion_fresh_days')::numeric = trunc((_value ->> 'suggestion_fresh_days')::numeric)
      and (_value ->> 'page_settle_seconds')::numeric between 10 and 600
      and (_value ->> 'page_settle_seconds')::numeric = trunc((_value ->> 'page_settle_seconds')::numeric)
      and jsonb_typeof(_value -> 'instructions') = 'string'
      and char_length(_value ->> 'instructions') <= 2000,
      false
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('booking_no_show', 'calendar', true),
  ('booking_survey_dismissed', 'calendar', false)
on conflict (event) do nothing;
