-- =============================================================================
-- AI usage caps set in the administration (step 13.5)
--
--   * app_settings: application-wide settings as key + JSON value. The first
--     key is 'ai_caps': the monthly cap of all accounts (USD), the monthly cap
--     of one user (USD, null = no limit) and the warning threshold (%).
--     JARVIS_MONTHLY_BUDGET_USD is only the default while no row exists.
--   * ai_user_caps: an exception for one user, either their own monthly cap
--     or AI blocked altogether. No row = the application-wide per-user cap.
--   * Both tables have row level security and no client policies: the server
--     reads them through the admin client. Writes go only through
--     admin_set_app_setting() / admin_set_ai_user_cap(), which let in nobody
--     but the owner with a live admin session (aal2) and write the change to
--     admin_audit in the same transaction: who, when, from what to what.
--   * admin_audit gains `detail` for that before/after (numbers, booleans and
--     identifiers only, never free text).
--   * jarvis_user_month_spend() / jarvis_top_user_spend(): one user's spend
--     and the largest single spend since an instant, server only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Validation of the 'ai_caps' value, shared by the check constraint and the
-- writer. Limits match src/features/jarvis/caps.ts.
-- ---------------------------------------------------------------------------
create or replace function public.valid_ai_caps(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- coalesce: a missing key makes the expression null, and null would pass a check.
  select coalesce(
    jsonb_typeof(_value) = 'object'
    and (select coalesce(bool_and(k in ('monthly_usd', 'per_user_usd', 'warn_percent')), true)
         from jsonb_object_keys(_value) as k)
    and jsonb_typeof(_value -> 'monthly_usd') = 'number'
    and (_value ->> 'monthly_usd')::numeric between 0 and 10000
    and (
      coalesce(jsonb_typeof(_value -> 'per_user_usd'), 'null') = 'null'
      or (jsonb_typeof(_value -> 'per_user_usd') = 'number'
          and (_value ->> 'per_user_usd')::numeric > 0
          and (_value ->> 'per_user_usd')::numeric <= 1000)
    )
    and jsonb_typeof(_value -> 'warn_percent') = 'number'
    and (_value ->> 'warn_percent')::numeric between 1 and 100
    and (_value ->> 'warn_percent')::numeric = trunc((_value ->> 'warn_percent')::numeric),
    false
  );
$$;

create table public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint app_settings_ai_caps_valid check (key <> 'ai_caps' or public.valid_ai_caps(value))
);
comment on table public.app_settings is
  'Application-wide settings changed in the administration. Read by the server (admin client); written only through admin_set_app_setting().';
alter table public.app_settings enable row level security;
-- No policies: the client can neither read nor write it.
revoke all on public.app_settings from anon, authenticated;

create table public.ai_user_caps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Own monthly cap in USD; null together with blocked = AI switched off.
  cap_usd numeric(10, 2) check (cap_usd > 0 and cap_usd <= 1000),
  blocked boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint ai_user_caps_something check (blocked or cap_usd is not null)
);
comment on table public.ai_user_caps is
  'Per-user exception to the AI caps: own monthly cap or AI blocked. Read by the server; written only through admin_set_ai_user_cap().';
alter table public.ai_user_caps enable row level security;
revoke all on public.ai_user_caps from anon, authenticated;

alter table public.admin_audit
  add column detail jsonb
  check (detail is null or (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000));

-- ---------------------------------------------------------------------------
-- Writers. SECURITY DEFINER so they can write the closed tables, and they
-- check the caller themselves: the owner with aal2 and a live admin session
-- (admin_session_touch), never anyone else. The actor is auth.uid().
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
  if coalesce(public.admin_session_touch(true) ->> 'status', '') <> 'ok' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
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

-- _blocked = true blocks AI; a cap without blocking sets the user's own cap;
-- neither removes the exception (back to the application-wide caps).
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
  if coalesce(public.admin_session_touch(true) ->> 'status', '') <> 'ok' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
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
-- Spend per user, server only (they read across accounts).
-- ---------------------------------------------------------------------------
create or replace function public.jarvis_user_month_spend(_user_id uuid, _since timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  where u.user_id = _user_id and u.created_at >= _since;
$$;
revoke all on function public.jarvis_user_month_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_user_month_spend(uuid, timestamptz) to service_role;

create or replace function public.jarvis_top_user_spend(_since timestamptz)
returns table (user_id uuid, cost_usd numeric)
language sql
stable
set search_path = ''
as $$
  select u.user_id, coalesce(sum(u.cost_usd), 0) as cost_usd
  from public.ai_usage u
  where u.created_at >= _since
  group by u.user_id
  order by 2 desc
  limit 1;
$$;
revoke all on function public.jarvis_top_user_spend(timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_top_user_spend(timestamptz) to service_role;
