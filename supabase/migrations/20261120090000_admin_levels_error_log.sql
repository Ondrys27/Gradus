-- =============================================================================
-- Full and limited administrators, the error log (step 27.2)
--
--   * user_roles.level: 'full' | 'limited' for the admin role (null for every
--     other role; an admin row without a level counts as limited). A full
--     administrator may do everything the owner may in the administration,
--     except the Administrators section (invite, change a level, remove) and
--     anything that would remove the owner or hand the ownership over. The
--     one admin there is today (Váša, a co-owner) becomes full here.
--   * admin_invites.level: chosen by the owner with the invitation (default
--     limited); admin_invite_accept() grants the role with it.
--   * admin_session_touch() also says the level ('full' for the owner).
--   * admin_require_owner() now lets in the owner OR a full administrator
--     (live admin session, aal2), so every writer that called it (plan
--     catalog, AI caps and exceptions, Grady's rules, error alerts, manual
--     subscriptions, partner payouts, currencies of the catalog) checks the
--     level itself, not only the interface. The Administrators section moves
--     to admin_require_sole_owner(): admin_invite_create / _revoke,
--     admin_remove and the new admin_set_level().
--   * admin_members() returns the level too.
--   * admin_notify_prefs: whether an administrator wants the e-mail "X changed
--     …" when another one publishes plans or changes AI caps. Server only.
--   * error_groups: the state of an error (its fingerprint) in the error log:
--     new | in_progress | resolved | ignored. A resolved error that happens
--     again goes back to new with returned_at (trigger on error_events).
--     admin_error_groups() lists the groups, admin_error_group_reports() the
--     bug reports filed with one of its codes. Server only.
--   * error_alert_sends.to_emails: who an e-mail about an error went to (the
--     administrators' own addresses from the alert settings, never a user's).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Levels
-- ---------------------------------------------------------------------------
alter table public.user_roles
  add column level text check (level is null or level in ('full', 'limited'));
comment on column public.user_roles.level is
  'For the admin role: full (everything the owner may in the administration except the Administrators section) or limited. Null = limited.';

alter table public.admin_invites
  add column level text not null default 'limited' check (level in ('full', 'limited'));

-- The administrator there is today is a co-owner: full.
update public.user_roles set level = 'full' where role = 'admin' and level is null;

