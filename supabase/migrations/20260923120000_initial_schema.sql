-- =============================================================================
-- Gradus — initial data model
--
-- Conventions
--   * every table: id uuid, user_id (or owner_id), created_at, updated_at
--     (append-only logs skip updated_at: usage_events, ai_usage,
--     contact_table_moves)
--   * RLS on every table; a user sees only their own rows unless noted
--   * composite foreign keys (id, user_id) keep child rows owned by the same
--     user as their parent
--   * timestamps are stored as timestamptz (UTC); the app renders and computes
--     day boundaries in the user's timezone (user_settings.timezone)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.app_role as enum ('owner', 'admin', 'user');
create type public.contact_field_type as enum ('text', 'long_text', 'date', 'datetime', 'select', 'boolean');
create type public.contact_source as enum ('manual', 'generated', 'import');
create type public.contact_activity_type as enum ('call', 'email', 'meeting', 'note', 'move', 'sms');
create type public.milestone_category as enum ('work', 'personal');
create type public.milestone_status as enum ('active', 'completed', 'archived');
create type public.task_status as enum ('todo', 'in_progress', 'done');
create type public.session_end_reason as enum ('pause', 'idle');
create type public.calendar_event_kind as enum ('meeting', 'call', 'reminder', 'other');
create type public.transaction_type as enum ('income', 'expense');
create type public.recurring_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type public.invoice_status as enum ('draft', 'open', 'sent', 'overdue', 'paid', 'cancelled', 'uncollectible');
create type public.worker_status as enum ('invited', 'active', 'inactive');
create type public.app_section as enum ('dashboard', 'milestones', 'pipeline', 'contacts', 'cold_calling', 'calendar', 'finance', 'workers', 'jarvis');
create type public.earning_status as enum ('pending', 'approved', 'paid');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
create type public.feature_request_status as enum ('new', 'planned', 'in_progress', 'done', 'declined');
create type public.jarvis_role as enum ('user', 'assistant');

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 1. Identity: profiles, roles, settings
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,                                  -- reserved for the future friends feature
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_username_lower_idx on public.profiles (lower(username)) where username is not null;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_user_id_idx on public.user_roles (user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  locale text not null default 'en',
  timezone text not null default 'Europe/Prague',
  country_code text not null default 'CZ',       -- ISO 3166-1 alpha-2, feeds call_time_stats
  currency text not null default 'CZK',           -- ISO 4217, display only
  date_format text not null default 'd. M. yyyy',
  time_format text not null default 'HH:mm',
  number_format text not null default 'cs',       -- key understood by format.ts
  first_day_of_week smallint not null default 1 check (first_day_of_week between 0 and 6),
  sound_enabled boolean not null default true,
  daily_call_goal integer not null default 20 check (daily_call_goal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 2. Plans and subscriptions
-- =============================================================================

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  daily_generation_limit integer not null check (daily_generation_limit >= 0),
  monthly_generation_limit integer not null check (monthly_generation_limit >= 0),
  ai_calls_limit integer not null check (ai_calls_limit >= 0),      -- per calendar month
  file_uploads_limit integer not null check (file_uploads_limit >= 0), -- per calendar month
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_single_default_idx on public.plans (is_default) where is_default;

insert into public.plans (key, name, daily_generation_limit, monthly_generation_limit, ai_calls_limit, file_uploads_limit, is_default)
values ('beta', 'Beta', 500, 5000, 3000, 500, true);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan_key text not null references public.plans (key) on update cascade,
  status public.subscription_status not null default 'active',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,                 -- null = open-ended (beta)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 3. Contacts and user-defined contact tables
-- =============================================================================

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  phone_normalized text,                          -- digits only, for duplicate detection
  website text,
  address text,
  city text,
  postal_code text,
  country_code text,
  external_place_id text,                         -- Google Places id
  source public.contact_source not null default 'manual',
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (company_name is not null or first_name is not null or last_name is not null)
);
create index contacts_user_id_idx on public.contacts (user_id);
create unique index contacts_user_place_idx on public.contacts (user_id, external_place_id) where external_place_id is not null;
create index contacts_user_phone_idx on public.contacts (user_id, phone_normalized) where phone_normalized is not null;
create index contacts_user_company_idx on public.contacts (user_id, lower(company_name));

create table public.contact_tables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default 'slate',            -- theme token name, never a hex
  position integer not null default 0,
  is_system boolean not null default false,       -- cannot be deleted; 'clients' is filled automatically
  system_key text,                                -- unreached, no_answer, failed, meeting_scheduled, email_sent, follow_up, clients
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index contact_tables_user_position_idx on public.contact_tables (user_id, position);
create unique index contact_tables_user_system_key_idx on public.contact_tables (user_id, system_key) where system_key is not null;

create table public.contact_table_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  table_id uuid not null,
  label text not null,
  type public.contact_field_type not null,
  required boolean not null default false,
  options jsonb,                                  -- select: [{ "key": "...", "label": "..." }]
  default_value text,                             -- 'today' / 'now' for date fields, literal otherwise
  depends_on_field_id uuid references public.contact_table_fields (id) on delete set null,
  depends_on_value text,                          -- option key of the parent select field
  position integer not null default 0,
  system_key text,                                -- e.g. meeting_at, so the app can act on well-known fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (table_id, user_id) references public.contact_tables (id, user_id) on delete cascade,
  check (type <> 'select' or options is not null),
  check ((depends_on_field_id is null) = (depends_on_value is null))
);
create index contact_table_fields_table_position_idx on public.contact_table_fields (table_id, position);
create index contact_table_fields_user_id_idx on public.contact_table_fields (user_id);

