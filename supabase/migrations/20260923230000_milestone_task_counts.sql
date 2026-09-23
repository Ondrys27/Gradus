-- =============================================================================
-- Milestone progress is computed at read time, never stored.
-- The view counts every task of a milestone (subtasks of any depth included) and
-- runs with the caller's rights, so RLS on `tasks` decides which rows count.
-- =============================================================================

create view public.milestone_task_counts
with (security_invoker = true) as
select
  milestone_id,
  count(*)::int as total,
  (count(*) filter (where status = 'done'))::int as done
from public.tasks
group by milestone_id;

revoke all on public.milestone_task_counts from public, anon;
grant select on public.milestone_task_counts to authenticated, service_role;
