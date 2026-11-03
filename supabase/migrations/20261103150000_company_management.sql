-- =============================================================================
-- Company management (19.2): the Workers section becomes Company
--   * hierarchy: workers.manager_id (null = right under the owner, who is the
--     root and never a row of workers); a manager is a worker of the same
--     owner; a cycle is refused by workers_hierarchy_guard under a lock per
--     owner, so two moves at once cannot build one either; moving a worker
--     takes everything below it along (only its own row changes)
--   * groups: worker_groups (owner_id, name, color, description, position)
--     and worker_group_members (group, worker, the same owner); a worker in
--     any number of groups or none; deleting a group ends its memberships only
--   * the owner writes hierarchy and groups (RLS), a read-only space does not
--   * reading the tree: company_tree() and company_groups() — the owner gets
--     every worker and group, an active worker only their own branch (them and
--     everyone below) and the groups of that branch, read only. Open tasks and
--     deals are counted here because a worker may not read them otherwise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hierarchy
-- -----------------------------------------------------------------------------

alter table public.workers
  add column manager_id uuid,
  add constraint workers_manager_not_self check (manager_id is null or manager_id <> id),
  -- The manager is a worker of the same owner. A deleted manager leaves the
  -- people below them right under the owner.
  add constraint workers_manager_fk foreign key (manager_id, owner_id)
    references public.workers (id, owner_id) on delete set null (manager_id);

create index workers_manager_idx on public.workers (manager_id) where manager_id is not null;

-- Refuses a manager that is the worker or anyone below them. Security definer,
-- so the walk up sees the whole tree whoever writes; the advisory lock per
-- owner makes concurrent moves wait for each other.
create or replace function public.workers_hierarchy_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.manager_id is not distinct from old.manager_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workers_tree:' || new.owner_id::text, 0));
  if new.manager_id = new.id or exists (
    with recursive up (id, manager_id) as (
      select w.id, w.manager_id from public.workers w
      where w.id = new.manager_id and w.owner_id = new.owner_id
      union
      select w.id, w.manager_id from public.workers w
      join up on w.id = up.manager_id
      where w.owner_id = new.owner_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'worker_manager_cycle' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.workers_hierarchy_guard() from public, anon, authenticated;

create trigger workers_hierarchy_guard
  before insert or update of manager_id on public.workers
  for each row execute function public.workers_hierarchy_guard();

-- A read-only space keeps its tree as it is. The owner may still deactivate a
-- worker (workers only guard inserts); a manager's row deleted with the
-- account moves the people below by the foreign key, which is not stopped.
create or replace function public.workers_manager_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.manager_id is distinct from old.manager_id and public.workspace_read_only(new.owner_id) then
    raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
  end if;
  return new;
end;
$$;
revoke execute on function public.workers_manager_writable() from public, anon, authenticated;

create trigger workers_manager_writable
  before update of manager_id on public.workers
  for each row execute function public.workers_manager_writable();

-- -----------------------------------------------------------------------------
-- Groups
-- -----------------------------------------------------------------------------

create table public.worker_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  -- A design tone (src/components/ui/tone.ts), never a hex.
  color text not null default 'violet'
    check (color in ('violet', 'teal', 'gold', 'green', 'pink', 'neutral')),
  description text check (description is null or char_length(description) between 1 and 500),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index worker_groups_name_idx on public.worker_groups (owner_id, lower(name));
create index worker_groups_owner_idx on public.worker_groups (owner_id, position);

create table public.worker_group_members (
  group_id uuid not null,
  worker_id uuid not null,
  owner_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (group_id, worker_id),
  foreign key (group_id, owner_id) references public.worker_groups (id, owner_id) on delete cascade,
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index worker_group_members_worker_idx on public.worker_group_members (worker_id);
create index worker_group_members_owner_idx on public.worker_group_members (owner_id);

create trigger set_updated_at before update on public.worker_groups
  for each row execute function public.set_updated_at();

-- Only the owner; a worker reads the groups of their branch through company_groups().
alter table public.worker_groups enable row level security;
create policy "worker_groups_owner_all" on public.worker_groups for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

alter table public.worker_group_members enable row level security;
create policy "worker_group_members_owner_all" on public.worker_group_members for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- Memberships are added and removed, never rewritten.
revoke update on public.worker_group_members from authenticated, anon;

create trigger worker_groups_writable
  before insert or update or delete on public.worker_groups
  for each row execute function public.enforce_workspace_writable('owner_id');
create trigger worker_group_members_writable
  before insert or update or delete on public.worker_group_members
  for each row execute function public.enforce_workspace_writable('owner_id');

-- -----------------------------------------------------------------------------
-- Reading the tree
-- -----------------------------------------------------------------------------

-- The workers the signed-in account may see in Company: every worker for the
-- owner of the space, the own branch for an active worker. Nothing for anyone else.
create or replace function public.company_visible_worker_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid;
  _me uuid;
begin
  if _uid is null then
    return;
  end if;
  _space := public.current_workspace_id();
  if _space = _uid then
    return query select w.id from public.workers w where w.owner_id = _uid;
    return;
  end if;
  select w.id into _me from public.workers w
  where w.user_id = _uid and w.owner_id = _space and w.status = 'active';
  if _me is null then
    return;
  end if;
  return query
    with recursive branch (id) as (
      select _me
      union
      select w.id from public.workers w
      join branch b on w.manager_id = b.id
      where w.owner_id = _space
    )
    select branch.id from branch;
end;
$$;
revoke execute on function public.company_visible_worker_ids() from public, anon;
grant execute on function public.company_visible_worker_ids() to authenticated;

-- One row per visible worker: who they are, under whom, their groups and how
-- much is open in their care. For a worker the top of their branch has no
-- manager (whoever is above is not theirs to see).
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
    p.avatar_url,
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
      select count(*) from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.user_id = w.owner_id and d.assignee_id = w.user_id
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

-- The groups the account may see: all of the owner's, or those with someone
-- of the worker's branch, with how many visible people are in each.
create or replace function public.company_groups()
returns table (
  id uuid,
  name text,
  color text,
  description text,
  "position" integer,
  member_count integer
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
    g.id,
    g.name,
    g.color,
    g.description,
    g.position,
    (select count(*) from public.worker_group_members m
     where m.group_id = g.id and m.worker_id in (select visible.id from visible))::integer
  from public.worker_groups g
  where g.owner_id = public.current_workspace_id()
    and (
      g.owner_id = auth.uid()
      or exists (
        select 1 from public.worker_group_members m
        where m.group_id = g.id and m.worker_id in (select visible.id from visible)
      )
    )
  order by g.position, g.name
  limit 200;
$$;
revoke execute on function public.company_groups() from public, anon;
grant execute on function public.company_groups() to authenticated;

-- -----------------------------------------------------------------------------
-- The section's unlock card carries its new name
-- -----------------------------------------------------------------------------

update public.unlock_definitions
set
  name = '{"en": "Company", "cs": "Správa firmy"}',
  description = '{"en": "Your team as a tree, groups, invites and rewards.", "cs": "Tým jako strom, skupiny, pozvánky a odměny."}',
  icon = 'building-2'
where key = 'section_workers';

-- -----------------------------------------------------------------------------
-- Analytics: the new events (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('worker_moved', 'workers', true),
  ('worker_group_created', 'workers', true),
  ('worker_group_updated', 'workers', true),
  ('worker_group_deleted', 'workers', true)
on conflict (event) do nothing;