create table public.contact_table_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null,
  table_id uuid not null,
  answers jsonb not null default '{}',            -- { "<field_id>": value }
  moved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, contact_id),                   -- a contact is always in exactly one table
  foreign key (contact_id, user_id) references public.contacts (id, user_id) on delete cascade,
  foreign key (table_id, user_id) references public.contact_tables (id, user_id) on delete restrict
);
create index contact_table_entries_table_moved_idx on public.contact_table_entries (table_id, moved_at desc);
create index contact_table_entries_user_table_idx on public.contact_table_entries (user_id, table_id);

create table public.contact_table_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  from_table_id uuid references public.contact_tables (id) on delete set null,
  to_table_id uuid references public.contact_tables (id) on delete set null,
  answers jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index contact_table_moves_user_created_idx on public.contact_table_moves (user_id, created_at desc);
create index contact_table_moves_contact_idx on public.contact_table_moves (contact_id, created_at desc);
create index contact_table_moves_from_table_idx on public.contact_table_moves (from_table_id, created_at desc);
create index contact_table_moves_to_table_idx on public.contact_table_moves (to_table_id, created_at desc);

create table public.contact_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null,
  deal_id uuid,                                   -- FK added after deals exists
  type public.contact_activity_type not null,
  content text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (contact_id, user_id) references public.contacts (id, user_id) on delete cascade
);
create index contact_activities_contact_occurred_idx on public.contact_activities (contact_id, occurred_at desc);
create index contact_activities_user_occurred_idx on public.contact_activities (user_id, occurred_at desc);

-- =============================================================================
-- 4. Milestones and tasks
-- =============================================================================

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  category public.milestone_category not null default 'work',
  tag text,
  target_date date,
  status public.milestone_status not null default 'active',
  position integer not null default 0,
  ai_feedback text,
  ai_feedback_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index milestones_user_status_idx on public.milestones (user_id, status, position);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  milestone_id uuid not null,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  position integer not null default 0,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (milestone_id, user_id) references public.milestones (id, user_id) on delete cascade,
  check (parent_task_id is distinct from id)
);
create index tasks_user_idx on public.tasks (user_id);
create index tasks_milestone_position_idx on public.tasks (milestone_id, position);
create index tasks_parent_idx on public.tasks (parent_task_id);
create index tasks_user_due_idx on public.tasks (user_id, due_date) where status <> 'done';

-- A subtask always lives in its parent's milestone.
create or replace function public.tasks_inherit_milestone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_task_id is not null then
    select milestone_id into new.milestone_id
    from public.tasks where id = new.parent_task_id;
  end if;
  return new;
end;
$$;
create trigger tasks_inherit_milestone
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.tasks_inherit_milestone();

-- A task with subtasks cannot be completed until every subtask is done.
-- Completion is never automatic; completed_at follows the status.
create or replace function public.tasks_before_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _was_done boolean := tg_op = 'UPDATE' and old.status = 'done';
begin
  if new.status = 'done' and not _was_done then
    if exists (
      select 1 from public.tasks
      where parent_task_id = new.id and status <> 'done'
    ) then
      raise exception 'task_has_open_subtasks' using errcode = 'check_violation';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_before_status_change
  before insert or update of status on public.tasks
  for each row execute function public.tasks_before_status_change();

-- Reopening a subtask reopens a completed parent.
create or replace function public.tasks_reopen_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_task_id is not null and new.status <> 'done' and old.status = 'done' then
    update public.tasks
    set status = 'in_progress'
    where id = new.parent_task_id and status = 'done';
  end if;
  return new;
