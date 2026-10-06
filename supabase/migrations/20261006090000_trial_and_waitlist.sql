-- =============================================================================
-- Public sign-up: trial, read-only after it, waitlist
--   * paid plans solo / pro / team next to beta
--   * a new account starts a 14-day trial of pro; the server switches accounts
--     created with an invite (beta code or worker invite) to beta, which never
--     expires. Anything that bypasses the server ends up on the trial, not on beta.
--   * current_plan(user_id): plan, effective status and limits, one source for
--     the app, contact generation and Jarvis
--   * after the trial the workspace is read-only: a trigger refuses every write
--     a signed-in user makes to the workspace's business data. Nothing is deleted.
--   * waitlist: written only by the server, confirmed by a link in an e-mail
--   * app_overview(): counts for the app owner
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plans and the trial
-- -----------------------------------------------------------------------------

alter table public.subscriptions add column trial_ends_at timestamptz;
alter table public.subscriptions
  add constraint subscriptions_trial_has_end
  check (status <> 'trialing' or trial_ends_at is not null);

-- Monthly contact limits match src/config/pricing.ts (a test compares them).
insert into public.plans
  (key, name, daily_generation_limit, monthly_generation_limit, ai_calls_limit, file_uploads_limit, is_default)
values
  ('solo', 'Solo', 30, 100, 300, 0, false),
  ('pro', 'Pro', 100, 300, 1000, 100, false),
  ('team', 'Team', 100, 300, 1500, 150, false)
on conflict (key) do update set
  name = excluded.name,
  daily_generation_limit = excluded.daily_generation_limit,
  monthly_generation_limit = excluded.monthly_generation_limit,
  ai_calls_limit = excluded.ai_calls_limit,
  file_uploads_limit = excluded.file_uploads_limit;

-- Every new account except the very first (the app owner) starts on the trial.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user'));
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

