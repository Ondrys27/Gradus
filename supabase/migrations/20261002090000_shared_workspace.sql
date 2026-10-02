-- =============================================================================
-- Shared workspace
--   A workspace is the owner's account. The owner works in their own; an active
--   worker works in the workspace of the owner who invited them (one for now).
--   * current_workspace_id(): the owner's id for an owner, workers.owner_id for
--     an active worker
--   * has_section_access(owner, section, level): true for the owner themself;
--     for an active worker of that owner by worker_permissions (view / edit).
--     Sections: milestones, contacts, pipeline, cold_calling, calendar, finance.
--     Workers and settings are never open to a worker.
--   * shared tables: read with view, insert / update / delete with edit; a
--     worker's rows carry user_id = owner (whose space) and actor_id (who did it)
--   * private stays private: profiles, settings, XP, Jarvis, ideas, unlocks
--   * the prospecting timer is per person inside the space: one open segment
--     per (space, actor); the owner sees all segments, a worker only their own
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workspace and section access
-- -----------------------------------------------------------------------------

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select w.owner_id from public.workers w
      where w.user_id = auth.uid() and w.status = 'active'
      order by w.created_at
      limit 1
    ),
    auth.uid()
  );
$$;

create or replace function public.has_section_access(_owner uuid, _section text, _level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and _owner is not null
    and (
      _owner = auth.uid()
      or (
        _section in ('milestones', 'contacts', 'pipeline', 'cold_calling', 'calendar', 'finance')
        and _level in ('view', 'edit')
        and exists (
          select 1
          from public.workers w
          join public.worker_permissions p on p.worker_id = w.id
          where w.owner_id = _owner
            and w.user_id = auth.uid()
            and w.status = 'active'
            and p.section::text = _section
            and case when _level = 'edit' then p.can_edit else p.can_view end
        )
      )
    ),
    false
  );
$$;

revoke execute on function public.current_workspace_id(), public.has_section_access(uuid, text, text)
  from public, anon;