end;
$$;
create trigger tasks_reopen_parent
  after update of status on public.tasks
  for each row execute function public.tasks_reopen_parent();

-- =============================================================================
-- 5. Pipeline
-- =============================================================================

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default 'violet',
  position integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  system_key text,                                -- lead, meeting, offer, deposit_paid, won, lost
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (not (is_won and is_lost))
);
create index pipeline_stages_user_position_idx on public.pipeline_stages (user_id, position);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  stage_id uuid not null,
  title text not null,
  description text,
  value numeric(14, 2),
  currency text not null default 'CZK',
  expected_close_date date,
  position integer not null default 0,
  entered_stage_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (stage_id, user_id) references public.pipeline_stages (id, user_id) on delete restrict
);
create index deals_user_stage_position_idx on public.deals (user_id, stage_id, position);
create index deals_contact_idx on public.deals (contact_id);

alter table public.contact_activities
  add constraint contact_activities_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete set null;
create index contact_activities_deal_idx on public.contact_activities (deal_id);

-- =============================================================================
-- 6. Meeting surveys and sales analyses
-- =============================================================================

create table public.meeting_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null,
  stage_id uuid references public.pipeline_stages (id) on delete set null,
  answers jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (deal_id, user_id) references public.deals (id, user_id) on delete cascade
);
create index meeting_surveys_deal_idx on public.meeting_surveys (deal_id, created_at desc);
create index meeting_surveys_user_created_idx on public.meeting_surveys (user_id, created_at desc);

create table public.sales_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_analyses_user_created_idx on public.sales_analyses (user_id, created_at desc);

-- =============================================================================
-- 7. Prospecting timer (cold calling)
-- =============================================================================

create table public.prospecting_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason public.session_end_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= started_at)
);
create index prospecting_segments_user_started_idx on public.prospecting_segments (user_id, started_at desc);
create unique index prospecting_segments_one_open_idx on public.prospecting_segments (user_id) where ended_at is null;

-- =============================================================================
-- 8. Calendar
-- =============================================================================

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  kind public.calendar_event_kind not null default 'other',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  contact_id uuid references public.contacts (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index calendar_events_user_starts_idx on public.calendar_events (user_id, starts_at);
create index calendar_events_contact_idx on public.calendar_events (contact_id);
create index calendar_events_deal_idx on public.calendar_events (deal_id);

-- =============================================================================
-- 9. Finance
-- =============================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  number text not null,
  amount numeric(14, 2) not null,
  currency text not null default 'CZK',
  status public.invoice_status not null default 'open',
  issued_on date,
  due_on date,
  paid_on date,
  customer_name text,
  contact_id uuid references public.contacts (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  fakturoid_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_user_status_idx on public.invoices (user_id, status, due_on);
create unique index invoices_user_fakturoid_idx on public.invoices (user_id, fakturoid_id) where fakturoid_id is not null;

create table public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.transaction_type not null,
  amount numeric(14, 2) not null,
  currency text not null default 'CZK',
  category text,
  description text not null,
  frequency public.recurring_frequency not null,
  next_due_on date not null,
  last_generated_on date,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recurring_payments_user_idx on public.recurring_payments (user_id);
create index recurring_payments_user_next_idx on public.recurring_payments (user_id, next_due_on) where is_active;
create index recurring_payments_due_idx on public.recurring_payments (next_due_on) where is_active; -- daily cron

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.transaction_type not null,
  amount numeric(14, 2) not null,
  currency text not null default 'CZK',
  category text,
  description text,
  occurred_on date not null,
  deal_id uuid references public.deals (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  recurring_payment_id uuid references public.recurring_payments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_occurred_idx on public.transactions (user_id, occurred_on desc);
create index transactions_recurring_idx on public.transactions (recurring_payment_id, occurred_on);
create index transactions_invoice_idx on public.transactions (invoice_id);

-- Fakturoid credentials live here encrypted, never in env. Server-only (no policies).
create table public.fakturoid_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  account_slug text not null,
  encrypted_credentials text not null,            -- encrypted by the server before insert
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 10. Workers
-- =============================================================================

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null, -- the worker's own account, once the invite is accepted
  name text not null,
  email text,
  phone text,
  status public.worker_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, user_id)
);
create index workers_owner_idx on public.workers (owner_id);
create index workers_user_idx on public.workers (user_id);

-- Worker ids belonging to the signed-in account (used by worker-facing policies).
create or replace function public.my_worker_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.workers where user_id = auth.uid();
$$;

create table public.worker_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  email text,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index worker_invites_owner_idx on public.worker_invites (owner_id);
create index worker_invites_worker_idx on public.worker_invites (worker_id);

create table public.worker_permissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  section public.app_section not null,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, section),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index worker_permissions_owner_idx on public.worker_permissions (owner_id);

