import type { OpsEnv } from "@/lib/ops";
import type { MilestoneInput, TaskInput } from "./schemas";
import { moveTaskFailure, type MoveTaskFailure, type MoveVia } from "./schemas";
import {
  MILESTONE_COLUMNS,
  TASK_COLUMNS,
  type Milestone,
  type Task,
  type TaskStatus,
} from "./types";

/**
 * The writes of Milestones, shared by the screens (queries.ts) and Grady's
 * tools: one place for the row, the rules the database does not stamp
 * itself, and the event. Everything goes with the caller's own client, so
 * RLS, milestones_guard, tasks_reopen_milestone and read-only mode decide.
 */

export function toMilestoneRow(input: MilestoneInput) {
  return {
    title: input.title,
    description: input.description || null,
    category: input.category,
    tag: input.tag || null,
    target_date: input.target_date,
    reward: input.reward || null,
  };
}

export function toTaskRow(input: TaskInput) {
  return {
    title: input.title,
    description: input.description || null,
    status: input.status,
    due_date: input.due_date,
  };
}

export type MilestoneWhere = "form" | "onboarding" | "import" | "grady";

/** A new milestone, last in the list. */
export async function createMilestone(
  env: OpsEnv,
  args: { workspaceId: string; input: MilestoneInput; position: number; where: MilestoneWhere },
): Promise<Milestone> {
  const { data, error } = await env.db
    .from("milestones")
    .insert({ ...toMilestoneRow(args.input), user_id: args.workspaceId, position: args.position })
    .select(MILESTONE_COLUMNS)
    .single();
  if (error) throw error;
  env.track("milestone_created", {
    where: args.where,
    category: data.category,
    has_reward: Boolean(data.reward),
    has_target_date: Boolean(data.target_date),
  });
  return data;
}

/** The position after the last milestone of the space. */
export async function nextMilestonePosition(env: OpsEnv, workspaceId: string): Promise<number> {
  const { data, error } = await env.db
    .from("milestones")
    .select("position")
    .eq("user_id", workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] ? data[0].position + 1 : 0;
}

export async function updateMilestone(
  env: OpsEnv,
  id: string,
  input: MilestoneInput,
): Promise<Milestone> {
  const { data, error } = await env.db
    .from("milestones")
    .update(toMilestoneRow(input))
    .eq("id", id)
    .select(MILESTONE_COLUMNS)
    .single();
  if (error) throw error;
  env.track("milestone_updated", { has_reward: Boolean(data.reward) });
  return data;
}

/**
 * Finishing or reopening a milestone, always on the user's word. The
 * database refuses to finish one without tasks or with open ones.
 */
export async function setMilestoneStatus(
  env: OpsEnv,
  id: string,
  status: "active" | "completed",
  /** Tasks of the milestone, for the event; read when not given. */
  taskCount?: number,
): Promise<Milestone & { template_id: string | null }> {
  const { data, error } = await env.db
    .from("milestones")
    .update({ status })
    .eq("id", id)
    .select(`${MILESTONE_COLUMNS}, template_id`)
    .single();
  if (error) throw error;
  if (data.status === "completed") {
    let count = taskCount;
    if (count === undefined) {
      const { count: total } = await env.db
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("milestone_id", id);
      count = total ?? 0;
    }
    const finished = data.completed_at ? new Date(data.completed_at) : new Date();
    env.track("milestone_completed", {
      milestone_id: data.id,
      from_template: data.template_id !== null,
      task_count: Math.min(count, 10_000),
      days_open: Math.max(
        0,
        Math.floor((finished.getTime() - new Date(data.created_at).getTime()) / 86_400_000),
      ),
      has_reward: Boolean(data.reward),
    });
  } else if (data.status === "active") {
    env.track("milestone_reopened", {});
  }
  return data;
}

export async function deleteMilestone(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("milestones").delete().eq("id", id);
  if (error) throw error;
  env.track("milestone_deleted", {});
}

/** A task (or subtask, with `parentId`) at `position` among its siblings. */
export async function createTask(
  env: OpsEnv,
  args: {
    workspaceId: string;
    milestoneId: string;
    parentId: string | null;
    input: TaskInput;
    position: number;
    /** Depth of the new task (0 = level 1), for the event. */
    depth: number;
    id?: string;
  },
): Promise<Task> {
  const { data, error } = await env.db
    .from("tasks")
    .insert({
      ...(args.id ? { id: args.id } : {}),
      ...toTaskRow(args.input),
      user_id: args.workspaceId,
      milestone_id: args.milestoneId,
      parent_task_id: args.parentId,
      position: args.position,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;
  env.track("task_created", { depth: Math.min(args.depth, 100), is_subtask: args.depth > 0 });
  return data;
}

export async function updateTask(env: OpsEnv, id: string, input: TaskInput): Promise<void> {
  const { error } = await env.db.from("tasks").update(toTaskRow(input)).eq("id", id);
  if (error) throw error;
  env.track("task_updated", {});
}

/**
 * Ticks or unticks a task. A task with open subtasks can not be ticked
 * (the database refuses too); unticking a subtask of a done task reopens it.
 */
export async function setTaskStatus(
  env: OpsEnv,
  args: {
    id: string;
    status: TaskStatus;
    previous: TaskStatus | null;
    depth: number;
    where: "milestone" | "dashboard";
  },
): Promise<void> {
  const { error } = await env.db.from("tasks").update({ status: args.status }).eq("id", args.id);
  if (error) throw error;
  if (args.status === "done" && args.previous !== "done") {
    env.track("task_completed", {
      depth: Math.min(args.depth, 100),
      is_subtask: args.depth > 0,
      where: args.where,
    });
  } else if (args.status !== "done" && args.previous === "done") {
    env.track("task_reopened", { where: args.where });
  }
}

/** Subtasks go with their task (cascade in the database). */
export async function deleteTask(env: OpsEnv, id: string, removed: number): Promise<void> {
  const { error } = await env.db.from("tasks").delete().eq("id", id);
  if (error) throw error;
  env.track("task_deleted", { removed: Math.min(removed, 10_000) });
}

export type MoveTaskArgs = {
  taskId: string;
  parentId: string | null;
  position: number;
  via: MoveVia;
  depth: number;
  levelChanged: boolean;
};

/**
 * Moves a task with everything below it: one call of move_task() (one
 * transaction; cycle and depth checked by the database).
 */
export async function moveTask(
  env: OpsEnv,
  args: MoveTaskArgs,
): Promise<{ ok: true } | { ok: false; error: MoveTaskFailure }> {
  const { error } = await env.db.rpc("move_task", {
    _task_id: args.taskId,
    // The generated type does not know that null (level 1) is allowed.
    _parent_id: args.parentId as string,
    _position: args.position,
  });
  if (error) {
    const failure = moveTaskFailure(error);
    if (failure === "unknown") console.error("move_task failed", error.code);
    return { ok: false, error: failure };
  }
  env.track("task_moved", {
    via: args.via,
    depth: Math.min(args.depth, 100),
    level_changed: args.levelChanged,
  });
  return { ok: true };
}