grant execute on function public.current_workspace_id(), public.has_section_access(uuid, text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Who did it: actor_id next to user_id (whose space)
-- -----------------------------------------------------------------------------

alter table public.contact_activities
  add column actor_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.contact_table_moves
  add column actor_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.prospecting_segments
  add column actor_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.calendar_events
  add column actor_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.deals
  add column created_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.tasks
  add column completed_by uuid references auth.users (id) on delete set null;

-- Everything so far was done by the space's owner.
update public.contact_activities set actor_id = user_id where actor_id is null;
update public.contact_table_moves set actor_id = user_id where actor_id is null;
update public.prospecting_segments set actor_id = user_id where actor_id is null;
update public.calendar_events set actor_id = user_id where actor_id is null;
update public.deals set created_by = user_id where created_by is null;
update public.tasks set completed_by = user_id where status = 'done' and completed_by is null;

create index contact_activities_actor_idx on public.contact_activities (actor_id);
create index contact_table_moves_actor_created_idx on public.contact_table_moves (actor_id, created_at desc);
create index prospecting_segments_user_actor_started_idx
  on public.prospecting_segments (user_id, actor_id, started_at desc);
create index calendar_events_actor_idx on public.calendar_events (actor_id);
create index deals_created_by_idx on public.deals (created_by);
create index tasks_completed_by_idx on public.tasks (completed_by);

-- One running timer per person in a space (was: per space).
drop index public.prospecting_segments_one_open_idx;
create unique index prospecting_segments_one_open_idx
  on public.prospecting_segments (user_id, actor_id) where ended_at is null;

-- The client never names somebody else as the actor: an insert is stamped with
-- the signed-in account, an update keeps what was there. Functions and the
-- server (not client requests) set it themselves.
create or replace function public.stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _column text := tg_argv[0];
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new := jsonb_populate_record(new, jsonb_build_object(_column, auth.uid()));
    else
      new := jsonb_populate_record(new, jsonb_build_object(_column, to_jsonb(old) -> _column));
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_actor() from public, anon;

create trigger contact_activities_stamp_actor
  before insert or update on public.contact_activities
  for each row execute function public.stamp_actor('actor_id');
create trigger calendar_events_stamp_actor
  before insert or update on public.calendar_events
  for each row execute function public.stamp_actor('actor_id');
create trigger deals_stamp_created_by
  before insert or update on public.deals
  for each row execute function public.stamp_actor('created_by');

-- completed_by follows the status like completed_at.
create or replace function public.tasks_before_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    if public.is_client_request() then
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
    return new;
  end if;

  if new.status = 'done' then
    if exists (
      select 1 from public.tasks
      where parent_task_id = new.id and status <> 'done'
    ) then
      raise exception 'task_has_open_subtasks' using errcode = 'check_violation';
    end if;
    new.completed_at := case when public.is_client_request() then now()
                             else coalesce(new.completed_at, now()) end;
    new.completed_by := case when public.is_client_request() then auth.uid()
                             else coalesce(new.completed_by, auth.uid()) end;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security on the shared tables
--   read:   own space, or has_section_access(user_id, section, 'view')
--   write:  own space, or has_section_access(user_id, section, 'edit')
-- has_section_access(x, ...) is true for a worker only when x is their owner,
-- i.e. their current workspace, so the check is written against
-- current_workspace_id() and evaluated once per query instead of once per row.
-- -----------------------------------------------------------------------------

do $$
declare
  _spec record;
  _view text;
  _edit text;
  _level text;
  _check text;
begin
  for _spec in
    select * from (values
      ('contacts', array['contacts', 'cold_calling'], true),
      ('contact_tables', array['contacts', 'cold_calling'], true),
      ('contact_table_fields', array['contacts', 'cold_calling'], true),
      ('contact_activities', array['contacts', 'cold_calling'], true),
      ('contact_table_entries', array['contacts', 'cold_calling'], false),
      ('contact_table_moves', array['contacts', 'cold_calling'], false),
      ('milestones', array['milestones'], true),
      ('tasks', array['milestones'], true),
      ('pipeline_stages', array['pipeline'], true),
      ('deals', array['pipeline'], true),
      ('meeting_surveys', array['pipeline'], true),
      ('calendar_events', array['calendar'], true),
      ('invoices', array['finance'], true),
      ('recurring_payments', array['finance'], true),
      ('transactions', array['finance'], true)
    ) as t(name, sections, writable)
  loop
    foreach _level in array array['view', 'edit'] loop
      select format(
        '((select auth.uid()) = user_id or (user_id = (select public.current_workspace_id()) and (select %s)))',
        string_agg(
          format('public.has_section_access(public.current_workspace_id(), %L, %L)', s, _level),
          ' or '
        )
      )
      into _check
      from unnest(_spec.sections) s;
      if _level = 'view' then _view := _check; else _edit := _check; end if;
    end loop;

    execute format('drop policy if exists %I on public.%I', _spec.name || '_select_own', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_insert_own', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_update_own', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_delete_own', _spec.name);

    execute format(
      'create policy %I on public.%I for select to authenticated using %s',
      _spec.name || '_select_workspace', _spec.name, _view
    );
    if _spec.writable then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check %s',
        _spec.name || '_insert_workspace', _spec.name, _edit
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using %s with check %s',
        _spec.name || '_update_workspace', _spec.name, _edit, _edit
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using %s',
        _spec.name || '_delete_workspace', _spec.name, _edit
      );
    end if;
  end loop;
end;
$$;

-- The timer: the owner sees every segment of their space (totals and per
-- person); a worker with cold calling sees only their own. Writes go through
-- start_prospecting() / pause_prospecting() only.
drop policy "prospecting_segments_select_own" on public.prospecting_segments;
create policy "prospecting_segments_select_workspace" on public.prospecting_segments
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      actor_id = (select auth.uid())
      and user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'view'))
    )
  );

-- The owner sees the name and avatar of the accounts that work for them
-- (profiles_select_my_workers); a worker does not see the owner's profile,
-- settings or anything of the workers section.

-- -----------------------------------------------------------------------------
-- Views carry the space, so the app filters by it (a worker's account has its
-- own seeded tables and stages next to the owner's)
-- -----------------------------------------------------------------------------

create or replace view public.contact_list
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.phone_normalized,
  c.city,
  c.source,
  c.created_at,
  concat_ws(' ', c.company_name, c.first_name, c.last_name) as search_name,
  e.table_id,
  (
    select max(a.occurred_at)
    from public.contact_activities a
    where a.contact_id = c.id and a.occurred_at <= now()
  ) as last_contact_at,
  c.website,
  c.user_id
from public.contacts c
left join public.contact_table_entries e
  on e.contact_id = c.id and e.user_id = c.user_id;

create or replace view public.contact_table_counts
with (security_invoker = true)
as
select table_id, count(*)::integer as contacts, user_id
from public.contact_table_entries
group by table_id, user_id;

create or replace view public.milestone_task_counts
with (security_invoker = true) as
select
  milestone_id,
  count(*)::int as total,
  (count(*) filter (where status = 'done'))::int as done,
  user_id
from public.tasks
group by milestone_id, user_id;

-- -----------------------------------------------------------------------------
-- Live permissions: the worker's app hears a change at once
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'worker_permissions'
    ) then
      alter publication supabase_realtime add table public.worker_permissions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workers'
    ) then
      alter publication supabase_realtime add table public.workers;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions: the workspace instead of auth.uid()
-- -----------------------------------------------------------------------------

