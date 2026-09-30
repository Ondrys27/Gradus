-- =============================================================================
-- Milestone completion and reward
--   * a milestone can be completed only when it has at least one task and every
--     task (subtasks of any depth included) is done; the check is here, not
--     only behind the locked button
--   * a task that is not done (reopened, or a new open one) sends a completed
--     milestone back to active; it never completes a milestone by itself
--   * milestones.reward: an optional short text the user promises themselves,
--     shown on the card and in the celebration
-- =============================================================================

alter table public.milestones
  add column reward text
    constraint milestones_reward_length check (reward is null or char_length(reward) between 1 and 120);

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

  -- Completing is allowed only with at least one task, all of them done.
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    if tg_op = 'INSERT' or not exists (
      select 1 from public.tasks where milestone_id = new.id
    ) then
      raise exception 'milestone_has_no_tasks' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.tasks where milestone_id = new.id and status <> 'done'
    ) then
      raise exception 'milestone_has_open_tasks' using errcode = 'check_violation';
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

-- A task that is not done reopens its completed milestone: unticking one, or
-- adding a new open one. Runs with the caller's rights, so RLS still applies.
create or replace function public.tasks_reopen_milestone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'done' and (tg_op = 'INSERT' or old.status = 'done') then
    update public.milestones
    set status = 'active'
    where id = new.milestone_id and status = 'completed';
  end if;
  return new;
end;
$$;
create trigger tasks_reopen_milestone
  after insert or update of status on public.tasks
  for each row execute function public.tasks_reopen_milestone();

revoke execute on function public.tasks_reopen_milestone() from public, anon;
