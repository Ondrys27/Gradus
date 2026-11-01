-- =============================================================================
-- Moving milestone tasks (17.5)
--   * tasks_tree_guard: a task's parent is always in the same milestone, never
--     the task itself or anything below it, and the tree stays within
--     TASK_LEVEL_LIMIT levels (100, the same as MAX_TASK_LEVELS in
--     src/features/milestones/task-tree.ts). Every parent change in a
--     milestone waits for the one before (advisory lock), so two moves at
--     once can never build a cycle together.
--   * move_task(_task_id, _parent_id, _position): the one way the app moves a
--     task. In one transaction it puts the task (with everything below it)
--     under the new parent at the given place among its new siblings and
--     renumbers the positions of the old and the new siblings. Runs with the
--     caller's rights: RLS (owner, or a worker with milestones edit) and the
--     read-only rule (enforce_workspace_writable) apply as to any write.
--     Completion follows the existing rules: an open task moved under a done
--     parent reopens it and its done ancestors (tasks_reopen_parent); nothing
--     is ever completed by a move.
-- =============================================================================

create or replace function public.tasks_tree_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _level_limit constant integer := 100;
  _milestone uuid;
  _cursor uuid;
  _depth integer := 0;
  _height integer := 0;
begin
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;
  if new.parent_task_id is null then
    return new;
  end if;

  -- tasks_inherit_milestone (earlier, by name) has already copied the
  -- parent's milestone into new; a task never changes milestone by a move.
  _milestone := case when tg_op = 'UPDATE' then old.milestone_id else new.milestone_id end;
  if new.milestone_id is distinct from _milestone then
    raise exception 'task_parent_invalid' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tasks_tree:' || _milestone::text, 0));

  -- Walk up from the new parent: the task itself on the way is a cycle.
  _cursor := new.parent_task_id;
  while _cursor is not null loop
    if _cursor = new.id then
      raise exception 'task_move_cycle' using errcode = 'check_violation';
    end if;
    _depth := _depth + 1;
    if _depth > _level_limit then
      raise exception 'task_too_deep' using errcode = 'check_violation';
    end if;
    select t.parent_task_id into _cursor from public.tasks t where t.id = _cursor;
  end loop;

  -- How far the task's own subtree reaches below it (0 for a new task).
  if tg_op = 'UPDATE' then
    with recursive below as (
      select t.id, 1 as level from public.tasks t where t.parent_task_id = new.id
      union all
      select t.id, below.level + 1 from public.tasks t
      join below on t.parent_task_id = below.id
      where below.level <= _level_limit
    )
    select coalesce(max(level), 0) into _height from below;
  end if;

  -- _depth is the number of levels above the task; the task is on level _depth + 1.
  if _depth + 1 + _height > _level_limit then
    raise exception 'task_too_deep' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_tree_guard() from public, anon, authenticated;

create trigger tasks_tree_guard
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.tasks_tree_guard();

-- -----------------------------------------------------------------------------
-- move_task
-- -----------------------------------------------------------------------------

create or replace function public.move_task(_task_id uuid, _parent_id uuid, _position integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _task public.tasks;
  _parent public.tasks;
  _old_parent uuid;
  _siblings uuid[];
  _index integer;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into _task from public.tasks where id = _task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'no_data_found';
  end if;
  if not (
    _task.user_id = _uid
    or (_task.user_id = public.current_workspace_id()
        and public.has_section_access(_task.user_id, 'milestones', 'edit'))
  ) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  -- One move per milestone at a time (the same lock as tasks_tree_guard), and
  -- everything below reads the tree as the previous move left it.
  perform pg_advisory_xact_lock(hashtextextended('tasks_tree:' || _task.milestone_id::text, 0));
  select * into _task from public.tasks where id = _task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'no_data_found';
  end if;
  _old_parent := _task.parent_task_id;

  if _parent_id is not null then
    select * into _parent from public.tasks where id = _parent_id;
    if not found
      or _parent.user_id <> _task.user_id
      or _parent.milestone_id <> _task.milestone_id
    then
      raise exception 'task_parent_invalid' using errcode = 'check_violation';
    end if;
  end if;

  -- The new siblings in their order, without the task, then the task at its place.
  select coalesce(array_agg(t.id order by t.position, t.created_at, t.id), '{}')
  into _siblings
  from public.tasks t
  where t.milestone_id = _task.milestone_id
    and t.parent_task_id is not distinct from _parent_id
    and t.id <> _task_id;
  _index := least(greatest(coalesce(_position, 0), 0), cardinality(_siblings));
  _siblings := _siblings[1:_index] || _task_id || _siblings[_index + 1:];

  -- The guard checks the cycle and the depth; the reopen triggers do the rest.
  if _old_parent is distinct from _parent_id then
    update public.tasks set parent_task_id = _parent_id where id = _task_id;
  end if;

  update public.tasks t
  set position = s.ord - 1
  from unnest(_siblings) with ordinality as s(id, ord)
  where t.id = s.id and t.position <> s.ord - 1;

  -- The siblings the task left close the gap.
  if _old_parent is distinct from _parent_id then
    update public.tasks t
    set position = s.ord - 1
    from (
      select o.id, row_number() over (order by o.position, o.created_at, o.id) as ord
      from public.tasks o
      where o.milestone_id = _task.milestone_id
        and o.parent_task_id is not distinct from _old_parent
    ) s
    where t.id = s.id and t.position <> s.ord - 1;
  end if;
end;
$$;
revoke execute on function public.move_task(uuid, uuid, integer) from public, anon;
grant execute on function public.move_task(uuid, uuid, integer) to authenticated;