-- Today in the space owner's zone, also when a worker (who cannot read the
-- owner's settings) triggers it. Only the date leaves, and only for the caller's
-- own account or space; anyone else's falls back to the default zone.
create or replace function public.user_today(_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (
      select s.timezone from public.user_settings s
      where s.user_id = _user_id
        and (auth.uid() is null or _user_id = auth.uid() or _user_id = public.current_workspace_id())
    ),
    'Europe/Prague'
  ))::date;
$$;

create or replace function public.remove_contact_table(_table_id uuid, _move_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _table public.contact_tables;
  _target public.contact_tables;
begin
  if not (public.has_section_access(_ws, 'contacts', 'edit')
          or public.has_section_access(_ws, 'cold_calling', 'edit')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select * into _table from public.contact_tables where id = _table_id and user_id = _ws;
  if _table.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _table.is_system then
    raise exception 'system_table_readonly' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.contact_table_entries where table_id = _table_id and user_id = _ws) then
    select * into _target from public.contact_tables
    where id = _move_to and user_id = _ws and id <> _table_id;
    if _target.id is null then
      raise exception 'target_table_required' using errcode = 'check_violation';
    end if;
    if _target.system_key = 'clients' then
      raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
    end if;

    insert into public.contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, answers)
    select _ws, auth.uid(), contact_id, _table_id, _target.id, '{}'::jsonb
    from public.contact_table_entries
    where table_id = _table_id and user_id = _ws;

    update public.contact_table_entries
      set table_id = _target.id, answers = '{}'::jsonb, moved_at = now()
      where table_id = _table_id and user_id = _ws;
  end if;

  delete from public.contact_tables where id = _table_id and user_id = _ws;
end;
$$;

-- Runs with the caller's rights: RLS on stages and deals decides (pipeline edit).
create or replace function public.remove_stage(_stage_id uuid, _move_to uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _offset integer;
begin
  if not exists (select 1 from public.pipeline_stages where id = _stage_id and user_id = _ws) then
    raise exception 'stage_not_found' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.deals where stage_id = _stage_id and user_id = _ws) then
    if _move_to is null or _move_to = _stage_id then
      raise exception 'target_stage_required' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.pipeline_stages where id = _move_to and user_id = _ws) then
      raise exception 'stage_not_found' using errcode = 'no_data_found';
    end if;
    select coalesce(max(position) + 1, 0) into _offset
    from public.deals where stage_id = _move_to and user_id = _ws;
    update public.deals
      set stage_id = _move_to, position = position + _offset
      where stage_id = _stage_id and user_id = _ws;
  end if;

  delete from public.pipeline_stages where id = _stage_id and user_id = _ws;
end;
$$;

create or replace function public.set_deposit_stage(_stage_id uuid, _percent smallint default 30)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
begin
  if _stage_id is not null then
    if not exists (
      select 1 from public.pipeline_stages
      where id = _stage_id and user_id = _ws and not is_won and not is_lost
    ) then
      raise exception 'stage_not_found' using errcode = 'no_data_found';
    end if;
  end if;

  update public.pipeline_stages set system_key = null
  where user_id = _ws and system_key = 'deposit_paid' and id is distinct from _stage_id;

  if _stage_id is not null then
    update public.pipeline_stages
      set system_key = 'deposit_paid', deposit_percent = coalesce(_percent, 30)
      where id = _stage_id and user_id = _ws;
  end if;
end;
$$;

-- Runs with the caller's rights: RLS on deals and invoices decides.
create or replace function public.create_invoice_from_deal(_deal_id uuid)
returns public.invoices
language plpgsql
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _deal public.deals;
  _invoice public.invoices;
  _today date;
  _year text;
  _next integer;
  _customer text;
begin
  select * into _deal from public.deals where id = _deal_id and user_id = _ws;
  if not found then
    raise exception 'deal_not_found' using errcode = 'no_data_found';
  end if;
  if _deal.value is null or _deal.value <= 0 then
    raise exception 'deal_value_required' using errcode = 'check_violation';
  end if;

  select * into _invoice from public.invoices
  where deal_id = _deal_id and user_id = _ws and status in ('draft', 'open', 'sent', 'overdue')
  order by created_at desc limit 1;
  if found then
    return _invoice;
  end if;

  _today := public.user_today(_ws);
  _year := to_char(_today, 'YYYY');
  select coalesce(max(substring(number from '-(\d+)$')::integer), 0) + 1 into _next
  from public.invoices where user_id = _ws and number ~ ('^' || _year || '-\d+$');

  select coalesce(nullif(company_name, ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''))
  into _customer from public.contacts where id = _deal.contact_id and user_id = _ws;

  insert into public.invoices
    (user_id, number, amount, currency, status, issued_on, due_on, customer_name, contact_id, deal_id)
  values (
    _ws, _year || '-' || lpad(_next::text, 3, '0'), _deal.value, _deal.currency, 'open',
    _today, _today + 14, _customer, _deal.contact_id, _deal.id
  )
  returning * into _invoice;
  return _invoice;
