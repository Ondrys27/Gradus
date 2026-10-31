-- =============================================================================
-- Sales tasks (Úkoly)
--   A task belongs to a deal, a contact or both, has a due moment with a time,
--   a length in minutes and one person who does it (the owner or a worker of
--   the space). Milestone tasks (public.tasks) are a different thing and stay
--   as they are.
--   * crm_tasks.user_id is the space (the owner); created_by and completed_by
--     are who did it, stamped by the database
--   * the owner sees and changes everything; a worker sees the tasks given to
--     them plus the tasks of deals and contacts in sections they may see, and
--     changes them with the right to edit; a worker who only has the task
--     given to them may tick it off (with a note) and nothing else
--   * the person doing it is always the owner or an active worker of the space
--   * the note written when ticking it off shows in the history of the deal
--     and the contact; ticking it back clears it
-- =============================================================================

create type public.crm_task_status as enum ('open', 'done');

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  due_at timestamptz not null,
  duration_minutes integer not null default 15 check (duration_minutes between 1 and 1440),
  assignee_id uuid default auth.uid() references auth.users (id) on delete set null,
  deal_id uuid,
  contact_id uuid,
  status public.crm_task_status not null default 'open',
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  completion_note text check (completion_note is null or char_length(completion_note) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_tasks_target check (deal_id is not null or contact_id is not null),
  constraint crm_tasks_completed check ((status = 'done') = (completed_at is not null)),
  -- Only deals and contacts of the same space; deleting one keeps the task on the other.
  constraint crm_tasks_deal_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete set null (deal_id),
  constraint crm_tasks_contact_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id)
);

create index crm_tasks_user_due_idx on public.crm_tasks (user_id, due_at);
create index crm_tasks_assignee_due_idx on public.crm_tasks (assignee_id, due_at);
create index crm_tasks_deal_idx on public.crm_tasks (deal_id) where deal_id is not null;
create index crm_tasks_contact_idx on public.crm_tasks (contact_id) where contact_id is not null;
create index crm_tasks_user_completed_idx on public.crm_tasks (user_id, completed_at desc)
  where status = 'done';
create index crm_tasks_created_by_idx on public.crm_tasks (created_by);
create index crm_tasks_completed_by_idx on public.crm_tasks (completed_by);

create trigger set_updated_at before update on public.crm_tasks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Who may be given a task, and who may change one
-- -----------------------------------------------------------------------------

-- Whether an account works in the space: the owner or an active worker with an
-- account. A signed-in user may only ask about their own space.
create or replace function public.is_workspace_member(_owner uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    _owner is not null
    and _user is not null
    and (auth.uid() is null or _owner = public.current_workspace_id() or _owner = auth.uid())
    and (
      _user = _owner
      or exists (
        select 1 from public.workers w
        where w.owner_id = _owner and w.user_id = _user and w.status = 'active'
      )
    ),
    false
  );
