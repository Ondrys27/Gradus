-- =============================================================================
-- Company: only the people of the company, inviting by @username or short id
-- (step 28.1)
--
--   * app_settings key 'worker_billing' = { "visible": true | false }; no row
--     = hidden. While hidden the app shows nothing about paying for workers
--     and charges no extra worker in Stripe; the arithmetic stays in the code.
--     Set like the other settings through admin_set_app_setting().
--   * active_members(_space): the one list of who works in a space now, for
--     every picker and list of people in the app: the owner and the workers
--     whose membership is active. Removed, departed and never accepted
--     records are not in it (they were, where screens read `workers` without
--     its status). Any active member of the space may read it, as
--     crm_task_assignees() and chat_people() already let them.
--   * A worker who leaves, is removed or declines (workers.status becomes
--     inactive) leaves every group at once (workers_end_group_memberships);
--     the group conversation follows through chat_group_members_sync.
--     Existing memberships of inactive workers go now. An inactive worker
--     joins no group and gets nobody under them.
--   * Usernames: changed at most once in 30 days (profiles.username_changed_at,
--     kept by the database), the old one reserved for its owner for 30 days
--     (username_reservations, server only). username_available() knows both.
--   * invite_account_lookup(): the owner's search for somebody to invite, by
--     exact @username or short id only, at most 10 misses and 40 searches an
--     hour per owner (account_lookup_attempts, server only, kept a day).
--     Server only (service role), the owner from the session.
-- Additive: new columns with defaults, new tables, new and replaced functions,
-- new triggers, one cleanup of rows that no longer mean anything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Worker billing switch
-- -----------------------------------------------------------------------------

create or replace function public.valid_worker_billing(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_value) = 'object'
    and jsonb_typeof(_value -> 'visible') = 'boolean'
    and coalesce(
      (select bool_and(k = 'visible') from jsonb_object_keys(_value) as k),
      false
    );
$$;

alter table public.app_settings
  add constraint app_settings_worker_billing_valid
  check (key <> 'worker_billing' or public.valid_worker_billing(value));

-- The same function as in 20261124090000_showcase_mode.sql, with 'worker_billing' added.
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
  elsif _key = 'worker_billing' then
    if _value is null or not public.valid_worker_billing(_value) then
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
-- Who works in a space now
-- -----------------------------------------------------------------------------

create or replace function public.active_members(_space uuid)
returns table (
  user_id uuid,
  worker_id uuid,
  is_owner boolean,
  name text,
  avatar_url text,
  username text,
  job_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select
      p.id,
      null::uuid,
      true,
      coalesce(nullif(btrim(p.display_name), ''), ''),
      p.avatar_url,
      p.username,
      null::text
    from public.profiles p
    where p.id = _space
      and public.is_space_member(_space)
    union all
    select
      m.user_id,
      w.id,
      false,
      coalesce(nullif(btrim(w.name), ''), nullif(btrim(p.display_name), ''), ''),
      coalesce(w.avatar_url, p.avatar_url),
      p.username,
      w.job_title
    from public.memberships m
    join public.workers w
      on w.id = m.worker_id and w.owner_id = _space and w.user_id = m.user_id and w.status = 'active'
    left join public.profiles p on p.id = m.user_id
    where m.space_id = _space
      and m.role = 'worker'
      and m.status = 'active'
      and public.is_space_member(_space)
  ) people (user_id, worker_id, is_owner, name, avatar_url, username, job_title)
  order by is_owner desc, lower(name), user_id
  limit 501;
$$;
revoke execute on function public.active_members(uuid) from public, anon;
grant execute on function public.active_members(uuid) to authenticated, service_role;

comment on function public.active_members(uuid) is
  'The owner and the active workers of a space (memberships.status = active): the one list every picker of people uses. Members of the space only.';

-- -----------------------------------------------------------------------------
-- Leaving the company ends the group memberships
-- -----------------------------------------------------------------------------

create or replace function public.workers_end_group_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from public.worker_group_members gm where gm.worker_id = new.id;
  exception when raise_exception then
    -- A read-only space (the owner may still end a worker): the memberships
    -- stay until it is writable again; no list shows an inactive worker.
    if sqlerrm <> 'read_only' then
      raise;
    end if;
  end;
  return new;
end;
$$;
revoke execute on function public.workers_end_group_memberships() from public, anon, authenticated;

create trigger workers_end_group_memberships
  after update of status on public.workers
  for each row
  when (new.status = 'inactive' and old.status is distinct from 'inactive')
  execute function public.workers_end_group_memberships();

-- Nobody joins a group or gets people under them once they left.
create or replace function public.worker_group_members_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.workers w where w.id = new.worker_id and w.status = 'inactive'
  ) then
    raise exception 'worker_inactive' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.worker_group_members_active() from public, anon, authenticated;

create trigger worker_group_members_active
  before insert on public.worker_group_members
  for each row execute function public.worker_group_members_active();

create or replace function public.workers_manager_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and exists (
       select 1 from public.workers m where m.id = new.manager_id and m.status = 'inactive'
     ) then
    raise exception 'worker_inactive' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.workers_manager_active() from public, anon, authenticated;

create trigger workers_manager_active
  before insert or update of manager_id on public.workers
  for each row execute function public.workers_manager_active();

-- Memberships of people who are no longer in the company.
delete from public.worker_group_members gm
using public.workers w
where w.id = gm.worker_id and w.status = 'inactive';

-- -----------------------------------------------------------------------------
-- Usernames: one change in 30 days, the old one reserved for 30 days
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username_changed_at timestamptz;

comment on column public.profiles.username_changed_at is
  'When the username last changed from a previous one (the database stamps it); the next change waits 30 days.';