end;
$$;

create or replace function public.mark_invoice_paid(_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _invoice public.invoices;
  _today date;
begin
  if _ws is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_section_access(_ws, 'finance', 'edit') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  select * into _invoice from public.invoices
  where id = _invoice_id and user_id = _ws for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  if _invoice.status = 'paid' then
    return _invoice;
  end if;
  if _invoice.fakturoid_id is not null then
    raise exception 'invoice_managed_by_fakturoid' using errcode = 'insufficient_privilege';
  end if;

  _today := public.user_today(_ws);
  update public.invoices set status = 'paid', paid_on = _today
  where id = _invoice_id returning * into _invoice;

  perform public.book_invoice_income(_invoice, _today);
  return _invoice;
end;
$$;

create or replace function public.finance_monthly_totals(_from date, _to date)
returns table (month date, income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    m.month::date,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  from generate_series(
    date_trunc('month', _from::timestamp), date_trunc('month', _to::timestamp), interval '1 month'
  )
    as m(month)
  left join public.transactions t
    on t.user_id = public.current_workspace_id()
   and t.occurred_on >= m.month::date
   and t.occurred_on < (m.month + interval '1 month')::date
  group by m.month
  order by m.month;
$$;

create or replace function public.finance_totals(_from date, _to date, _category text default null)
returns table (income numeric, expense numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(amount) filter (where type = 'income'), 0),
    coalesce(sum(amount) filter (where type = 'expense'), 0)
  from public.transactions
  where user_id = public.current_workspace_id()
    and occurred_on between _from and _to
    and (_category is null or category = _category);
$$;

-- -----------------------------------------------------------------------------
-- Prospecting timer: per person inside the space
-- -----------------------------------------------------------------------------

-- The person's own moves out of Unreached keep their segment alive.
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
        and m.actor_id is not distinct from _segment.actor_id
        and t.system_key = 'unreached'
        and m.created_at >= _segment.started_at
    )
  );
$$;

-- The signed-in person's own seconds on a day of their space.
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
  where s.user_id = public.current_workspace_id()
    and s.actor_id = auth.uid()
    and s.started_at < b.day_end
    and public.prospecting_effective_end(s) > b.day_start;
$$;

create or replace function public.start_prospecting()
returns public.prospecting_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_section_access(_ws, 'cold_calling', 'edit') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select * into _open from public.prospecting_segments
  where user_id = _ws and actor_id = _uid and ended_at is null;

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

  insert into public.prospecting_segments (user_id, actor_id) values (_ws, _uid)
  returning * into _open;
  return _open;
end;
$$;

create or replace function public.pause_prospecting()
returns public.prospecting_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  select * into _open from public.prospecting_segments
  where user_id = public.current_workspace_id() and actor_id = auth.uid() and ended_at is null;
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