create table public.worker_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  title text not null,
  description text,
  due_date date,
  status public.task_status not null default 'todo',
  assigned_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index worker_tasks_worker_status_idx on public.worker_tasks (worker_id, status, due_date);
create index worker_tasks_owner_idx on public.worker_tasks (owner_id, status);

create or replace function public.worker_tasks_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger worker_tasks_completed_at
  before insert or update of status on public.worker_tasks
  for each row execute function public.worker_tasks_completed_at();

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason public.session_end_reason,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade,
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= started_at)
);
create index work_sessions_worker_started_idx on public.work_sessions (worker_id, started_at desc);
create index work_sessions_owner_started_idx on public.work_sessions (owner_id, started_at desc);
create unique index work_sessions_one_open_idx on public.work_sessions (worker_id) where ended_at is null;

create table public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid,                                 -- null = applies to all workers of the owner
  name text not null,
  rules jsonb not null default '{}',              -- rule tree evaluated by the app
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index reward_rules_owner_idx on public.reward_rules (owner_id) where is_active;
create index reward_rules_worker_idx on public.reward_rules (worker_id);

create table public.worker_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'CZK',
  paid_at timestamptz not null default now(),
  note text,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index worker_payments_worker_paid_idx on public.worker_payments (worker_id, paid_at desc);
create index worker_payments_owner_idx on public.worker_payments (owner_id, paid_at desc);

create table public.worker_earnings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'CZK',
  description text,
  status public.earning_status not null default 'pending',
  reward_rule_id uuid references public.reward_rules (id) on delete set null,
  work_session_id uuid references public.work_sessions (id) on delete set null,
  worker_task_id uuid references public.worker_tasks (id) on delete set null,
  payment_id uuid references public.worker_payments (id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade,
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'paid' or (approved_at is not null and paid_at is not null))
);
create index worker_earnings_worker_status_idx on public.worker_earnings (worker_id, status, created_at desc);
create index worker_earnings_owner_status_idx on public.worker_earnings (owner_id, status);
create index worker_earnings_payment_idx on public.worker_earnings (payment_id);

-- =============================================================================
-- 11. Gamification, Jarvis, attachments, feedback
-- =============================================================================

create table public.unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  unlocked_at timestamptz not null default now(),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.jarvis_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index jarvis_conversations_user_last_idx on public.jarvis_conversations (user_id, last_message_at desc nulls last);

