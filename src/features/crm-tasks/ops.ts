import type { OpsEnv } from "@/lib/ops";
import { delayMinutes, type TaskInput } from "./logic";
import type { CrmTask, TaskOrigin } from "./types";

/**
 * The writes of sales tasks, shared by the screens (queries.ts) and Grady's
 * tools. crm_tasks_guard stamps who made and finished a task, checks the
 * assignee and the deal / contact of the same space; the permission guard
 * decides what a worker may change.
 */

export function toCrmTaskRow(input: TaskInput) {
  return {
    title: input.title,
    description: input.description || null,
    due_at: input.due_at,
    duration_minutes: input.duration_minutes,
    assignee_id: input.assignee_id,
    deal_id: input.deal_id,
    contact_id: input.contact_id,
  };
}

/** A new open task; without an assignee it is the creator's own. */
export async function createCrmTask(
  env: OpsEnv,
  args: { workspaceId: string; userId: string; input: TaskInput; from: TaskOrigin | "grady" },
): Promise<{ id: string }> {
  const assignee = args.input.assignee_id ?? args.userId;
  const { data, error } = await env.db
    .from("crm_tasks")
    .insert({ ...toCrmTaskRow(args.input), assignee_id: assignee, user_id: args.workspaceId })
    .select("id")
    .single();
  if (error) throw error;
  env.track("crm_task_created", {
    from: args.from,
    duration: args.input.duration_minutes,
    assigned_to_other: assignee !== args.userId,
    has_deal: args.input.deal_id !== null,
    has_contact: args.input.contact_id !== null,
  });
  return data;
}

export async function updateCrmTask(
  env: OpsEnv,
  id: string,
  patch: Partial<ReturnType<typeof toCrmTaskRow>>,
  via: "form" | "calendar",
): Promise<void> {
  const { error } = await env.db.from("crm_tasks").update(patch).eq("id", id);
  if (error) throw error;
  env.track("crm_task_updated", { via });
}

/** Done, with the note written in the same step (or none). */
export async function completeCrmTask(
  env: OpsEnv,
  task: Pick<CrmTask, "id" | "due_at" | "duration_minutes">,
  note: string,
): Promise<void> {
  const clean = note.trim();
  const { error } = await env.db
    .from("crm_tasks")
    .update({ status: "done", completion_note: clean || null })
    .eq("id", task.id);
  if (error) throw error;
  env.track("crm_task_completed", {
    duration: task.duration_minutes,
    delay_minutes: delayMinutes(task.due_at, new Date()),
    has_note: clean.length > 0,
  });
}

/** Back to open; the database clears the finish and its note. */
export async function reopenCrmTask(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("crm_tasks").update({ status: "open" }).eq("id", id);
  if (error) throw error;
  env.track("crm_task_reopened", {});
}

export async function deleteCrmTask(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("crm_tasks").delete().eq("id", id);
  if (error) throw error;
  env.track("crm_task_deleted", {});
}