create or replace function public.prospecting_status(_timezone text)
returns table (
  running boolean,
  segment_started_at timestamptz,
  idle_deadline timestamptz,
  today_seconds integer,
  server_now timestamptz,
  idle_closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _open public.prospecting_segments;
  _effective timestamptz;
  _closed timestamptz;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into _open from public.prospecting_segments
  where user_id = _ws and actor_id = _uid and ended_at is null;

  if _open.id is not null then
    _effective := public.prospecting_effective_end(_open);
    if _effective < now() then
      update public.prospecting_segments
        set ended_at = _effective, end_reason = 'idle'
        where id = _open.id;
      _closed := _effective;
      _open := null;
    end if;
  end if;

  return query
  select
    _open.id is not null,
    _open.started_at,
    case when _open.id is not null
      then public.prospecting_last_activity_at(_open) + public.timer_idle_interval()
    end,
    public.prospecting_seconds_for_day((now() at time zone _timezone)::date, _timezone),
    now(),
    _closed;
end;
$$;

-- Statistics: the owner sees the space in total (_actor null) or one person;
-- a worker always gets only their own numbers, whatever they ask for.
drop function public.prospecting_daily_seconds(date, date, text);
create function public.prospecting_daily_seconds(
  _from date,
  _to date,
  _timezone text,
  _actor uuid default null
)
returns table (day date, seconds integer)
language sql
stable
set search_path = ''
as $$
  with who as (
    select
      public.current_workspace_id() as ws,
      case when public.current_workspace_id() = auth.uid() then _actor else auth.uid() end as actor
  ),
  days as (
    select
      d::date as day,
      (d::date::timestamp at time zone _timezone) as day_start,
      ((d::date + 1)::timestamp at time zone _timezone) as day_end
    from generate_series(_from, least(_to, _from + 400), interval '1 day') d
  ),
  segments as (
    select s.started_at, public.prospecting_effective_end(s) as ended_at
    from public.prospecting_segments s, who
    where s.user_id = who.ws
      and (who.actor is null or s.actor_id = who.actor)
      and s.started_at < (select max(day_end) from days)
      and coalesce(s.ended_at, now()) > (select min(day_start) from days)
  )
  select
    days.day,
    -- least/greatest skip NULLs, so days without a segment must be filtered out explicitly.
    coalesce(sum(extract(epoch from
      least(segments.ended_at, days.day_end) - greatest(segments.started_at, days.day_start)
    )) filter (where segments.started_at is not null), 0)::integer
  from days
  left join segments
    on segments.started_at < days.day_end and segments.ended_at > days.day_start
  group by days.day
  order by days.day;
$$;

drop function public.meetings_daily(date, date, text);
create function public.meetings_daily(_from date, _to date, _timezone text, _actor uuid default null)
returns table (day date, meetings integer)
language sql
stable
set search_path = ''
as $$
  with who as (
    select
      public.current_workspace_id() as ws,
      case when public.current_workspace_id() = auth.uid() then _actor else auth.uid() end as actor
  )
  select (m.created_at at time zone _timezone)::date as day, count(*)::integer
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  cross join who
  where m.user_id = who.ws
    and (who.actor is null or m.actor_id = who.actor)
    and t.system_key = 'meeting_scheduled'
    and m.created_at >= (_from::timestamp at time zone _timezone)
    and m.created_at < ((least(_to, _from + 400) + 1)::timestamp at time zone _timezone)
  group by 1
  order by 1;
$$;

revoke execute on function public.prospecting_daily_seconds(date, date, text, uuid),
  public.meetings_daily(date, date, text, uuid) from public, anon;
grant execute on function public.prospecting_daily_seconds(date, date, text, uuid),
  public.meetings_daily(date, date, text, uuid) to authenticated;

-- A personal record is the person's own best day.
create or replace function public.prospecting_record(_timezone text)
returns table (awarded boolean, seconds integer, previous_best integer, xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _today date := (now() at time zone _timezone)::date;
  _today_seconds integer;
  _best integer;
  _xp constant integer := 80;
  _inserted boolean := false;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  _today_seconds := public.prospecting_seconds_for_day(_today, _timezone);
  select coalesce(max(d.seconds), 0) into _best
  from public.prospecting_daily_seconds(_today - 400, _today - 1, _timezone, _uid) d;

  if _today_seconds > 0 and _today_seconds > _best then
    with ins as (
      insert into public.xp_events (user_id, kind, xp, idempotency_key)
      values (_uid, 'prospecting_record', _xp, _today::text)
      on conflict (user_id, kind, idempotency_key) do nothing
      returning 1
    )
    select exists (select 1 from ins) into _inserted;
  end if;

  return query
  select _inserted, _today_seconds, _best, case when _inserted then _xp else null end;
end;
$$;

-- Best industries: the space's data; the unlock stays the signed-in account's own.
create or replace function public.industry_insights()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _needed constant integer := 10;
  _meetings integer;
  _unlock public.unlocks;
  _industries jsonb := '[]'::jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not (public.has_section_access(_ws, 'cold_calling', 'view')
          or public.has_section_access(_ws, 'contacts', 'view')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into _meetings
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  where m.user_id = _ws and t.system_key = 'meeting_scheduled';

  if _meetings >= _needed then
    insert into public.unlocks (user_id, key) values (_uid, 'best_industries')
    on conflict (user_id, key) do nothing;
  end if;
  select * into _unlock from public.unlocks where user_id = _uid and key = 'best_industries';

  if _unlock.id is not null then
    select coalesce(jsonb_agg(row_to_json(r) order by r.meetings::numeric / greatest(r.called, 1) desc, r.called desc), '[]'::jsonb)
    into _industries
    from (
      select
        min(c.generated_industry) as industry,
        count(*)::integer as contacts,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.from_table_id
          where m.contact_id = c.id and t.system_key = 'unreached'
        ))::integer as called,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.to_table_id
          where m.contact_id = c.id and t.system_key = 'meeting_scheduled'
        ))::integer as meetings
      from public.contacts c
      where c.user_id = _ws and c.generated_industry is not null
      group by lower(c.generated_industry)
      limit 50
    ) r;
  end if;

  return jsonb_build_object(
    'meetings', _meetings,
    'needed', _needed,
    'unlocked_at', _unlock.unlocked_at,
    'seen_at', _unlock.seen_at,
    'industries', _industries
  );
end;
$$;

