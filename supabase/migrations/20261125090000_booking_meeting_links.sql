-- =============================================================================
-- 27.5 Scheduler: the call's link of a booking
--   * The guest's e-mails, the .ics and the reminders no longer carry the
--     call's link itself, only the booking's page (/s/r/<token>), which reads
--     the link when it is opened. Which link that is, the server decides:
--       1. the host's own link for this one meeting (bookings.meeting_link),
--       2. the booking's own room on Jitsi Meet when the type asks for one
--          (event_types.video_source = 'jitsi', bookings.video_room),
--       3. the permanent link of the host's profile,
--       4. none: "the host sends the link before the meeting" and a task for
--          the host (bookings.link_task_id).
--   * Every booking gets a room name when it is made (a random one, unique),
--     used only while its type asks for a room; switching a type over later
--     needs nothing new for the bookings it already has.
--   * Only the server writes a booking (scheduler_set_meeting_link,
--     scheduler_link_task, service role); the host's client reads the link and
--     the room of the bookings it may read.
-- Additive only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The meeting type: the permanent link, or a room for every booking
-- -----------------------------------------------------------------------------

alter table public.event_types
  add column video_source text not null default 'profile'
    check (video_source in ('profile', 'jitsi'));

grant insert (video_source), update (video_source) on public.event_types to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The booking: its own link, its room, the host's task
-- -----------------------------------------------------------------------------

-- "gradus-" and 12 characters of a 32-letter alphabet (no l, o, 0, 1), each
-- from a random byte of a v4 UUID (the version and variant bytes left out),
-- so 60 random bits: a room nobody guesses.
create or replace function public.scheduler_new_room()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  _alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  _bytes bytea := uuid_send(gen_random_uuid());
  _room text := 'gradus-';
  _i integer;
begin
  foreach _i in array array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13] loop
    _room := _room || substr(_alphabet, 1 + (get_byte(_bytes, _i) % 32), 1);
  end loop;
  return _room;
end;
$$;
revoke execute on function public.scheduler_new_room() from public, anon, authenticated;
grant execute on function public.scheduler_new_room() to service_role;

alter table public.bookings
  -- The host's own link for this one meeting (https, like the profile's).
  add column meeting_link text check (
    meeting_link is null or (char_length(meeting_link) <= 500 and meeting_link ~ '^https://[^\s/?#]+\.[^\s]+$')),
  -- The booking's room on meet.jit.si, used while its type asks for one.
  add column video_room text default public.scheduler_new_room() check (
    video_room is null or video_room ~ '^gradus-[a-km-np-z2-9]{12}$'),
  -- The host's task "send the link" of a video meeting without one.
  add column link_task_id uuid references public.crm_tasks (id) on delete set null;

create unique index bookings_video_room_idx on public.bookings (video_room) where video_room is not null;

-- The host reads the link and the room of their bookings (RLS as before).
grant select (meeting_link, video_room, link_task_id) on public.bookings to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The host sets the link of one meeting (the server, after the session)
-- -----------------------------------------------------------------------------

-- A live video meeting before its end; an empty link goes back to the type's.
-- Returns what was there before, so the server knows whether to tell the guest.
create or replace function public.scheduler_set_meeting_link(_booking uuid, _link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _kind text;
  _clean text := nullif(btrim(coalesce(_link, '')), '');
begin
  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.id is null or _b.status not in ('pending', 'confirmed') or _b.ends_at <= now() then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  select t.location_kind into _kind from public.event_types t where t.id = _b.event_type_id;
  if _kind is distinct from 'video' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if _clean is not null and (char_length(_clean) > 500 or _clean !~ '^https://[^\s/?#]+\.[^\s]+$') then
    raise exception 'invalid_link' using errcode = '22023';
  end if;
  update public.bookings set meeting_link = _clean where id = _b.id;
  return jsonb_build_object(
    'id', _b.id, 'status', _b.status, 'starts_at', _b.starts_at,
    'previous', _b.meeting_link, 'link', _clean);
end;
$$;
revoke execute on function public.scheduler_set_meeting_link(uuid, text) from public, anon, authenticated;
grant execute on function public.scheduler_set_meeting_link(uuid, text) to service_role;

-- The host's task to send the link of a confirmed video meeting that has
-- none: one per booking while it exists (calling again returns the same). On
-- the booking's contact and deal, assigned to and made by the host. Texts
-- from the server, in the host's language.
create or replace function public.scheduler_link_task(
  _booking uuid, _title text, _description text, _due_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _task uuid;
begin
  select * into _b from public.bookings b where b.id = _booking for update;
  if _b.id is null or _b.status <> 'confirmed' or _b.host_user_id is null
     or (_b.contact_id is null and _b.deal_id is null) then
    return null;
  end if;
  if _b.link_task_id is not null then
    return _b.link_task_id;
  end if;
  insert into public.crm_tasks (
    user_id, title, description, due_at, duration_minutes, assignee_id, deal_id, contact_id, created_by)
  values (
    _b.space_id, left(btrim(_title), 200), nullif(left(coalesce(_description, ''), 5000), ''), _due_at, 5,
    _b.host_user_id, _b.deal_id, _b.contact_id, _b.host_user_id)
  returning id into _task;
  update public.bookings set link_task_id = _task where id = _b.id;
  return _task;
end;
$$;
revoke execute on function public.scheduler_link_task(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.scheduler_link_task(uuid, text, text, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('booking_link_changed', 'calendar', true)
on conflict (event) do nothing;