create table public.jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role public.jarvis_role not null,
  content text not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.jarvis_conversations (id, user_id) on delete cascade
);
create index jarvis_messages_conversation_created_idx on public.jarvis_messages (conversation_id, created_at);
create index jarvis_messages_user_idx on public.jarvis_messages (user_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,                      -- jarvis_message, milestone, deal, contact, ...
  entity_id uuid not null,
  storage_path text not null unique,              -- object path in the "attachments" bucket
  file_name text not null,
  mime_type text not null,                        -- detected from content, not from the extension
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 10 * 1024 * 1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create index attachments_user_idx on public.attachments (user_id, created_at desc);

create table public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status public.feature_request_status not null default 'new',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feature_requests_user_idx on public.feature_requests (user_id, created_at desc);
create index feature_requests_status_idx on public.feature_requests (status, created_at desc);

-- =============================================================================
-- 12. Server-only logs and shared statistics
-- =============================================================================

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,                       -- generate_contacts, file_upload, ...
  success boolean not null default true,
  quantity integer not null default 1 check (quantity >= 0),
  message text,                                   -- provider error message on failure
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index usage_events_user_type_created_idx on public.usage_events (user_id, event_type, created_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.jarvis_conversations (id) on delete set null,
  purpose text not null,                          -- chat, milestone_review, opportunity_scan, ...
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  duration_ms integer,
  success boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

-- Shared, anonymous: best hours to call per country. Written only by the daily cron.
create table public.call_time_stats (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),   -- 0 = Sunday
  hour smallint not null check (hour between 0 and 23),               -- local hour in the caller's timezone
  attempts integer not null default 0 check (attempts >= 0),
  meetings integer not null default 0 check (meetings >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, day_of_week, hour)
);

-- =============================================================================
-- updated_at triggers
-- =============================================================================

do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- =============================================================================
-- Domain functions
-- =============================================================================

-- Move a contact to another table. The only supported way to change membership.
-- Rejects the system "clients" table; won deals fill it through a trigger.
create or replace function public.move_contact(
  _contact_id uuid,
  _to_table_id uuid,
  _answers jsonb default '{}'::jsonb
)
returns public.contact_table_entries
language plpgsql
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _target public.contact_tables;
  _from uuid;
  _entry public.contact_table_entries;
begin
  select * into _target from public.contact_tables
  where id = _to_table_id and user_id = _uid;
  if _target.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _target.system_key = 'clients' then
    raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.contacts where id = _contact_id and user_id = _uid) then
    raise exception 'contact_not_found' using errcode = 'no_data_found';
  end if;

  select table_id into _from from public.contact_table_entries
  where user_id = _uid and contact_id = _contact_id;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (_uid, _contact_id, _to_table_id, coalesce(_answers, '{}'::jsonb), now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id,
        answers = excluded.answers,
        moved_at = excluded.moved_at
  returning * into _entry;

  insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
  values (_uid, _contact_id, _from, _to_table_id, coalesce(_answers, '{}'::jsonb));

  return _entry;
end;
$$;

-- Stage changes stamp entered_stage_at and won_at / lost_at.
create or replace function public.deals_before_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _stage public.pipeline_stages;
begin
  if tg_op = 'UPDATE' then
    if new.stage_id = old.stage_id then
      return new;
    end if;
  end if;
  select * into _stage from public.pipeline_stages where id = new.stage_id;
  new.entered_stage_at := now();
  new.won_at := case when _stage.is_won then now() else null end;
  new.lost_at := case when _stage.is_lost then now() else null end;
  return new;
end;
$$;
create trigger deals_before_stage_change
  before insert or update of stage_id on public.deals
  for each row execute function public.deals_before_stage_change();

-- A won deal puts its contact into the system "clients" table.
create or replace function public.deals_after_won()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _clients_table_id uuid;
  _from uuid;
begin
  if new.won_at is null or new.contact_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.won_at is not null then
      return new;
    end if;
  end if;

  select id into _clients_table_id from public.contact_tables
  where user_id = new.user_id and system_key = 'clients';
  if _clients_table_id is null then
    return new;
  end if;

  select table_id into _from from public.contact_table_entries
  where user_id = new.user_id and contact_id = new.contact_id;
  if _from = _clients_table_id then
    return new;
  end if;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (new.user_id, new.contact_id, _clients_table_id, '{}'::jsonb, now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id, answers = '{}'::jsonb, moved_at = excluded.moved_at;

  insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
  values (new.user_id, new.contact_id, _from, _clients_table_id, jsonb_build_object('deal_id', new.id));

  return new;
end;
$$;
create trigger deals_after_won
  after insert or update of stage_id on public.deals
  for each row execute function public.deals_after_won();

-- Idle window for timers: no activity for 15 minutes ends the segment.
create or replace function public.timer_idle_interval()
returns interval
language sql
immutable
as $$ select interval '15 minutes'; $$;

-- Last prospecting activity = the latest move out of the "unreached" table
-- since the segment started (or the segment start itself).
create or replace function public.prospecting_last_activity_at(_segment public.prospecting_segments)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    _segment.started_at,
    (
      select max(m.created_at)
      from public.contact_table_moves m
      join public.contact_tables t on t.id = m.from_table_id
      where m.user_id = _segment.user_id
        and t.system_key = 'unreached'
        and m.created_at >= _segment.started_at
    )
  );
$$;

-- Effective end of a segment: its real end, or min(now, last activity + idle).
create or replace function public.prospecting_effective_end(_segment public.prospecting_segments)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    _segment.ended_at,
    least(now(), public.prospecting_last_activity_at(_segment) + public.timer_idle_interval())
  );
$$;

-- Seconds prospected on a calendar day in the given timezone, segments clipped
-- to the day. Nothing is stored; midnight needs no job.
create or replace function public.prospecting_seconds_for_day(_day date, _timezone text)
returns integer
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      (_day::timestamp at time zone _timezone) as day_start,
      ((_day + 1)::timestamp at time zone _timezone) as day_end
  )
  select coalesce(sum(
    extract(epoch from
      least(public.prospecting_effective_end(s), b.day_end)
      - greatest(s.started_at, b.day_start)
    )
  ), 0)::integer
  from public.prospecting_segments s, bounds b
  where s.user_id = auth.uid()
    and s.started_at < b.day_end
    and public.prospecting_effective_end(s) > b.day_start;
$$;

-- Start the timer. A stale open segment is closed as idle first.
create or replace function public.start_prospecting()
returns public.prospecting_segments
language plpgsql
set search_path = ''
as $$
declare
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  select * into _open from public.prospecting_segments
  where user_id = auth.uid() and ended_at is null;

  if _open.id is not null then
    _effective := public.prospecting_effective_end(_open);
    if _effective < now() then
      update public.prospecting_segments
      set ended_at = _effective, end_reason = 'idle'
      where id = _open.id;
    else
      return _open;
    end if;
  end if;

  insert into public.prospecting_segments (user_id) values (auth.uid())
  returning * into _open;
  return _open;