$$;
revoke execute on function public.is_workspace_member(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;

-- The right to change a task beyond ticking it off: the owner, or a worker
-- who may edit the deal's or the contact's section.
create or replace function public.crm_task_editable(_owner uuid, _deal uuid, _contact uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.uid() = _owner
    or (
      _owner = public.current_workspace_id()
      and (
        (_deal is not null and public.has_section_access(_owner, 'pipeline', 'edit'))
        or (
          _contact is not null
          and (
            public.has_section_access(_owner, 'contacts', 'edit')
            or public.has_section_access(_owner, 'cold_calling', 'edit')
          )
        )
      )
    ),
    false
  );
$$;
revoke execute on function public.crm_task_editable(uuid, uuid, uuid) from public, anon;
grant execute on function public.crm_task_editable(uuid, uuid, uuid) to authenticated, service_role;

-- Stamps who made and who finished a task, keeps the done state consistent and
-- refuses a person outside the space. Not SECURITY DEFINER: is_client_request()
-- reads the role of the request.
create or replace function public.crm_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _client boolean := public.is_client_request();
begin
  if tg_op = 'INSERT' then
    if _client then
      -- A new task is always open and made by whoever is signed in.
      new.created_by := auth.uid();
      new.created_at := now();
      new.status := 'open';
      new.completed_at := null;
      new.completed_by := null;
      new.completion_note := null;
    end if;
    new.assignee_id := coalesce(new.assignee_id, new.created_by, new.user_id);
  else
    if new.user_id <> old.user_id then
      raise exception 'crm_task_space_fixed' using errcode = 'check_violation';
    end if;
    if _client then
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      -- Given the task but not the deal or the contact: only ticking it off.
      if not public.crm_task_editable(old.user_id, old.deal_id, old.contact_id)
        and (new.title, new.description, new.due_at, new.duration_minutes, new.assignee_id,
             new.deal_id, new.contact_id)
          is distinct from
            (old.title, old.description, old.due_at, old.duration_minutes, old.assignee_id,
             old.deal_id, old.contact_id)
      then
        raise exception 'crm_task_only_status' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.completed_at := case when _client then now() else coalesce(new.completed_at, now()) end;
      new.completed_by := case when _client then auth.uid()
                               else coalesce(new.completed_by, auth.uid()) end;
    elsif _client then
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
    new.completion_note := nullif(btrim(new.completion_note), '');
  else
    new.completed_at := null;
    new.completed_by := null;
    new.completion_note := null;
  end if;

  if new.assignee_id is not null
    and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
    and not public.is_workspace_member(new.user_id, new.assignee_id)
  then
    raise exception 'crm_task_assignee_outside' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
revoke execute on function public.crm_tasks_guard() from public, anon;

create trigger crm_tasks_guard
  before insert or update on public.crm_tasks
  for each row execute function public.crm_tasks_guard();

-- After the trial (or over a limit) the space is read only, tasks included.
create trigger crm_tasks_writable
  before insert or update or delete on public.crm_tasks
  for each row execute function public.enforce_workspace_writable('user_id');

-- Deleting a deal or a contact takes the tasks that hung only on it; a task
-- that also belongs to the other one stays there (the foreign key clears the
-- link). SECURITY DEFINER so a task the deleting worker can not see goes too.
create or replace function public.crm_tasks_detach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'deals' then
    delete from public.crm_tasks where deal_id = old.id and contact_id is null;
  else
    delete from public.crm_tasks where contact_id = old.id and deal_id is null;
  end if;
  return old;
end;
$$;
revoke execute on function public.crm_tasks_detach() from public, anon, authenticated;

create trigger crm_tasks_detach before delete on public.deals
  for each row execute function public.crm_tasks_detach();
create trigger crm_tasks_detach before delete on public.contacts
  for each row execute function public.crm_tasks_detach();

-- -----------------------------------------------------------------------------
-- Row level security
--   read:   the owner; a worker of the space the tasks given to them and the
--           tasks of a deal (pipeline) or a contact (contacts / cold calling)
--           they may see
--   insert: the owner; a worker who may edit the deal's or the contact's section
--   update: as insert, plus the person the task is given to (the guard keeps
--           them to ticking it off)
--   delete: as insert
-- -----------------------------------------------------------------------------

alter table public.crm_tasks enable row level security;

create policy "crm_tasks_select_workspace" on public.crm_tasks
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          deal_id is not null
          and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'view'))
        )
        or (
          contact_id is not null
          and (
            (select public.has_section_access(public.current_workspace_id(), 'contacts', 'view'))
            or (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'view'))
          )
        )
      )
    )
  );

create policy "crm_tasks_insert_workspace" on public.crm_tasks
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        (
          deal_id is not null
          and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
        )
        or (
          contact_id is not null
          and (
            (select public.has_section_access(public.current_workspace_id(), 'contacts', 'edit'))
            or (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'edit'))
          )
        )
      )
    )
  );

create policy "crm_tasks_update_workspace" on public.crm_tasks
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          deal_id is not null
          and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
        )
        or (
          contact_id is not null
          and (
            (select public.has_section_access(public.current_workspace_id(), 'contacts', 'edit'))
            or (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'edit'))
          )
        )
      )
    )
  )
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          deal_id is not null
          and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
        )
        or (
          contact_id is not null
          and (
            (select public.has_section_access(public.current_workspace_id(), 'contacts', 'edit'))
            or (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'edit'))
          )
        )
      )
    )
  );

create policy "crm_tasks_delete_workspace" on public.crm_tasks
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        (
          deal_id is not null
          and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
        )
        or (
          contact_id is not null
          and (
            (select public.has_section_access(public.current_workspace_id(), 'contacts', 'edit'))
            or (select public.has_section_access(public.current_workspace_id(), 'cold_calling', 'edit'))
          )
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- The people a task can be given to: the owner of the caller's space and its
-- active workers with an account. Names only, for the "Kdo" picker and the
-- task list; a worker sees nothing else of the owner's profile or workers.
-- -----------------------------------------------------------------------------

create or replace function public.crm_task_assignees()
returns table (user_id uuid, name text, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with space as (select public.current_workspace_id() as id)
  select p.id, coalesce(nullif(btrim(p.display_name), ''), ''), true
  from space s
  join public.profiles p on p.id = s.id
  where auth.uid() is not null
  union all
  select w.user_id, w.name, false
  from space s
  join public.workers w on w.owner_id = s.id
  where auth.uid() is not null
    and w.user_id is not null
    and w.status = 'active'
  order by 3 desc, 2
  limit 101;
$$;
revoke execute on function public.crm_task_assignees() from public, anon;
grant execute on function public.crm_task_assignees() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Analytics: the events of the Tasks section (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('crm_task_created', 'pipeline', true),
  ('crm_task_updated', 'pipeline', true),
  ('crm_task_completed', 'pipeline', true),
  ('crm_task_reopened', 'pipeline', true),
  ('crm_task_deleted', 'pipeline', true)
on conflict (event) do nothing;
