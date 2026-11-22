-- =============================================================================
-- Worker rewards: a plan of rules per person, rewards as entries (step 28.2)
--
--   * reward_plans: one per worker (space_id = the company, worker_id),
--     approval auto | manual (default manual), the currency the rules pay in,
--     active from–to (null = open), notes (what an older rule could not
--     become, written by this migration).
--   * reward_plan_rules (the name reward_rules is taken by the rules of the
--     drawn reward tree, which stay for history): kind, amount or percent,
--     unit (kept by the database from the kind), filter, cap per month in the
--     plan's currency, active, position. Kinds:
--       task_fixed    the price written on a task (the amount is on the task)
--       task_default  every done task without a price of its own
--       project_done  a milestone done whose reward goes to the worker
--       per_meeting   a meeting booked: a contact moved into "Meeting
--                     scheduled" by a call, or a booking confirmed in the
--                     scheduler with the worker as host
--       per_call      a call: a contact moved out of "Not contacted" or "No
--                     answer" by the worker
--       per_contact   a qualified contact: moved by the worker into
--                     "Interested" or "Meeting scheduled", once per contact
--       deal_percent  a share of a won deal's value (the value is without VAT)
--       deal_fixed    a fixed amount per won deal
--       hourly        per hour of the worker's own timer (work_sessions)
--       monthly_fixed a fixed amount per month (the daily cron)
--   * reward_amount + reward_currency on crm_tasks, worker_tasks, tasks,
--     deals and milestones (milestones also reward_worker_id: whose project
--     it is). Only reward_set_price() writes them; a client write is ignored.
--   * reward_entries: what a worker earned, from where (source_kind,
--     source_id), by which rule, how much in which currency and its status
--     planned | pending | approved | rejected | paid. planned = a reward that
--     will come (a task with a price not done yet). The database writes them
--     (triggers, functions); the client only reads.
--   * reward_payouts: money handed over, from approved entries of one
--     currency; it books an expense in Finance (category rewards) and puts
--     the row into the month plan when there is one.
--   * The engine: an event (task done, deal won, meeting, call, contact,
--     hours, end of a month) turns into wishes, reward_reconcile() makes the
--     entries of that source match them. Idempotent: one event = at most one
--     entry per rule. Undone (task reopened, deal no longer won, booking
--     cancelled): an unpaid entry goes (a task with a price goes back to
--     planned), a paid one gets a negative correction. The monthly cap is
--     applied when an entry is made; the monthly fixed amount comes from the
--     daily cron (reward_run_monthly()). Mirrors src/features/workers/rewards/engine.ts.
--   * Rights: company.rewards in the permission catalog. Plans, prices,
--     approvals and payouts: the space's owner, or a worker with "company:
--     rewards" for the people they see in Company, never for themself. A
--     worker reads their own plan and entries always. A manager without the
--     right sees nothing of the rewards of the people under them.
--   * The active rules of the reward tree become plans of their workers;
--     what cannot be expressed goes into the plan's notes. The old rules are
--     switched off; old earnings and payments are copied into the new tables.
-- Additive only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The right
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
    ('company', 'rewards', 'write')
  ) as c (section, action, kind);
$$;

-- Whether the signed-in account manages the rewards of this worker of this
-- space: the space's owner, or a worker with "company: rewards" who sees the
-- person in Company, never for themself.
create or replace function public.reward_can_manage(_space uuid, _worker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and exists (select 1 from public.workers w where w.id = _worker and w.owner_id = _space)
    and (
      _space = auth.uid()
      or (
        public.has_permission(_space, 'company', 'rewards')
        and not exists (
          select 1 from public.workers w where w.id = _worker and w.user_id = auth.uid()
        )
        and _worker in (select v.id from public.company_visible_worker_ids_in(_space) v (id))
      )
    ),
    false
  );
$$;
revoke execute on function public.reward_can_manage(uuid, uuid) from public, anon;
grant execute on function public.reward_can_manage(uuid, uuid) to authenticated, service_role;

-- Whether the account manages rewards in the space at all (prices of tasks).
create or replace function public.reward_manager_in(_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null and _space is not null
    and (_space = auth.uid() or public.has_permission(_space, 'company', 'rewards')),
    false
  );
$$;
revoke execute on function public.reward_manager_in(uuid) from public, anon;
grant execute on function public.reward_manager_in(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Plans and their rules
-- -----------------------------------------------------------------------------

create table public.reward_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  name text not null default 'Plan' check (char_length(btrim(name)) between 1 and 80),
  approval text not null default 'manual' check (approval in ('auto', 'manual')),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  active_from date,
  active_to date,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id),
  unique (id, space_id),
  constraint reward_plans_dates check (active_to is null or active_from is null or active_to >= active_from),
  constraint reward_plans_worker_fkey foreign key (worker_id, space_id)
    references public.workers (id, owner_id) on delete cascade
);
create index reward_plans_space_idx on public.reward_plans (space_id);