end;
$$;

-- Pause the timer. Closes the open segment at its effective end.
create or replace function public.pause_prospecting()
returns public.prospecting_segments
language plpgsql
set search_path = ''
as $$
declare
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  select * into _open from public.prospecting_segments
  where user_id = auth.uid() and ended_at is null;
  if _open.id is null then
    return null;
  end if;

  _effective := public.prospecting_effective_end(_open);
  update public.prospecting_segments
  set ended_at = _effective,
      end_reason = case when _effective < now() then 'idle' else 'pause' end::public.session_end_reason
  where id = _open.id
  returning * into _open;
  return _open;
end;
$$;

-- Work sessions use the same rules; activity = the worker touching their tasks.
create or replace function public.work_session_effective_end(_session public.work_sessions)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    _session.ended_at,
    least(
      now(),
      greatest(
        _session.started_at,
        (
          select max(updated_at) from public.worker_tasks
          where worker_id = _session.worker_id and updated_at >= _session.started_at
        )
      ) + public.timer_idle_interval()
    )
  );
$$;

create or replace function public.work_seconds_for_day(_worker_id uuid, _day date, _timezone text)
returns integer
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      (_day::timestamp at time zone _timezone) as day_start,
      ((_day + 1)::timestamp at time zone _timezone) as day_end
  )
  select coalesce(sum(
    extract(epoch from
      least(public.work_session_effective_end(s), b.day_end)
      - greatest(s.started_at, b.day_start)
    )
  ), 0)::integer
  from public.work_sessions s, bounds b
  where s.worker_id = _worker_id
    and (s.owner_id = auth.uid() or s.worker_id in (select public.my_worker_ids()))
    and s.started_at < b.day_end
    and public.work_session_effective_end(s) > b.day_start;
$$;

-- =============================================================================
-- Account initialisation
-- =============================================================================

create or replace function public.initialize_user(_user_id uuid, _locale text default 'en')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _cs boolean := coalesce(_locale, 'en') = 'cs';
  _plan text;
  _t_failed uuid;
  _t_meeting uuid;
  _t_email uuid;
  _t_follow uuid;
  _f_reason uuid;
