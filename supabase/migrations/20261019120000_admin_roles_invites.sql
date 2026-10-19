-- =============================================================================
-- Administrators next to the owner (step 14.4)
--
--   * Role 'admin' (app_role already has it) enters the administration on the
--     same terms as the owner: password, TOTP (aal2) and a live admin session.
--     admin_session_touch() now lets both in and says which role it saw.
--     docs/admin-roles.md lists what stays owner-only.
--   * admin_set_app_setting() / admin_set_ai_user_cap(): owner only; an admin
--     reads the AI caps and exceptions but never changes them.
--   * admin_invites: one row per invitation link. Only the SHA-256 of a random
--     32-byte token is stored, never the token. 7 days, single use, revocable.
--     No client policies; written only through the SECURITY DEFINER functions
--     below, each of which writes admin_audit in the same transaction.
--       - admin_invite_create / admin_invite_revoke / admin_remove: the owner
--         with a live admin session (aal2).
--       - admin_invite_accept: the invited account itself, signed in with aal2.
--         The token is consumed by one conditional UPDATE in the same
--         transaction that grants the role, so two parallel uses cannot both win.
--   * admin_members(): owner and administrators, active or removed, with their
--     sign-ins to the administration; server only.
--   * admin_audit gains ip_prefix (the address cut to /24 or /48) and browser
--     ("chrome/desktop") on sign-in rows, for the history of an administrator.
--   * admin_login_attempts: stage 'invite' counts wrong invitation links per IP.
--   * An account created from an invitation (user metadata admin_invite) gets
--     a profile and settings only: no onboarding, no workspace, no trial, and
--     the internal flag. Every holder of the admin role is internal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The gate: owner or admin
-- ---------------------------------------------------------------------------
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
begin
  if _uid is null or _claims ->> 'aal' is distinct from 'aal2' then
    return jsonb_build_object('status', 'denied');
  end if;
  _role := case
    when public.has_role(_uid, 'owner') then 'owner'
    when public.has_role(_uid, 'admin') then 'admin'
  end;
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
    -- Old ended sessions are of no use to anyone.
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
    'session_id', _sid,
    'expires_at', _row.started_at + interval '8 hours',
    'idle_at', _row.last_seen_at + interval '30 minutes'
  );
end;
$$;
revoke execute on function public.admin_session_touch(boolean) from public, anon;
grant execute on function public.admin_session_touch(boolean) to authenticated;

-- The owner with a live admin session, or an exception. For the owner-only writers.
create or replace function public.admin_require_owner()
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
revoke execute on function public.admin_require_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- AI caps: owner only from now on (bodies unchanged apart from the check)
-- ---------------------------------------------------------------------------
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
  if _key is distinct from 'ai_caps' then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  if _value is null or not public.valid_ai_caps(_value) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  select s.value into _old from public.app_settings s where s.key = _key for update;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (_key, _value, now(), _uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.' || _key, _ip_hash,
    jsonb_build_object('key', _key, 'from', _old, 'to', _value)
  );
  return _old;
end;
$$;
revoke all on function public.admin_set_app_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb, text) to authenticated;

create or replace function public.admin_set_ai_user_cap(
  _user_id uuid,
  _cap_usd numeric,
  _blocked boolean,
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
  _new jsonb;
  _blocked_now boolean := coalesce(_blocked, false);
  _cap numeric := case when coalesce(_blocked, false) then null else _cap_usd end;
begin
  perform public.admin_require_owner();
  if _user_id is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if _cap is not null and (_cap <= 0 or _cap > 1000) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  select jsonb_build_object('cap_usd', c.cap_usd, 'blocked', c.blocked) into _old
  from public.ai_user_caps c where c.user_id = _user_id for update;

  if not _blocked_now and _cap is null then
    delete from public.ai_user_caps where user_id = _user_id;
    _new := null;
  else
    insert into public.ai_user_caps (user_id, cap_usd, blocked, updated_at, updated_by)
    values (_user_id, _cap, _blocked_now, now(), _uid)
    on conflict (user_id) do update
      set cap_usd = excluded.cap_usd, blocked = excluded.blocked,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    _new := jsonb_build_object('cap_usd', round(_cap, 2), 'blocked', _blocked_now);
  end if;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'users.ai_cap', _ip_hash,
    jsonb_build_object('user', _user_id, 'from', _old, 'to', _new)
  );
  return _old;
end;
$$;
revoke all on function public.admin_set_ai_user_cap(uuid, numeric, boolean, text) from public, anon;
grant execute on function public.admin_set_ai_user_cap(uuid, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit: where a sign-in came from, coarse
-- ---------------------------------------------------------------------------
alter table public.admin_audit
  add column ip_prefix text check (ip_prefix ~ '^[0-9a-f.:]{1,39}/(24|48)$'),
  add column browser text check (browser ~ '^[a-z]{1,12}/[a-z]{1,12}$');
create index admin_audit_user_kind_idx on public.admin_audit (user_id, kind, created_at desc);

alter table public.admin_login_attempts drop constraint admin_login_attempts_stage_check;
alter table public.admin_login_attempts
  add constraint admin_login_attempts_stage_check check (stage in ('password', 'totp', 'invite'));

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  note text check (note is null or char_length(note) <= 200),
  -- SHA-256 (hex) of the 32-byte token in the link; the token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint admin_invites_used_once check (accepted_at is null or revoked_at is null)
);
create index admin_invites_accepted_by_idx on public.admin_invites (accepted_by) where accepted_by is not null;
comment on table public.admin_invites is
  'Invitations to the administration. Read by the server (admin client); written only through admin_invite_create / admin_invite_revoke / admin_invite_accept.';
