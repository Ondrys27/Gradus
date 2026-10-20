-- =============================================================================
-- Plan catalog edited in the administration and published by a button (15.5)
--
--   * plan_catalog_versions: the prices, limits and card texts of the plans
--     solo / pro / team as one JSON payload per version. Exactly one row is
--     published (the website, the app and Jarvis read it), at most one is a
--     draft, the rest is history (archived). Published and archived versions
--     never change; a draft is published or discarded.
--   * Row level security without policies: the server reads the published row
--     with the service role, the administration reads drafts and history after
--     its guard. Writes go only through admin_plan_catalog_*(), SECURITY
--     DEFINER, the owner with aal2 and a live admin session
--     (admin_require_owner), each into admin_audit in the same transaction.
--     An advisory lock serialises them; publishing names the version it
--     replaces, so two publishes at once cannot both win.
--   * current_plan() reads the limits of solo / pro / team from the published
--     version on every call (beta and anything else from `plans` as before).
--   * Workers and storage are limits of what an account holds. Above them the
--     workspace turns read-only (the same rule as after the trial, nothing is
--     deleted) from the next day in the owner's time zone after the later of
--     the publishing and the moment the account went over. Empty = no limit.
--   * The first version published here is src/config/pricing.ts with the plan
--     texts of the translations (a test compares them), so nothing changes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Validation, the same rules as validatePlanCatalog() in
-- src/features/plan/catalog.ts. Every helper answers false (never an error)
-- for a value of the wrong type, so a bad payload is simply refused.
-- ---------------------------------------------------------------------------
create or replace function public.plan_catalog_number(_value jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(_value) = 'number' then (_value #>> '{}')::numeric end;
$$;

create or replace function public.plan_catalog_keys_ok(_value jsonb, _allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) = 'object' then
      coalesce((select bool_and(k = any (_allowed)) from jsonb_object_keys(_value) as k), true)
    else false
  end;
$$;

create or replace function public.plan_catalog_text_ok(_value jsonb, _min integer, _max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_value, array['cs', 'en']) then false
    when jsonb_typeof(_value -> 'cs') <> 'string' or jsonb_typeof(_value -> 'en') <> 'string' then false
    else char_length(btrim(_value ->> 'cs')) between _min and _max
      and char_length(btrim(_value ->> 'en')) between _min and _max
  end;
$$;

create or replace function public.plan_catalog_money_ok(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_value, array['CZK', 'EUR']) then false
    else coalesce(
      (select bool_and(
         public.plan_catalog_number(_value -> c) > 0
         and public.plan_catalog_number(_value -> c) <= 1000000
         and round(public.plan_catalog_number(_value -> c), 2) = public.plan_catalog_number(_value -> c))
       from unnest(array['CZK', 'EUR']) as c),
      false)
  end;
$$;

-- A whole number 0–1 000 000; JSON null only where the limit may be empty.
create or replace function public.plan_catalog_count_ok(_value jsonb, _nullable boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when _value is null then false
    when jsonb_typeof(_value) = 'null' then _nullable
    else coalesce(
      public.plan_catalog_number(_value) between 0 and 1000000
      and public.plan_catalog_number(_value) = trunc(public.plan_catalog_number(_value)),
      false)
  end;
$$;

create or replace function public.plan_catalog_feature_ok(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_value, array['cs', 'en', 'highlight']) then false
    else jsonb_typeof(_value -> 'highlight') = 'boolean'
      and public.plan_catalog_text_ok(_value - 'highlight', 1, 120)
  end;
$$;

create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'limits', 'features',
      'recommended', 'order']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_money_ok(_p -> 'monthly')
      and public.plan_catalog_money_ok(_p -> 'yearly')
      and public.plan_catalog_number(_p -> 'yearly' -> 'CZK')
        <= 12 * public.plan_catalog_number(_p -> 'monthly' -> 'CZK')
      and public.plan_catalog_number(_p -> 'yearly' -> 'EUR')
        <= 12 * public.plan_catalog_number(_p -> 'monthly' -> 'EUR')
      and (jsonb_typeof(_p -> 'per_worker') = 'null' or public.plan_catalog_money_ok(_p -> 'per_worker'))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- The whole payload: the three plans once each, distinct order, one recommended at most.
create or replace function public.valid_plan_catalog(_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_payload) is distinct from 'array' then false
    when jsonb_array_length(_payload) <> 3 then false
    when octet_length(_payload::text) > 64000 then false
    else coalesce(
      (select bool_and(public.plan_catalog_plan_ok(p)) from jsonb_array_elements(_payload) as p)
      and (select array_agg(p ->> 'key' order by p ->> 'key') from jsonb_array_elements(_payload) as p)
        = array['pro', 'solo', 'team']
      and (select count(distinct public.plan_catalog_number(p -> 'order'))
           from jsonb_array_elements(_payload) as p) = 3
      and (select count(*) from jsonb_array_elements(_payload) as p
           where p -> 'recommended' = 'true'::jsonb) <= 1,
      false)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table public.plan_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  status text not null check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  payload jsonb not null constraint plan_catalog_versions_payload_valid
    check (public.valid_plan_catalog(payload)),
  constraint plan_catalog_versions_published_has_time
    check (status = 'draft' or published_at is not null)
);
comment on table public.plan_catalog_versions is
  'Versions of the plan catalog: one published, at most one draft, the rest archived. Read by the server; written only through admin_plan_catalog_*().';
create unique index plan_catalog_versions_one_published
  on public.plan_catalog_versions ((true)) where status = 'published';
create unique index plan_catalog_versions_one_draft
  on public.plan_catalog_versions ((true)) where status = 'draft';
create index plan_catalog_versions_published_at_idx
  on public.plan_catalog_versions (published_at desc);

alter table public.plan_catalog_versions enable row level security;
-- No policies: the client can neither read nor write it.
revoke all on public.plan_catalog_versions from anon, authenticated;

-- History stays as it was: a draft may change and become published, a
-- published version may only be archived, an archived one never changes, and
-- only a draft can be deleted.
create or replace function public.plan_catalog_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.id <> old.id or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  if old.status = 'draft' then
    if new.status = 'archived' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  elsif old.status = 'published' then
    if new.status <> 'archived' or new.payload <> old.payload
       or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  else
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_catalog_versions_guard() from public, anon, authenticated;

create trigger plan_catalog_versions_guard
  before update or delete on public.plan_catalog_versions
  for each row execute function public.plan_catalog_versions_guard();

-- ---------------------------------------------------------------------------
-- Reading the published version (server and the functions below)
-- ---------------------------------------------------------------------------

-- One plan of the published version, or null for beta and unknown keys.
create or replace function public.published_plan(_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select p
  from public.plan_catalog_versions v
  cross join lateral jsonb_array_elements(v.payload) as p
  where v.status = 'published' and p ->> 'key' = _key
  limit 1;
$$;
revoke execute on function public.published_plan(text) from public, anon, authenticated;
grant execute on function public.published_plan(text) to service_role;

-- What an account holds against the workers and storage limits of its
-- published plan, and from when it is read-only for being over them: the next
-- midnight in the owner's zone after the later of the publishing and the
-- moment it went over (the oldest worker or file beyond the limit). No row
-- without a subscription to a plan of the catalog; nulls where nothing is over.
create or replace function public.plan_overage(_owner uuid)
returns table (
  plan_key text,
  workers_used integer,
  workers_limit integer,
  storage_bytes bigint,
  storage_limit_bytes bigint,
  over_since timestamptz,
  read_only_from timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _key text;
  _plan jsonb;
  _published_at timestamptz;
  _workers_limit integer;
  _storage_limit bigint;
  _workers integer := 0;
  _storage bigint := 0;
  _workers_over timestamptz;
  _storage_over timestamptz;
  _since timestamptz;
  _tz text;
  _from timestamptz;
begin
  select s.plan_key into _key from public.subscriptions s where s.user_id = _owner;
  if _key is null then
    return;
  end if;
  select p, v.published_at into _plan, _published_at
  from public.plan_catalog_versions v
  cross join lateral jsonb_array_elements(v.payload) as p
  where v.status = 'published' and p ->> 'key' = _key
  limit 1;
  if _plan is null then
    return;
  end if;

  _workers_limit := (_plan -> 'limits' ->> 'workers')::integer;
  _storage_limit := (_plan -> 'limits' ->> 'storage_mb')::bigint * 1048576;

  if _workers_limit is not null then
    select count(*)::integer into _workers
    from public.workers w
    where w.owner_id = _owner and w.status <> 'inactive';
    if _workers > _workers_limit then
      select w.created_at into _workers_over
      from public.workers w
      where w.owner_id = _owner and w.status <> 'inactive'
      order by w.created_at, w.id
      offset _workers_limit
      limit 1;
    end if;
  end if;

  if _storage_limit is not null then
    select coalesce(sum(a.size_bytes), 0)::bigint into _storage
    from public.attachments a
    where a.user_id = _owner;
    if _storage > _storage_limit then
      select x.created_at into _storage_over
      from (
        select a.created_at, sum(a.size_bytes) over (order by a.created_at, a.id) as total
        from public.attachments a
        where a.user_id = _owner
      ) x
      where x.total > _storage_limit
      order by x.created_at
      limit 1;
    end if;
  end if;

  if _workers_over is not null or _storage_over is not null then
    -- least() and greatest() skip nulls.
    _since := greatest(_published_at, least(_workers_over, _storage_over));
    select us.timezone into _tz from public.user_settings us where us.user_id = _owner;
    begin
      _from := ((_since at time zone coalesce(_tz, 'Europe/Prague'))::date + 1)::timestamp
        at time zone coalesce(_tz, 'Europe/Prague');
    exception when others then
      _from := ((_since at time zone 'Europe/Prague')::date + 1)::timestamp at time zone 'Europe/Prague';
    end;
  end if;

  return query select _key, _workers, _workers_limit, _storage, _storage_limit, _since, _from;
end;
$$;
revoke execute on function public.plan_overage(uuid) from public, anon, authenticated;
grant execute on function public.plan_overage(uuid) to service_role;

-- Read-only for being over a limit of the plan, from the day after.
create or replace function public.workspace_over_limit(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.read_only_from <= now() from public.plan_overage(_owner) o),
    false
  );
$$;
revoke execute on function public.workspace_over_limit(uuid) from public, anon, authenticated;
grant execute on function public.workspace_over_limit(uuid) to service_role;

-- The trial has ended or the account is over its plan's limits. Computed,
-- never stored. Body as before plus the limits.
create or replace function public.workspace_read_only(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = _owner
      and s.status = 'trialing'
      and s.trial_ends_at <= now()
  ) or public.workspace_over_limit(_owner);
$$;
revoke execute on function public.workspace_read_only(uuid) from public, anon, authenticated;
grant execute on function public.workspace_read_only(uuid) to service_role;

-- Plan and state of an account, as before, with the limits of solo / pro /
-- team from the published catalog. A read-only workspace (trial over or above
-- a limit) has no limits left: nothing new is generated or asked of the AI.
create or replace function public.current_plan(_user_id uuid)
returns table (
  plan_key text,
  status text,
  trial_ends_at timestamptz,
  read_only boolean,
  daily_generation_limit integer,
  monthly_generation_limit integer,
  ai_calls_limit integer,
  file_uploads_limit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
  _plan public.plans%rowtype;
  _catalog jsonb;
  _expired boolean;
  _read_only boolean;
begin
  if auth.uid() is not null
     and _user_id is distinct from auth.uid()
     and _user_id is distinct from public.current_workspace_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into _sub from public.subscriptions s where s.user_id = _user_id;
  if found then
    select * into _plan from public.plans p where p.key = _sub.plan_key;
  end if;
  if _plan.key is null then
    select * into _plan from public.plans p where p.is_default limit 1;
  end if;
  _catalog := public.published_plan(_plan.key) -> 'limits';

  _expired := coalesce(_sub.status = 'trialing' and _sub.trial_ends_at <= now(), false);
  _read_only := _expired or public.workspace_over_limit(_user_id);

  return query select
    _plan.key,
    case when _expired then 'expired' else coalesce(_sub.status::text, 'active') end,
    _sub.trial_ends_at,
    _read_only,
    case when _read_only then 0
      else coalesce((_catalog ->> 'daily_contacts')::integer, _plan.daily_generation_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'monthly_contacts')::integer, _plan.monthly_generation_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'ai_calls')::integer, _plan.ai_calls_limit, 0) end,
    case when _read_only then 0
      else coalesce((_catalog ->> 'ai_files')::integer, _plan.file_uploads_limit, 0) end;
end;
$$;
revoke execute on function public.current_plan(uuid) from public, anon;
grant execute on function public.current_plan(uuid) to authenticated, service_role;

-- For the confirmation before publishing: per plan of a payload, the accounts
-- on it (trial still running or active) and how many of them hold more than
-- its workers or storage limit. Server only, after the administration's guard.
create or replace function public.plan_catalog_impact(_payload jsonb)
returns table (plan_key text, users integer, over_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p ->> 'key',
    count(s.user_id)::integer,
    (count(s.user_id) filter (
      where (l.workers is not null and coalesce(w.n, 0) > l.workers)
         or (l.storage is not null and coalesce(a.bytes, 0) > l.storage)
    ))::integer
  from jsonb_array_elements(case when public.valid_plan_catalog(_payload) then _payload else '[]' end) as p
  cross join lateral (
    select (p -> 'limits' ->> 'workers')::integer as workers,
           (p -> 'limits' ->> 'storage_mb')::bigint * 1048576 as storage
  ) l
  left join public.subscriptions s
    on s.plan_key = p ->> 'key'
   and not (s.status = 'trialing' and s.trial_ends_at <= now())
  left join lateral (
    select count(*) as n from public.workers w
    where w.owner_id = s.user_id and w.status <> 'inactive' and l.workers is not null
  ) w on true
  left join lateral (
    select sum(x.size_bytes) as bytes from public.attachments x
    where x.user_id = s.user_id and l.storage is not null
  ) a on true
  group by p ->> 'key';
$$;
revoke execute on function public.plan_catalog_impact(jsonb) from public, anon, authenticated;
grant execute on function public.plan_catalog_impact(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Writers: the owner with aal2 and a live admin session, one at a time
-- ---------------------------------------------------------------------------

-- Saves the draft (creates it when there is none). Publishes nothing.
create or replace function public.admin_plan_catalog_save_draft(
  _payload jsonb,
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
  if _payload is null or not public.valid_plan_catalog(_payload) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  update public.plan_catalog_versions set payload = _payload
  where status = 'draft'
  returning id into _id;
  if _id is null then
    insert into public.plan_catalog_versions (created_by, status, payload)
    values (_uid, 'draft', _payload)
    returning id into _id;
  end if;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans.draft', _ip_hash,
          jsonb_build_object('action', 'save_draft', 'version', _id));
  return _id;
end;
$$;
revoke all on function public.admin_plan_catalog_save_draft(jsonb, text) from public, anon;
grant execute on function public.admin_plan_catalog_save_draft(jsonb, text) to authenticated;

-- Discards the draft; true when there was one.
create or replace function public.admin_plan_catalog_discard_draft(_ip_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  perform public.admin_require_owner();
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));
  delete from public.plan_catalog_versions where status = 'draft' returning id into _id;
  if _id is null then
    return false;
  end if;
  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans.draft', _ip_hash,
          jsonb_build_object('action', 'discard_draft', 'version', _id));
  return true;
end;
$$;
revoke all on function public.admin_plan_catalog_discard_draft(text) from public, anon;
grant execute on function public.admin_plan_catalog_discard_draft(text) to authenticated;

-- Publishes the draft. `_payload` is what the owner confirmed and
-- `_expected` the version the confirmation compared it with: when either
-- changed meanwhile (another tab saved or published), nothing happens ('stale').
create or replace function public.admin_plan_catalog_publish(
  _payload jsonb,
  _expected uuid,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _draft public.plan_catalog_versions%rowtype;
  _current uuid;
begin
  perform public.admin_require_owner();
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  select * into _draft from public.plan_catalog_versions where status = 'draft' for update;
  select id into _current from public.plan_catalog_versions where status = 'published' for update;
  if _draft.id is null or _draft.payload is distinct from _payload
     or _current is distinct from _expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  update public.plan_catalog_versions set status = 'archived' where id = _current;
  update public.plan_catalog_versions
  set status = 'published', published_at = now(), published_by = _uid
  where id = _draft.id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans', _ip_hash,
          jsonb_build_object('action', 'publish', 'from', _current, 'to', _draft.id));
  return _draft.id;
end;
$$;
revoke all on function public.admin_plan_catalog_publish(jsonb, uuid, text) from public, anon;
grant execute on function public.admin_plan_catalog_publish(jsonb, uuid, text) to authenticated;

-- Brings back an earlier version: publishes a copy of it as a new version.
-- The draft, if any, stays.
create or replace function public.admin_plan_catalog_restore(
  _version uuid,
  _expected uuid,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _payload jsonb;
  _current uuid;
  _id uuid;
begin
  perform public.admin_require_owner();
  perform pg_advisory_xact_lock(hashtext('public.plan_catalog_versions'));

  select payload into _payload from public.plan_catalog_versions
  where id = _version and status = 'archived';
  if _payload is null or not public.valid_plan_catalog(_payload) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select id into _current from public.plan_catalog_versions where status = 'published' for update;
  if _current is distinct from _expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  update public.plan_catalog_versions set status = 'archived' where id = _current;
  insert into public.plan_catalog_versions (created_by, status, published_at, published_by, payload)
  values (_uid, 'published', now(), _uid, _payload)
  returning id into _id;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (_uid, 'update', 'settings.plans', _ip_hash,
          jsonb_build_object('action', 'restore', 'from', _current, 'to', _id, 'source', _version));
  return _id;
end;
$$;
revoke all on function public.admin_plan_catalog_restore(uuid, uuid, text) from public, anon;
grant execute on function public.admin_plan_catalog_restore(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The first version: src/config/pricing.ts with the plan texts of the
-- translations, exactly what the website showed before.
-- ---------------------------------------------------------------------------
insert into public.plan_catalog_versions (status, published_at, payload)
values ('published', now(), $catalog$
[
  {
    "key": "solo",
    "name": {
      "cs": "Solo",
      "en": "Solo"
    },
    "tagline": {
      "cs": "Pro jednoho.",
      "en": "For one person."
    },
    "monthly": {
      "CZK": 490,
      "EUR": 19
    },
    "yearly": {
      "CZK": 4900,
      "EUR": 190
    },
    "per_worker": null,
    "limits": {
      "daily_contacts": 30,
      "monthly_contacts": 100,
      "ai_calls": 300,
      "ai_files": 0,
      "workers": null,
      "storage_mb": null
    },
    "features": [
      {
        "cs": "Všechny sekce aplikace",
        "en": "Every section of the app",
        "highlight": false
      },
      {
        "cs": "{monthly_contacts} vygenerovaných kontaktů měsíčně",
        "en": "{monthly_contacts} generated contacts a month",
        "highlight": false
      },
      {
        "cs": "Asistent Jarvis",
        "en": "Jarvis, your assistant",
        "highlight": false
      }
    ],
    "recommended": false,
    "order": 0
  },
  {
    "key": "pro",
    "name": {
      "cs": "Pro",
      "en": "Pro"
    },
    "tagline": {
      "cs": "Pro ty, kdo to myslí vážně.",
      "en": "For those who mean business."
    },
    "monthly": {
      "CZK": 890,
      "EUR": 35
    },
    "yearly": {
      "CZK": 8900,
      "EUR": 350
    },
    "per_worker": null,
    "limits": {
      "daily_contacts": 100,
      "monthly_contacts": 300,
      "ai_calls": 1000,
      "ai_files": 100,
      "workers": null,
      "storage_mb": null
    },
    "features": [
      {
        "cs": "{monthly_contacts} vygenerovaných kontaktů měsíčně",
        "en": "{monthly_contacts} generated contacts a month",
        "highlight": false
      },
      {
        "cs": "AI rozbor schůzek",
        "en": "AI meeting analysis",
        "highlight": false
      },
      {
        "cs": "Soubory do Jarvise",
        "en": "Files for Jarvis",
        "highlight": false
      },
      {
        "cs": "Synchronizace kalendáře",
        "en": "Calendar sync",
        "highlight": false
      },
      {
        "cs": "Přednostní podpora",
        "en": "Priority support",
        "highlight": false
      }
    ],
    "recommended": true,
    "order": 1
  },
  {
    "key": "team",
    "name": {
      "cs": "Tým",
      "en": "Team"
    },
    "tagline": {
      "cs": "Pro malý tým.",
      "en": "For a small team."
    },
    "monthly": {
      "CZK": 890,
      "EUR": 35
    },
    "yearly": {
      "CZK": 8900,
      "EUR": 350
    },
    "per_worker": {
      "CZK": 290,
      "EUR": 12
    },
    "limits": {
      "daily_contacts": 100,
      "monthly_contacts": 300,
      "ai_calls": 1500,
      "ai_files": 150,
      "workers": null,
      "storage_mb": null
    },
    "features": [
      {
        "cs": "Vše z Pro",
        "en": "Everything in Pro",
        "highlight": false
      },
      {
        "cs": "Pracovníci s právy",
        "en": "Workers with permissions",
        "highlight": false
      },
      {
        "cs": "Systém odměn",
        "en": "Reward system",
        "highlight": false
      },
      {
        "cs": "Týmové statistiky",
        "en": "Team statistics",
        "highlight": false
      }
    ],
    "recommended": false,
    "order": 2
  }
]
$catalog$::jsonb);
