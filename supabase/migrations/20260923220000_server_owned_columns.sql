-- =============================================================================
-- Server-owned rows and columns (audit follow-up 2026-09-23)
--   * Jarvis output (messages, sales analyses, milestone feedback) and unlocks
--     are written by the server; the client reads them
--   * timestamps that feed XP and badges follow the status, never the client
--   * a new open subtask reopens a completed parent
--   * deleting a select field deletes the questions that depend on it
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Jarvis output: read and delete from the client, written by /api/jarvis
-- -----------------------------------------------------------------------------

drop policy "jarvis_messages_insert_own" on public.jarvis_messages;
drop policy "jarvis_messages_update_own" on public.jarvis_messages;
drop policy "sales_analyses_insert_own" on public.sales_analyses;
drop policy "sales_analyses_update_own" on public.sales_analyses;

create or replace function public.milestones_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.ai_feedback := null;
      new.ai_feedback_at := null;
    else
      new.ai_feedback := old.ai_feedback;
      new.ai_feedback_at := old.ai_feedback_at;
    end if;
  end if;

  -- completed_at follows the status; archiving keeps it.
  if new.status = 'completed' then
    if tg_op = 'UPDATE' and old.status = 'completed' then
      new.completed_at := old.completed_at;
    elsif public.is_client_request() or new.completed_at is null then
      new.completed_at := now();
    end if;
  elsif new.status = 'active' then
    new.completed_at := null;
  elsif tg_op = 'UPDATE' and public.is_client_request() then
    new.completed_at := old.completed_at;
  elsif public.is_client_request() then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger milestones_guard
  before insert or update on public.milestones
  for each row execute function public.milestones_guard();

-- -----------------------------------------------------------------------------
-- Unlocks: granted by the server, the client only marks them as seen
-- -----------------------------------------------------------------------------

drop policy "unlocks_insert_own" on public.unlocks;
drop policy "unlocks_delete_own" on public.unlocks;

create or replace function public.unlocks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and (to_jsonb(new) - array['seen_at', 'updated_at'])
         <> (to_jsonb(old) - array['seen_at', 'updated_at']) then
    raise exception 'unlocks_are_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger unlocks_guard
  before update on public.unlocks
  for each row execute function public.unlocks_guard();

-- -----------------------------------------------------------------------------
-- Deals: won_at / lost_at / entered_stage_at change only with the stage
-- -----------------------------------------------------------------------------

create or replace function public.deals_before_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _stage public.pipeline_stages;
begin
  if tg_op = 'UPDATE' and new.stage_id = old.stage_id then
    if public.is_client_request() then
      new.entered_stage_at := old.entered_stage_at;
      new.won_at := old.won_at;
      new.lost_at := old.lost_at;
    end if;
    return new;
  end if;
  select * into _stage from public.pipeline_stages where id = new.stage_id;
  new.entered_stage_at := now();
  new.won_at := case when _stage.is_won then now() else null end;
  new.lost_at := case when _stage.is_lost then now() else null end;
  return new;
end;
$$;
drop trigger deals_before_stage_change on public.deals;
create trigger deals_before_stage_change
  before insert or update on public.deals
  for each row execute function public.deals_before_stage_change();

-- -----------------------------------------------------------------------------
-- Tasks and worker tasks: completed_at follows the status
-- -----------------------------------------------------------------------------

create or replace function public.tasks_before_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    if public.is_client_request() then
      new.completed_at := old.completed_at;
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
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger tasks_before_status_change on public.tasks;
create trigger tasks_before_status_change
  before insert or update on public.tasks
  for each row execute function public.tasks_before_status_change();

-- An open subtask under a completed parent reopens it: reopening, adding or
-- moving a subtask in.
create or replace function public.tasks_reopen_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_task_id is not null and new.status <> 'done'
     and (tg_op = 'INSERT'
          or old.status = 'done'
          or old.parent_task_id is distinct from new.parent_task_id) then
    update public.tasks
    set status = 'in_progress'
    where id = new.parent_task_id and status = 'done';
  end if;
  return new;
end;
$$;
drop trigger tasks_reopen_parent on public.tasks;
create trigger tasks_reopen_parent
  after insert or update of status, parent_task_id on public.tasks
  for each row execute function public.tasks_reopen_parent();

create or replace function public.worker_tasks_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    if public.is_client_request() then
      new.completed_at := old.completed_at;
    end if;
    return new;
  end if;
  if new.status = 'done' then
    new.completed_at := case when public.is_client_request() then now()
                             else coalesce(new.completed_at, now()) end;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger worker_tasks_completed_at on public.worker_tasks;
create trigger worker_tasks_completed_at
  before insert or update on public.worker_tasks
  for each row execute function public.worker_tasks_completed_at();

-- -----------------------------------------------------------------------------
-- Dependent questions go with the select field they depend on
-- -----------------------------------------------------------------------------

alter table public.contact_table_fields
  drop constraint contact_table_fields_depends_on_field_id_fkey,
  add constraint contact_table_fields_depends_on_field_id_fkey foreign key (depends_on_field_id, user_id)
    references public.contact_table_fields (id, user_id) on delete cascade;

revoke execute on function public.milestones_guard(), public.unlocks_guard() from public, anon;
