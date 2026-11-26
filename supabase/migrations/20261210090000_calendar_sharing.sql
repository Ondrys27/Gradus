-- =============================================================================
-- 30.3 Calendar sharing inside a company
--
--   * calendar_events.calendar_owner_id: whose calendar an event is in (null =
--     the one who made it, then the space). It differs from actor_id only for
--     an event someone wrote into another person's calendar through a write
--     share ("made by X"). The client never sets it: its own inserts are its
--     own calendar, a change keeps it.
--   * calendar_events.private: the others see a private event only as "Busy",
--     without its title, place or people, whatever the share; the row itself
--     reaches only its calendar's person and the one who made it (RLS).
--     calendar_connection_calendars.private_default makes everything read in
--     from that calendar private ("everything from Personal is private").
--   * calendar_shares: a person shares their calendar in a space with a
--     member, a group or the whole company at busy | read | write, for the
--     sources listed ('gradus' and the ids of their read Google / Apple
--     calendars). Written only by calendar_share_set / _remove / the answer
--     to a request. The owner of a space sees their people at busy without a
--     share unless user_settings.calendar_owner_sees_busy is off.
--   * Others' events are read only through calendar_shared_events() /
--     calendar_people_busy(): busy gives the times alone, read everything but
--     the private ones. Write creates and changes events in the person's
--     calendar in that space (calendar_shared_event_save / _delete), never
--     their private ones nor their sharing.
--   * calendar_share_requests: "May I see your calendar?" with a level and a
--     message; the answer (allow, allow at another level, decline) reaches the
--     one who asked. After a decline the same request waits seven days.
--   * calendar_event_attendees: a meeting found in "Find a common time" invites
--     the chosen people into their Gradus calendar; they accept or decline.
--   * calendar_view_people: the colour and checkbox each viewer keeps per person.
-- Additive: new tables, columns with defaults, replaced functions and policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Events: whose calendar, private
-- -----------------------------------------------------------------------------

alter table public.calendar_events
  add column calendar_owner_id uuid references auth.users (id) on delete set null,
  add column private boolean not null default false;

create index calendar_events_calendar_owner_idx
  on public.calendar_events (calendar_owner_id, starts_at) where calendar_owner_id is not null;

comment on column public.calendar_events.calendar_owner_id is
  'Whose calendar the event is in; null = coalesce(actor_id, user_id). Set only by the server (a write share).';
comment on column public.calendar_events.private is
  'Others see a private event only as busy time; the row reaches only its calendar''s person and its maker.';

-- The client's own inserts are its own calendar; a change keeps the calendar.
-- Only the event's person (or its maker) turns private on or off.
create or replace function public.calendar_events_share_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.calendar_owner_id := auth.uid();
    else
      new.calendar_owner_id := old.calendar_owner_id;
      if new.private is distinct from old.private
         and auth.uid() is distinct from coalesce(old.calendar_owner_id, old.actor_id, old.user_id)
         and auth.uid() is distinct from old.actor_id then
        new.private := old.private;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_events_share_guard() from public, anon, authenticated;

create trigger calendar_events_share_guard
  before insert or update on public.calendar_events
  for each row execute function public.calendar_events_share_guard();

-- "Everything from this calendar is private."
alter table public.calendar_connection_calendars
  add column private_default boolean not null default false;
grant select (private_default) on public.calendar_connection_calendars to authenticated;

-- Whether an event was read in from a calendar its person keeps private.
create or replace function public.calendar_event_from_private_calendar(_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_external_links l
    join public.calendar_connection_calendars c on c.id = l.calendar_id
    where l.event_id = _event and l.origin = 'external' and c.private_default
  );
$$;
revoke execute on function public.calendar_event_from_private_calendar(uuid) from public, anon;
grant execute on function public.calendar_event_from_private_calendar(uuid) to authenticated, service_role;

-- A private event, by its own flag or its calendar's.
create or replace function public.calendar_event_is_private(_event uuid, _private boolean, _source text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(_private, false)
    or (_source = 'external' and public.calendar_event_from_private_calendar(_event));
$$;
revoke execute on function public.calendar_event_is_private(uuid, boolean, text) from public, anon;
grant execute on function public.calendar_event_is_private(uuid, boolean, text) to authenticated, service_role;

create or replace function public.calendar_set_private_default(_calendar uuid, _private boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  update public.calendar_connection_calendars
  set private_default = coalesce(_private, false)
  where id = _calendar and user_id = auth.uid();
  return found;
end;
$$;
revoke execute on function public.calendar_set_private_default(uuid, boolean) from public, anon;
grant execute on function public.calendar_set_private_default(uuid, boolean) to authenticated;

-- Row protection: the person of the calendar (and its maker) reach their own
-- events as before; a private event reaches nobody else, not even the owner of
-- the space. Their own calendar also includes what others wrote into it.
drop policy if exists "calendar_events_scope_select" on public.calendar_events;
drop policy if exists "calendar_events_update_permission" on public.calendar_events;
drop policy if exists "calendar_events_delete_permission" on public.calendar_events;

create policy "calendar_events_scope_select" on public.calendar_events
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (actor_id = (select auth.uid()) or calendar_owner_id = (select auth.uid()))
      and user_id = any ((select public.member_spaces())::uuid[])
    )
    or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
  );
create policy "calendar_events_update_permission" on public.calendar_events
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('calendar', 'update'))::uuid[])
      and (
        actor_id = (select auth.uid())
        or calendar_owner_id = (select auth.uid())
        or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
      )
    )
  );
create policy "calendar_events_delete_permission" on public.calendar_events
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('calendar', 'update'))::uuid[])
      and (
        actor_id = (select auth.uid())
        or calendar_owner_id = (select auth.uid())
        or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
      )
    )
  );

create policy "calendar_events_private_select" on public.calendar_events
  as restrictive for select to authenticated
  using (
    coalesce(calendar_owner_id, actor_id, user_id) = (select auth.uid())
    or actor_id = (select auth.uid())
    or (not private and (source <> 'external' or not public.calendar_event_from_private_calendar(id)))
  );
create policy "calendar_events_private_update" on public.calendar_events
  as restrictive for update to authenticated
  using (
    coalesce(calendar_owner_id, actor_id, user_id) = (select auth.uid())
    or actor_id = (select auth.uid())
    or (not private and (source <> 'external' or not public.calendar_event_from_private_calendar(id)))
  );