-- The shared chart caps each person (not each space) at 30 attempts per hour and day.
create or replace function public.refresh_call_time_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rows integer;
begin
  delete from public.call_time_stats where true;

  insert into public.call_time_stats (country_code, day_of_week, hour, attempts, meetings)
  with attempts as (
    select
      coalesce(m.actor_id, m.user_id) as person,
      upper(coalesce(c.country_code, s.country_code)) as country_code,
      (m.created_at at time zone s.timezone) as local_at,
      coalesce(t_to.system_key = 'meeting_scheduled', false) as meeting
    from public.contact_table_moves m
    join public.contact_tables t_from on t_from.id = m.from_table_id
    left join public.contact_tables t_to on t_to.id = m.to_table_id
    join public.user_settings s on s.user_id = m.user_id
    left join public.contacts c on c.id = m.contact_id
    where t_from.system_key in ('unreached', 'no_answer')
      and m.created_at >= now() - interval '365 days'
      and coalesce(c.country_code, s.country_code) is not null
  ),
  per_person as (
    select
      country_code,
      local_at::date as day,
      extract(hour from local_at)::smallint as hour,
      least(count(*), 30) as attempts,
      least(count(*) filter (where meeting), least(count(*), 30)) as meetings
    from attempts
    group by person, country_code, local_at::date, extract(hour from local_at)
  )
  select
    country_code,
    extract(dow from day)::smallint,
    hour,
    sum(attempts)::integer,
    sum(meetings)::integer
  from per_person
  group by country_code, extract(dow from day), hour;

  get diagnostics _rows = row_count;
  return _rows;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rewards follow the person who did it
-- -----------------------------------------------------------------------------

-- A worker books a meeting: they moved a contact of the space into "Meeting scheduled".
create or replace function public.contact_moves_rewards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker_id uuid;
  _name text;
begin
  if new.actor_id is null then
    return null;
  end if;
  select w.id into _worker_id from public.workers w
  where w.owner_id = new.user_id and w.user_id = new.actor_id and w.status = 'active';
  if _worker_id is null then
    return null;
  end if;
  if not exists (
    select 1 from public.contact_tables t
    where t.id = new.to_table_id and t.system_key = 'meeting_scheduled'
  ) then
    return null;
  end if;

  select coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''))
  into _name
  from public.contacts c where c.id = new.contact_id;

  -- Once per contact: moving it out and back does not pay again.
  perform public.grant_worker_rewards(
    _worker_id, 'meeting_booked', new.contact_id, null, null, _name, null, null
  );
  return null;
end;
$$;

-- A deal the worker created is won (by anyone): the worker earns it.
create or replace function public.deals_rewards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker_id uuid;
begin
  if new.created_by is null then
    return null;
  end if;
  select w.id into _worker_id from public.workers w
  where w.owner_id = new.user_id and w.user_id = new.created_by and w.status = 'active';
  if _worker_id is null then
    return null;
  end if;

  if new.won_at is not null and (tg_op = 'INSERT' or old.won_at is null) then
    perform public.grant_worker_rewards(
      _worker_id, 'deal_won', new.id, new.value, null, new.title, null, null
    );
  elsif tg_op = 'UPDATE' and old.won_at is not null and new.won_at is null then
    perform public.revoke_pending_rewards('deal_won', new.id);
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Moving a contact, importing generated contacts and search: in the space
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.move_contact(_contact_id uuid, _to_table_id uuid, _answers jsonb DEFAULT '{}'::jsonb)
 RETURNS contact_table_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _actor uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _target public.contact_tables;
  _contact public.contacts;
  _from uuid;
  _entry public.contact_table_entries;
  _given jsonb := coalesce(_answers, '{}'::jsonb);
  _clean jsonb := '{}'::jsonb;
  _field public.contact_table_fields;
  _value jsonb;
  _text text;
  _starts timestamptz;