create or replace function public.reward_rule_ok(
  _kind text,
  _amount numeric,
  _percent numeric,
  _filter jsonb,
  _cap numeric
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _key text;
begin
  if _kind is null or _kind not in (
    'task_fixed', 'task_default', 'project_done', 'per_meeting', 'per_call', 'per_contact',
    'deal_percent', 'deal_fixed', 'hourly', 'monthly_fixed') then
    return false;
  end if;
  if _filter is null or jsonb_typeof(_filter) <> 'object' then
    return false;
  end if;
  for _key in select jsonb_object_keys(_filter) loop
    if _key not in ('onTimeOnly', 'minDealValue') then
      return false;
    end if;
  end loop;
  if _filter ? 'onTimeOnly' then
    if _kind not in ('task_fixed', 'task_default') or jsonb_typeof(_filter -> 'onTimeOnly') <> 'boolean' then
      return false;
    end if;
  end if;
  if _filter ? 'minDealValue' then
    if _kind not in ('deal_fixed', 'deal_percent') or jsonb_typeof(_filter -> 'minDealValue') <> 'number' then
      return false;
    end if;
    if (_filter ->> 'minDealValue')::numeric < 0 or (_filter ->> 'minDealValue')::numeric > 1000000000 then
      return false;
    end if;
  end if;
  if _cap is not null and (_cap <= 0 or _cap > 100000000 or _kind = 'monthly_fixed') then
    return false;
  end if;
  if _kind = 'task_fixed' then
    return _amount is null and _percent is null;
  end if;
  if _kind = 'deal_percent' then
    return _amount is null and _percent is not null and _percent > 0 and _percent <= 100;
  end if;
  return _percent is null and _amount is not null and _amount > 0 and _amount <= 10000000;
end;
$$;

create table public.reward_plan_rules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  space_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  kind text not null,
  amount numeric(14, 2),
  percent numeric(5, 2),
  unit text not null default 'item' check (unit in ('item', 'hour', 'month', 'percent', 'price')),
  filter jsonb not null default '{}',
  cap_per_period numeric(14, 2),
  active boolean not null default true,
  position integer not null default 0 check (position between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_plan_rules_plan_fkey foreign key (plan_id, space_id)
    references public.reward_plans (id, space_id) on delete cascade,
  constraint reward_plan_rules_ok check (public.reward_rule_ok(kind, amount, percent, filter, cap_per_period))
);
create index reward_plan_rules_plan_idx on public.reward_plan_rules (plan_id, position);
create index reward_plan_rules_kind_idx on public.reward_plan_rules (kind) where active;

create trigger set_updated_at before update on public.reward_plans
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reward_plan_rules
  for each row execute function public.set_updated_at();

-- The space and the worker of a plan never change; who made it is the session's.
create or replace function public.reward_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.space_id := old.space_id;
    new.worker_id := old.worker_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif public.is_client_request() then
    new.created_by := auth.uid();
    -- Notes are what the migration could not convert; the client only clears them.
    new.notes := null;
  end if;
  if tg_op = 'UPDATE' and public.is_client_request()
     and new.notes is not null and new.notes is distinct from old.notes then
    new.notes := old.notes;
  end if;
  return new;
end;
$$;
create trigger reward_plans_guard
  before insert or update on public.reward_plans
  for each row execute function public.reward_plans_guard();

-- A rule takes its space and worker from its plan and its unit from its kind;
-- a plan holds 30 rules at most.
create or replace function public.reward_plan_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
begin
  if tg_op = 'UPDATE' then
    new.plan_id := old.plan_id;
  end if;
  select * into _plan from public.reward_plans where id = new.plan_id;
  -- An unknown plan: row level security and the foreign key refuse the row.
  if _plan.id is null then
    return new;
  end if;
  new.space_id := _plan.space_id;
  new.worker_id := _plan.worker_id;
  new.unit := case new.kind
    when 'hourly' then 'hour'
    when 'monthly_fixed' then 'month'
    when 'deal_percent' then 'percent'
    when 'task_fixed' then 'price'
    else 'item'
  end;
  if tg_op = 'INSERT' and (
    select count(*) from public.reward_plan_rules r where r.plan_id = new.plan_id
  ) >= 30 then
    raise exception 'reward_rules_limit' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.reward_plan_rules_guard() from public, anon, authenticated;
create trigger reward_plan_rules_guard
  before insert or update on public.reward_plan_rules
  for each row execute function public.reward_plan_rules_guard();

create trigger reward_plans_writable
  before insert or update or delete on public.reward_plans
  for each row execute function public.enforce_workspace_writable('space_id');
create trigger reward_plan_rules_writable
  before insert or update or delete on public.reward_plan_rules
  for each row execute function public.enforce_workspace_writable('space_id');

alter table public.reward_plans enable row level security;
alter table public.reward_plan_rules enable row level security;

create policy "reward_plans_select" on public.reward_plans for select to authenticated
  using (
    worker_id in (select public.my_worker_ids())
    or public.reward_can_manage(space_id, worker_id)
  );
create policy "reward_plans_insert" on public.reward_plans for insert to authenticated
  with check (public.reward_can_manage(space_id, worker_id));
create policy "reward_plans_update" on public.reward_plans for update to authenticated
  using (public.reward_can_manage(space_id, worker_id))
  with check (public.reward_can_manage(space_id, worker_id));
create policy "reward_plans_delete" on public.reward_plans for delete to authenticated
  using (public.reward_can_manage(space_id, worker_id));

create policy "reward_plan_rules_select" on public.reward_plan_rules for select to authenticated
  using (
    worker_id in (select public.my_worker_ids())
    or public.reward_can_manage(space_id, worker_id)
  );
create policy "reward_plan_rules_insert" on public.reward_plan_rules for insert to authenticated
  with check (public.reward_can_manage(space_id, worker_id));
create policy "reward_plan_rules_update" on public.reward_plan_rules for update to authenticated
  using (public.reward_can_manage(space_id, worker_id))
  with check (public.reward_can_manage(space_id, worker_id));
create policy "reward_plan_rules_delete" on public.reward_plan_rules for delete to authenticated
  using (public.reward_can_manage(space_id, worker_id));

-- -----------------------------------------------------------------------------
-- 3. Prices on tasks, deals and milestones
-- -----------------------------------------------------------------------------

alter table public.crm_tasks
  add column reward_amount numeric(14, 2) check (reward_amount is null or (reward_amount > 0 and reward_amount <= 10000000)),
  add column reward_currency text check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  add constraint crm_tasks_reward_pair check ((reward_amount is null) = (reward_currency is null));
alter table public.worker_tasks
  add column reward_amount numeric(14, 2) check (reward_amount is null or (reward_amount > 0 and reward_amount <= 10000000)),
  add column reward_currency text check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  add constraint worker_tasks_reward_pair check ((reward_amount is null) = (reward_currency is null));
alter table public.tasks
  add column reward_amount numeric(14, 2) check (reward_amount is null or (reward_amount > 0 and reward_amount <= 10000000)),
  add column reward_currency text check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  add constraint tasks_reward_pair check ((reward_amount is null) = (reward_currency is null));
alter table public.deals
  add column reward_amount numeric(14, 2) check (reward_amount is null or (reward_amount > 0 and reward_amount <= 10000000)),
  add column reward_currency text check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  add constraint deals_reward_pair check ((reward_amount is null) = (reward_currency is null));
alter table public.milestones
  add column reward_amount numeric(14, 2) check (reward_amount is null or (reward_amount > 0 and reward_amount <= 10000000)),
  add column reward_currency text check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  add column reward_worker_id uuid,
  add constraint milestones_reward_pair check ((reward_amount is null) = (reward_currency is null)),
  add constraint milestones_reward_worker_fkey foreign key (reward_worker_id, user_id)
    references public.workers (id, owner_id) on delete set null (reward_worker_id);

-- Only reward_set_price() changes a price: a client insert starts without one,
-- a client update keeps it (like is_demo, silently).
create or replace function public.reward_columns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.reward_amount := null;
    new.reward_currency := null;
  else
    new.reward_amount := old.reward_amount;
    new.reward_currency := old.reward_currency;
  end if;
  return new;
end;
$$;
-- Milestones also keep whose project it is.
create or replace function public.reward_milestone_columns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.reward_amount := null;
    new.reward_currency := null;
    new.reward_worker_id := null;
  else
    new.reward_amount := old.reward_amount;
    new.reward_currency := old.reward_currency;
    new.reward_worker_id := old.reward_worker_id;
  end if;
  return new;
end;
$$;
create trigger crm_tasks_reward_columns before insert or update on public.crm_tasks
  for each row execute function public.reward_columns_guard();
create trigger worker_tasks_reward_columns before insert or update on public.worker_tasks
  for each row execute function public.reward_columns_guard();
create trigger tasks_reward_columns before insert or update on public.tasks
  for each row execute function public.reward_columns_guard();
create trigger deals_reward_columns before insert or update on public.deals
  for each row execute function public.reward_columns_guard();
create trigger milestones_reward_columns before insert or update on public.milestones
  for each row execute function public.reward_milestone_columns_guard();

-- -----------------------------------------------------------------------------
-- 4. Entries and payouts
-- -----------------------------------------------------------------------------

create table public.reward_payouts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  period_from date,
  period_to date,
  total numeric(14, 2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 300),
  transaction_id uuid,
  entries integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, space_id),
  constraint reward_payouts_worker_fkey foreign key (worker_id, space_id)
    references public.workers (id, owner_id) on delete cascade,
  constraint reward_payouts_transaction_fkey foreign key (transaction_id, space_id)
    references public.transactions (id, user_id) on delete set null (transaction_id)
);
create index reward_payouts_worker_idx on public.reward_payouts (worker_id, paid_at desc);
create index reward_payouts_space_idx on public.reward_payouts (space_id, paid_at desc);