create table public.username_reservations (
  username text primary key check (username ~ '^[a-z0-9._]{3,20}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index username_reservations_user_idx on public.username_reservations (user_id);
alter table public.username_reservations enable row level security;
revoke all on table public.username_reservations from anon, authenticated;

comment on table public.username_reservations is
  'A username somebody just left, kept for them 30 days so nobody else takes it at once. Written by profiles_username_guard only.';

create or replace function public.profiles_username_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.username_changed_at := null;
    return new;
  end if;
  if new.username is not distinct from old.username then
    -- Only the database stamps the change.
    new.username_changed_at := old.username_changed_at;
    return new;
  end if;
  if auth.uid() is not null
     and old.username_changed_at is not null
     and old.username_changed_at > now() - interval '30 days' then
    raise exception 'username_cooldown' using errcode = 'P0001',
      hint = 'The username changes at most once in 30 days.';
  end if;
  if new.username is not null and exists (
    select 1 from public.username_reservations r
    where r.username = lower(new.username)
      and r.user_id <> new.id
      and r.reserved_until > now()
  ) then
    raise exception 'username_reserved' using errcode = '23505',
      hint = 'Somebody left this username less than 30 days ago.';
  end if;
  -- Taking one's own reserved name back frees it.
  if new.username is not null then
    delete from public.username_reservations r
    where r.username = lower(new.username) and r.user_id = new.id;
  end if;
  if old.username is not null then
    insert into public.username_reservations (username, user_id, reserved_until)
    values (lower(old.username), old.id, now() + interval '30 days')
    on conflict (username) do update
      set user_id = excluded.user_id,
          reserved_until = excluded.reserved_until,
          created_at = now();
    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_username_guard() from public, anon, authenticated;

create trigger profiles_username_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_username_guard();

-- The same check as in 20260923200000_auth_profiles_avatars.sql, with the
-- names other people left less than 30 days ago.
create or replace function public.username_available(_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _username ~ '^[a-z0-9._]{3,20}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(_username)
        and id is distinct from auth.uid()
    )
    and not exists (
      select 1 from public.username_reservations r
      where r.username = lower(_username)
        and r.user_id is distinct from auth.uid()
        and r.reserved_until > now()
    );
$$;
revoke execute on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- The account behind a username, like account_by_public_id (server only).
create or replace function public.account_by_username(_username text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.space_id = p.id and m.role = 'owner'
  where p.username is not null
    and lower(p.username) = lower(btrim(_username))
  limit 1;
$$;
revoke execute on function public.account_by_username(text) from public, anon, authenticated;
grant execute on function public.account_by_username(text) to service_role;

-- -----------------------------------------------------------------------------
-- Looking somebody up to invite: exact @username or short id, limited
-- -----------------------------------------------------------------------------

create table public.account_lookup_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  found boolean not null,
  created_at timestamptz not null default now()
);
create index account_lookup_attempts_user_idx on public.account_lookup_attempts (user_id, created_at);
alter table public.account_lookup_attempts enable row level security;
revoke all on table public.account_lookup_attempts from anon, authenticated;

comment on table public.account_lookup_attempts is
  'Searches of an owner for somebody to invite (only whether it found anybody), for the attempt limit. Server only, kept a day.';

-- What the owner typed: '@name' is a username; six characters of the short
-- id alphabet are a short id first and a username second; any other valid
-- username is a username. Answers { outcome: found | not_found | limited |
-- invalid } and, when found, the card: id, name, avatar_url, username.
-- Never a partial match. Server only, with the owner from the session.
create or replace function public.invite_account_lookup(_actor uuid, _value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _raw text := btrim(coalesce(_value, ''));
  _name text;
  _public text;
  _found uuid;
  _misses integer;
  _total integer;
  _profile record;
begin
  if _actor is null or char_length(_raw) = 0 or char_length(_raw) > 64 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  delete from public.account_lookup_attempts a
  where a.user_id = _actor and a.created_at < now() - interval '1 day';
  select count(*) filter (where not a.found), count(*)
    into _misses, _total
  from public.account_lookup_attempts a
  where a.user_id = _actor and a.created_at > now() - interval '1 hour';
  if _misses >= 10 or _total >= 40 then
    return jsonb_build_object('outcome', 'limited');
  end if;

  if left(_raw, 1) = '@' then
    _name := lower(substr(_raw, 2));
    if _name !~ '^[a-z0-9._]{3,20}$' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  else
    _public := upper(regexp_replace(_raw, '[\s-]', '', 'g'));
    if _public ~ '^[2-9A-HJKMNP-TV-Z]{6}$' then
      _found := public.account_by_public_id(_public);
    end if;
    if lower(_raw) ~ '^[a-z0-9._]{3,20}$' then
      _name := lower(_raw);
    elsif _public !~ '^[2-9A-HJKMNP-TV-Z]{6}$' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  end if;
  if _found is null and _name is not null then
    _found := public.account_by_username(_name);
  end if;

  insert into public.account_lookup_attempts (user_id, found)
  values (_actor, _found is not null);

  if _found is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select p.display_name, p.avatar_url, p.username into _profile
  from public.profiles p where p.id = _found;
  return jsonb_build_object(
    'outcome', 'found',
    'id', _found,
    'name', _profile.display_name,
    'avatar_url', _profile.avatar_url,
    'username', _profile.username
  );
end;
$$;
revoke execute on function public.invite_account_lookup(uuid, text) from public, anon, authenticated;
grant execute on function public.invite_account_lookup(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('worker_invite_lookup', 'workers', false)
on conflict (event) do nothing;