alter table public.admin_invites enable row level security;
revoke all on table public.admin_invites from anon, authenticated;

create or replace function public.admin_invite_create(
  _token_hash text,
  _email text default null,
  _note text default null,
  _ip_hash text default null
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
  perform public.admin_require_owner();
  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into public.admin_invites (email, note, token_hash, created_by)
  values (
    nullif(lower(btrim(coalesce(_email, ''))), ''),
    nullif(btrim(coalesce(_note, '')), ''),
    _token_hash,
    _uid
  )
  returning id into _id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.invite', _ip_hash,
    jsonb_build_object('invite', _id, 'from', jsonb_build_object('state', null),
                       'to', jsonb_build_object('state', 'open'))
  );
  return _id;
exception
  when check_violation then
    raise exception 'invalid_value' using errcode = '22023';
end;
$$;
revoke all on function public.admin_invite_create(text, text, text, text) from public, anon;
grant execute on function public.admin_invite_create(text, text, text, text) to authenticated;

create or replace function public.admin_invite_revoke(_id uuid, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  perform public.admin_require_owner();
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

-- The invited account, right after its second factor. One transaction: the
-- conditional UPDATE takes the row lock, so a parallel second use waits, sees
-- accepted_at set and finds nothing. The owner never becomes an admin.
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
  returning id into _id;
  if _id is null then
    raise exception 'invalid_invite' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role) values (_uid, 'admin')
  on conflict (user_id, role) do nothing;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'admins.accept', _ip_hash,
    jsonb_build_object('user', _uid, 'invite', _id,
                       'from', jsonb_build_object('role', null),
                       'to', jsonb_build_object('role', 'admin'))
  );
end;
$$;
revoke all on function public.admin_invite_accept(text, text) from public, anon;
grant execute on function public.admin_invite_accept(text, text) to authenticated;

-- Takes the admin role away and ends every admin session of that account at
-- once: the next request of theirs finds no role and no session. Never the
-- owner, never oneself.
create or replace function public.admin_remove(_user_id uuid, _ip_hash text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  perform public.admin_require_owner();
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

-- Owner and administrators (also the removed ones, from their accepted
-- invitations), with sign-ins and activity in the administration.
create or replace function public.admin_members()
returns table (
  user_id uuid,
  role text,
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
    select r.user_id, r.role::text as role, r.created_at as added_at, true as active
    from public.user_roles r
    where r.role in ('owner', 'admin')
    union all
    select i.accepted_by, 'admin', min(i.accepted_at), false
    from public.admin_invites i
    where i.accepted_by is not null
    group by i.accepted_by
  ),
  members as (
    select distinct on (c.user_id) c.user_id, c.role, c.active, c.added_at
    from candidates c
    order by c.user_id, c.active desc, (c.role = 'owner') desc, c.added_at
  )
  select
    m.user_id,
    m.role,
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
-- Internal flag for every administrator
-- ---------------------------------------------------------------------------
create or replace function public.is_internal_account(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(_user_id, 'owner')
      or public.has_role(_user_id, 'admin')
      or exists (
        select 1 from auth.users u
        where u.id = _user_id and lower(coalesce(u.email, '')) like '%@gradus.local'
      );
$$;
revoke execute on function public.is_internal_account(uuid) from public, anon, authenticated;

create or replace function public.user_roles_mark_internal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('owner', 'admin') then
    update public.profiles set is_internal = true where id = new.user_id and not is_internal;
  end if;
  return new;
end;
$$;
revoke execute on function public.user_roles_mark_internal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New accounts: one made from an administrator invitation gets no workspace
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _locale text := case when new.raw_user_meta_data ->> 'locale' = 'cs' then 'cs' else 'en' end;
begin
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user'));
  -- Set only by the server (admin client) when it creates an account on an
  -- invitation page; the account exists to enter the administration.
  if new.raw_user_meta_data ->> 'admin_invite' = 'true'
     and exists (select 1 from public.user_roles) then
    insert into public.profiles (id, is_internal, onboarding_completed_at, tour_completed_at)
    values (new.id, true, now(), now())
    on conflict (id) do nothing;
    insert into public.user_settings (user_id, locale) values (new.id, _locale)
    on conflict (user_id) do nothing;
    return new;
  end if;

  perform public.initialize_user(new.id, coalesce(new.raw_user_meta_data ->> 'locale', 'en'));
  if not public.has_role(new.id, 'owner') then
    update public.subscriptions
    set plan_key = 'pro',
        status = 'trialing',
        trial_ends_at = now() + interval '14 days',
        current_period_start = now(),
        current_period_end = now() + interval '14 days',
        updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