-- The gate, as in step 14.4, with the level next to the role.
create or replace function public.admin_session_touch(_activity boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  _sid uuid;
  _totp_at timestamptz;
  _now timestamptz := now();
  _row public.admin_sessions;
  _role text;
  _level text;
begin
  if _uid is null or _claims ->> 'aal' is distinct from 'aal2' then
    return jsonb_build_object('status', 'denied');
  end if;
  if public.has_role(_uid, 'owner') then
    _role := 'owner';
    _level := 'full';
  elsif public.has_role(_uid, 'admin') then
    _role := 'admin';
    select coalesce(r.level, 'limited') into _level
    from public.user_roles r where r.user_id = _uid and r.role = 'admin';
  end if;
  if _role is null then
    return jsonb_build_object('status', 'denied');
  end if;

  if coalesce(_claims ->> 'session_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    return jsonb_build_object('status', 'denied');
  end if;
  _sid := (_claims ->> 'session_id')::uuid;
  _totp_at := public.jwt_totp_at(_claims);
  if _totp_at is null then
    return jsonb_build_object('status', 'denied');
  end if;

  select * into _row from public.admin_sessions where session_id = _sid for update;
  if not found then
    if _totp_at < _now - interval '8 hours' then
      return jsonb_build_object('status', 'expired');
    end if;
    delete from public.admin_sessions where last_seen_at < _now - interval '30 days';
    insert into public.admin_sessions (session_id, user_id, started_at, last_seen_at)
    values (_sid, _uid, least(_totp_at, _now), _now)
    on conflict (session_id) do nothing;
    select * into _row from public.admin_sessions where session_id = _sid for update;
  end if;

  if _row.user_id is distinct from _uid then
    return jsonb_build_object('status', 'denied');
  end if;
  if _row.ended_at is not null then
    return jsonb_build_object('status', 'ended');
  end if;
  if _row.started_at <= _now - interval '8 hours' then
    update public.admin_sessions set ended_at = _now where session_id = _sid;
    return jsonb_build_object('status', 'expired');
  end if;
  if _row.last_seen_at <= _now - interval '30 minutes' then
    update public.admin_sessions set ended_at = _now where session_id = _sid;
    return jsonb_build_object('status', 'idle');
  end if;

  if _activity then
    update public.admin_sessions set last_seen_at = _now where session_id = _sid
    returning * into _row;
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'user_id', _uid,
    'role', _role,
    'level', _level,
    'session_id', _sid,
    'expires_at', _row.started_at + interval '8 hours',
    'idle_at', _row.last_seen_at + interval '30 minutes'
  );
end;
$$;
revoke execute on function public.admin_session_touch(boolean) from public, anon;
grant execute on function public.admin_session_touch(boolean) to authenticated;

-- The owner or a full administrator with a live admin session, or an
-- exception. The name stays: every privileged writer already calls it.
create or replace function public.admin_require_owner()
returns void
language plpgsql
set search_path = ''
as $$
declare
  _touched jsonb := public.admin_session_touch(true);
begin
  if coalesce(_touched ->> 'status', '') <> 'ok'
     or not (
       _touched ->> 'role' = 'owner'
       or (_touched ->> 'role' = 'admin' and _touched ->> 'level' = 'full')
     ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.admin_require_owner() from public, anon, authenticated;

-- Only the owner: the Administrators section.
create or replace function public.admin_require_sole_owner()
returns void
language plpgsql
set search_path = ''
as $$
declare
  _touched jsonb := public.admin_session_touch(true);
begin
  if coalesce(_touched ->> 'status', '') <> 'ok' or _touched ->> 'role' is distinct from 'owner' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.admin_require_sole_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The Administrators section: the owner only
-- ---------------------------------------------------------------------------

-- A new argument (the level) replaces the four-argument version; callers
-- without it get a limited administrator, as before.
drop function if exists public.admin_invite_create(text, text, text, text);
create or replace function public.admin_invite_create(
  _token_hash text,
  _email text default null,
  _note text default null,
  _ip_hash text default null,
  _level text default 'limited'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  perform public.admin_require_sole_owner();
  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(_level, '') not in ('full', 'limited') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into public.admin_invites (email, note, token_hash, created_by, level)
  values (
    nullif(lower(btrim(coalesce(_email, ''))), ''),
    nullif(btrim(coalesce(_note, '')), ''),
    _token_hash,
    _uid,
    _level
  )
  returning id into _id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.invite', _ip_hash,
    jsonb_build_object('invite', _id, 'from', jsonb_build_object('state', null),
                       'to', jsonb_build_object('state', 'open', 'level', _level))
  );
  return _id;
exception
  when check_violation then
    raise exception 'invalid_value' using errcode = '22023';
end;
$$;
revoke all on function public.admin_invite_create(text, text, text, text, text) from public, anon;
grant execute on function public.admin_invite_create(text, text, text, text, text) to authenticated;

create or replace function public.admin_invite_revoke(_id uuid, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  perform public.admin_require_sole_owner();
  update public.admin_invites
  set revoked_at = now()
  where id = _id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'not_open' using errcode = '22023';
  end if;
  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.revoke', _ip_hash,
    jsonb_build_object('invite', _id, 'from', jsonb_build_object('state', 'open'),
                       'to', jsonb_build_object('state', 'revoked'))
  );
end;
$$;
revoke all on function public.admin_invite_revoke(uuid, text) from public, anon;
grant execute on function public.admin_invite_revoke(uuid, text) to authenticated;

-- As in step 14.4; the role comes with the level of the invitation.
create or replace function public.admin_invite_accept(_token_hash text, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  _id uuid;
  _level text;
begin
  if _uid is null
     or _claims ->> 'aal' is distinct from 'aal2'
     or public.jwt_totp_at(_claims) is null
     or public.has_role(_uid, 'owner') then
    raise exception 'invalid_invite' using errcode = '42501';
  end if;
  update public.admin_invites
  set accepted_at = now(), accepted_by = _uid
  where token_hash = _token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  returning id, level into _id, _level;
  if _id is null then
    raise exception 'invalid_invite' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role, level) values (_uid, 'admin', _level)
  on conflict (user_id, role) do update set level = excluded.level, updated_at = now();

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.accept', _ip_hash,
    jsonb_build_object('user', _uid, 'invite', _id,
                       'from', jsonb_build_object('role', null),
                       'to', jsonb_build_object('role', 'admin', 'level', _level))
  );
end;
$$;
revoke all on function public.admin_invite_accept(text, text) from public, anon;
grant execute on function public.admin_invite_accept(text, text) to authenticated;

create or replace function public.admin_remove(_user_id uuid, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  perform public.admin_require_sole_owner();
  if _user_id is null or _user_id = _uid or public.has_role(_user_id, 'owner') then
    raise exception 'not_removable' using errcode = '22023';
  end if;
  delete from public.user_roles where user_id = _user_id and role = 'admin';
  if not found then
    raise exception 'not_admin' using errcode = '22023';
  end if;
  update public.admin_sessions set ended_at = now()
  where user_id = _user_id and ended_at is null;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.remove', _ip_hash,
    jsonb_build_object('user', _user_id,
                       'from', jsonb_build_object('role', 'admin'),
                       'to', jsonb_build_object('role', null))
  );
end;
$$;
revoke all on function public.admin_remove(uuid, text) from public, anon;
grant execute on function public.admin_remove(uuid, text) to authenticated;

-- The owner changes an administrator's level; takes effect on their next
-- request (the gate reads the level every time). Never the owner, never oneself.
create or replace function public.admin_set_level(
  _user_id uuid,
  _level text,
  _ip_hash text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old text;
begin
  perform public.admin_require_sole_owner();
  if coalesce(_level, '') not in ('full', 'limited') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if _user_id is null or _user_id = _uid or public.has_role(_user_id, 'owner') then
    raise exception 'not_changeable' using errcode = '22023';
  end if;
  select coalesce(r.level, 'limited') into _old
  from public.user_roles r where r.user_id = _user_id and r.role = 'admin'
  for update;
  if not found then
    raise exception 'not_admin' using errcode = '22023';
  end if;
  if _old = _level then
    return;
  end if;
  update public.user_roles set level = _level, updated_at = now()
  where user_id = _user_id and role = 'admin';

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.level', _ip_hash,
    jsonb_build_object('user', _user_id,
                       'from', jsonb_build_object('level', _old),
                       'to', jsonb_build_object('level', _level))
  );
end;
$$;
revoke all on function public.admin_set_level(uuid, text, text) from public, anon;
grant execute on function public.admin_set_level(uuid, text, text) to authenticated;

-- As in step 14.4, with the level of each administrator (null for the owner
-- and for a removed one).
drop function if exists public.admin_members();
create or replace function public.admin_members()
returns table (
  user_id uuid,
  role text,
  level text,
  active boolean,
  added_at timestamptz,
  removed_at timestamptz,
  last_login_at timestamptz,
  logins_30d integer,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select r.user_id, r.role::text as role,
           case when r.role = 'admin' then coalesce(r.level, 'limited') end as level,
           r.created_at as added_at, true as active
    from public.user_roles r
    where r.role in ('owner', 'admin')
    union all
    select i.accepted_by, 'admin', null, min(i.accepted_at), false
    from public.admin_invites i
    where i.accepted_by is not null
    group by i.accepted_by
  ),
  members as (
    select distinct on (c.user_id) c.user_id, c.role, c.level, c.active, c.added_at
    from candidates c
    order by c.user_id, c.active desc, (c.role = 'owner') desc, c.added_at
  )
  select
    m.user_id,
    m.role,
    m.level,
    m.active,
    m.added_at,
    case when m.active then null else (
      select max(a.created_at) from public.admin_audit a
      where a.target = 'admins.remove' and a.detail ->> 'user' = m.user_id::text
    ) end,
    (select max(a.created_at) from public.admin_audit a
      where a.user_id = m.user_id and a.kind = 'login'),
    (select count(*)::int from public.admin_audit a
      where a.user_id = m.user_id and a.kind = 'login' and a.created_at > now() - interval '30 days'),
    greatest(
      (select max(s.last_seen_at) from public.admin_sessions s where s.user_id = m.user_id),
      (select max(a.created_at) from public.admin_audit a where a.user_id = m.user_id)
    )
  from members m
  order by (m.role = 'owner') desc, m.active desc, m.added_at
  limit 200;
$$;
revoke all on function public.admin_members() from public, anon, authenticated;
grant execute on function public.admin_members() to service_role;

-- ---------------------------------------------------------------------------
-- "X changed …" e-mails between the owner and the full administrators
-- ---------------------------------------------------------------------------
create table public.admin_notify_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- An e-mail when someone else publishes plans or changes AI caps.
  peer_changes boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.admin_notify_prefs is
  'Administrators'' own e-mail preferences. Read and written only by the server (admin client) after the admin guard.';
alter table public.admin_notify_prefs enable row level security;
revoke all on table public.admin_notify_prefs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The error log
-- ---------------------------------------------------------------------------
create table public.error_groups (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved', 'ignored')),
  -- The last time a resolved error happened again (and went back to new).
  returned_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.error_groups is
  'The state of each error (fingerprint of error_events) in the administration''s error log. A group without a row is new. Server only.';
alter table public.error_groups enable row level security;
revoke all on table public.error_groups from anon, authenticated;

alter table public.error_alert_sends
  add column to_emails text[] check (to_emails is null or cardinality(to_emails) <= 10);

-- A resolved error that happens again is new again, labelled "came back".
create or replace function public.error_events_reopen_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.error_groups
  set status = 'new', returned_at = new.created_at, updated_at = now(), updated_by = null
  where fingerprint = new.fingerprint and status = 'resolved';
  return new;
end;
$$;
revoke execute on function public.error_events_reopen_group() from public, anon, authenticated;

create trigger error_events_reopen_group
  after insert on public.error_events
  for each row execute function public.error_events_reopen_group();

-- The groups of the log, newest last occurrence first. The period (days in
-- the metrics zone, both included), the version and the status narrow the
-- occurrences counted; a code (or its beginning, GR-…) finds its group
-- whatever the period says. first_at and last_at are of the whole history
-- of the group. Technical data only.
create or replace function public.admin_error_groups(
  _from date,
  _to date,
  _status text default null,
  _code text default null,
  _version text default null,
  _limit integer default 50,
  _offset integer default 0
)
returns table (
  fingerprint text,
  status text,
  returned_at timestamptz,
  last_code text,
  message text,
  page text,
  action text,
  source text,
  occurrences integer,
  users integer,
  first_at timestamptz,
  last_at timestamptz,
  last_version text,
  total integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with coded as (
    select distinct e.fingerprint
    from public.error_events e
    where _code is not null and e.code like _code || '%'
  ),
  scoped as (
    select e.fingerprint, e.user_id
    from public.error_events e
    where (
        (_code is null
          and e.created_at >= (_from::timestamp at time zone public.metrics_timezone())
          and e.created_at < ((_to + 1)::timestamp at time zone public.metrics_timezone()))
        or (_code is not null and e.fingerprint in (select c.fingerprint from coded c))
      )
      and (_version is null or e.app_version = _version)
  ),
  grouped as (
    select s.fingerprint, count(*)::int as occurrences, count(distinct s.user_id)::int as users
    from scoped s
    group by s.fingerprint
  ),
  stated as (
    select g.fingerprint, g.occurrences, g.users,
           coalesce(eg.status, 'new') as status, eg.returned_at
    from grouped g
    left join public.error_groups eg on eg.fingerprint = g.fingerprint
    where _status is null or coalesce(eg.status, 'new') = _status
  )
  select
    s.fingerprint, s.status, s.returned_at,
    l.code, l.message, l.page, l.action, l.source,
    s.occurrences, s.users,
    f.first_at, l.created_at, l.app_version,
    (count(*) over ())::int
  from stated s
  cross join lateral (
    select e.code, e.message, e.page, e.action, e.source, e.created_at, e.app_version
    from public.error_events e
    where e.fingerprint = s.fingerprint
    order by e.created_at desc
    limit 1
  ) l
  cross join lateral (
    select min(e.created_at) as first_at from public.error_events e where e.fingerprint = s.fingerprint
  ) f
  order by l.created_at desc, s.fingerprint
  limit least(greatest(coalesce(_limit, 50), 1), 200)
  offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.admin_error_groups(date, date, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_error_groups(date, date, text, text, text, integer, integer) to service_role;

-- The bug reports filed with a code of one error group, newest first.
create or replace function public.admin_error_group_reports(_fingerprint text)
returns table (
  id uuid,
  error_code text,
  status text,
  kind text,
  source text,
  user_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.error_code, r.status, r.kind, r.source, r.user_id, r.created_at
  from public.bug_reports r
  join public.error_events e on e.code = r.error_code
  where e.fingerprint = _fingerprint
  order by r.created_at desc
  limit 50;
$$;
revoke all on function public.admin_error_group_reports(text) from public, anon, authenticated;
grant execute on function public.admin_error_group_reports(text) to service_role;
