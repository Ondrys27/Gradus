-- =============================================================================
-- More people on one deal
--   * deal_assignees: everyone who works on a deal (the owner or active workers
--     of the space), all of them equal. A worker with "only own deals" sees and
--     works on every deal they are on.
--   * deals.assignee_id stays (additive migration) as a mirror the database
--     keeps: the person on the deal the longest, null without anyone. Old code
--     that still writes it (a single person picked) replaces that person in
--     the list; the app writes the list through deal_set_assignees().
--   * Counts of a person's open deals (Company, removal) and the visibility of
--     a deal's tasks follow the list. The reward for a won deal does not
--     change: it still goes to whoever made the deal.
-- =============================================================================

create table public.deal_assignees (
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null,
  assignee_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (deal_id, assignee_id),
  -- Only a deal of the same space.
  constraint deal_assignees_deal_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete cascade
);

create index deal_assignees_assignee_idx on public.deal_assignees (assignee_id, deal_id);
create index deal_assignees_user_idx on public.deal_assignees (user_id);

-- Everyone who looks after a deal so far is its first person.
insert into public.deal_assignees (user_id, deal_id, assignee_id, created_by, created_at)
select d.user_id, d.id, d.assignee_id, d.created_by, d.created_at
from public.deals d
where d.assignee_id is not null
on conflict do nothing;

alter table public.deal_assignees enable row level security;
revoke update on public.deal_assignees from anon, authenticated;

create trigger deal_assignees_writable
  before insert or update or delete on public.deal_assignees
  for each row execute function public.enforce_workspace_writable('user_id');

-- Whether the signed-in account is on the deal. SECURITY DEFINER, so the
-- policies of deals read the list without its own policies.
create or replace function public.is_deal_assignee(_deal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deal_assignees a
    where a.deal_id = _deal and a.assignee_id = auth.uid()
  );
$$;
revoke execute on function public.is_deal_assignee(uuid) from public, anon;
grant execute on function public.is_deal_assignee(uuid) to authenticated, service_role;

-- Stamps who added the person; only members of the deal's space. Not
-- SECURITY DEFINER: is_client_request() reads the request's role.
create or replace function public.deal_assignees_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  if not public.is_workspace_member(new.user_id, new.assignee_id) then
    raise exception 'deal_assignee_outside' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.deal_assignees a where a.deal_id = new.deal_id) >= 20 then
    raise exception 'deal_assignees_too_many' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.deal_assignees_guard() from public, anon;

create trigger deal_assignees_guard
  before insert on public.deal_assignees
  for each row execute function public.deal_assignees_guard();

-- The list changed: deals.assignee_id follows (the longest-serving person, or
-- null) and the deal's last activity is now.
create or replace function public.deal_assignees_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.deals d
    set assignee_id = coalesce(d.assignee_id, new.assignee_id),
        last_activity_at = greatest(d.last_activity_at, now())
    where d.id = new.deal_id and (d.assignee_id is null or d.last_activity_at < now());
  else
    update public.deals d
    set assignee_id = case
          when d.assignee_id is null or d.assignee_id = old.assignee_id then (
            select a.assignee_id from public.deal_assignees a
            where a.deal_id = old.deal_id
            order by a.created_at, a.assignee_id
            limit 1
          )
          else d.assignee_id
        end,
        last_activity_at = greatest(d.last_activity_at, now())
    where d.id = old.deal_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.deal_assignees_sync() from public, anon, authenticated;

create trigger deal_assignees_sync
  after insert or delete on public.deal_assignees
  for each row execute function public.deal_assignees_sync();

-- A new deal starts with the person deals_track_activity gave it. A direct
-- change of deals.assignee_id (one person picked, older code) swaps that
-- person in the list; the mirror updates of deal_assignees_sync and the
-- cascades of a deleted account come from a trigger and are left alone.
create or replace function public.deals_sync_assignees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      insert into public.deal_assignees (user_id, deal_id, assignee_id, created_by, created_at)
      values (new.user_id, new.id, new.assignee_id, new.created_by, now())
      on conflict do nothing;
    end if;
  elsif pg_trigger_depth() = 1 and new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null and not exists (
      select 1 from public.deal_assignees a
      where a.deal_id = new.id and a.assignee_id = new.assignee_id
    ) then
      insert into public.deal_assignees (user_id, deal_id, assignee_id, created_by, created_at)
      values (new.user_id, new.id, new.assignee_id, auth.uid(), now())
      on conflict do nothing;
    end if;
    if old.assignee_id is not null then
      delete from public.deal_assignees a
      where a.deal_id = new.id and a.assignee_id = old.assignee_id;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.deals_sync_assignees() from public, anon, authenticated;

create trigger deals_sync_assignees
  after insert or update of assignee_id on public.deals
  for each row execute function public.deals_sync_assignees();

-- Read with the deal: whoever sees the deal sees who is on it. Added and
-- removed with the right to edit deals, on a deal the account sees.
create policy deal_assignees_select on public.deal_assignees
  for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_assignees.deal_id));
