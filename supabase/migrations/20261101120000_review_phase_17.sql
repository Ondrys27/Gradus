-- =============================================================================
-- Review of phase 17
--   * crm_tasks_guard: a worker ties a task to a deal (new task, or a task
--     moved to another deal) only with the right to see the pipeline. Before,
--     a worker with contacts only could hang a task on a deal of the space
--     they may not see (and move its last activity).
--   * deals_touch_activity on crm_tasks also fires when a task is tied to a
--     deal later: the task shows in the deal's history, so it is activity.
--   The rest of crm_tasks_guard() is unchanged.
-- =============================================================================

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

  -- A deal is tied only by someone who may see the pipeline (the owner always).
  if _client
    and new.deal_id is not null
    and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id)
    and not public.has_section_access(new.user_id, 'pipeline', 'view')
  then
    raise exception 'crm_task_deal_hidden' using errcode = '42501';
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

drop trigger deals_touch_activity on public.crm_tasks;
create trigger deals_touch_activity
  after insert or update of status, deal_id on public.crm_tasks
  for each row when (new.deal_id is not null)
  execute function public.deals_touch_activity();