-- An account created with an invite: beta, open-ended. Only the server calls it.
create or replace function public.grant_beta_plan(_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.subscriptions (user_id, plan_key, status)
  values (_user_id, 'beta', 'active')
  on conflict (user_id) do update set
    plan_key = 'beta',
    status = 'active',
    trial_ends_at = null,
    current_period_end = null,
    updated_at = now();
$$;
revoke execute on function public.grant_beta_plan(uuid) from public, anon, authenticated;
grant execute on function public.grant_beta_plan(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Effective plan
-- -----------------------------------------------------------------------------

-- True when the workspace's trial is over. Computed, never stored.
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
  );
$$;
revoke execute on function public.workspace_read_only(uuid) from public, anon, authenticated;
grant execute on function public.workspace_read_only(uuid) to service_role;

-- Plan and state of an account. A signed-in user may ask about their own
-- account or the workspace they work in; the server about anyone. Without a
-- subscription the default plan applies. A read-only workspace has no limits
-- left: nothing new is generated or asked of the AI.
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
  _expired boolean;
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

  _expired := coalesce(_sub.status = 'trialing' and _sub.trial_ends_at <= now(), false);

  return query select
    _plan.key,
    case when _expired then 'expired' else coalesce(_sub.status::text, 'active') end,
    _sub.trial_ends_at,
    _expired,
    case when _expired then 0 else coalesce(_plan.daily_generation_limit, 0) end,
    case when _expired then 0 else coalesce(_plan.monthly_generation_limit, 0) end,
    case when _expired then 0 else coalesce(_plan.ai_calls_limit, 0) end,
    case when _expired then 0 else coalesce(_plan.file_uploads_limit, 0) end;
end;
$$;
revoke execute on function public.current_plan(uuid) from public, anon;
grant execute on function public.current_plan(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Read-only after the trial
-- -----------------------------------------------------------------------------

-- Refuses a signed-in user's write to a read-only workspace's data, including
-- writes through SECURITY DEFINER functions they call (move_contact, timer…).
-- The server (service role, no user in the request) is not stopped here: its
-- routes check current_plan() themselves. TG_ARGV[0] names the owner column.
create or replace function public.enforce_workspace_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _column text := tg_argv[0];
  _owner uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    _owner := (to_jsonb(new) ->> _column)::uuid;
    if public.workspace_read_only(_owner) then
      raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    _owner := (to_jsonb(old) ->> _column)::uuid;
    if public.workspace_read_only(_owner) then
      raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.enforce_workspace_writable() from public, anon, authenticated;

do $$
declare
  _t record;
begin
  for _t in
    select * from (values
      ('attachments', 'user_id', 'insert or update or delete'),
      ('calendar_events', 'user_id', 'insert or update or delete'),
      ('contact_activities', 'user_id', 'insert or update or delete'),
      ('contact_table_entries', 'user_id', 'insert or update or delete'),
      ('contact_table_fields', 'user_id', 'insert or update or delete'),
      ('contact_table_moves', 'user_id', 'insert or update or delete'),
      ('contact_tables', 'user_id', 'insert or update or delete'),
      ('contacts', 'user_id', 'insert or update or delete'),
      ('deals', 'user_id', 'insert or update or delete'),
      ('invoices', 'user_id', 'insert or update or delete'),
      ('meeting_surveys', 'user_id', 'insert or update or delete'),
      ('milestones', 'user_id', 'insert or update or delete'),
      ('pipeline_stages', 'user_id', 'insert or update or delete'),
      ('prospecting_segments', 'user_id', 'insert or update or delete'),
      ('recurring_payments', 'user_id', 'insert or update or delete'),
      ('sales_analyses', 'user_id', 'insert or update or delete'),
      ('tasks', 'user_id', 'insert or update or delete'),
      ('transactions', 'user_id', 'insert or update or delete'),
      ('work_sessions', 'owner_id', 'insert or update or delete'),
      ('worker_tasks', 'owner_id', 'insert or update or delete'),
      ('worker_payments', 'owner_id', 'insert or update or delete'),
      ('worker_earnings', 'owner_id', 'insert or update or delete'),
      ('reward_rules', 'owner_id', 'insert or update or delete'),
      ('reward_drafts', 'owner_id', 'insert or update or delete'),
      -- The owner may still take access away; only new workers and invites wait.
      ('workers', 'owner_id', 'insert'),
      ('worker_invites', 'owner_id', 'insert'),
      ('worker_permissions', 'owner_id', 'insert')
    ) as t (tbl, col, ops)
  loop
    execute format('drop trigger if exists %I on public.%I', _t.tbl || '_writable', _t.tbl);
    execute format(
      'create trigger %I before %s on public.%I for each row execute function public.enforce_workspace_writable(%L)',
      _t.tbl || '_writable', _t.ops, _t.tbl, _t.col
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Waitlist
-- -----------------------------------------------------------------------------

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  locale text not null default 'cs' check (locale in ('cs', 'en')),
  source text not null default 'web' check (char_length(source) between 1 and 40),
  -- sha256 of the token in the confirmation link; the token itself is never stored
  confirm_token_hash text,
  confirm_sent_at timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index waitlist_email_idx on public.waitlist (email);
create unique index waitlist_token_idx on public.waitlist (confirm_token_hash)
  where confirm_token_hash is not null;

-- No policies: only the server (service role) reads and writes it.
alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Owner overview
-- -----------------------------------------------------------------------------

create or replace function public.app_overview()
returns table (trialing integer, expired integer, waitlist integer, waitlist_confirmed integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(auth.uid(), 'owner') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select
    (select count(*)::int from public.subscriptions
      where status = 'trialing' and trial_ends_at > now()),
    (select count(*)::int from public.subscriptions
      where status = 'trialing' and trial_ends_at <= now()),
    (select count(*)::int from public.waitlist),
    (select count(*)::int from public.waitlist where confirmed_at is not null);
end;
$$;
revoke execute on function public.app_overview() from public, anon;
grant execute on function public.app_overview() to authenticated;

-- -----------------------------------------------------------------------------
-- Jarvis suggestions keep opening the right page after the move under /app
-- -----------------------------------------------------------------------------

update public.jarvis_suggestions
set action = jsonb_set(
  action,
  '{href}',
  to_jsonb(
    case
      when action ->> 'href' = '/dashboard' then '/app'
      when action ->> 'href' like '/milestones%' then '/app/milniky' || substr(action ->> 'href', 12)
      when action ->> 'href' like '/contacts%' then '/app/kontakty' || substr(action ->> 'href', 10)
      when action ->> 'href' like '/calendar%' then '/app/kalendar' || substr(action ->> 'href', 10)
      else '/app' || (action ->> 'href')
    end
  )
)
where action ->> 'kind' = 'open'
  and action ->> 'href' ~ '^/(dashboard|milestones|pipeline|contacts|cold-calling|calendar|finance)([/?]|$)';