begin
  -- profile, settings, role, subscription --------------------------------
  insert into public.profiles (id) values (_user_id)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, locale)
  values (_user_id, case when _cs then 'cs' else 'en' end)
  on conflict (user_id) do nothing;

  -- the very first account becomes the owner
  if not exists (select 1 from public.user_roles where user_id = _user_id) then
    insert into public.user_roles (user_id, role)
    values (_user_id, case when exists (select 1 from public.user_roles) then 'user' else 'owner' end::public.app_role);
  end if;

  select key into _plan from public.plans where is_default limit 1;
  if _plan is not null then
    insert into public.subscriptions (user_id, plan_key) values (_user_id, _plan)
    on conflict (user_id) do nothing;
  end if;

  -- six pipeline stages ---------------------------------------------------
  if not exists (select 1 from public.pipeline_stages where user_id = _user_id) then
    insert into public.pipeline_stages (user_id, name, color, position, is_won, is_lost, system_key) values
      (_user_id, case when _cs then 'Nový lead' else 'New lead' end, 'violet', 0, false, false, 'lead'),
      (_user_id, case when _cs then 'Schůzka' else 'Meeting' end, 'blue', 1, false, false, 'meeting'),
      (_user_id, case when _cs then 'Nabídka odeslána' else 'Offer sent' end, 'gold', 2, false, false, 'offer'),
      (_user_id, case when _cs then 'Záloha zaplacena' else 'Deposit paid' end, 'teal', 3, false, false, 'deposit_paid'),
      (_user_id, case when _cs then 'Vyhráno' else 'Won' end, 'green', 4, true, false, 'won'),
      (_user_id, case when _cs then 'Ztraceno' else 'Lost' end, 'pink', 5, false, true, 'lost');
  end if;

  -- seven contact tables --------------------------------------------------
  if exists (select 1 from public.contact_tables where user_id = _user_id) then
    return;
  end if;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key) values
    (_user_id, case when _cs then 'Neoslovení klienti' else 'Unreached' end, 'slate', 0, true, 'unreached'),
    (_user_id, case when _cs then 'Nezvedají telefon' else 'No answer' end, 'blue', 1, false, 'no_answer');

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Neúspěch' else 'Unsuccessful' end, 'pink', 2, false, 'failed')
  returning id into _t_failed;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Domluvená schůzka' else 'Meeting scheduled' end, 'green', 3, false, 'meeting_scheduled')
  returning id into _t_meeting;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Odeslán e-mail' else 'Email sent' end, 'violet', 4, false, 'email_sent')
  returning id into _t_email;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Ozvat se' else 'Follow up' end, 'gold', 5, false, 'follow_up')
  returning id into _t_follow;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Klienti' else 'Clients' end, 'teal', 6, true, 'clients');

  -- Unsuccessful: reason + dependent "why" fields
  insert into public.contact_table_fields (user_id, table_id, label, type, required, options, position, system_key)
  values (
    _user_id, _t_failed,
    case when _cs then 'Důvod' else 'Reason' end,
    'select', true,
    case when _cs then
      '[{"key":"has_solution","label":"Už mají řešení"},{"key":"not_interested","label":"Nemají zájem"},{"key":"no_budget","label":"Nemá finance"},{"key":"not_target_group","label":"Není cílová skupina"},{"key":"other","label":"Jiné"}]'::jsonb
    else
      '[{"key":"has_solution","label":"Already have a solution"},{"key":"not_interested","label":"Not interested"},{"key":"no_budget","label":"No budget"},{"key":"not_target_group","label":"Not the target group"},{"key":"other","label":"Other"}]'::jsonb
    end,
    0, 'reason'
  )
  returning id into _f_reason;

  insert into public.contact_table_fields (user_id, table_id, label, type, required, depends_on_field_id, depends_on_value, position) values
    (_user_id, _t_failed, case when _cs then 'Proč?' else 'Why?' end, 'long_text', false, _f_reason, 'not_interested', 1),
    (_user_id, _t_failed, case when _cs then 'Proč?' else 'Why?' end, 'long_text', false, _f_reason, 'not_target_group', 2),
    (_user_id, _t_failed, case when _cs then 'Popis' else 'Description' end, 'long_text', false, _f_reason, 'other', 3);

  -- Meeting scheduled
  insert into public.contact_table_fields (user_id, table_id, label, type, required, position, system_key) values
    (_user_id, _t_meeting, case when _cs then 'Kdy?' else 'When?' end, 'datetime', true, 0, 'meeting_at'),
    (_user_id, _t_meeting, case when _cs then 'Podrobnosti' else 'Details' end, 'long_text', false, 1, null),
    (_user_id, _t_meeting, case when _cs then 'O jaký produkt má zájem' else 'Which product are they interested in?' end, 'text', false, 2, 'product');

  -- Email sent
  insert into public.contact_table_fields (user_id, table_id, label, type, required, default_value, position, system_key) values
    (_user_id, _t_email, case when _cs then 'Vložit odeslaný e-mail' else 'Paste the sent email' end, 'long_text', false, null, 0, 'email_body'),
    (_user_id, _t_email, case when _cs then 'Kdy byl poslán' else 'When was it sent?' end, 'date', true, 'today', 1, 'sent_on');

  -- Follow up
  insert into public.contact_table_fields (user_id, table_id, label, type, required, position, system_key) values
    (_user_id, _t_follow, case when _cs then 'Kdy?' else 'When?' end, 'datetime', true, 0, 'follow_up_at'),
    (_user_id, _t_follow, case when _cs then 'Podrobnosti' else 'Details' end, 'long_text', false, 1, null),
    (_user_id, _t_follow, case when _cs then 'O jaký produkt měl zájem' else 'Which product were they interested in?' end, 'text', false, 2, 'product');
end;
$$;

revoke execute on function public.initialize_user(uuid, text) from public, anon, authenticated;
grant execute on function public.initialize_user(uuid, text) to service_role, supabase_auth_admin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialize_user(new.id, coalesce(new.raw_user_meta_data ->> 'locale', 'en'));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row level security
-- =============================================================================

-- Tables owned through user_id: the user has full access to their own rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_settings', 'contacts', 'contact_tables', 'contact_table_fields',
    'contact_table_entries', 'contact_activities', 'milestones', 'tasks',
    'pipeline_stages', 'deals', 'meeting_surveys', 'sales_analyses',
    'prospecting_segments', 'calendar_events', 'invoices', 'recurring_payments',
    'transactions', 'unlocks', 'jarvis_conversations', 'jarvis_messages',
    'attachments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end;
$$;

-- profiles: id is the user id
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- user_roles: read own, no client writes
alter table public.user_roles enable row level security;
create policy "user_roles_select_own" on public.user_roles for select to authenticated using ((select auth.uid()) = user_id);