create policy deal_assignees_insert on public.deal_assignees
  for insert to authenticated
  with check (
    exists (
      select 1 from public.deals d
      where d.id = deal_assignees.deal_id and d.user_id = deal_assignees.user_id
    )
    and (
      (select auth.uid()) = user_id
      or user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
    )
  );
create policy deal_assignees_delete on public.deal_assignees
  for delete to authenticated
  using (
    exists (select 1 from public.deals d where d.id = deal_assignees.deal_id)
    and (
      (select auth.uid()) = user_id
      or user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
    )
  );

-- The whole list of a deal at once (as the caller, under the policies above):
-- new people first, then the ones left out go. Never empty.
create or replace function public.deal_set_assignees(_deal uuid, _assignees uuid[])
returns setof uuid
language plpgsql
set search_path = ''
as $$
declare
  _space uuid;
  _wanted uuid[] := array(select distinct x from unnest(_assignees) x where x is not null);
begin
  if cardinality(_wanted) = 0 then
    raise exception 'deal_assignees_empty' using errcode = 'check_violation';
  end if;
  if cardinality(_wanted) > 20 then
    raise exception 'deal_assignees_too_many' using errcode = 'check_violation';
  end if;
  select d.user_id into _space from public.deals d where d.id = _deal;
  if _space is null then
    raise exception 'deal_not_found' using errcode = 'no_data_found';
  end if;
  if not (auth.uid() = _space or _space = any (public.permitted_spaces('pipeline', 'update'))) then
    raise exception 'deal_assignees_forbidden' using errcode = 'insufficient_privilege';
  end if;

  -- Only the new ones: someone already on it stays, even after leaving the space.
  insert into public.deal_assignees (user_id, deal_id, assignee_id)
  select _space, _deal, x from unnest(_wanted) x
  where not exists (
    select 1 from public.deal_assignees a where a.deal_id = _deal and a.assignee_id = x
  )
  on conflict do nothing;
  delete from public.deal_assignees a
  where a.deal_id = _deal and a.assignee_id <> all (_wanted);

  return query
    select a.assignee_id from public.deal_assignees a
    where a.deal_id = _deal
    order by a.created_at, a.assignee_id;
end;
$$;
revoke execute on function public.deal_set_assignees(uuid, uuid[]) from public, anon;
grant execute on function public.deal_set_assignees(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Deals in a worker's care: every deal they are on
-- -----------------------------------------------------------------------------

drop policy if exists "deals_scope_select" on public.deals;
drop policy if exists "deals_scope_update" on public.deals;
drop policy if exists "deals_delete_permission" on public.deals;

create policy "deals_scope_select" on public.deals
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (assignee_id = (select auth.uid()) or public.is_deal_assignee(id))
      and user_id = any ((select public.member_spaces())::uuid[])
    )
    or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
  );
create policy "deals_scope_update" on public.deals
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (assignee_id = (select auth.uid()) or public.is_deal_assignee(id))
      and user_id = any ((select public.member_spaces())::uuid[])
    )
    or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
  );
create policy "deals_delete_permission" on public.deals
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('pipeline', 'delete'))::uuid[])
      and (
        assignee_id = (select auth.uid())
        or public.is_deal_assignee(id)
        or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
      )
    )
  );