create policy "calendar_events_private_delete" on public.calendar_events
  as restrictive for delete to authenticated
  using (
    coalesce(calendar_owner_id, actor_id, user_id) = (select auth.uid())
    or actor_id = (select auth.uid())
    or (not private and (source <> 'external' or not public.calendar_event_from_private_calendar(id)))
  );

-- The activity log never names a private event.
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
    jsonb_build_object(
      'title', case when new.private then null else public.activity_title(new.title) end,
      'kind', new.kind::text,
      'at', new.starts_at));
  return new;
end;
$$;

create or replace function public.calendar_events_private_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.private and not coalesce(old.private, false) then
    update public.activity_log set summary = summary - 'title'
    where object_kind = 'event' and object_id = new.id and summary ? 'title';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_events_private_activity() from public, anon, authenticated;
create trigger calendar_events_private_activity
  after update of private on public.calendar_events
  for each row execute function public.calendar_events_private_activity();

-- The outbox follows the calendar's person (an event written into someone's
-- calendar goes to their Google / Apple), otherwise as in 20261204090000.
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

-- -----------------------------------------------------------------------------
-- 2. The owner's default: busy times of their people
-- -----------------------------------------------------------------------------

alter table public.user_settings
  add column calendar_owner_sees_busy boolean not null default true;
comment on column public.user_settings.calendar_owner_sees_busy is
  'The owner of this space sees the busy times of their people without a share (30.3).';

-- -----------------------------------------------------------------------------
-- 3. Shares
-- -----------------------------------------------------------------------------

