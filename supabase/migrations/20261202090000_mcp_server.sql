-- =============================================================================
-- Gradus as an MCP server (step 28.8)
--
--   * OAuth 2.1 of the app's own: oauth_clients (dynamic registration and
--     client metadata documents), mcp_grants (one connected client of one
--     account: the level read | write | full, the companies it may act in and
--     the one it acts in now, the sealed Supabase session the server acts
--     with), oauth_codes and oauth_tokens (only SHA-256 hashes; refresh
--     tokens rotate), mcp_rate (a per-minute counter against loops) and
--     mcp_calls (what each client did: the history in Settings → Connected
--     apps and the count of actions). Everything but the person's own grants
--     and calls is the server's only; the client writes none of it.
--   * Who may use it: the company's switch (mcp_space_settings, the owner),
--     the right "integrations: MCP" of a worker (permission catalog, on by
--     default) and the plan (catalog flag `mcp`, missing = on).
--   * The company's activity names the client (activity_log.mcp_grant_id,
--     taken from the x-gradus-mcp-grant header only for a live grant of the
--     signed-in account).
--   * Trash for what Grady and the MCP clients delete: deals and contacts are
--     kept with deleted_at (hidden from every client query by restrictive
--     policies, with what hangs only on them), other rows as a snapshot in
--     trash_items. Restorable for app_settings.trash_retention days (7 by
--     default, the administration sets it); purge_trash() removes the rest
--     daily. Notes keep their own trash of 30 days.
-- Additive: new tables, new nullable columns, new policies, replaced
-- functions with the same signatures, new catalog rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The right "integrations: MCP" (on without a row, like a worker's own tasks)
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

-- Every worker has their own tasks, their branch of Company and may connect
-- an app (MCP) until the owner switches it off.
create or replace function public.permission_default(_section text, _action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (_action = 'view' and _section in ('tasks', 'company'))
    or (_section = 'integrations' and _action in ('view', 'mcp'));
$$;

-- -----------------------------------------------------------------------------
-- 2. The plan: the catalog's flag `mcp` (missing = available)
-- -----------------------------------------------------------------------------

create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'included_workers', 'limits',
      'features', 'recommended', 'order', 'mcp']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb',
      'scheduler_types']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    when not public.plan_catalog_money_ok(_p -> 'monthly') then false
    when not public.plan_catalog_money_ok(_p -> 'yearly') then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'yearly')
      and (select bool_and(coalesce(
             public.plan_catalog_number(_p -> 'yearly' -> c)
               <= 12 * public.plan_catalog_number(_p -> 'monthly' -> c), false))
           from jsonb_object_keys(_p -> 'monthly') as c)
      and (jsonb_typeof(_p -> 'per_worker') = 'null'
        or (public.plan_catalog_money_ok(_p -> 'per_worker')
          and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'per_worker')))
      and (not (_p ? 'included_workers') or public.plan_catalog_count_ok(_p -> 'included_workers', false))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and (not (_p -> 'limits' ? 'scheduler_types')
        or public.plan_catalog_count_ok(_p -> 'limits' -> 'scheduler_types', true))
      and (not (_p ? 'mcp') or jsonb_typeof(_p -> 'mcp') = 'boolean')
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- Whether the space's plan lets its people connect apps: the published
-- catalog's flag of the owner's plan; beta, other plans and older versions yes.
create or replace function public.plan_allows_mcp(_space uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _key text;
  _plan jsonb;
begin
  select s.plan_key into _key from public.subscriptions s where s.user_id = _space;
  if _key is null then
    return true;
  end if;
  _plan := public.published_plan(_key);
  if _plan is null or not (_plan ? 'mcp') then
    return true;
  end if;
  return coalesce((_plan ->> 'mcp')::boolean, true);
end;
$$;
revoke execute on function public.plan_allows_mcp(uuid) from public, anon, authenticated;
grant execute on function public.plan_allows_mcp(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. The company's switch
-- -----------------------------------------------------------------------------

create table public.mcp_space_settings (
  space_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);

alter table public.mcp_space_settings enable row level security;
create policy "mcp_space_settings_select" on public.mcp_space_settings
  for select to authenticated
  using (
    space_id = (select auth.uid())
    or space_id = any ((select public.member_spaces())::uuid[])
  );
create policy "mcp_space_settings_insert" on public.mcp_space_settings
  for insert to authenticated
  with check (space_id = (select auth.uid()));
create policy "mcp_space_settings_update" on public.mcp_space_settings
  for update to authenticated
  using (space_id = (select auth.uid()))
  with check (space_id = (select auth.uid()));
revoke all on public.mcp_space_settings from anon;
revoke delete on public.mcp_space_settings from authenticated;

create or replace function public.mcp_space_settings_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger mcp_space_settings_stamp
  before insert or update on public.mcp_space_settings
  for each row execute function public.mcp_space_settings_stamp();

-- -----------------------------------------------------------------------------
-- 4. OAuth: clients, grants, codes, tokens
-- -----------------------------------------------------------------------------

create table public.oauth_clients (
  -- A random id (dynamic registration) or the https address of the client's
  -- metadata document (CIMD).
  id text primary key check (char_length(id) between 16 and 512),
  kind text not null check (kind in ('dcr', 'cimd')),
  client_name text not null check (char_length(client_name) between 1 and 120),
  client_uri text check (client_uri is null or char_length(client_uri) <= 512),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  last_used_at timestamptz
);
create index oauth_clients_age_idx on public.oauth_clients (created_at);
alter table public.oauth_clients enable row level security;
revoke all on public.oauth_clients from anon, authenticated;
grant select, insert, update, delete on public.oauth_clients to service_role;

create table public.mcp_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The company the client acts in now; one of space_ids.
  space_id uuid not null references auth.users (id) on delete cascade,
  -- The companies the person allowed on the consent screen.
  space_ids uuid[] not null check (cardinality(space_ids) between 1 and 50),
  client_id text not null references public.oauth_clients (id) on delete cascade,
  client_name text not null check (char_length(client_name) between 1 and 120),
  redirect_host text check (redirect_host is null or char_length(redirect_host) <= 255),
  level text not null check (level in ('read', 'write', 'full')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  -- The Supabase session the server acts with (AES-256-GCM, never readable by clients).
  session_cipher text,
  constraint mcp_grants_space_allowed check (space_id = any (space_ids))
);
create index mcp_grants_user_idx on public.mcp_grants (user_id, created_at desc);
create index mcp_grants_space_idx on public.mcp_grants (space_id) where revoked_at is null;
alter table public.mcp_grants enable row level security;
create policy "mcp_grants_select_own" on public.mcp_grants
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.mcp_grants from anon, authenticated;
grant select (id, user_id, space_id, space_ids, client_name, redirect_host, level, created_at,
  last_used_at, revoked_at) on public.mcp_grants to authenticated;
grant select, insert, update, delete on public.mcp_grants to service_role;

create table public.oauth_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  grant_id uuid not null references public.mcp_grants (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_codes_age_idx on public.oauth_codes (expires_at);
alter table public.oauth_codes enable row level security;
revoke all on public.oauth_codes from anon, authenticated;
grant select, insert, update, delete on public.oauth_codes to service_role;

create table public.oauth_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_id uuid not null references public.mcp_grants (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  resource text not null,
  expires_at timestamptz not null,
  -- A refresh token is used once; using it again later is a replay.
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index oauth_tokens_age_idx on public.oauth_tokens (expires_at);
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_tokens from anon, authenticated;
grant select, insert, update, delete on public.oauth_tokens to service_role;

-- One minute of calls of one grant (a loop of a client stops here; not a daily cap).
create table public.mcp_rate (
  grant_id uuid not null references public.mcp_grants (id) on delete cascade,
  bucket timestamptz not null,
  hits integer not null default 0,
  primary key (grant_id, bucket)
);
alter table public.mcp_rate enable row level security;
revoke all on public.mcp_rate from anon, authenticated;
grant select, insert, update, delete on public.mcp_rate to service_role;

create or replace function public.mcp_rate_hit(_grant uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.mcp_rate (grant_id, bucket, hits)
  values (_grant, date_trunc('minute', now()), 1)
  on conflict (grant_id, bucket) do update set hits = public.mcp_rate.hits + 1
  returning hits;
$$;
revoke execute on function public.mcp_rate_hit(uuid) from public, anon, authenticated;
grant execute on function public.mcp_rate_hit(uuid) to service_role;

-- What a connected client did: the tool, its level, whether it worked, the card's line.
create table public.mcp_calls (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_grants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,63}$'),
  level text not null check (level in ('read', 'write', 'delete')),
  ok boolean not null,
  error text check (error is null or error ~ '^[A-Za-z][A-Za-z0-9_]{1,40}$'),
  summary text check (summary is null or char_length(summary) <= 300),
  created_at timestamptz not null default now()
);
create index mcp_calls_grant_idx on public.mcp_calls (grant_id, created_at desc);
create index mcp_calls_age_idx on public.mcp_calls (created_at);
alter table public.mcp_calls enable row level security;
create policy "mcp_calls_select_own" on public.mcp_calls
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.mcp_calls from anon, authenticated;
grant select on public.mcp_calls to authenticated;
grant select, insert, update, delete on public.mcp_calls to service_role;

-- Whether the signed-in account may use a connected app in this space now:
-- its own space; a company where it is an active worker with "integrations:
-- MCP" and the owner has not switched it off; and the space's plan allows it.
create or replace function public.mcp_space_open(_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and _space is not null
    and (
      _space = auth.uid()
      or (
        exists (
          select 1 from public.workers w
          where w.owner_id = _space
            and w.user_id = auth.uid()
            and w.status = 'active'
            and public.worker_grant(w.id, 'integrations', 'view')
            and public.worker_grant(w.id, 'integrations', 'mcp')
        )
        and coalesce(
          (select s.enabled from public.mcp_space_settings s where s.space_id = _space),
          true
        )
      )
    )
    and public.plan_allows_mcp(_space),
    false
  );
$$;
revoke execute on function public.mcp_space_open(uuid) from public, anon;
grant execute on function public.mcp_space_open(uuid) to authenticated, service_role;

-- The owner's view in Company: which of their people have a client connected here.
create or replace function public.company_mcp_clients()
returns table (worker_id uuid, clients integer, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, count(g.id)::integer, max(g.last_used_at)
  from public.workers w
  join public.mcp_grants g
    on g.user_id = w.user_id
   and w.owner_id = any (g.space_ids)
   and g.revoked_at is null
  where w.owner_id = auth.uid()
  group by w.id;
$$;
revoke execute on function public.company_mcp_clients() from public, anon;
grant execute on function public.company_mcp_clients() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The company's activity names the client
-- -----------------------------------------------------------------------------

alter table public.activity_log
  add column mcp_grant_id uuid references public.mcp_grants (id) on delete set null;

/** The live grant of the signed-in account the request names, else null. */
create or replace function public.activity_mcp_grant()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _raw text := nullif(current_setting('request.headers', true), '');
  _id uuid;
begin
  if _raw is null or auth.uid() is null then
    return null;
  end if;
  begin
    _id := (_raw::json ->> 'x-gradus-mcp-grant')::uuid;
  exception when others then
    return null;
  end;
  if _id is null then
    return null;
  end if;
  return (
    select g.id from public.mcp_grants g
    where g.id = _id and g.user_id = auth.uid() and g.revoked_at is null
  );
end;
$$;
revoke execute on function public.activity_mcp_grant() from public, anon, authenticated;

-- The same as in 20261201090000_activity_log.sql, with the client of an MCP step.
create or replace function public.activity_add(
  _space uuid,
  _verb text,
  _kind text,
  _object uuid,
  _summary jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _via text;
begin
  if _uid is null or _space is null then
    return;
  end if;
  _via := public.activity_via();
  insert into public.activity_log (
    space_id, actor_id, via, verb, object_kind, object_id, summary, mcp_grant_id)
  values (
    _space, _uid, _via, _verb, _kind, _object,
    jsonb_strip_nulls(coalesce(_summary, '{}'::jsonb)),
    case when _via = 'mcp' then public.activity_mcp_grant() end
  );
end;
$$;
revoke execute on function public.activity_add(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Trash: what Grady and connected apps delete can be restored
-- -----------------------------------------------------------------------------

alter table public.deals
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
alter table public.contacts
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index deals_trashed_idx on public.deals (id) where deleted_at is not null;
create index contacts_trashed_idx on public.contacts (id) where deleted_at is not null;

-- Only trash_record() / trash_restore() move a row in or out of the trash.
create or replace function public.trash_column_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deleted_by is not null then
      raise exception 'trash_denied' using errcode = '42501';
    end if;
  elsif (new.deleted_at, new.deleted_by) is distinct from (old.deleted_at, old.deleted_by) then
    raise exception 'trash_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trash_column_guard() from public, anon;
create trigger deals_trash_guard
  before insert or update on public.deals
  for each row execute function public.trash_column_guard();
create trigger contacts_trash_guard
  before insert or update on public.contacts
  for each row execute function public.trash_column_guard();

create or replace function public.deal_trashed(_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _id is not null
    and exists (select 1 from public.deals d where d.id = _id and d.deleted_at is not null);
$$;
create or replace function public.contact_trashed(_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _id is not null
    and exists (select 1 from public.contacts c where c.id = _id and c.deleted_at is not null);
$$;
revoke execute on function public.deal_trashed(uuid), public.contact_trashed(uuid) from public, anon;
grant execute on function public.deal_trashed(uuid), public.contact_trashed(uuid) to authenticated, service_role;

-- A row in the trash is gone for every client query, with what hangs only on it.
create policy "deals_not_trashed" on public.deals
  as restrictive for select to authenticated
  using (deleted_at is null);
create policy "contacts_not_trashed" on public.contacts
  as restrictive for select to authenticated
  using (deleted_at is null);
create policy "deal_contacts_not_trashed" on public.deal_contacts
  as restrictive for select to authenticated
  using (not public.deal_trashed(deal_id) and not public.contact_trashed(contact_id));
create policy "crm_tasks_not_trashed" on public.crm_tasks
  as restrictive for select to authenticated
  using (
    (deal_id is not null and not public.deal_trashed(deal_id))
    or (contact_id is not null and not public.contact_trashed(contact_id))
  );
create policy "calendar_events_not_trashed" on public.calendar_events
  as restrictive for select to authenticated
  using (source is distinct from 'deal_deadline' or not public.deal_trashed(deal_id));
create policy "contact_table_entries_not_trashed" on public.contact_table_entries
  as restrictive for select to authenticated
  using (not public.contact_trashed(contact_id));
create policy "contact_activities_not_trashed" on public.contact_activities
  as restrictive for select to authenticated
  using (not public.contact_trashed(contact_id));

create table public.trash_items (
  id uuid primary key default gen_random_uuid(),
  -- Who deleted it (and may restore it).
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'deal', 'contact', 'crm_task', 'task', 'event', 'transaction', 'recurring_payment')),
  record_id uuid not null,
  title text check (title is null or char_length(title) <= 200),
  via text not null default 'grady' check (via in ('app', 'grady', 'mcp')),
  -- The rows as they were (Undo records), for what was deleted; null for
  -- deals and contacts, which wait in their tables with deleted_at.
  records jsonb check (records is null or jsonb_typeof(records) = 'array'),
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index trash_items_user_idx on public.trash_items (user_id, deleted_at desc);
create index trash_items_record_idx on public.trash_items (record_id);
create index trash_items_age_idx on public.trash_items (deleted_at);
alter table public.trash_items enable row level security;
create policy "trash_items_select_own" on public.trash_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (space_id = (select auth.uid()) or space_id = any ((select public.member_spaces())::uuid[]))
  );
revoke all on public.trash_items from anon, authenticated;
grant select (id, user_id, space_id, kind, record_id, title, via, deleted_at, restored_at)
  on public.trash_items to authenticated;
grant select, insert, update, delete on public.trash_items to service_role;

/** How many days the trash keeps what was deleted (the administration's setting, else 7). */
create or replace function public.trash_retention_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value ->> 'days')::integer from public.app_settings s where s.key = 'trash_retention'),
    7
  );
$$;
grant execute on function public.trash_retention_days() to authenticated, service_role;

create or replace function public.valid_trash_retention(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_value) = 'object'
    and jsonb_typeof(_value -> 'days') = 'number'
    and (_value ->> 'days') ~ '^\d+$'
    and (_value ->> 'days')::integer between 1 and 90
    and coalesce((select bool_and(k = 'days') from jsonb_object_keys(_value) as k), false);
$$;
alter table public.app_settings
  add constraint app_settings_trash_retention_valid
  check (key <> 'trash_retention' or public.valid_trash_retention(value));

-- Whether the signed-in account may delete this deal / contact (the same as
-- the delete policies of the tables).
create or replace function public.trash_may_delete(_kind text, _id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid;
  _assignee uuid;
begin
  if _uid is null then
    return false;
  end if;
  if _kind = 'deal' then
    select d.user_id, d.assignee_id into _space, _assignee from public.deals d where d.id = _id;
    return _space is not null and (
      _space = _uid
      or (
        _space = any (public.permitted_spaces('pipeline', 'delete'))
        and (
          _assignee = _uid
          or public.is_deal_assignee(_id)
          or _space = any (public.permitted_spaces('pipeline', 'view_all'))
        )
      )
    );
  elsif _kind = 'contact' then
    select c.user_id into _space from public.contacts c where c.id = _id;
    return _space is not null and (
      _space = _uid or _space = any (public.permitted_spaces('contacts', 'delete'))
    );
  end if;
  return false;
end;
$$;
revoke execute on function public.trash_may_delete(text, uuid) from public, anon, authenticated;

/**
 * A deal or a contact into the trash (Grady's and the connected apps' delete):
 * hidden at once, restorable by the same person until the trash is emptied.
 */
create or replace function public.trash_record(_kind text, _id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid;
  _title text;
  _item uuid;
begin
  if _uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if _kind = 'deal' then
    select d.user_id, d.title into _space, _title
    from public.deals d where d.id = _id and d.deleted_at is null;
  elsif _kind = 'contact' then
    select c.user_id, public.activity_contact_name(c) into _space, _title
    from public.contacts c where c.id = _id and c.deleted_at is null;
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if _space is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.trash_may_delete(_kind, _id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if _kind = 'deal' then
    update public.deals set deleted_at = now(), deleted_by = _uid where id = _id;
  else
    update public.contacts set deleted_at = now(), deleted_by = _uid where id = _id;
  end if;
  insert into public.trash_items (user_id, space_id, kind, record_id, title, via)
  values (_uid, _space, _kind, _id, left(_title, 200),
    case when public.activity_via() in ('grady', 'mcp') then public.activity_via() else 'app' end)
  returning id into _item;
  perform public.activity_add(_space, 'deleted', _kind, _id,
    jsonb_build_object('title', public.activity_title(_title)));
  return _item;
end;
$$;
revoke execute on function public.trash_record(text, uuid) from public, anon;
grant execute on function public.trash_record(text, uuid) to authenticated;

/** A trashed deal or contact back, by the person who deleted it (still with the right to). */
create or replace function public.trash_restore_record(_kind text, _id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _item public.trash_items;
begin
  if _uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into _item from public.trash_items t
  where t.kind = _kind and t.record_id = _id and t.user_id = _uid
    and t.restored_at is null and t.records is null
  order by t.deleted_at desc
  limit 1;
  if _item.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.trash_may_delete(_kind, _id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if _kind = 'deal' then
    update public.deals set deleted_at = null, deleted_by = null
    where id = _id and deleted_at is not null;
  else
    update public.contacts set deleted_at = null, deleted_by = null
    where id = _id and deleted_at is not null;
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.trash_items set restored_at = now() where id = _item.id;
  return true;
end;
$$;
revoke execute on function public.trash_restore_record(text, uuid) from public, anon;
grant execute on function public.trash_restore_record(text, uuid) to authenticated;

/** Daily: what has been in the trash longer than the retention goes for good. */
create or replace function public.purge_trash()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _cutoff timestamptz := now() - make_interval(days => public.trash_retention_days());
  _deals integer;
  _contacts integer;
  _items integer;
begin
  delete from public.deals where deleted_at is not null and deleted_at < _cutoff;
  get diagnostics _deals = row_count;
  delete from public.contacts where deleted_at is not null and deleted_at < _cutoff;
  get diagnostics _contacts = row_count;
  delete from public.trash_items where deleted_at < _cutoff;
  get diagnostics _items = row_count;
  return _deals + _contacts + _items;
end;
$$;
revoke execute on function public.purge_trash() from public, anon, authenticated;
grant execute on function public.purge_trash() to service_role;

/** Daily: spent codes and tokens, old counters, calls after 180 days, unused clients. */
create or replace function public.purge_mcp()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _n integer := 0;
  _part integer;
begin
  delete from public.oauth_codes where expires_at < now() - interval '1 day';
  get diagnostics _part = row_count;
  _n := _n + _part;
  delete from public.oauth_tokens where expires_at < now() - interval '1 day';
  get diagnostics _part = row_count;
  _n := _n + _part;
  delete from public.mcp_rate where bucket < now() - interval '1 day';
  get diagnostics _part = row_count;
  _n := _n + _part;
  delete from public.mcp_calls where created_at < now() - interval '180 days';
  get diagnostics _part = row_count;
  _n := _n + _part;
  delete from public.mcp_grants where revoked_at < now() - interval '180 days';
  get diagnostics _part = row_count;
  _n := _n + _part;
  delete from public.oauth_clients c
  where c.created_at < now() - interval '30 days'
    and coalesce(c.last_used_at, c.created_at) < now() - interval '30 days'
    and not exists (select 1 from public.mcp_grants g where g.client_id = c.id);
  get diagnostics _part = row_count;
  return _n + _part;
end;
$$;
revoke execute on function public.purge_mcp() from public, anon, authenticated;
grant execute on function public.purge_mcp() to service_role;

-- The trash's retention joins the administration's settings (the same
-- function as in 20261124090000_showcase_mode.sql, with 'trash_retention').
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
  elsif _key = 'trash_retention' then
    if _value is null or not public.valid_trash_retention(_value) then
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
-- 7. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('mcp_client_registered', 'jarvis', false),
  ('mcp_client_connected', 'jarvis', true),
  ('mcp_client_disconnected', 'jarvis', true),
  ('mcp_level_changed', 'jarvis', false),
  ('mcp_tool_called', 'jarvis', true),
  ('mcp_space_switched', 'jarvis', false),
  ('mcp_company_toggled', 'workers', false),
  ('trash_restored', 'jarvis', false)
on conflict (event) do nothing;