-- A deal's sales tasks: seen by everyone on the deal.
create or replace function public.crm_task_target_visible(_owner uuid, _deal uuid, _contact uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() = _owner
    or (
      public.is_space_member(_owner)
      and (
        (
          _deal is not null
          and public.has_section_access(_owner, 'pipeline', 'view')
          and (
            public.has_permission(_owner, 'pipeline', 'view_all')
            or exists (
              select 1 from public.deal_assignees a
              join public.deals d on d.id = a.deal_id
              where a.deal_id = _deal and d.user_id = _owner and a.assignee_id = auth.uid()
            )
          )
        )
        or (
          _contact is not null
          and (
            public.has_section_access(_owner, 'contacts', 'view')
            or public.has_section_access(_owner, 'cold_calling', 'view')
          )
        )
      )
    ),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- Company: a person's open deals are the ones they are on
-- -----------------------------------------------------------------------------

create or replace function public.company_tree()
returns table (
  id uuid,
  name text,
  job_title text,
  status public.worker_status,
  manager_id uuid,
  user_id uuid,
  avatar_url text,
  display_name text,
  open_tasks integer,
  open_deals integer,
  group_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select v.id from public.company_visible_worker_ids() v (id)
  )
  select
    w.id,
    w.name,
    w.job_title,
    w.status,
    case when w.manager_id in (select visible.id from visible) then w.manager_id end,
    w.user_id,
    coalesce(w.avatar_url, p.avatar_url),
    p.display_name,
    (
      (select count(*) from public.worker_tasks t
       where t.worker_id = w.id and t.owner_id = w.owner_id and t.status <> 'done')
      + case when w.user_id is null then 0 else (
          select count(*) from public.crm_tasks c
          where c.user_id = w.owner_id and c.assignee_id = w.user_id and c.status = 'open'
        ) end
    )::integer,
    case when w.user_id is null then 0 else (
      select count(*) from public.deal_assignees a
      join public.deals d on d.id = a.deal_id
      join public.pipeline_stages s on s.id = d.stage_id
      where a.assignee_id = w.user_id and d.user_id = w.owner_id
        and not s.is_won and not s.is_lost
    ) end::integer,
    coalesce(
      array(
        select m.group_id from public.worker_group_members m
        where m.worker_id = w.id order by m.created_at, m.group_id
      ),
      '{}'
    )
  from public.workers w
  left join public.profiles p on p.id = w.user_id
  where w.id in (select visible.id from visible)
  order by w.name, w.created_at
  limit 500;
$$;
revoke execute on function public.company_tree() from public, anon;
grant execute on function public.company_tree() to authenticated;

create or replace function public.company_worker_impact(_worker_id uuid)
returns table (open_deals integer, open_crm_tasks integer, open_worker_tasks integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when w.user_id is null then 0 else (
      select count(*) from public.deal_assignees a
      join public.deals d on d.id = a.deal_id
      join public.pipeline_stages s on s.id = d.stage_id
      where a.assignee_id = w.user_id and d.user_id = w.owner_id
        and not s.is_won and not s.is_lost
    ) end::integer,
    case when w.user_id is null then 0 else (
      select count(*) from public.crm_tasks c
      where c.user_id = w.owner_id and c.assignee_id = w.user_id and c.status = 'open'
    ) end::integer,
    (select count(*) from public.worker_tasks t
     where t.worker_id = w.id and t.owner_id = w.owner_id and t.status <> 'done')::integer
  from public.workers w
  where w.id = _worker_id and w.owner_id = auth.uid();
$$;
revoke execute on function public.company_worker_impact(uuid) from public, anon;
grant execute on function public.company_worker_impact(uuid) to authenticated;

-- As before, only the open deals: the person leaves each of them, and a deal
-- nobody else is on goes to _assignee.
create or replace function public.company_remove_worker(_worker_id uuid, _assignee uuid default null)
returns table (deals integer, crm_tasks integer, worker_tasks integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _worker public.workers;
  _read_only boolean;
  _target_worker uuid;
  _deals integer := 0;
  _tasks integer := 0;
  _worker_tasks integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _worker from public.workers w
  where w.id = _worker_id and w.owner_id = _uid
  for update;
  if not found then
    raise exception 'worker_not_found' using errcode = 'no_data_found';
  end if;
  if _worker.status = 'inactive' then
    return query select 0, 0, 0;
    return;
  end if;
  _read_only := public.workspace_read_only(_uid);

  if _assignee is not null then
    if _read_only then
      raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
    end if;
    if _assignee is not distinct from _worker.user_id
       or not public.is_workspace_member(_uid, _assignee) then
      raise exception 'worker_assignee_outside' using errcode = 'check_violation';
    end if;
    if _worker.user_id is not null then
      insert into public.deal_assignees (user_id, deal_id, assignee_id, created_by)
      select d.user_id, d.id, _assignee, _uid
      from public.deal_assignees a
      join public.deals d on d.id = a.deal_id
      join public.pipeline_stages s on s.id = d.stage_id
      where a.assignee_id = _worker.user_id
        and d.user_id = _uid
        and not s.is_won and not s.is_lost
        and not exists (
          select 1 from public.deal_assignees o
          where o.deal_id = d.id and o.assignee_id <> _worker.user_id
        )
      on conflict do nothing;
      delete from public.deal_assignees a
      using public.deals d, public.pipeline_stages s
      where a.deal_id = d.id
        and s.id = d.stage_id
        and a.assignee_id = _worker.user_id
        and d.user_id = _uid
        and not s.is_won and not s.is_lost;
      get diagnostics _deals = row_count;
      update public.crm_tasks c
      set assignee_id = _assignee
      where c.user_id = _uid and c.assignee_id = _worker.user_id and c.status = 'open';
      get diagnostics _tasks = row_count;
    end if;
    select w.id into _target_worker from public.workers w
    where w.owner_id = _uid and w.user_id = _assignee and w.status = 'active' and w.id <> _worker.id;
    if _target_worker is not null then
      update public.worker_tasks t
      set worker_id = _target_worker
      where t.worker_id = _worker.id and t.owner_id = _uid and t.status <> 'done';
      get diagnostics _worker_tasks = row_count;
    end if;
  end if;

  if not _read_only then
    update public.workers w set manager_id = _worker.manager_id
    where w.owner_id = _uid and w.manager_id = _worker.id;
  end if;
  delete from public.worker_invites i where i.worker_id = _worker.id and i.accepted_at is null;
  update public.workers w set status = 'inactive' where w.id = _worker.id;
  return query select _deals, _tasks, _worker_tasks;
end;
$$;
revoke execute on function public.company_remove_worker(uuid, uuid) from public, anon;
grant execute on function public.company_remove_worker(uuid, uuid) to authenticated;

-- The event of a changed list (src/lib/analytics/events.ts).
insert into public.analytics_event_catalog (event, section, active) values
  ('deal_assignees_changed', 'pipeline', true)
on conflict (event) do nothing;