-- plans: readable by everyone signed in, no client writes
alter table public.plans enable row level security;
create policy "plans_select_authenticated" on public.plans for select to authenticated using (true);

-- subscriptions: read own, server manages
alter table public.subscriptions enable row level security;
create policy "subscriptions_select_own" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- contact_table_moves: append-only history, never edited or deleted from the client
alter table public.contact_table_moves enable row level security;
create policy "contact_table_moves_select_own" on public.contact_table_moves for select to authenticated using ((select auth.uid()) = user_id);
create policy "contact_table_moves_insert_own" on public.contact_table_moves for insert to authenticated with check ((select auth.uid()) = user_id);

-- feature_requests: own rows; owner and admin see and update all of them
alter table public.feature_requests enable row level security;
create policy "feature_requests_select" on public.feature_requests for select to authenticated
  using ((select auth.uid()) = user_id or public.has_role((select auth.uid()), 'owner') or public.has_role((select auth.uid()), 'admin'));
create policy "feature_requests_insert_own" on public.feature_requests for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "feature_requests_update" on public.feature_requests for update to authenticated
  using ((select auth.uid()) = user_id or public.has_role((select auth.uid()), 'owner') or public.has_role((select auth.uid()), 'admin'));
create policy "feature_requests_delete_own" on public.feature_requests for delete to authenticated using ((select auth.uid()) = user_id);

-- fakturoid_connections, usage_events, ai_usage: server only (RLS on, no policies)
alter table public.fakturoid_connections enable row level security;
alter table public.usage_events enable row level security;
alter table public.ai_usage enable row level security;

-- call_time_stats: shared summaries, readable by every signed-in user, written by cron only
alter table public.call_time_stats enable row level security;
create policy "call_time_stats_select_authenticated" on public.call_time_stats for select to authenticated using (true);

-- workers: owner has full access, a worker reads their own row
alter table public.workers enable row level security;
create policy "workers_owner_all" on public.workers for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "workers_self_select" on public.workers for select to authenticated
  using ((select auth.uid()) = user_id);

-- worker_invites: owner only (acceptance runs on the server)
alter table public.worker_invites enable row level security;
create policy "worker_invites_owner_all" on public.worker_invites for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- worker_permissions: owner manages, worker reads own
alter table public.worker_permissions enable row level security;
create policy "worker_permissions_owner_all" on public.worker_permissions for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_permissions_worker_select" on public.worker_permissions for select to authenticated
  using (worker_id in (select public.my_worker_ids()));

-- worker_tasks: owner manages, worker reads and updates own (status); columns are limited by the app
alter table public.worker_tasks enable row level security;
create policy "worker_tasks_owner_all" on public.worker_tasks for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_tasks_worker_select" on public.worker_tasks for select to authenticated
  using (worker_id in (select public.my_worker_ids()));
create policy "worker_tasks_worker_update" on public.worker_tasks for update to authenticated
  using (worker_id in (select public.my_worker_ids())) with check (worker_id in (select public.my_worker_ids()));

-- work_sessions: owner reads and manages, worker records their own time
alter table public.work_sessions enable row level security;
create policy "work_sessions_owner_all" on public.work_sessions for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "work_sessions_worker_select" on public.work_sessions for select to authenticated
  using (worker_id in (select public.my_worker_ids()));
create policy "work_sessions_worker_insert" on public.work_sessions for insert to authenticated
  with check (worker_id in (select public.my_worker_ids()));
create policy "work_sessions_worker_update" on public.work_sessions for update to authenticated
  using (worker_id in (select public.my_worker_ids())) with check (worker_id in (select public.my_worker_ids()));

-- reward_rules: owner manages, worker reads rules that apply to them
alter table public.reward_rules enable row level security;
create policy "reward_rules_owner_all" on public.reward_rules for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "reward_rules_worker_select" on public.reward_rules for select to authenticated
  using (worker_id in (select public.my_worker_ids())
    or (worker_id is null and owner_id in (select owner_id from public.workers where user_id = (select auth.uid()))));

-- worker_earnings and worker_payments: owner manages, worker reads own
alter table public.worker_earnings enable row level security;
create policy "worker_earnings_owner_all" on public.worker_earnings for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_earnings_worker_select" on public.worker_earnings for select to authenticated
  using (worker_id in (select public.my_worker_ids()));

alter table public.worker_payments enable row level security;
create policy "worker_payments_owner_all" on public.worker_payments for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_payments_worker_select" on public.worker_payments for select to authenticated
  using (worker_id in (select public.my_worker_ids()));

-- =============================================================================
-- Storage: private attachments bucket, objects live under <user_id>/...
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 10485760,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create policy "attachments_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
