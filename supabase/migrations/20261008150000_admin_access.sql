-- =============================================================================
-- Access to the administration (step 11.3)
--
--   * admin_sessions: one row per Supabase session that passed the second
--     factor on /admin/prihlaseni. 30 minutes without activity or 8 hours
--     after the code was entered end it for good; only a new sign-in with
--     password and code opens a new one.
--   * admin_session_touch(): the single gate used by the middleware and every
--     server function of the administration. It trusts only the signed JWT:
--     role owner, aal2, the session id and the time of the TOTP step.
--   * admin_audit: who looked at which view or exported what, with an IP
--     fingerprint (an HMAC, never the address).
--   * admin_login_attempts: failed sign-ins for the 5 / 15 minutes limit.
--
-- The tables have row level security and no client policies at all: only the
-- server reads and writes them through the admin client, after the gate.
-- =============================================================================

create table public.admin_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from anon, authenticated;

create type public.admin_audit_kind as enum ('login', 'view', 'export');

create table public.admin_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind public.admin_audit_kind not null,
  -- An identifier of the view or export (e.g. "audit", "growth.funnel"), never free text.
  target text not null check (target ~ '^[a-z0-9_.:-]{1,80}$'),
  ip_hash text check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  created_at timestamptz not null default now()
);
create index admin_audit_created_at_idx on public.admin_audit (created_at desc);
alter table public.admin_audit enable row level security;
revoke all on table public.admin_audit from anon, authenticated;

create table public.admin_login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  email_hash text check (email_hash ~ '^[0-9a-f]{16,64}$'),
  stage text not null check (stage in ('password', 'totp')),
  success boolean not null,
  created_at timestamptz not null default now()
);
create index admin_login_attempts_ip_idx on public.admin_login_attempts (ip_hash, created_at);
create index admin_login_attempts_email_idx on public.admin_login_attempts (email_hash, created_at);
alter table public.admin_login_attempts enable row level security;
revoke all on table public.admin_login_attempts from anon, authenticated;

-- The time of the TOTP step in the token's amr claim, or null.
create or replace function public.jwt_totp_at(_claims jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  _at timestamptz;
begin
  if jsonb_typeof(_claims -> 'amr') is distinct from 'array' then
    return null;
  end if;
  select max(to_timestamp((e ->> 'timestamp')::double precision)) into _at
  from jsonb_array_elements(_claims -> 'amr') as e
  where jsonb_typeof(e) = 'object'
    and e ->> 'method' = 'totp'
    and (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$';
  return _at;
end;
$$;
revoke execute on function public.jwt_totp_at(jsonb) from public, anon, authenticated;

-- ok | denied | idle | expired | ended. With _activity the session counts as
-- used now (a page or an action); without it the call only checks.
-- SECURITY DEFINER: writes admin_sessions, which no client may touch.
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
begin
  if _uid is null
     or _claims ->> 'aal' is distinct from 'aal2'
     or not public.has_role(_uid, 'owner') then
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
    'session_id', _sid,
    'expires_at', _row.started_at + interval '8 hours',
    'idle_at', _row.last_seen_at + interval '30 minutes'
  );
end;
$$;
revoke execute on function public.admin_session_touch(boolean) from public, anon;
grant execute on function public.admin_session_touch(boolean) to authenticated;

-- Signing out of the administration ends the admin session; the app session stays.
create or replace function public.admin_session_end()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sid text := coalesce(auth.jwt(), '{}'::jsonb) ->> 'session_id';
begin
  if auth.uid() is null or coalesce(_sid, '') !~ '^[0-9a-fA-F-]{36}$' then
    return;
  end if;
  update public.admin_sessions
  set ended_at = now()
  where session_id = _sid::uuid and user_id = auth.uid() and ended_at is null;
end;
$$;
revoke execute on function public.admin_session_end() from public, anon;
grant execute on function public.admin_session_end() to authenticated;