create table public.reward_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  source_kind text not null check (source_kind in (
    'crm_task', 'worker_task', 'task', 'milestone', 'deal', 'meeting', 'booking', 'call',
    'contact', 'work_session', 'month', 'manual')),
  source_id uuid,
  rule_id uuid references public.reward_plan_rules (id) on delete set null,
  rule_kind text not null check (rule_kind in (
    'task_fixed', 'task_default', 'project_done', 'per_meeting', 'per_call', 'per_contact',
    'deal_percent', 'deal_fixed', 'hourly', 'monthly_fixed', 'price', 'manual')),
  amount numeric(14, 2) not null check (amount <> 0 and abs(amount) <= 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('planned', 'pending', 'approved', 'rejected', 'paid')),
  occurred_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  payout_id uuid,
  note text check (note is null or char_length(note) <= 300),
  -- A negative correction of a paid entry whose event was undone.
  corrects_id uuid references public.reward_entries (id) on delete cascade,
  -- Set on a paid entry once its correction exists: the event may happen again.
  reversed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_entries_worker_fkey foreign key (worker_id, space_id)
    references public.workers (id, owner_id) on delete cascade,
  constraint reward_entries_payout_fkey foreign key (payout_id, space_id)
    references public.reward_payouts (id, space_id) on delete set null (payout_id),
  constraint reward_entries_paid check ((status = 'paid') = (paid_at is not null)),
  constraint reward_entries_planned_positive check (status <> 'planned' or amount > 0)
);
-- One event, one entry per rule and person (a correction or a reversed entry aside).
create unique index reward_entries_event_idx on public.reward_entries (
  worker_id, source_kind, source_id, rule_kind,
  coalesce(rule_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where source_id is not null and corrects_id is null and reversed_at is null and rule_kind <> 'manual';
create unique index reward_entries_correction_idx on public.reward_entries (corrects_id)
  where corrects_id is not null;
create index reward_entries_worker_idx on public.reward_entries (worker_id, occurred_at desc);
create index reward_entries_space_status_idx on public.reward_entries (space_id, status);
create index reward_entries_source_idx on public.reward_entries (source_kind, source_id);
create index reward_entries_rule_idx on public.reward_entries (rule_id, occurred_at) where rule_id is not null;
create index reward_entries_payout_idx on public.reward_entries (payout_id) where payout_id is not null;

create trigger set_updated_at before update on public.reward_entries
  for each row execute function public.set_updated_at();
create trigger reward_entries_writable
  before insert or update or delete on public.reward_entries
  for each row execute function public.enforce_workspace_writable('space_id');
create trigger reward_payouts_writable
  before insert or update or delete on public.reward_payouts
  for each row execute function public.enforce_workspace_writable('space_id');

alter table public.reward_entries enable row level security;
alter table public.reward_payouts enable row level security;

-- Read only: the person their own, whoever manages their rewards. Writes go
-- through the functions below.
create policy "reward_entries_select" on public.reward_entries for select to authenticated
  using (
    worker_id in (select public.my_worker_ids())
    or public.reward_can_manage(space_id, worker_id)
  );
create policy "reward_payouts_select" on public.reward_payouts for select to authenticated
  using (
    worker_id in (select public.my_worker_ids())
    or public.reward_can_manage(space_id, worker_id)
  );
revoke insert, update, delete on public.reward_entries, public.reward_payouts from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. The engine
-- -----------------------------------------------------------------------------

-- What one source should have: one wish per person and rule.
create type public.reward_wish as (
  worker_id uuid,
  rule_kind text,
  rule_id uuid,
  amount numeric,
  currency text,
  status text,
  occurred_at timestamptz,
  note text,
  cap numeric
);

-- The active worker record of an account in a space.
create or replace function public.reward_worker_of(_space uuid, _account uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workers w
  where w.owner_id = _space and w.user_id = _account and w.status = 'active'
  limit 1;
$$;

create or replace function public.reward_zone(_space uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.timezone from public.user_settings s where s.user_id = _space), 'UTC');
$$;

-- The plan of an active worker that holds on a day of the space.
create or replace function public.reward_plan_for(_worker uuid, _at timestamptz)
returns public.reward_plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.reward_plans p
  join public.workers w on w.id = p.worker_id and w.status = 'active'
  where p.worker_id = _worker
    and (p.active_from is null
      or p.active_from <= (_at at time zone public.reward_zone(p.space_id))::date)
    and (p.active_to is null
      or p.active_to >= (_at at time zone public.reward_zone(p.space_id))::date);
$$;

-- The status a new entry gets: approved at once with "automatically".
create or replace function public.reward_status_for(_plan public.reward_plans)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when _plan.approval = 'auto' then 'approved' else 'pending' end;
$$;

-- The amount still under a rule's monthly cap, in the cap's month of `_at`.
create or replace function public.reward_capped(
  _rule_id uuid,
  _cap numeric,
  _currency text,
  _amount numeric,
  _at timestamptz,
  _space uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _zone text := public.reward_zone(_space);
  _start timestamptz;
  _used numeric;
begin
  if _cap is null or _rule_id is null or _amount <= 0 then
    return _amount;
  end if;
  _start := date_trunc('month', _at at time zone _zone) at time zone _zone;
  select coalesce(sum(e.amount), 0) into _used
  from public.reward_entries e
  where e.rule_id = _rule_id
    and e.currency = _currency
    and e.status in ('pending', 'approved', 'paid')
    and e.occurred_at >= _start
    and e.occurred_at < _start + interval '1 month';
  return greatest(least(_amount, _cap - _used), 0);
end;
$$;

-- Makes the entries of one source match the wishes.
--   mode 'sync': entries without a wish go (unpaid) or get a correction (paid)
--   mode 'add':  only adds what is missing (a call, a meeting: facts)
--   mode 'drop_planned': only the planned entries go (the source was deleted)
create or replace function public.reward_reconcile(
  _space uuid,
  _source_kind text,
  _source_id uuid,
  _wishes public.reward_wish[],
  _mode text default 'sync'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _entry public.reward_entries;
  _wish public.reward_wish;
  _used boolean[] := array_fill(false, array[greatest(coalesce(array_length(_wishes, 1), 0), 1)]);
  _i integer;
  _match integer;
  _amount numeric;
begin
  if _mode = 'drop_planned' then
    delete from public.reward_entries
    where source_kind = _source_kind and source_id = _source_id and status = 'planned';
    return;
  end if;

  for _entry in
    select * from public.reward_entries
    where source_kind = _source_kind and source_id = _source_id
      and corrects_id is null and reversed_at is null and rule_kind <> 'manual'
    order by created_at, id
  loop
    _match := null;
    for _i in 1 .. coalesce(array_length(_wishes, 1), 0) loop
      _wish := _wishes[_i];
      if not _used[_i]
         and _wish.worker_id = _entry.worker_id
         and _wish.rule_kind = _entry.rule_kind
         and _wish.rule_id is not distinct from _entry.rule_id then
        _match := _i;
        exit;
      end if;
    end loop;

    if _match is null then
      continue when _mode = 'add';
      if _entry.status = 'paid' then
        perform public.reward_correct(_entry, null);
      else
        delete from public.reward_entries where id = _entry.id;
      end if;
      continue;
    end if;

    _used[_match] := true;
    _wish := _wishes[_match];
    if _wish.status = 'planned' then
      if _entry.status = 'planned' then
        update public.reward_entries
        set amount = _wish.amount, currency = _wish.currency, occurred_at = _wish.occurred_at,
            note = left(_wish.note, 300)
        where id = _entry.id
          and (amount, currency, occurred_at, note) is distinct from
              (_wish.amount, _wish.currency, _wish.occurred_at, left(_wish.note, 300));
      elsif _entry.status = 'paid' then
        perform public.reward_correct(_entry, null);
        insert into public.reward_entries (
          space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
          status, occurred_at, note
        ) values (
          _space, _wish.worker_id, _source_kind, _source_id, _wish.rule_id, _wish.rule_kind,
          _wish.amount, _wish.currency, 'planned', _wish.occurred_at, left(_wish.note, 300)
        );
      else
        -- Reopened: the reward waits again.
        update public.reward_entries
        set status = 'planned', amount = _wish.amount, currency = _wish.currency,
            occurred_at = _wish.occurred_at, approved_at = null, approved_by = null,
            note = left(_wish.note, 300)
        where id = _entry.id;
      end if;
    elsif _entry.status = 'planned' then
      -- Done: the planned reward is earned.
      _amount := public.reward_capped(_wish.rule_id, _wish.cap, _wish.currency, _wish.amount, _wish.occurred_at, _space);
      if _amount <= 0 then
        delete from public.reward_entries where id = _entry.id;
      else
        update public.reward_entries
        set status = _wish.status, amount = _amount, currency = _wish.currency,
            occurred_at = _wish.occurred_at, note = left(_wish.note, 300),
            approved_at = case when _wish.status = 'approved' then now() end
        where id = _entry.id;
      end if;
    end if;
    -- An entry already earned stays as it is: the same event pays once.
  end loop;

  for _i in 1 .. coalesce(array_length(_wishes, 1), 0) loop
    continue when _used[_i];
    _wish := _wishes[_i];
    _amount := case
      when _wish.status = 'planned' then _wish.amount
      else public.reward_capped(_wish.rule_id, _wish.cap, _wish.currency, _wish.amount, _wish.occurred_at, _space)
    end;
    continue when _amount is null or _amount <= 0;
    insert into public.reward_entries (
      space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
      status, occurred_at, approved_at, note
    ) values (
      _space, _wish.worker_id, _source_kind, _source_id, _wish.rule_id, _wish.rule_kind,
      _amount, _wish.currency, _wish.status, _wish.occurred_at,
      case when _wish.status = 'approved' then now() end, left(_wish.note, 300)
    )
    on conflict do nothing;
  end loop;
end;
$$;

-- A paid entry whose event was undone: a negative entry of the same amount,
-- approved (it comes off the next payout), and the entry marked reversed.
create or replace function public.reward_correct(_entry public.reward_entries, _note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_entries (
    space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
    status, occurred_at, approved_at, note, corrects_id
  ) values (
    _entry.space_id, _entry.worker_id, _entry.source_kind, _entry.source_id, _entry.rule_id,
    _entry.rule_kind, -_entry.amount, _entry.currency, 'approved', now(), now(),
    left(coalesce(_note, _entry.note), 300), _entry.id
  )
  on conflict do nothing;
  update public.reward_entries set reversed_at = now() where id = _entry.id;
end;
$$;

-- The wishes of a task of any kind for one worker.
create or replace function public.reward_task_wishes(
  _worker uuid,
  _done boolean,
  _at timestamptz,
  _on_time boolean,
  _price numeric,
  _price_currency text,
  _note text
)
returns public.reward_wish[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _wishes public.reward_wish[] := '{}';
  _status text;
begin
  if _worker is null then
    return _wishes;
  end if;
  _plan := public.reward_plan_for(_worker, _at);
  if _plan.id is null then
    return _wishes;
  end if;
  _status := case when _done then public.reward_status_for(_plan) else 'planned' end;

  if _price is not null then
    select * into _rule from public.reward_plan_rules r
    where r.plan_id = _plan.id and r.kind = 'task_fixed' and r.active
    order by r.position, r.created_at limit 1;
    if _done and coalesce((_rule.filter ->> 'onTimeOnly')::boolean, false) and not _on_time then
      return _wishes;
    end if;
    return array[row(_worker, 'task_fixed', _rule.id, _price, _price_currency, _status, _at, _note,
                     _rule.cap_per_period)::public.reward_wish];
  end if;

  if not _done then
    return _wishes;
  end if;
  for _rule in
    select * from public.reward_plan_rules r
    where r.plan_id = _plan.id and r.kind = 'task_default' and r.active
    order by r.position, r.created_at
  loop
    continue when coalesce((_rule.filter ->> 'onTimeOnly')::boolean, false) and not _on_time;
    _wishes := _wishes || row(_worker, 'task_default', _rule.id, _rule.amount, _plan.currency,
                              _status, _at, _note, _rule.cap_per_period)::public.reward_wish;
  end loop;
  return _wishes;
end;
$$;

-- Sales tasks: the person it is given to.
create or replace function public.reward_sync_crm_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.crm_tasks;
  _done boolean;
begin
  select * into _task from public.crm_tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'crm_task', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _task.status = 'done';
  perform public.reward_reconcile(
    _task.user_id, 'crm_task', _id,
    public.reward_task_wishes(
      public.reward_worker_of(_task.user_id, _task.assignee_id),
      _done,
      case when _done then coalesce(_task.completed_at, now()) else _task.due_at end,
      date_trunc('minute', coalesce(_task.completed_at, now())) <= date_trunc('minute', _task.due_at),
      _task.reward_amount, _task.reward_currency, _task.title),
    'sync');
end;
$$;

-- Tasks from the owner: the worker they are given to.
create or replace function public.reward_sync_worker_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.worker_tasks;
  _done boolean;
  _zone text;
begin
  select * into _task from public.worker_tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'worker_task', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _task.status = 'done';
  _zone := public.reward_zone(_task.owner_id);
  perform public.reward_reconcile(
    _task.owner_id, 'worker_task', _id,
    public.reward_task_wishes(
      (select w.id from public.workers w where w.id = _task.worker_id and w.status = 'active'),
      _done,
      case
        when _done then coalesce(_task.completed_at, now())
        when _task.due_date is not null then (_task.due_date + time '12:00') at time zone _zone
        else now()
      end,
      _task.due_date is null or (coalesce(_task.completed_at, now()) at time zone _zone)::date <= _task.due_date,
      _task.reward_amount, _task.reward_currency, _task.title),
    'sync');
end;
$$;

-- Tasks of milestones have nobody assigned: whoever ticks one off.
create or replace function public.reward_sync_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.tasks;
  _zone text;
begin
  select * into _task from public.tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'task', _id, '{}', 'drop_planned');
    return;
  end if;
  if _task.status <> 'done' then
    perform public.reward_reconcile(_task.user_id, 'task', _id, '{}', 'sync');
    return;
  end if;
  _zone := public.reward_zone(_task.user_id);
  perform public.reward_reconcile(
    _task.user_id, 'task', _id,
    public.reward_task_wishes(
      public.reward_worker_of(_task.user_id, _task.completed_by),
      true,
      coalesce(_task.completed_at, now()),
      _task.due_date is null or (coalesce(_task.completed_at, now()) at time zone _zone)::date <= _task.due_date,
      _task.reward_amount, _task.reward_currency, _task.title),
    'sync');
end;
$$;

-- Milestones: the worker whose project it is (reward_worker_id).
create or replace function public.reward_sync_milestone(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _milestone public.milestones;
  _worker uuid;
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _wishes public.reward_wish[] := '{}';
  _done boolean;
  _at timestamptz;
  _status text;
begin
  select * into _milestone from public.milestones where id = _id;
  if _milestone.id is null then
    perform public.reward_reconcile(_space, 'milestone', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _milestone.status = 'completed';
  _at := case when _done then coalesce(_milestone.completed_at, now()) else now() end;
  select w.id into _worker from public.workers w
  where w.id = _milestone.reward_worker_id and w.status = 'active';
  if _worker is not null and _milestone.status <> 'archived' then
    _plan := public.reward_plan_for(_worker, _at);
  end if;
  if _plan.id is not null then
    _status := case when _done then public.reward_status_for(_plan) else 'planned' end;
    if _milestone.reward_amount is not null then
      _wishes := _wishes || row(_worker, 'price', null, _milestone.reward_amount,
        _milestone.reward_currency, _status, _at, _milestone.title, null)::public.reward_wish;
    end if;
    if _done then
      for _rule in
        select * from public.reward_plan_rules r
        where r.plan_id = _plan.id and r.kind = 'project_done' and r.active
        order by r.position, r.created_at
      loop
        _wishes := _wishes || row(_worker, 'project_done', _rule.id, _rule.amount, _plan.currency,
          _status, _at, _milestone.title, _rule.cap_per_period)::public.reward_wish;
      end loop;
    end if;
  end if;
  perform public.reward_reconcile(_milestone.user_id, 'milestone', _id, _wishes, 'sync');
end;
$$;

-- Deals: everyone on the deal and whoever made it, if they work there.
create or replace function public.reward_sync_deal(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _deal public.deals;
  _worker uuid;
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _wishes public.reward_wish[] := '{}';
  _won boolean;
  _open boolean;
  _at timestamptz;
  _status text;
  _min numeric;
  _value numeric;
begin
  select * into _deal from public.deals where id = _id;
  if _deal.id is null then
    perform public.reward_reconcile(_space, 'deal', _id, '{}', 'drop_planned');
    return;
  end if;
  _won := _deal.won_at is not null;
  _open := not _won and _deal.lost_at is null;
  _at := coalesce(_deal.won_at, now());
  _value := coalesce(_deal.value, 0);

  for _worker in
    select distinct w.id from public.workers w
    where w.owner_id = _deal.user_id and w.status = 'active'
      and (
        w.user_id = _deal.created_by
        or w.user_id in (select a.assignee_id from public.deal_assignees a where a.deal_id = _deal.id)
      )
  loop
    _plan := public.reward_plan_for(_worker, _at);
    continue when _plan.id is null;
    if _won then
      _status := public.reward_status_for(_plan);
    elsif _open then
      _status := 'planned';
    else
      continue;
    end if;
    if _deal.reward_amount is not null then
      _wishes := _wishes || row(_worker, 'price', null, _deal.reward_amount, _deal.reward_currency,
        _status, _at, _deal.title, null)::public.reward_wish;
    end if;
    continue when not _won;
    for _rule in
      select * from public.reward_plan_rules r
      where r.plan_id = _plan.id and r.kind in ('deal_fixed', 'deal_percent') and r.active
      order by r.position, r.created_at
    loop
      if _rule.filter ? 'minDealValue' then
        -- A threshold in the plan's currency compares only a deal in the same currency.
        _min := (_rule.filter ->> 'minDealValue')::numeric;
        continue when _deal.currency <> _plan.currency or _value < _min;
      end if;
      if _rule.kind = 'deal_fixed' then
        _wishes := _wishes || row(_worker, 'deal_fixed', _rule.id, _rule.amount, _plan.currency,
          _status, _at, _deal.title, _rule.cap_per_period)::public.reward_wish;
      elsif _value > 0 then
        _wishes := _wishes || row(_worker, 'deal_percent', _rule.id,
          round(_value * _rule.percent / 100, 2), _deal.currency, _status, _at, _deal.title,
          case when _deal.currency = _plan.currency then _rule.cap_per_period end)::public.reward_wish;
      end if;
    end loop;
  end loop;
  perform public.reward_reconcile(_deal.user_id, 'deal', _id, _wishes, 'sync');
end;
$$;

-- One event of a worker for the rules of one kind (meetings, calls, contacts, hours).
create or replace function public.reward_event(
  _worker uuid,
  _rule_kind text,
  _source_kind text,
  _source_id uuid,
  _at timestamptz,
  _note text,
  _units numeric default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _wishes public.reward_wish[] := '{}';
begin
  if _worker is null then
    return;
  end if;
  _plan := public.reward_plan_for(_worker, _at);
  if _plan.id is null then
    return;
  end if;
  for _rule in
    select * from public.reward_plan_rules r
    where r.plan_id = _plan.id and r.kind = _rule_kind and r.active
    order by r.position, r.created_at
  loop
    _wishes := _wishes || row(_worker, _rule_kind, _rule.id, round(_rule.amount * _units, 2),
      _plan.currency, public.reward_status_for(_plan), _at, _note, _rule.cap_per_period)::public.reward_wish;
  end loop;
  if coalesce(array_length(_wishes, 1), 0) > 0 then
    perform public.reward_reconcile(_plan.space_id, _source_kind, _source_id, _wishes, 'add');
  end if;
end;
$$;

revoke execute on function
  public.reward_worker_of(uuid, uuid),
  public.reward_zone(uuid),
  public.reward_plan_for(uuid, timestamptz),
  public.reward_capped(uuid, numeric, text, numeric, timestamptz, uuid),
  public.reward_reconcile(uuid, text, uuid, public.reward_wish[], text),
  public.reward_correct(public.reward_entries, text),
  public.reward_task_wishes(uuid, boolean, timestamptz, boolean, numeric, text, text),
  public.reward_sync_crm_task(uuid, uuid),
  public.reward_sync_worker_task(uuid, uuid),
  public.reward_sync_task(uuid, uuid),
  public.reward_sync_milestone(uuid, uuid),
  public.reward_sync_deal(uuid, uuid),
  public.reward_event(uuid, text, text, uuid, timestamptz, text, numeric)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. The events
-- -----------------------------------------------------------------------------

create or replace function public.reward_on_crm_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.assignee_id is not distinct from old.assignee_id
     and new.reward_amount is not distinct from old.reward_amount
     and new.reward_currency is not distinct from old.reward_currency
     and new.title is not distinct from old.title
     and new.due_at is not distinct from old.due_at then
    return null;
  end if;
  perform public.reward_sync_crm_task(coalesce(new.id, old.id), coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger crm_tasks_rewards
  after insert or update or delete on public.crm_tasks
  for each row execute function public.reward_on_crm_task();

create or replace function public.reward_on_worker_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.worker_id is not distinct from old.worker_id
     and new.reward_amount is not distinct from old.reward_amount
     and new.reward_currency is not distinct from old.reward_currency
     and new.title is not distinct from old.title
     and new.due_date is not distinct from old.due_date then
    return null;
  end if;
  perform public.reward_sync_worker_task(coalesce(new.id, old.id), coalesce(new.owner_id, old.owner_id));
  return null;
end;
$$;
create trigger worker_tasks_rewards_28
  after insert or update or delete on public.worker_tasks
  for each row execute function public.reward_on_worker_task();

create or replace function public.reward_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.completed_by is not distinct from old.completed_by
     and new.reward_amount is not distinct from old.reward_amount
     and new.reward_currency is not distinct from old.reward_currency then
    return null;
  end if;
  -- A new task has no price yet, and one inserted done (an imported map) was
  -- not completed by anybody: only ticking a task off pays.
  if tg_op = 'INSERT' then
    return null;
  end if;
  perform public.reward_sync_task(coalesce(new.id, old.id), coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger tasks_rewards
  after insert or update or delete on public.tasks
  for each row execute function public.reward_on_task();

create or replace function public.reward_on_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.reward_worker_id is not distinct from old.reward_worker_id
     and new.reward_amount is not distinct from old.reward_amount
     and new.reward_currency is not distinct from old.reward_currency
     and new.title is not distinct from old.title then
    return null;
  end if;
  if tg_op = 'INSERT' and new.reward_worker_id is null then
    return null;
  end if;
  perform public.reward_sync_milestone(coalesce(new.id, old.id), coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger milestones_rewards
  after insert or update or delete on public.milestones
  for each row execute function public.reward_on_milestone();

create or replace function public.reward_on_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.won_at is not distinct from old.won_at
     and new.lost_at is not distinct from old.lost_at
     and new.reward_amount is not distinct from old.reward_amount
     and new.reward_currency is not distinct from old.reward_currency
     and new.title is not distinct from old.title then
    return null;
  end if;
  perform public.reward_sync_deal(coalesce(new.id, old.id), coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger deals_rewards_28
  after insert or update or delete on public.deals
  for each row execute function public.reward_on_deal();

-- Somebody joins or leaves a deal: what it promises follows the people on it.
create or replace function public.reward_on_deal_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.deals d where d.id = coalesce(new.deal_id, old.deal_id)) then
    perform public.reward_sync_deal(coalesce(new.deal_id, old.deal_id), coalesce(new.user_id, old.user_id));
  end if;
  return null;
end;
$$;
create trigger deal_assignees_rewards
  after insert or delete on public.deal_assignees
  for each row execute function public.reward_on_deal_assignee();

-- Cold Calling: a call, a qualified contact, a meeting.
create or replace function public.reward_on_contact_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
  _from text;
  _to text;
  _name text;
begin
  if new.actor_id is null or new.source is not distinct from 'scheduler' then
    return null;
  end if;
  _worker := public.reward_worker_of(new.user_id, new.actor_id);
  if _worker is null then
    return null;
  end if;
  select t.system_key into _from from public.contact_tables t where t.id = new.from_table_id;
  select t.system_key into _to from public.contact_tables t where t.id = new.to_table_id;
  select coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''))
  into _name from public.contacts c where c.id = new.contact_id;

  if _from in ('unreached', 'no_answer') then
    perform public.reward_event(_worker, 'per_call', 'call', new.id, new.created_at, _name);
  end if;
  if _to in ('interested', 'meeting_scheduled') then
    perform public.reward_event(_worker, 'per_contact', 'contact', new.contact_id, new.created_at, _name);
  end if;
  if _to = 'meeting_scheduled' then
    perform public.reward_event(_worker, 'per_meeting', 'meeting', new.contact_id, new.created_at, _name);
  end if;
  return null;
end;
$$;
create trigger contact_moves_rewards_28
  after insert on public.contact_table_moves
  for each row execute function public.reward_on_contact_move();

-- Scheduler: a booking confirmed with a worker as host; cancelled = undone.
create or replace function public.reward_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
begin
  if new.host_user_id is null then
    return null;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    _worker := public.reward_worker_of(new.space_id, new.host_user_id);
    perform public.reward_event(_worker, 'per_meeting', 'booking', new.id,
      coalesce(new.confirmed_at, now()), new.guest_company);
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status in ('cancelled', 'declined') then
    perform public.reward_reconcile(new.space_id, 'booking', new.id, '{}', 'sync');
  end if;
  return null;
end;
$$;
create trigger bookings_rewards
  after insert or update of status on public.bookings
  for each row execute function public.reward_on_booking();

-- The worker's own timer: hours of a closed session.
create or replace function public.reward_on_work_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _hours numeric;
begin
  if old.ended_at is null and new.ended_at is not null then
    _hours := extract(epoch from new.ended_at - new.started_at) / 3600.0;
    if _hours > 0 then
      perform public.reward_event(new.worker_id, 'hourly', 'work_session', new.id, new.ended_at,
        null, round(_hours, 4));
    end if;
  end if;
  return null;
end;
$$;
create trigger work_sessions_rewards_28
  after update of ended_at on public.work_sessions
  for each row execute function public.reward_on_work_session();

-- A rule or a plan changed: what tasks, deals and milestones promise is re-read.
create or replace function public.reward_resync_planned(_worker uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _space uuid;
  _account uuid;
  _id uuid;
begin
  select w.owner_id, w.user_id into _space, _account from public.workers w where w.id = _worker;
  if _space is null then
    return;
  end if;
  for _id in
    select t.id from public.crm_tasks t
    where t.user_id = _space and t.assignee_id = _account and t.status = 'open'
      and t.reward_amount is not null
    limit 500
  loop
    perform public.reward_sync_crm_task(_id, _space);
  end loop;
  for _id in
    select t.id from public.worker_tasks t
    where t.worker_id = _worker and t.status <> 'done' and t.reward_amount is not null
    limit 500
  loop
    perform public.reward_sync_worker_task(_id, _space);
  end loop;
  for _id in
    select m.id from public.milestones m
    where m.user_id = _space and m.reward_worker_id = _worker and m.status = 'active'
    limit 200
  loop
    perform public.reward_sync_milestone(_id, _space);
  end loop;
  for _id in
    select d.id from public.deals d
    where d.user_id = _space and d.won_at is null and d.lost_at is null and d.reward_amount is not null
      and (d.created_by = _account
        or exists (select 1 from public.deal_assignees a where a.deal_id = d.id and a.assignee_id = _account))
    limit 500
  loop
    perform public.reward_sync_deal(_id, _space);
  end loop;
end;
$$;
revoke execute on function public.reward_resync_planned(uuid) from public, anon, authenticated;

create or replace function public.reward_on_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.active_from is not distinct from old.active_from
     and new.active_to is not distinct from old.active_to then
    return null;
  end if;
  perform public.reward_resync_planned(coalesce(new.worker_id, old.worker_id));
  return null;
end;
$$;
create trigger reward_plans_resync
  after insert or update or delete on public.reward_plans
  for each row execute function public.reward_on_plan();

create or replace function public.reward_on_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.kind, old.kind) <> 'task_fixed' then
    return null;
  end if;
  perform public.reward_resync_planned(coalesce(new.worker_id, old.worker_id));
  return null;
end;
$$;
create trigger reward_plan_rules_resync
  after insert or update or delete on public.reward_plan_rules
  for each row execute function public.reward_on_rule();

revoke execute on function
  public.reward_on_crm_task(), public.reward_on_worker_task(), public.reward_on_task(),
  public.reward_on_milestone(), public.reward_on_deal(), public.reward_on_deal_assignee(),
  public.reward_on_contact_move(), public.reward_on_booking(), public.reward_on_work_session(),
  public.reward_on_plan(), public.reward_on_rule(), public.reward_columns_guard(),
  public.reward_milestone_columns_guard(), public.reward_plans_guard()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. The daily cron: the monthly fixed amount
-- -----------------------------------------------------------------------------

-- Each active monthly_fixed rule has a planned entry for the current month of
-- its space; a month that ended turns into pending or approved. Run as often
-- as you like: nothing doubles.
create or replace function public.reward_run_monthly()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rule record;
  _zone text;
  _month date;
  _end timestamptz;
  _count integer := 0;
  _entry record;
  _plan public.reward_plans;
begin
  for _rule in
    select r.*, p.currency as plan_currency, p.space_id as plan_space, p.active_from, p.active_to
    from public.reward_plan_rules r
    join public.reward_plans p on p.id = r.plan_id
    join public.workers w on w.id = r.worker_id and w.status = 'active'
    where r.kind = 'monthly_fixed' and r.active
  loop
    _zone := public.reward_zone(_rule.plan_space);
    _month := date_trunc('month', now() at time zone _zone)::date;
    continue when _rule.active_from is not null and _rule.active_from > (_month + interval '1 month - 1 day')::date;
    continue when _rule.active_to is not null and _rule.active_to < _month;
    _end := ((_month + interval '1 month')::timestamp at time zone _zone) - interval '1 second';
    perform public.reward_reconcile(
      _rule.plan_space, 'month',
      md5(_rule.id::text || ':' || to_char(_month, 'YYYY-MM'))::uuid,
      array[row(_rule.worker_id, 'monthly_fixed', _rule.id, _rule.amount, _rule.plan_currency,
                'planned', _end, null, null)::public.reward_wish],
      'add');
  end loop;

  -- Months that ended: earned.
  for _entry in
    select e.id, e.worker_id, e.occurred_at from public.reward_entries e
    where e.source_kind = 'month' and e.status = 'planned' and e.occurred_at < now()
  loop
    _plan := public.reward_plan_for(_entry.worker_id, _entry.occurred_at);
    if _plan.id is null then
      delete from public.reward_entries where id = _entry.id;
    else
      update public.reward_entries
      set status = public.reward_status_for(_plan),
          approved_at = case when _plan.approval = 'auto' then now() end
      where id = _entry.id;
      _count := _count + 1;
    end if;
  end loop;
  return _count;
end;
$$;
revoke execute on function public.reward_run_monthly() from public, anon, authenticated;
grant execute on function public.reward_run_monthly() to service_role;

-- -----------------------------------------------------------------------------
-- 8. What the app calls
-- -----------------------------------------------------------------------------

-- The price of a task, deal or milestone (null = none); a milestone also says whose it is.
create or replace function public.reward_set_price(
  _source_kind text,
  _source_id uuid,
  _amount numeric,
  _currency text,
  _worker_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _space uuid;
  _recipient uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _amount is not null and (_amount <= 0 or _amount > 10000000) then
    raise exception 'amount_invalid' using errcode = 'check_violation';
  end if;
  if _amount is not null and (_currency is null or _currency !~ '^[A-Z]{3}$') then
    raise exception 'currency_invalid' using errcode = 'check_violation';
  end if;

  if _source_kind = 'crm_task' then
    select t.user_id, public.reward_worker_of(t.user_id, t.assignee_id) into _space, _recipient
    from public.crm_tasks t where t.id = _source_id;
  elsif _source_kind = 'worker_task' then
    select t.owner_id, t.worker_id into _space, _recipient
    from public.worker_tasks t where t.id = _source_id;
  elsif _source_kind = 'task' then
    -- Whoever ticks a milestone task off is paid: only the owner prices them.
    select t.user_id into _space from public.tasks t where t.id = _source_id and t.user_id = auth.uid();
  elsif _source_kind = 'deal' then
    select d.user_id into _space from public.deals d where d.id = _source_id;
    -- Whoever is on the deal (or made it) is paid by it: never their own price.
    if _space is not null and _space <> auth.uid() and exists (
      select 1 from public.deals d where d.id = _source_id and d.created_by = auth.uid()
      union all
      select 1 from public.deal_assignees a where a.deal_id = _source_id and a.assignee_id = auth.uid()
    ) then
      raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
    end if;
  elsif _source_kind = 'milestone' then
    select m.user_id into _space from public.milestones m where m.id = _source_id;
    _recipient := _worker_id;
    if _worker_id is not null and not exists (
      select 1 from public.workers w where w.id = _worker_id and w.owner_id = _space
    ) then
      raise exception 'worker_not_found' using errcode = 'no_data_found';
    end if;
  else
    raise exception 'source_invalid' using errcode = 'check_violation';
  end if;
  if _space is null or not public.reward_manager_in(_space) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  -- Nobody but the owner prices their own work.
  if _recipient is not null and _space <> auth.uid() and not public.reward_can_manage(_space, _recipient) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;

  if _source_kind = 'crm_task' then
    update public.crm_tasks set reward_amount = _amount, reward_currency = case when _amount is null then null else _currency end
    where id = _source_id;
  elsif _source_kind = 'worker_task' then
    update public.worker_tasks set reward_amount = _amount, reward_currency = case when _amount is null then null else _currency end
    where id = _source_id;
  elsif _source_kind = 'task' then
    update public.tasks set reward_amount = _amount, reward_currency = case when _amount is null then null else _currency end
    where id = _source_id;
  elsif _source_kind = 'deal' then
    update public.deals set reward_amount = _amount, reward_currency = case when _amount is null then null else _currency end
    where id = _source_id;
  else
    update public.milestones
    set reward_amount = _amount,
        reward_currency = case when _amount is null then null else _currency end,
        reward_worker_id = _worker_id
    where id = _source_id;
  end if;
end;
$$;
revoke execute on function public.reward_set_price(text, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.reward_set_price(text, uuid, numeric, text, uuid) to authenticated;

-- A reward (or a deduction, negative) added by hand; approved at once.
create or replace function public.reward_add_manual(
  _worker_id uuid,
  _amount numeric,
  _currency text,
  _occurred_on date,
  _note text,
  _source_kind text default null,
  _source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _space uuid;
  _id uuid;
  _zone text;
begin
  select w.owner_id into _space from public.workers w where w.id = _worker_id;
  if _space is null or not public.reward_can_manage(_space, _worker_id) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  if _amount is null or _amount = 0 or abs(_amount) > 10000000 then
    raise exception 'amount_invalid' using errcode = 'check_violation';
  end if;
  if _currency is null or _currency !~ '^[A-Z]{3}$' then
    raise exception 'currency_invalid' using errcode = 'check_violation';
  end if;
  if _note is null or char_length(btrim(_note)) not between 1 and 300 then
    raise exception 'note_invalid' using errcode = 'check_violation';
  end if;
  if (_source_kind is null) <> (_source_id is null)
     or (_source_kind is not null and _source_kind not in ('crm_task', 'worker_task', 'task', 'deal', 'milestone')) then
    raise exception 'source_invalid' using errcode = 'check_violation';
  end if;
  _zone := public.reward_zone(_space);
  insert into public.reward_entries (
    space_id, worker_id, source_kind, source_id, rule_kind, amount, currency, status,
    occurred_at, approved_at, approved_by, note
  ) values (
    _space, _worker_id, coalesce(_source_kind, 'manual'), _source_id, 'manual', round(_amount, 2),
    _currency, 'approved',
    case when _occurred_on is null then now() else (_occurred_on + time '12:00') at time zone _zone end,
    now(), auth.uid(), btrim(_note)
  )
  returning id into _id;
  return _id;
end;
$$;
revoke execute on function public.reward_add_manual(uuid, numeric, text, date, text, text, uuid) from public, anon;
grant execute on function public.reward_add_manual(uuid, numeric, text, date, text, text, uuid) to authenticated;

-- Approve, reject or send back to "waiting" (pending): only entries the caller manages.
create or replace function public.reward_review(_ids uuid[], _action text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _count integer;
begin
  if _action not in ('approve', 'reject', 'pending') then
    raise exception 'action_invalid' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(_ids, 1), 0) > 1000 then
    raise exception 'too_many' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.reward_entries e
    where e.id = any (_ids) and not public.reward_can_manage(e.space_id, e.worker_id)
  ) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  update public.reward_entries e
  set status = case _action when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end,
      approved_at = case when _action = 'approve' then now() end,
      approved_by = case when _action = 'approve' then auth.uid() end
  where e.id = any (_ids)
    and e.corrects_id is null
    and case _action
      when 'approve' then e.status in ('pending', 'rejected')
      when 'reject' then e.status in ('pending', 'approved')
      else e.status in ('approved', 'rejected')
    end;
  get diagnostics _count = row_count;
  return _count;
end;
$$;
revoke execute on function public.reward_review(uuid[], text) from public, anon;
grant execute on function public.reward_review(uuid[], text) to authenticated;

-- A different amount or note on an entry not paid yet.
create or replace function public.reward_entry_update(_id uuid, _amount numeric, _note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _entry public.reward_entries;
begin
  select * into _entry from public.reward_entries where id = _id;
  if _entry.id is null or not public.reward_can_manage(_entry.space_id, _entry.worker_id) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  if _entry.status not in ('pending', 'approved', 'rejected') or _entry.corrects_id is not null then
    raise exception 'reward_not_editable' using errcode = 'check_violation';
  end if;
  if _amount is null or _amount = 0 or abs(_amount) > 10000000 then
    raise exception 'amount_invalid' using errcode = 'check_violation';
  end if;
  if _note is not null and char_length(_note) > 300 then
    raise exception 'note_invalid' using errcode = 'check_violation';
  end if;
  update public.reward_entries
  set amount = round(_amount, 2), note = coalesce(nullif(btrim(_note), ''), note)
  where id = _id;
end;
$$;
revoke execute on function public.reward_entry_update(uuid, numeric, text) from public, anon;
grant execute on function public.reward_entry_update(uuid, numeric, text) to authenticated;

-- Paying out: approved entries of one person in one currency become paid,
-- an expense goes to Finance (category rewards) and the month plan gets the
-- row it lands in. `_row_label` is the category's name in the user's language.
create or replace function public.reward_payout_create(
  _worker_id uuid,
  _entry_ids uuid[],
  _paid_on date,
  _note text,
  _row_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _space uuid;
  _name text;
  _zone text;
  _today date;
  _currency text;
  _currency_max text;
  _total numeric;
  _count integer;
  _from date;
  _to date;
  _transaction uuid;
  _payout uuid;
  _paid_at timestamptz;
  _monday date;
  _month text;
  _label text := nullif(btrim(coalesce(_row_label, '')), '');
begin
  select w.owner_id, w.name into _space, _name from public.workers w where w.id = _worker_id;
  if _space is null or not public.reward_can_manage(_space, _worker_id) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(_entry_ids, 1), 0) = 0 or array_length(_entry_ids, 1) > 2000 then
    raise exception 'entries_invalid' using errcode = 'check_violation';
  end if;
  if _note is not null and char_length(_note) > 300 then
    raise exception 'note_invalid' using errcode = 'check_violation';
  end if;
  _zone := public.reward_zone(_space);
  _today := (now() at time zone _zone)::date;
  _paid_on := least(coalesce(_paid_on, _today), _today);

  -- Every entry asked for, approved, of this person; one currency.
  perform 1 from public.reward_entries where id = any (_entry_ids) for update;
  select count(*), min(currency), max(currency), sum(amount),
         min((occurred_at at time zone _zone)::date), max((occurred_at at time zone _zone)::date)
  into _count, _currency, _currency_max, _total, _from, _to
  from public.reward_entries
  where id = any (_entry_ids) and worker_id = _worker_id and status = 'approved';
  if _count <> (select count(distinct x) from unnest(_entry_ids) x) then
    raise exception 'entries_invalid' using errcode = 'check_violation';
  end if;
  if _currency is distinct from _currency_max then
    raise exception 'currency_mixed' using errcode = 'check_violation';
  end if;
  if _total is null or _total <= 0 then
    raise exception 'total_invalid' using errcode = 'check_violation';
  end if;

  insert into public.transactions (user_id, type, amount, currency, category, description, occurred_on)
  values (_space, 'expense', _total, _currency, 'rewards', left(_name, 200), _paid_on)
  returning id into _transaction;

  _paid_at := (_paid_on + time '12:00') at time zone _zone;
  insert into public.reward_payouts (
    space_id, worker_id, period_from, period_to, total, currency, paid_at, note, transaction_id, entries
  ) values (
    _space, _worker_id, _from, _to, _total, _currency, _paid_at, nullif(btrim(_note), ''),
    _transaction, _count
  )
  returning id into _payout;

  update public.reward_entries
  set status = 'paid', paid_at = _paid_at, payout_id = _payout
  where id = any (_entry_ids);

  -- The month plan of the week (its Monday's month), when there is an open one in this currency.
  _monday := _paid_on - (extract(isodow from _paid_on)::integer - 1);
  _month := to_char(_monday, 'YYYY-MM');
  if _label is not null and exists (
    select 1 from public.finance_plan_months m
    where m.user_id = _space and m.month = _month and m.currency = _currency and not m.closed
  ) and not exists (
    select 1 from public.finance_plan_rows r
    where r.user_id = _space and r.month = _month and r.kind = 'expense'
      and lower(btrim(r.label)) in (lower(left(_label, 120)), 'rewards')
  ) then
    insert into public.finance_plan_rows (user_id, month, kind, label, position, source)
    values (
      _space, _month, 'expense', left(_label, 120),
      coalesce((select max(r.position) + 1 from public.finance_plan_rows r
                where r.user_id = _space and r.month = _month and r.kind = 'expense'), 0),
      'manual'
    )
    on conflict do nothing;
  end if;
  return _payout;
end;
$$;
revoke execute on function public.reward_payout_create(uuid, uuid[], date, text, text) from public, anon;
grant execute on function public.reward_payout_create(uuid, uuid[], date, text, text) to authenticated;

-- Sums per person and currency, by what the caller may read (RLS applies):
-- earned in the period (waiting, approved or paid), and over all time what
-- waits for approval, for the payout, and what is planned (with how many).
create or replace function public.reward_totals(_from timestamptz, _until timestamptz, _worker_id uuid default null)
returns table (
  worker_id uuid,
  currency text,
  earned numeric,
  pending numeric,
  pending_count integer,
  approved numeric,
  approved_count integer,
  planned numeric,
  planned_count integer,
  paid numeric
)
language sql
stable
set search_path = ''
as $$
  select
    e.worker_id,
    e.currency,
    coalesce(sum(e.amount) filter (
      where e.status in ('pending', 'approved', 'paid') and e.occurred_at >= _from and e.occurred_at < _until), 0),
    coalesce(sum(e.amount) filter (where e.status = 'pending'), 0),
    (count(*) filter (where e.status = 'pending'))::integer,
    coalesce(sum(e.amount) filter (where e.status = 'approved'), 0),
    (count(*) filter (where e.status = 'approved'))::integer,
    coalesce(sum(e.amount) filter (where e.status = 'planned'), 0),
    (count(*) filter (where e.status = 'planned'))::integer,
    coalesce(sum(e.amount) filter (where e.status = 'paid' and e.paid_at >= _from and e.paid_at < _until), 0)
  from public.reward_entries e
  where _worker_id is null or e.worker_id = _worker_id
  group by e.worker_id, e.currency;
$$;
revoke execute on function public.reward_totals(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.reward_totals(timestamptz, timestamptz, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. The invite shows the worker's plan (instead of the drawn rules)
-- -----------------------------------------------------------------------------

create or replace function public.my_worker_invites(_user uuid default null)
returns table (
  invite_id uuid,
  space_id uuid,
  company_name text,
  logo_url text,
  owner_name text,
  job_title text,
  grants jsonb,
  rewards jsonb,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.owner_id,
    coalesce(p.company_name, ip.name),
    p.company_logo_url,
    p.display_name,
    w.job_title,
    coalesce((
      select jsonb_agg(jsonb_build_object('section', g.section, 'action', g.action, 'allowed', g.allowed)
                       order by g.section, g.action)
      from public.worker_permission_grants g
      where g.worker_id = w.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'amount', r.amount, 'percent', r.percent, 'filter', r.filter,
               'cap', r.cap_per_period, 'currency', rp.currency)
             order by r.position, r.created_at)
      from public.reward_plan_rules r
      join public.reward_plans rp on rp.id = r.plan_id
      where rp.worker_id = w.id and r.active
    ), '[]'::jsonb),
    i.expires_at,
    i.created_at
  from public.worker_invites i
  join public.workers w on w.id = i.worker_id and w.owner_id = i.owner_id
  left join public.profiles p on p.id = i.owner_id
  left join public.invoice_profiles ip on ip.user_id = i.owner_id
  where i.invitee_id = coalesce(auth.uid(), _user)
    and i.accepted_at is null
    and i.declined_at is null
    and i.replaced_at is null
    and i.expires_at > now()
    and w.status = 'invited'
    and w.user_id is null
  order by i.created_at desc
  limit 20;
$$;

-- -----------------------------------------------------------------------------
-- 10. The drawn reward tree becomes plans; old earnings and payments move over
-- -----------------------------------------------------------------------------

-- Returns how many rule parts could not be converted (they are in the plans' notes).
create or replace function public.reward_convert_legacy_rules()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r record;
  _w record;
  _plan uuid;
  _trigger text;
  _kind text;
  _amount numeric;
  _cond jsonb;
  _new_kind text;
  _new_amount numeric;
  _percent numeric;
  _cap numeric;
  _filter jsonb;
  _note text;
  _cs boolean;
  _currency text;
  _skipped integer := 0;
begin
  for _r in
    select * from public.reward_rules
    where is_active and public.reward_rule_is_valid(rules)
    order by owner_id, created_at, id
  loop
    select coalesce(s.locale, 'cs') <> 'en', coalesce(s.currency, 'CZK') into _cs, _currency
    from public.user_settings s where s.user_id = _r.owner_id;
    _cs := coalesce(_cs, true);
    _currency := coalesce(_currency, 'CZK');
    _trigger := _r.rules ->> 'trigger';
    _kind := _r.rules ->> 'kind';
    _amount := (_r.rules ->> 'amount')::numeric;
    _cond := coalesce(_r.rules -> 'conditions', '{}'::jsonb);
    _new_amount := _amount;
    _percent := null;
    _cap := null;
    _filter := '{}'::jsonb;
    _note := null;

    if _trigger = 'task_completed' then
      _new_kind := 'task_default';
      if coalesce((_cond ->> 'onlyBeforeDue')::boolean, false) then
        _filter := jsonb_build_object('onTimeOnly', true);
      end if;
    elsif _trigger = 'meeting_booked' then
      _new_kind := 'per_meeting';
    elsif _trigger = 'hour_worked' then
      _new_kind := 'hourly';
    elsif _kind = 'percent' then
      _new_kind := 'deal_percent';
      _percent := _amount;
      _new_amount := null;
    else
      _new_kind := 'deal_fixed';
    end if;
    if _trigger = 'deal_won' and _cond ? 'minDealValue' then
      _filter := jsonb_build_object('minDealValue', (_cond ->> 'minDealValue')::numeric);
    end if;
    -- "At most N a month" is a cap of N times a fixed amount; of a share or hours it cannot be said.
    if _cond ? 'maxPerMonth' then
      if _kind = 'fixed' then
        _cap := least(_amount * (_cond ->> 'maxPerMonth')::integer, 100000000);
      else
        _note := case when _cs
          then format('Nepřevedeno z pravidla „%s“: nejvýš %s za měsíc (strop jde nastavit jen jako částku).',
                      _r.name, _cond ->> 'maxPerMonth')
          else format('Not converted from rule "%s": at most %s a month (a cap can only be an amount).',
                      _r.name, _cond ->> 'maxPerMonth')
        end;
        _skipped := _skipped + 1;
      end if;
    end if;

    for _w in
      select w.id, w.owner_id from public.workers w
      where w.owner_id = _r.owner_id and w.status <> 'inactive'
        and (_r.worker_id is null or w.id = _r.worker_id)
    loop
      insert into public.reward_plans (space_id, worker_id, name, approval, currency)
      values (_w.owner_id, _w.id, case when _cs then 'Plán odměn' else 'Reward plan' end, 'manual', _currency)
      on conflict (worker_id) do nothing;
      select p.id into _plan from public.reward_plans p where p.worker_id = _w.id;
      if (select count(*) from public.reward_plan_rules x where x.plan_id = _plan) < 30 then
        insert into public.reward_plan_rules (plan_id, space_id, worker_id, kind, amount, percent, filter, cap_per_period, position)
        values (_plan, _w.owner_id, _w.id, _new_kind, _new_amount, _percent, _filter, _cap,
                (select count(*) from public.reward_plan_rules x where x.plan_id = _plan));
      end if;
      if _note is not null then
        update public.reward_plans set notes = left(concat_ws(E'\n', notes, _note), 4000) where id = _plan;
      end if;
    end loop;
  end loop;
  update public.reward_rules set is_active = false where is_active;
  return _skipped;
end;
$$;
revoke execute on function public.reward_convert_legacy_rules() from public, anon, authenticated;
grant execute on function public.reward_convert_legacy_rules() to service_role;

select public.reward_convert_legacy_rules();

-- Payments keep their id, so the earnings they settled still point at them.
insert into public.reward_payouts (id, space_id, worker_id, total, currency, paid_at, note, transaction_id, created_at)
select p.id, p.owner_id, p.worker_id, p.amount, p.currency, p.paid_at, left(p.note, 300), p.transaction_id, p.created_at
from public.worker_payments p
where p.amount > 0
on conflict (id) do nothing;

insert into public.reward_entries (
  space_id, worker_id, source_kind, source_id, rule_kind, amount, currency, status,
  occurred_at, approved_at, paid_at, payout_id, note, created_by, created_at
)
select
  e.owner_id, e.worker_id,
  case e.source
    when 'task_completed' then 'worker_task'
    when 'meeting_booked' then 'meeting'
    when 'deal_won' then 'deal'
    when 'hour_worked' then 'work_session'
    else 'manual'
  end,
  case when e.source is null then null else coalesce(e.source_ref, e.worker_task_id, e.work_session_id) end,
  case e.source
    when 'task_completed' then 'task_default'
    when 'meeting_booked' then 'per_meeting'
    when 'deal_won' then case when e.basis is null then 'deal_fixed' else 'deal_percent' end
    when 'hour_worked' then 'hourly'
    else 'manual'
  end,
  e.amount, e.currency, e.status::text, e.created_at,
  case when e.status in ('approved', 'paid') then coalesce(e.approved_at, e.created_at) end,
  case when e.status = 'paid' then coalesce(e.paid_at, e.created_at) end,
  case when e.status = 'paid' and exists (select 1 from public.reward_payouts p where p.id = e.payment_id)
    then e.payment_id end,
  left(e.description, 300), null, e.created_at
from public.worker_earnings e
where e.amount > 0
on conflict do nothing;

-- The drawn tree has no editor any more.
revoke execute on function public.replace_reward_rules(jsonb) from anon;

-- -----------------------------------------------------------------------------
-- 11. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('reward_plan_created', 'workers', true),
  ('reward_plan_updated', 'workers', true),
  ('reward_rule_saved', 'workers', true),
  ('reward_rule_deleted', 'workers', true),
  ('reward_template_applied', 'workers', true),
  ('reward_manual_added', 'workers', true),
  ('reward_entries_reviewed', 'workers', true),
  ('reward_entry_edited', 'workers', true),
  ('reward_payout_recorded', 'workers', true),
  ('reward_payouts_exported', 'workers', false),
  ('reward_price_set', 'workers', true)
on conflict (event) do nothing;