begin
  if _actor is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- The owner moves in their own space; a worker needs edit rights to contacts or cold calling.
  if not (public.has_section_access(_ws, 'contacts', 'edit')
          or public.has_section_access(_ws, 'cold_calling', 'edit')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select * into _target from public.contact_tables
  where id = _to_table_id and user_id = _ws;
  if _target.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _target.system_key = 'clients' then
    raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
  end if;
  select * into _contact from public.contacts where id = _contact_id and user_id = _ws;
  if _contact.id is null then
    raise exception 'contact_not_found' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(_given) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'check_violation';
  end if;

  -- Questions shown for these answers: no dependency, or the answer they hang on was given
  -- to a question that is itself shown.
  for _field in
    with recursive shown as (
      select f.id from public.contact_table_fields f
      where f.table_id = _target.id and f.depends_on_field_id is null
      union
      select f.id from public.contact_table_fields f
      join shown s on s.id = f.depends_on_field_id
      where f.table_id = _target.id
        and _given ->> f.depends_on_field_id::text = f.depends_on_value
    )
    select f.* from public.contact_table_fields f
    join shown s on s.id = f.id
    order by f.position
  loop
    _value := _given -> _field.id::text;
    if _value is null or jsonb_typeof(_value) = 'null'
       or (jsonb_typeof(_value) = 'string' and btrim(_value #>> '{}') = '') then
      if _field.required then
        raise exception 'answer_required' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      continue;
    end if;

    if _field.type = 'boolean' then
      if jsonb_typeof(_value) <> 'boolean' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
    else
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      _text := _value #>> '{}';
      if char_length(_text) > 5000
         or (_field.type = 'date' and _text !~ '^\d{4}-\d{2}-\d{2}$')
         or (_field.type = 'datetime' and _text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
         or (_field.type = 'select' and not exists (
               select 1 from jsonb_array_elements(_field.options) o where o ->> 'key' = _text
             )) then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      begin
        if _field.type = 'date' then
          perform _text::date;
        elsif _field.type = 'datetime' then
          perform _text::timestamptz;
        end if;
      exception when others then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end;
    end if;
    _clean := _clean || jsonb_build_object(_field.id::text, _value);
  end loop;

  select table_id into _from from public.contact_table_entries
  where user_id = _ws and contact_id = _contact_id;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (_ws, _contact_id, _to_table_id, _clean, now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id,
        answers = excluded.answers,
        moved_at = excluded.moved_at
  returning * into _entry;

  insert into public.contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, answers)
  values (_ws, _actor, _contact_id, _from, _to_table_id, _clean);

  -- The table's name at the time of the move; the history keeps it after a rename.
  insert into public.contact_activities (user_id, actor_id, contact_id, type, content)
  values (_ws, _actor, _contact_id, 'move', _target.name);

  for _field in
    select * from public.contact_table_fields
    where table_id = _target.id and type = 'datetime' and system_key = 'meeting_at'
  loop
    if _clean ? _field.id::text then
      _starts := (_clean ->> _field.id::text)::timestamptz;
      insert into public.calendar_events (user_id, actor_id, title, kind, starts_at, contact_id, source)
      values (
        _ws,
        _actor,
        coalesce(
          nullif(btrim(_contact.company_name), ''),
          nullif(btrim(concat_ws(' ', _contact.first_name, _contact.last_name)), '')
        ),
        'meeting',
        _starts,
        _contact_id,
        'contact_move'
      );
    end if;
  end loop;

  return _entry;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.import_generated_contacts(_places jsonb, _limit integer, _country text DEFAULT NULL::text, _industry text DEFAULT NULL::text)
 RETURNS TABLE(created integer, duplicates integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _place jsonb;
  _name text;
  _address text;
  _phone text;
  _inserted integer;
  _created integer := 0;
  _duplicates integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(_places) <> 'array' then
    raise exception 'invalid_places' using errcode = 'check_violation';
  end if;

  for _place in select value from jsonb_array_elements(_places) loop
    exit when _created >= _limit;
    _name := nullif(btrim(_place ->> 'name'), '');
    if _name is null or nullif(btrim(_place ->> 'id'), '') is null then
      continue;
    end if;
    _address := nullif(btrim(_place ->> 'address'), '');
    _phone := public.normalize_phone(_place ->> 'phone');

    if exists (
      select 1 from public.contacts c
      where c.user_id = _ws
        and (
          c.external_place_id = _place ->> 'id'
          or (_phone is not null and char_length(_phone) >= 6
              and c.phone_normalized = _phone)
          or (_address is not null
              and lower(c.company_name) = lower(_name)
              and lower(c.address) = lower(_address))
        )
    ) then
      _duplicates := _duplicates + 1;
      continue;
    end if;

    insert into public.contacts
      (user_id, company_name, phone, website, address, country_code, external_place_id, source,
       generated_industry)
    values (
      _ws,
      left(_name, 120),
      left(nullif(btrim(_place ->> 'phone'), ''), 40),
      left(nullif(btrim(_place ->> 'website'), ''), 300),
      left(_address, 300),
      _country,
      _place ->> 'id',
      'generated',
      left(nullif(btrim(_industry), ''), 80)
    )
    on conflict (user_id, external_place_id) where external_place_id is not null do nothing;
    get diagnostics _inserted = row_count;
    if _inserted = 0 then
      _duplicates := _duplicates + 1;
    else
      _created := _created + 1;
    end if;
  end loop;

  return query select _created, _duplicates;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_matches(_kind text, _q text, _phones text[], _amount_digits text, _limit integer)
 RETURNS TABLE(id uuid, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.45'
AS $function$
#variable_conflict use_column
declare
  _uid uuid := public.current_workspace_id();
  _text boolean := length(coalesce(_q, '')) >= 2;
  _lim integer := least(greatest(coalesce(_limit, 6), 1), 50);
begin
  if _uid is null then
    return;
  end if;
  _phones := coalesce(_phones, '{}');

  -- _uid is the workspace; a worker only finds what their sections let them see.
  if not coalesce(case _kind
    when 'contact' then public.has_section_access(_uid, 'contacts', 'view')
                        or public.has_section_access(_uid, 'cold_calling', 'view')
    when 'deal' then public.has_section_access(_uid, 'pipeline', 'view')
    when 'milestone' then public.has_section_access(_uid, 'milestones', 'view')
    when 'task' then public.has_section_access(_uid, 'milestones', 'view')
    when 'event' then public.has_section_access(_uid, 'calendar', 'view')
    when 'transaction' then public.has_section_access(_uid, 'finance', 'view')
    when 'invoice' then public.has_section_access(_uid, 'finance', 'view')
    when 'worker' then _uid = auth.uid()
    else false
  end, false) then
    return;
  end if;

  if _kind = 'contact' then
    return query
    with hits as (
      select c.id,
        public.search_rank(
          _q,
          coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)),
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        ) as r,
        c.updated_at
      from public.contacts c
      where _text
        and c.user_id = _uid
        and (
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        )
      union all
      select c.id, 2.2::real, c.updated_at
      from unnest(_phones) as p(pattern)
      join public.contacts c on c.phone_normalized like p.pattern
      where c.user_id = _uid
    )
    select h.id, max(h.r)::real
    from hits h
    group by h.id
    order by max(h.r) desc, max(h.updated_at) desc
    limit _lim;

  elsif _kind = 'deal' then
    return query
    with contact_ids as (
      select c.id
      from public.contacts c
      where _text
        and c.user_id = _uid
        and (
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        )
    ),
    hits as (
      select d.id, public.search_rank(_q, d.title, public.search_doc(d.title)) as r, d.updated_at
      from public.deals d
      where _text
        and d.user_id = _uid
        and (
          public.search_doc(d.title) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(d.title)
        )
      union all
      select d.id, 1.4::real, d.updated_at
      from public.deals d
      where d.user_id = _uid and d.contact_id in (select ci.id from contact_ids ci)
      union all
      select d.id, (case when trunc(d.value)::text = _amount_digits then 2.4 else 1 end)::real, d.updated_at
      from public.deals d
      where _amount_digits is not null
        and d.user_id = _uid
        and d.value is not null
        and (
          trunc(d.value)::text = _amount_digits
          or (length(_amount_digits) >= 3 and trunc(d.value)::text like _amount_digits || '%')
        )
    )
    select h.id, max(h.r)::real
    from hits h
    group by h.id
    order by max(h.r) desc, max(h.updated_at) desc
    limit _lim;

  elsif not _text then
    return;

  elsif _kind = 'milestone' then
    return query
    select m.id, public.search_rank(_q, m.title, public.search_doc(m.title, m.description)) as r
    from public.milestones m
    where m.user_id = _uid
      and (
        public.search_doc(m.title, m.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(m.title, m.description)
      )
    order by r desc, m.updated_at desc
    limit _lim;

  elsif _kind = 'task' then
    return query
    select t.id, public.search_rank(_q, t.title, public.search_doc(t.title, t.description)) as r
    from public.tasks t
    where t.user_id = _uid
      and (
        public.search_doc(t.title, t.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(t.title, t.description)
      )
    order by r desc, t.updated_at desc
    limit _lim;

  elsif _kind = 'event' then
    return query
    select ev.id, public.search_rank(_q, ev.title, public.search_doc(ev.title, ev.description)) as r
    from public.calendar_events ev
    where ev.user_id = _uid
      and (
        public.search_doc(ev.title, ev.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(ev.title, ev.description)
      )
    order by r desc, ev.updated_at desc
    limit _lim;

  elsif _kind = 'transaction' then
    return query
    select tr.id, public.search_rank(_q, tr.description, public.search_doc(tr.description)) as r
    from public.transactions tr
    where tr.user_id = _uid
      and (
        public.search_doc(tr.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(tr.description)
      )
    order by r desc, tr.updated_at desc
    limit _lim;

  elsif _kind = 'invoice' then
    return query
    select i.id, public.search_rank(_q, i.number, public.search_doc(i.number, i.customer_name)) as r
    from public.invoices i
    where i.user_id = _uid
      and (
        public.search_doc(i.number, i.customer_name) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(i.number, i.customer_name)
      )
    order by r desc, i.updated_at desc
    limit _lim;

  elsif _kind = 'worker' then
    return query
    select w.id, public.search_rank(_q, w.name, public.search_doc(w.name, w.job_title)) as r
    from public.workers w
    where w.owner_id = _uid
      and (
        public.search_doc(w.name, w.job_title) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(w.name, w.job_title)
      )
    order by r desc, w.updated_at desc
    limit _lim;
  end if;
end;
$function$
;