create or replace function public.calendar_level_rank(_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case _level when 'busy' then 1 when 'read' then 2 when 'write' then 3 else 0 end;
$$;

-- 'gradus' or the id of one of the person's calendars; 1–30, no repeats.
create or replace function public.calendar_share_sources_ok(_sources text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _sources is not null
    and cardinality(_sources) between 1 and 30
    and (select count(distinct s) from unnest(_sources) s) = cardinality(_sources)
    and coalesce((
      select bool_and(
        s = 'gradus'
        or s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      from unnest(_sources) s), false);
$$;

create table public.calendar_shares (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  -- Whose calendar.
  user_id uuid not null references auth.users (id) on delete cascade,
  target_kind text not null check (target_kind in ('member', 'group', 'space')),
  target_user_id uuid references auth.users (id) on delete cascade,
  group_id uuid references public.worker_groups (id) on delete cascade,
  level text not null check (level in ('busy', 'read', 'write')),
  calendars text[] not null default array['gradus'] check (public.calendar_share_sources_ok(calendars)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_shares_target_shape check (
    (target_kind = 'member' and target_user_id is not null and group_id is null)
    or (target_kind = 'group' and group_id is not null and target_user_id is null)
    or (target_kind = 'space' and target_user_id is null and group_id is null)
  ),
  constraint calendar_shares_not_self check (target_user_id is distinct from user_id)
);
comment on table public.calendar_shares is
  'Who sees a person''s calendar in a space (a member, a group, the whole company), how (busy, read, write) and which of their calendars. Written only by calendar_share_set / _remove and the answer to a request.';

create unique index calendar_shares_target_unique on public.calendar_shares (
  space_id, user_id, target_kind,
  coalesce(target_user_id, group_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index calendar_shares_target_user_idx on public.calendar_shares (target_user_id) where target_user_id is not null;
create index calendar_shares_group_idx on public.calendar_shares (group_id) where group_id is not null;

create trigger set_updated_at before update on public.calendar_shares
  for each row execute function public.set_updated_at();

alter table public.calendar_shares enable row level security;
-- The person reads their own shares; the others learn through calendar_visible_people().
create policy calendar_shares_select on public.calendar_shares for select to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
revoke all on public.calendar_shares from anon, authenticated;
grant select on public.calendar_shares to authenticated;
grant all on public.calendar_shares to service_role;

-- The sources of a person's calendar: Gradus and the Google / Apple calendars they read.
create or replace function public.calendar_person_sources(_person uuid)
returns table (key text, name text, writes boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select 'gradus'::text, null::text, false
  union all
  select c.id::text, c.name, c.write
  from public.calendar_connection_calendars c
  join public.calendar_connections k on k.id = c.connection_id
  where c.user_id = _person and c.read and _person is not null;
$$;
revoke execute on function public.calendar_person_sources(uuid) from public, anon, authenticated;

/**
 * What `_viewer` may see of `_owner`'s calendar in `_space`, per source: the
 * highest level of the shares that reach the viewer (directly, through one of
 * their groups, the whole company) and, for the owner of the space, busy of
 * every source of their people. Both must belong to the space now. Internal.
 */
create or replace function public.calendar_share_levels_of(_space uuid, _owner uuid, _viewer uuid)
returns table (source text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  with ok as (
    select coalesce(
      _owner is distinct from _viewer
      and public.space_member_of(_space, _owner)
      and public.space_member_of(_space, _viewer), false) as yes
  ),
  sources as (
    select s.key from public.calendar_person_sources(_owner) s
  ),
  viewer_groups as (
    select gm.group_id
    from public.memberships m
    join public.worker_group_members gm on gm.worker_id = m.worker_id
    where m.user_id = _viewer and m.space_id = _space and m.role = 'worker' and m.status = 'active'
  ),
  granted as (
    select unnest(s.calendars) as source, s.level
    from public.calendar_shares s
    where s.space_id = _space and s.user_id = _owner
      and (
        (s.target_kind = 'member' and s.target_user_id = _viewer)
        or (s.target_kind = 'group' and s.group_id in (select group_id from viewer_groups))
        or s.target_kind = 'space'
      )
    union all
    select src.key, 'busy'
    from sources src
    where _viewer = _space and _owner <> _space
      and coalesce(
        (select us.calendar_owner_sees_busy from public.user_settings us where us.user_id = _space),
        true)
  )
  select g.source, (array['busy', 'read', 'write'])[max(public.calendar_level_rank(g.level))]
  from granted g
  cross join ok
  where ok.yes and g.source in (select key from sources)
  group by g.source;
$$;
revoke execute on function public.calendar_share_levels_of(uuid, uuid, uuid) from public, anon, authenticated;

-- The people of a space whose calendars the signed-in account sees, with the
-- level of each source and whether it may write into their Gradus calendar
-- (and the person's Google / Apple calendar the event then goes to).
create or replace function public.calendar_visible_people(_space uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  is_owner boolean,
  level text,
  sources jsonb,
  can_write boolean,
  writes_to text
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select a.user_id, a.name, a.avatar_url, a.is_owner
    from public.active_members(_space) a
    where a.user_id <> auth.uid()
  ),
  levels as (
    select p.user_id, l.source, l.level
    from people p
    cross join lateral public.calendar_share_levels_of(_space, p.user_id, auth.uid()) l
  )
  select p.user_id, p.name, p.avatar_url, p.is_owner,
    (array['busy', 'read', 'write'])[max(public.calendar_level_rank(l.level))],
    jsonb_agg(jsonb_build_object(
      'key', l.source,
      'name', (select s.name from public.calendar_person_sources(p.user_id) s where s.key = l.source),
      'level', l.level) order by l.source = 'gradus' desc, l.source),
    bool_or(l.source = 'gradus' and l.level = 'write'),
    case when bool_or(l.source = 'gradus' and l.level = 'write') then (
      select s.name from public.calendar_person_sources(p.user_id) s where s.writes limit 1
    ) end
  from people p
  join levels l on l.user_id = p.user_id
  where auth.uid() is not null
  group by p.user_id, p.name, p.avatar_url, p.is_owner
  order by p.is_owner desc, lower(p.name);
$$;
revoke execute on function public.calendar_visible_people(uuid) from public, anon;
grant execute on function public.calendar_visible_people(uuid) to authenticated;

-- The signed-in account's own sources (for the form and the panel).
create or replace function public.calendar_my_sources()
returns table (key text, name text, writes boolean, private_default boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.name, s.writes,
    coalesce((select c.private_default from public.calendar_connection_calendars c
              where c.id::text = s.key), false)
  from public.calendar_person_sources(auth.uid()) s
  where auth.uid() is not null;
$$;
revoke execute on function public.calendar_my_sources() from public, anon;
grant execute on function public.calendar_my_sources() to authenticated;

-- Who sees my calendar here: my shares, and the owner's default when I work for them.
create or replace function public.calendar_my_shares(_space uuid)
returns table (
  entry text,
  share_id uuid,
  target_kind text,
  target_user_id uuid,
  group_id uuid,
  name text,
  avatar_url text,
  member_count integer,
  level text,
  calendars text[],
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select a.user_id, a.name, a.avatar_url from public.active_members(_space) a
  )
  select 'auto'::text, null::uuid, 'member'::text, _space, null::uuid,
    (select p.name from people p where p.user_id = _space),
    (select p.avatar_url from people p where p.user_id = _space),
    null::integer, 'busy'::text,
    array(select s.key from public.calendar_person_sources(auth.uid()) s),
    null::timestamptz
  where auth.uid() is not null and auth.uid() <> _space
    and public.is_space_member(_space)
    and coalesce(
      (select us.calendar_owner_sees_busy from public.user_settings us where us.user_id = _space), true)
  union all
  select 'share', s.id, s.target_kind, s.target_user_id, s.group_id,
    case s.target_kind
      when 'member' then (select p.name from people p where p.user_id = s.target_user_id)
      when 'group' then (select g.name from public.worker_groups g where g.id = s.group_id)
    end,
    case when s.target_kind = 'member'
      then (select p.avatar_url from people p where p.user_id = s.target_user_id) end,
    case when s.target_kind = 'group' then (
      select count(*) from public.worker_group_members gm
      join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
      where gm.group_id = s.group_id)::integer end,
    s.level, s.calendars, s.updated_at
  from public.calendar_shares s
  where s.space_id = _space and s.user_id = auth.uid()
    and public.is_space_member(_space)
    -- Shares to people who no longer work there are left out.
    and (s.target_kind <> 'member' or exists (select 1 from people p where p.user_id = s.target_user_id));
$$;
revoke execute on function public.calendar_my_shares(uuid) from public, anon;
grant execute on function public.calendar_my_shares(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Notifications in the bell
-- -----------------------------------------------------------------------------

alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check
  check (kind in (
    'invite_accepted', 'invite_declined', 'worker_left', 'invite_requested',
    'note_shared', 'notes_transferred',
    'calendar_shared', 'calendar_share_requested', 'calendar_share_approved',
    'calendar_share_declined', 'calendar_invite'
  ));

-- -----------------------------------------------------------------------------
-- 5. Setting a share
-- -----------------------------------------------------------------------------

/**
 * Shares the calendar of `_owner` in `_space` with a target or changes the
 * level and sources of the existing share of the same target. The people
 * who newly get access hear it in the bell. Internal; checks are the callers'.
 */
create or replace function public.calendar_share_upsert(
  _space uuid,
  _owner uuid,
  _target_kind text,
  _target uuid,
  _level text,
  _calendars text[],
  _notify boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _existing public.calendar_shares%rowtype;
  _id uuid;
  _recipients uuid[];
begin
  select * into _existing from public.calendar_shares s
  where s.space_id = _space and s.user_id = _owner and s.target_kind = _target_kind
    and coalesce(s.target_user_id, s.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(_target, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if _existing.id is not null then
    update public.calendar_shares
    set level = _level, calendars = coalesce(_calendars, _existing.calendars)
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into public.calendar_shares (space_id, user_id, target_kind, target_user_id, group_id, level, calendars)
  values (
    _space, _owner, _target_kind,
    case when _target_kind = 'member' then _target end,
    case when _target_kind = 'group' then _target end,
    _level, coalesce(_calendars, array['gradus'])
  )
  returning id into _id;

  if _notify then
    select coalesce(array_agg(distinct x.u), '{}') into _recipients from (
      select _target as u where _target_kind = 'member'
      union all
      select w.user_id from public.worker_group_members gm
      join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
      where _target_kind = 'group' and gm.group_id = _target
      union all
      select a.user_id from public.active_members(_space) a where _target_kind = 'space'
    ) x
    where x.u is not null and x.u <> _owner and public.space_member_of(_space, x.u);

    insert into public.account_notifications (user_id, kind, space_id, actor_id)
    select r, 'calendar_shared', _space, _owner from unnest(_recipients[1:500]) as r;
  end if;
  return _id;
end;
$$;
revoke execute on function public.calendar_share_upsert(uuid, uuid, text, uuid, text, text[], boolean)
  from public, anon, authenticated;

-- The signed-in account shares its calendar in a space it belongs to.
-- Errors: calendar_share_target, calendar_share_sources, not_signed_in.
create or replace function public.calendar_share_set(
  _space uuid,
  _target_kind text,
  _target uuid,
  _level text,
  _calendars text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_space_member(_space)
    or _target_kind not in ('member', 'group', 'space')
    or _level not in ('busy', 'read', 'write') then
    raise exception 'calendar_share_target' using errcode = 'P0001';
  end if;
  if _target_kind = 'member' then
    if _target is null or _target = _uid or not public.space_member_of(_space, _target) then
      raise exception 'calendar_share_target' using errcode = 'P0001';
    end if;
  elsif _target_kind = 'group' then
    if _target is null or not exists (
      select 1 from public.worker_groups g where g.id = _target and g.owner_id = _space
    ) then
      raise exception 'calendar_share_target' using errcode = 'P0001';
    end if;
  else
    _target := null;
  end if;
  if not public.calendar_share_sources_ok(_calendars)
    or exists (
      select 1 from unnest(_calendars) c
      where c not in (select s.key from public.calendar_person_sources(_uid) s)
    ) then
    raise exception 'calendar_share_sources' using errcode = 'P0001';
  end if;
  return public.calendar_share_upsert(_space, _uid, _target_kind, _target, _level, _calendars, true);
end;
$$;
revoke execute on function public.calendar_share_set(uuid, text, uuid, text, text[]) from public, anon;
grant execute on function public.calendar_share_set(uuid, text, uuid, text, text[]) to authenticated;

create or replace function public.calendar_share_remove(_share uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from public.calendar_shares where id = _share and user_id = auth.uid();
  return found;
end;
$$;
revoke execute on function public.calendar_share_remove(uuid) from public, anon;
grant execute on function public.calendar_share_remove(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Requests
-- -----------------------------------------------------------------------------

create table public.calendar_share_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  -- Who asks.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Whose calendar.
  to_user_id uuid not null references auth.users (id) on delete cascade,
  level text not null check (level in ('busy', 'read', 'write')),
  message text check (message is null or char_length(message) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  approved_level text check (approved_level is null or approved_level in ('busy', 'read', 'write')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint calendar_share_requests_not_self check (user_id <> to_user_id)
);
comment on table public.calendar_share_requests is
  'A request to see someone''s calendar in a space and its answer. Written only by calendar_share_request_create / _respond.';
create unique index calendar_share_requests_pending_idx
  on public.calendar_share_requests (space_id, user_id, to_user_id) where status = 'pending';
create index calendar_share_requests_to_idx on public.calendar_share_requests (to_user_id, status, created_at desc);
create index calendar_share_requests_from_idx on public.calendar_share_requests (user_id, created_at desc);

alter table public.calendar_share_requests enable row level security;
create policy calendar_share_requests_select on public.calendar_share_requests for select to authenticated
  using (
    (user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
    and space_id = any ((select public.member_spaces())::uuid[])
  );
revoke all on public.calendar_share_requests from anon, authenticated;
grant select on public.calendar_share_requests to authenticated;
grant all on public.calendar_share_requests to service_role;

alter table public.account_notifications
  add column calendar_request_id uuid references public.calendar_share_requests (id) on delete cascade,
  add column event_id uuid references public.calendar_events (id) on delete cascade,
  add column share_level text check (share_level is null or share_level in ('busy', 'read', 'write'));

/** After a decline the same person may ask again in this many days. */
create or replace function public.calendar_request_retry_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7 $$;

-- Asks `_to` to share their calendar. A pending request of the same pair is
-- updated; after a decline the next one waits seven days.
-- Errors: calendar_request_target, calendar_request_too_soon (detail = when),
-- calendar_request_already, calendar_request_limit.
create or replace function public.calendar_share_request_create(
  _space uuid,
  _to uuid,
  _level text,
  _message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _text text := nullif(left(btrim(coalesce(_message, '')), 500), '');
  _pending uuid;
  _declined timestamptz;
  _have text;
  _id uuid;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_space_member(_space) or _to is null or _to = _uid
    or not public.space_member_of(_space, _to)
    or _level not in ('busy', 'read', 'write') then
    raise exception 'calendar_request_target' using errcode = 'P0001';
  end if;

  select l.level into _have from public.calendar_share_levels_of(_space, _to, _uid) l
  where l.source = 'gradus';
  if public.calendar_level_rank(_have) >= public.calendar_level_rank(_level) then
    raise exception 'calendar_request_already' using errcode = 'P0001';
  end if;

  select r.responded_at into _declined from public.calendar_share_requests r
  where r.space_id = _space and r.user_id = _uid and r.to_user_id = _to and r.status = 'declined'
  order by r.responded_at desc nulls last limit 1;
  if _declined is not null and _declined > now() - make_interval(days => public.calendar_request_retry_days()) then
    raise exception 'calendar_request_too_soon' using errcode = 'P0001',
      detail = to_char((_declined + make_interval(days => public.calendar_request_retry_days())) at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  select r.id into _pending from public.calendar_share_requests r
  where r.space_id = _space and r.user_id = _uid and r.to_user_id = _to and r.status = 'pending'
  for update;
  if _pending is not null then
    update public.calendar_share_requests set level = _level, message = _text where id = _pending;
    return _pending;
  end if;

  if (select count(*) from public.calendar_share_requests r
      where r.user_id = _uid and r.created_at > now() - interval '1 day') >= 30 then
    raise exception 'calendar_request_limit' using errcode = 'P0001';
  end if;

  insert into public.calendar_share_requests (space_id, user_id, to_user_id, level, message)
  values (_space, _uid, _to, _level, _text)
  returning id into _id;
  insert into public.account_notifications (user_id, kind, space_id, actor_id, calendar_request_id, share_level)
  values (_to, 'calendar_share_requested', _space, _uid, _id, _level);
  return _id;
end;
$$;
revoke execute on function public.calendar_share_request_create(uuid, uuid, text, text) from public, anon;
grant execute on function public.calendar_share_request_create(uuid, uuid, text, text) to authenticated;

-- The person asked answers: allow (at the asked level or another one) or
-- decline. Allowing shares Gradus and every calendar they read (an existing
-- share to the person keeps its calendars). The one who asked hears it.
-- Errors: not_found.
create or replace function public.calendar_share_request_respond(
  _request uuid,
  _approve boolean,
  _level text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _row public.calendar_share_requests%rowtype;
  _chosen text;
  _have text;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into _row from public.calendar_share_requests r
  where r.id = _request and r.to_user_id = _uid and r.status = 'pending'
  for update;
  if _row.id is null or not public.is_space_member(_row.space_id)
    or not public.space_member_of(_row.space_id, _row.user_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if coalesce(_approve, false) then
    _chosen := coalesce(_level, _row.level);
    if _chosen not in ('busy', 'read', 'write') then
      raise exception 'calendar_share_target' using errcode = 'P0001';
    end if;
    -- An existing share to the person keeps its calendars, a new one gets them all.
    select s.level into _have from public.calendar_shares s
    where s.space_id = _row.space_id and s.user_id = _uid
      and s.target_kind = 'member' and s.target_user_id = _row.user_id;
    perform public.calendar_share_upsert(
      _row.space_id, _uid, 'member', _row.user_id, _chosen,
      case when _have is null
        then array(select s.key from public.calendar_person_sources(_uid) s)
        else null end,
      false);
    update public.calendar_share_requests
    set status = 'approved', approved_level = _chosen, responded_at = now()
    where id = _row.id;
    insert into public.account_notifications (user_id, kind, space_id, actor_id, calendar_request_id, share_level)
    values (_row.user_id, 'calendar_share_approved', _row.space_id, _uid, _row.id, _chosen);
    update public.account_notifications set read_at = coalesce(read_at, now())
    where user_id = _uid and calendar_request_id = _row.id;
    return 'approved';
  end if;

  update public.calendar_share_requests set status = 'declined', responded_at = now() where id = _row.id;
  insert into public.account_notifications (user_id, kind, space_id, actor_id, calendar_request_id, share_level)
  values (_row.user_id, 'calendar_share_declined', _row.space_id, _uid, _row.id, _row.level);
  update public.account_notifications set read_at = coalesce(read_at, now())
  where user_id = _uid and calendar_request_id = _row.id;
  return 'declined';
end;
$$;
revoke execute on function public.calendar_share_request_respond(uuid, boolean, text) from public, anon;
grant execute on function public.calendar_share_request_respond(uuid, boolean, text) to authenticated;

-- Requests for the signed-in account: the ones waiting for it in any company it
-- belongs to (like the bell), and its own of the last 30 days in `_space`,
-- with the other person's name.
create or replace function public.calendar_share_requests_list(_space uuid)
returns table (
  id uuid,
  space_id uuid,
  incoming boolean,
  person_id uuid,
  name text,
  avatar_url text,
  level text,
  message text,
  status text,
  approved_level text,
  created_at timestamptz,
  responded_at timestamptz,
  retry_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.space_id, r.to_user_id = auth.uid(),
    case when r.to_user_id = auth.uid() then r.user_id else r.to_user_id end,
    p.name, p.avatar_url, r.level, r.message, r.status, r.approved_level, r.created_at, r.responded_at,
    case when r.status = 'declined' and r.user_id = auth.uid()
      then r.responded_at + make_interval(days => public.calendar_request_retry_days()) end
  from public.calendar_share_requests r
  join lateral (
    select a.name, a.avatar_url from public.active_members(r.space_id) a
    where a.user_id = case when r.to_user_id = auth.uid() then r.user_id else r.to_user_id end
  ) p on true
  where auth.uid() is not null
    and (
      (r.to_user_id = auth.uid() and r.status = 'pending'
        and r.space_id = any (public.member_spaces()))
      or (r.user_id = auth.uid() and r.space_id = _space and r.created_at > now() - interval '30 days')
    )
  order by (r.to_user_id = auth.uid() and r.status = 'pending') desc, r.created_at desc
  limit 100;
$$;
revoke execute on function public.calendar_share_requests_list(uuid) from public, anon;
grant execute on function public.calendar_share_requests_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Meetings with people (invites into their Gradus calendar)
-- -----------------------------------------------------------------------------

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (event_id, user_id)
);
comment on table public.calendar_event_attendees is
  'People invited to a meeting in a space; it is in their Gradus calendar until they decline. Written only by calendar_meeting_create / calendar_invite_respond.';
create index calendar_event_attendees_user_idx on public.calendar_event_attendees (user_id, space_id);

alter table public.calendar_event_attendees enable row level security;
create policy calendar_event_attendees_select on public.calendar_event_attendees for select to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      user_id = (select auth.uid())
      or exists (select 1 from public.calendar_events e where e.id = event_id)
    )
  );
revoke all on public.calendar_event_attendees from anon, authenticated;
grant select on public.calendar_event_attendees to authenticated;
grant all on public.calendar_event_attendees to service_role;

-- A meeting in the signed-in account's calendar with people of the space,
-- who get it in their Gradus calendar and a line in the bell.
-- Errors: calendar_meeting_denied, calendar_meeting_invalid.
create or replace function public.calendar_meeting_create(
  _space uuid,
  _title text,
  _starts timestamptz,
  _ends timestamptz,
  _attendees uuid[],
  _description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _title_clean text := btrim(coalesce(_title, ''));
  _people uuid[];
  _id uuid;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_space_member(_space)
    or not (_space = _uid or _space = any (public.permitted_spaces('calendar', 'create'))) then
    raise exception 'calendar_meeting_denied' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct p), '{}') into _people
  from unnest(coalesce(_attendees, '{}')) p
  where p is not null and p <> _uid;
  if char_length(_title_clean) not between 1 and 120
    or _starts is null or _ends is null or _ends <= _starts or _ends > _starts + interval '1 day'
    or cardinality(_people) not between 1 and 30
    or char_length(coalesce(_description, '')) > 2000
    or exists (select 1 from unnest(_people) p where not public.space_member_of(_space, p)) then
    raise exception 'calendar_meeting_invalid' using errcode = 'P0001';
  end if;

  insert into public.calendar_events (
    user_id, actor_id, calendar_owner_id, title, kind, starts_at, ends_at, all_day, description, source)
  values (
    _space, _uid, _uid, _title_clean, 'meeting', _starts, _ends, false,
    nullif(btrim(coalesce(_description, '')), ''), 'manual')
  returning id into _id;

  insert into public.calendar_event_attendees (event_id, space_id, user_id, invited_by)
  select _id, _space, p, _uid from unnest(_people) p;
  insert into public.account_notifications (user_id, kind, space_id, actor_id, event_id)
  select p, 'calendar_invite', _space, _uid, _id from unnest(_people) p;
  return _id;
end;
$$;
revoke execute on function public.calendar_meeting_create(uuid, text, timestamptz, timestamptz, uuid[], text)
  from public, anon;
grant execute on function public.calendar_meeting_create(uuid, text, timestamptz, timestamptz, uuid[], text)
  to authenticated;

create or replace function public.calendar_invite_respond(_event uuid, _accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  update public.calendar_event_attendees a
  set status = case when coalesce(_accept, false) then 'accepted' else 'declined' end,
      responded_at = now()
  where a.event_id = _event and a.user_id = auth.uid() and public.is_space_member(a.space_id);
  return found;
end;
$$;
revoke execute on function public.calendar_invite_respond(uuid, boolean) from public, anon;
grant execute on function public.calendar_invite_respond(uuid, boolean) to authenticated;

-- The people of a meeting with their answers, for whoever sees it.
create or replace function public.calendar_event_people(_event uuid)
returns table (user_id uuid, name text, avatar_url text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, coalesce(m.name, public.space_person_name(a.space_id, a.user_id)), m.avatar_url, a.status
  from public.calendar_event_attendees a
  left join lateral (
    select x.name, x.avatar_url from public.active_members(a.space_id) x where x.user_id = a.user_id
  ) m on true
  where a.event_id = _event
    and public.is_space_member(a.space_id)
    and (
      exists (select 1 from public.calendar_event_attendees me
              where me.event_id = _event and me.user_id = auth.uid())
      or exists (
        select 1 from public.calendar_events e
        where e.id = _event
          and (e.user_id = auth.uid()
               or coalesce(e.calendar_owner_id, e.actor_id) = auth.uid()
               or (e.user_id = any (public.permitted_spaces('calendar', 'view_all')) and not e.private)))
    )
  order by lower(coalesce(m.name, ''))
  limit 31;
$$;
revoke execute on function public.calendar_event_people(uuid) from public, anon;
grant execute on function public.calendar_event_people(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Reading others' calendars
-- -----------------------------------------------------------------------------

/**
 * The events of the people whose calendars the signed-in account sees in
 * `_space`, between two instants (at most 62 days): the times always, the
 * rest only at read or write and never of a private event. Their calendar is
 * their Gradus events in this space and in their own (not demo, not a deal's
 * delivery date), the meetings they are invited to here, and the Google /
 * Apple calendars they read, each source at its own level. Meetings the
 * account is invited to come too, in full. The calendar drops what it
 * already reads itself (same id).
 */
create or replace function public.calendar_shared_events(_space uuid, _from timestamptz, _to timestamptz)
returns table (
  id uuid,
  person_id uuid,
  level text,
  busy_only boolean,
  private boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  title text,
  description text,
  location text,
  kind text,
  source text,
  calendar_key text,
  created_by uuid,
  created_by_name text,
  can_edit boolean,
  invite_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _until timestamptz;
begin
  if _uid is null or _from is null or _to is null or _to <= _from or not public.is_space_member(_space) then
    return;
  end if;
  _until := least(_to, _from + interval '62 days');

  return query
  with people as (
    select a.user_id from public.active_members(_space) a where a.user_id <> _uid
  ),
  levels as (
    select p.user_id as person, l.source, l.level
    from people p
    cross join lateral public.calendar_share_levels_of(_space, p.user_id, _uid) l
  ),
  persons as (
    select distinct person from levels
  ),
  own_events as (
    select e.*, coalesce(e.calendar_owner_id, e.actor_id, e.user_id) as person
    from public.calendar_events e
    where e.starts_at < _until and coalesce(e.ends_at, e.starts_at) >= _from
      and not e.is_demo and e.source <> 'deal_deadline'
      and coalesce(e.calendar_owner_id, e.actor_id, e.user_id) in (select person from persons)
      and e.user_id in (select _space union select person from persons)
      and (e.user_id = _space or e.user_id = coalesce(e.calendar_owner_id, e.actor_id, e.user_id))
  ),
  invited as (
    select e.*, a.user_id as person
    from public.calendar_event_attendees a
    join public.calendar_events e on e.id = a.event_id
    where a.space_id = _space and a.status <> 'declined'
      and a.user_id in (select person from persons)
      and e.starts_at < _until and coalesce(e.ends_at, e.starts_at) >= _from
  ),
  candidates as (
    select o.*,
      case when o.source = 'external'
        then (select l.calendar_id::text from public.calendar_external_links l where l.event_id = o.id)
        else 'gradus' end as key
    from own_events o
    union all
    select i.*, 'gradus' from invited i
  ),
  shown as (
    select c.*, lv.level as lvl,
      public.calendar_event_is_private(c.id, c.private, c.source) as hidden
    from candidates c
    join levels lv on lv.person = c.person and lv.source = c.key
  ),
  mine as (
    select e.*, coalesce(e.calendar_owner_id, e.actor_id, e.user_id) as person, a.status as invite
    from public.calendar_event_attendees a
    join public.calendar_events e on e.id = a.event_id
    where a.space_id = _space and a.user_id = _uid
      and e.starts_at < _until and coalesce(e.ends_at, e.starts_at) >= _from
  ),
  picked as (
    select s.id, s.person, s.lvl, (s.lvl = 'busy' or s.hidden) as busy_only, s.hidden,
      s.starts_at, s.ends_at, s.all_day, s.title, s.description, s.location, s.kind::text as kind,
      s.source, s.key, s.actor_id, s.user_id, null::text as invite
    from shown s
    union all
    select m.id, m.person, 'invite', false, m.private,
      m.starts_at, m.ends_at, m.all_day, m.title, m.description, m.location, m.kind::text,
      m.source, 'gradus', m.actor_id, m.user_id, m.invite
    from mine m
  ),
  best as (
    select distinct on (r.id) r.*
    from picked r
    order by r.id, (r.invite is not null) desc, r.busy_only asc,
      public.calendar_level_rank(r.lvl) desc
  )
  select b.id, b.person, b.lvl, b.busy_only, b.hidden,
    b.starts_at, b.ends_at, b.all_day,
    case when b.busy_only then null else b.title end,
    case when b.busy_only then null else b.description end,
    case when b.busy_only then null else b.location end,
    case when b.busy_only then null else b.kind end,
    case when b.busy_only then null else b.source end,
    b.key,
    case when b.busy_only then null else b.actor_id end,
    case when b.busy_only or b.actor_id is null or b.actor_id = b.person then null
      else public.space_person_name(_space, b.actor_id) end,
    (b.lvl = 'write' and b.key = 'gradus' and b.user_id = _space and b.source = 'manual'
      and b.invite is null and (not b.hidden or b.actor_id = _uid)),
    b.invite
  from best b
  order by b.starts_at
  limit 2000;
end;
$$;
revoke execute on function public.calendar_shared_events(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_shared_events(uuid, timestamptz, timestamptz) to authenticated;

/**
 * Busy times of the chosen people of `_space` (and of the signed-in account
 * itself) between two instants, for "Find a common time" and Grady: only
 * times, from the sources the account may see at least as busy. A person who
 * shares nothing comes back once with known = false ("we don't know"). Times
 * marked free in Google are left out; all-day events are flagged.
 */
create or replace function public.calendar_people_busy(
  _space uuid,
  _people uuid[],
  _from timestamptz,
  _to timestamptz
)
returns table (person_id uuid, known boolean, starts_at timestamptz, ends_at timestamptz, all_day boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _until timestamptz;
begin
  if _uid is null or _from is null or _to is null or _to <= _from or not public.is_space_member(_space) then
    return;
  end if;
  _until := least(_to, _from + interval '62 days');

  return query
  with asked as (
    select distinct p as person from unnest(coalesce(_people, '{}')) p
    where p is not null and public.space_member_of(_space, p)
    limit 31
  ),
  levels as (
    select a.person, s.key as source
    from asked a
    cross join lateral public.calendar_person_sources(a.person) s
    where a.person = _uid
    union all
    select a.person, l.source
    from asked a
    cross join lateral public.calendar_share_levels_of(_space, a.person, _uid) l
    where a.person <> _uid
  ),
  events as (
    select coalesce(e.calendar_owner_id, e.actor_id, e.user_id) as person, e.id, e.source,
      e.starts_at, e.ends_at, e.all_day
    from public.calendar_events e
    where e.starts_at < _until and coalesce(e.ends_at, e.starts_at) >= _from
      and not e.is_demo and e.source <> 'deal_deadline'
      and coalesce(e.calendar_owner_id, e.actor_id, e.user_id) in (select person from asked)
      and e.user_id in (select _space union select person from asked)
      and (e.user_id = _space or e.user_id = coalesce(e.calendar_owner_id, e.actor_id, e.user_id))
    union all
    select a.user_id, e.id, 'manual', e.starts_at, e.ends_at, e.all_day
    from public.calendar_event_attendees a
    join public.calendar_events e on e.id = a.event_id
    where a.space_id = _space and a.status <> 'declined'
      and a.user_id in (select person from asked)
      and e.starts_at < _until and coalesce(e.ends_at, e.starts_at) >= _from
  ),
  keyed as (
    select ev.*,
      case when ev.source = 'external' then l.calendar_id::text else 'gradus' end as key,
      coalesce(l.transparent, false) as free
    from events ev
    left join public.calendar_external_links l on l.event_id = ev.id and ev.source = 'external'
  )
  select k.person, true, k.starts_at, coalesce(k.ends_at, k.starts_at + interval '1 hour'), k.all_day
  from keyed k
  join levels lv on lv.person = k.person and lv.source = k.key
  where not k.free
  union all
  select a.person, false, null::timestamptz, null::timestamptz, false
  from asked a
  where not exists (select 1 from levels lv where lv.person = a.person)
  order by 1, 3 nulls first
  limit 5000;
end;
$$;
revoke execute on function public.calendar_people_busy(uuid, uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_people_busy(uuid, uuid[], timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Writing into someone's calendar (write)
-- -----------------------------------------------------------------------------

-- Creates (no `_event`) or changes an event in `_owner`'s Gradus calendar in
-- `_space`, marked as made by the signed-in account. Only with write on
-- their Gradus calendar; never their private events, a booking, a deal's
-- delivery date or what came from Google / Apple.
-- Errors: calendar_write_denied, calendar_event_invalid, not_found.
create or replace function public.calendar_shared_event_save(
  _space uuid,
  _owner uuid,
  _event uuid,
  _title text,
  _kind text,
  _starts timestamptz,
  _ends timestamptz,
  _all_day boolean,
  _description text default null,
  _private boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _title_clean text := btrim(coalesce(_title, ''));
  _row public.calendar_events%rowtype;
  _id uuid;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_space_member(_space) or _owner is null or _owner = _uid
    or not exists (
      select 1 from public.calendar_share_levels_of(_space, _owner, _uid) l
      where l.source = 'gradus' and l.level = 'write'
    ) then
    raise exception 'calendar_write_denied' using errcode = '42501';
  end if;
  if char_length(_title_clean) not between 1 and 120
    or _kind not in ('meeting', 'task', 'deadline')
    or _starts is null
    or (not coalesce(_all_day, false) and (_ends is null or _ends <= _starts))
    or (_ends is not null and _ends < _starts)
    or char_length(coalesce(_description, '')) > 2000 then
    raise exception 'calendar_event_invalid' using errcode = 'P0001';
  end if;

  if _event is null then
    insert into public.calendar_events (
      user_id, actor_id, calendar_owner_id, title, kind, starts_at, ends_at, all_day,
      description, source, private)
    values (
      _space, _uid, _owner, _title_clean, _kind::public.calendar_event_kind, _starts, _ends,
      coalesce(_all_day, false), nullif(btrim(coalesce(_description, '')), ''), 'manual',
      coalesce(_private, false))
    returning id into _id;
    return _id;
  end if;

  select * into _row from public.calendar_events e where e.id = _event for update;
  if _row.id is null or _row.user_id <> _space
    or coalesce(_row.calendar_owner_id, _row.actor_id, _row.user_id) <> _owner then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if _row.source <> 'manual'
    or (public.calendar_event_is_private(_row.id, _row.private, _row.source) and _row.actor_id is distinct from _uid) then
    raise exception 'calendar_write_denied' using errcode = '42501';
  end if;
  update public.calendar_events set
    title = _title_clean,
    kind = _kind::public.calendar_event_kind,
    starts_at = _starts,
    ends_at = _ends,
    all_day = coalesce(_all_day, false),
    description = nullif(btrim(coalesce(_description, '')), ''),
    -- Only the one who made it decides whether it is private.
    private = case when _row.actor_id = _uid then coalesce(_private, _row.private) else _row.private end
  where id = _row.id;
  return _row.id;
end;
$$;
revoke execute on function public.calendar_shared_event_save(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, boolean, text, boolean) from public, anon;
grant execute on function public.calendar_shared_event_save(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, boolean, text, boolean) to authenticated;

create or replace function public.calendar_shared_event_delete(_event uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _row public.calendar_events%rowtype;
  _owner uuid;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into _row from public.calendar_events e where e.id = _event for update;
  if _row.id is null then
    return false;
  end if;
  _owner := coalesce(_row.calendar_owner_id, _row.actor_id, _row.user_id);
  if _owner = _uid or _row.source <> 'manual'
    or not public.is_space_member(_row.user_id)
    or (public.calendar_event_is_private(_row.id, _row.private, _row.source) and _row.actor_id is distinct from _uid)
    or not exists (
      select 1 from public.calendar_share_levels_of(_row.user_id, _owner, _uid) l
      where l.source = 'gradus' and l.level = 'write'
    ) then
    raise exception 'calendar_write_denied' using errcode = '42501';
  end if;
  delete from public.calendar_events where id = _row.id;
  return true;
end;
$$;
revoke execute on function public.calendar_shared_event_delete(uuid) from public, anon;
grant execute on function public.calendar_shared_event_delete(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. The viewer's colour and checkbox per person
-- -----------------------------------------------------------------------------

create table public.calendar_view_people (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null references auth.users (id) on delete cascade,
  tone text not null default 'teal' check (tone in ('violet', 'teal', 'gold', 'green', 'pink')),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, person_id)
);
comment on table public.calendar_view_people is
  'The colour and the checkbox a viewer keeps for a person''s calendar. The viewer''s own rows.';

create trigger set_updated_at before update on public.calendar_view_people
  for each row execute function public.set_updated_at();

alter table public.calendar_view_people enable row level security;
create policy calendar_view_people_select on public.calendar_view_people for select to authenticated
  using (user_id = (select auth.uid()));
create policy calendar_view_people_insert on public.calendar_view_people for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy calendar_view_people_update on public.calendar_view_people for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy calendar_view_people_delete on public.calendar_view_people for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.calendar_view_people from anon;
grant select, insert, update, delete on public.calendar_view_people to authenticated;
grant all on public.calendar_view_people to service_role;

-- -----------------------------------------------------------------------------
-- 11. Who did what, for the bell
-- -----------------------------------------------------------------------------

create or replace function public.calendar_notification_labels(_ids uuid[])
returns table (
  id uuid,
  actor_name text,
  level text,
  request_status text,
  event_title text,
  event_starts_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
    case when a.actor_id is null or a.space_id is null then null
      else public.space_person_name(a.space_id, a.actor_id) end,
    a.share_level,
    (select r.status from public.calendar_share_requests r where r.id = a.calendar_request_id),
    (select e.title from public.calendar_events e
     join public.calendar_event_attendees x on x.event_id = e.id and x.user_id = auth.uid()
     where e.id = a.event_id and public.is_space_member(x.space_id)),
    (select e.starts_at from public.calendar_events e
     join public.calendar_event_attendees x on x.event_id = e.id and x.user_id = auth.uid()
     where e.id = a.event_id and public.is_space_member(x.space_id))
  from public.account_notifications a
  where a.id = any (_ids[1:50]) and a.user_id = auth.uid();
$$;
revoke execute on function public.calendar_notification_labels(uuid[]) from public, anon;
grant execute on function public.calendar_notification_labels(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Grady's bubble: a request waiting for the person
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'overdueCrmTask', 'workerInvite', 'cashLow', 'bookingPending', 'bookingNew', 'taskCompleted',
  'calendarShareRequest', 'insight', 'pathReady', 'briefing', 'question'
));

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
                       'bookingPending', 'bookingNew', 'calendarShareRequest')
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
-- 13. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('calendar_share_saved', 'calendar', true),
  ('calendar_share_removed', 'calendar', true),
  ('calendar_share_requested', 'calendar', true),
  ('calendar_share_request_answered', 'calendar', true),
  ('calendar_shared_event_saved', 'calendar', true),
  ('calendar_common_time_searched', 'calendar', true),
  ('calendar_meeting_invited', 'calendar', true),
  ('calendar_invite_answered', 'calendar', true)
on conflict (event) do nothing;

-- -----------------------------------------------------------------------------
-- 14. Groups for "Find a common time": who is in each (active people only)
-- -----------------------------------------------------------------------------

create or replace function public.calendar_groups(_space uuid)
returns table (id uuid, name text, color text, people uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.color,
    coalesce(array(
      select w.user_id from public.worker_group_members gm
      join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
      join public.memberships m on m.worker_id = w.id and m.status = 'active'
      where gm.group_id = g.id
      order by w.user_id
    ), '{}')
  from public.worker_groups g
  where g.owner_id = _space and public.is_space_member(_space)
  order by g.position, lower(g.name)
  limit 200;
$$;
revoke execute on function public.calendar_groups(uuid) from public, anon;
grant execute on function public.calendar_groups(uuid) to authenticated;

-- The calendar tells the account's own events of each Google / Apple calendar apart.
grant select (calendar_id) on public.calendar_external_links to authenticated;

-- Requests waiting for a person, for Grady's bubble: the signed-in account's
-- own, or any person's for the server (the daily watch has no session).
create or replace function public.calendar_requests_waiting(_user uuid)
returns table (id uuid, space_id uuid, name text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.space_id, public.space_person_name(r.space_id, r.user_id), r.level
  from public.calendar_share_requests r
  where r.to_user_id = _user
    and _user = coalesce(auth.uid(), _user)
    and r.status = 'pending'
    and public.space_member_of(r.space_id, _user)
    and public.space_member_of(r.space_id, r.user_id)
  order by r.created_at desc
  limit 3;
$$;
revoke execute on function public.calendar_requests_waiting(uuid) from public, anon;
grant execute on function public.calendar_requests_waiting(uuid) to authenticated, service_role;
