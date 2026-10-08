import type { Milestone, MilestoneWithCounts, Task, TaskStatus } from "./types";

export type TaskNode = { task: Task; children: TaskNode[] };

/** Groups tasks under their parents; siblings keep the order they arrive in (by position). */
export function buildTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>(tasks.map((task) => [task.id, { task, children: [] }]));
  const roots: TaskNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.task.parent_task_id && nodes.get(node.task.parent_task_id);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Progress is the share of done tasks among ALL tasks of the milestone, subtasks included. */
export function progressOf(counts: { total: number; done: number }): number {
  return counts.total > 0 ? counts.done / counts.total : 0;
}

export function countTasks(tasks: Task[]) {
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.status === "done").length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
  };
}

export type MilestoneCompletion =
  | { kind: "completed" }
  | { kind: "empty" }
  | { kind: "locked"; remaining: number }
  | { kind: "ready" };

/**
 * Whether the milestone can be completed. Mirrors milestones_guard: at least one
 * task and every task done. Even then it waits for the user; nothing completes it.
 */
export function milestoneCompletion(
  status: Milestone["status"],
  counts: { total: number; done: number },
): MilestoneCompletion {
  if (status === "completed") return { kind: "completed" };
  if (counts.total === 0) return { kind: "empty" };
  if (counts.done < counts.total) return { kind: "locked", remaining: counts.total - counts.done };
  return { kind: "ready" };
}

/** A task that is not done sends a completed milestone back to active (tasks_reopen_milestone). */
export function reopenedMilestone<M extends Pick<Milestone, "status" | "completed_at">>(
  milestone: M,
  tasks: Pick<Task, "status">[],
): M {
  if (milestone.status !== "completed" || tasks.every((task) => task.status === "done")) {
    return milestone;
  }
  return { ...milestone, status: "active", completed_at: null };
}

/** How many direct subtasks are still open. While it is above zero the task cannot be ticked. */
export function openSubtasks(tasks: Task[], taskId: string): number {
  return tasks.filter((task) => task.parent_task_id === taskId && task.status !== "done").length;
}

export type StatusChange = { tasks: Task[]; error?: "openSubtasks" };

/**
 * Mirrors the database rules for instant feedback; the database stays the authority.
 * - a task with open subtasks cannot be completed
 * - completing it is always a manual act (this never completes anything else)
 * - reopening a task under a completed parent sends that parent (and its completed
 *   ancestors) back to in progress
 */
export function applyStatusChange(
  tasks: Task[],
  taskId: string,
  status: TaskStatus,
  now: Date = new Date(),
): StatusChange {
  const target = tasks.find((task) => task.id === taskId);
  if (!target || target.status === status) return { tasks };
  if (status === "done" && openSubtasks(tasks, taskId) > 0) {
    return { tasks, error: "openSubtasks" };
  }

  const changed = new Map<string, Partial<Task>>();
  changed.set(taskId, { status, completed_at: status === "done" ? now.toISOString() : null });

  if (target.status === "done") {
    let parentId = target.parent_task_id;
    while (parentId) {
      const parent = tasks.find((task) => task.id === parentId);
      if (!parent || parent.status !== "done") break;
      changed.set(parent.id, { status: "in_progress", completed_at: null });
      parentId = parent.parent_task_id;
    }
  }

  return { tasks: tasks.map((task) => ({ ...task, ...changed.get(task.id) })) };
}

/** A new open subtask reopens a completed parent, exactly like a reopened one. */
export function reopenAncestors(tasks: Task[], taskId: string): Task[] {
  const target = tasks.find((task) => task.id === taskId);
  if (!target || target.status === "done" || !target.parent_task_id) return tasks;
  const changed = new Set<string>();
  let parentId: string | null = target.parent_task_id;
  while (parentId) {
    const parent = tasks.find((task) => task.id === parentId);
    if (!parent || parent.status !== "done") break;
    changed.add(parent.id);
    parentId = parent.parent_task_id;
  }
  return tasks.map((task) =>
    changed.has(task.id) ? { ...task, status: "in_progress", completed_at: null } : task,
  );
}

/** The task and everything below it. */
export function subtreeIds(tasks: Task[], taskId: string): Set<string> {
  const ids = new Set([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parent_task_id && ids.has(task.parent_task_id) && !ids.has(task.id)) {
        ids.add(task.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function nextPosition(tasks: Task[], parentId: string | null): number {
  const siblings = tasks.filter((task) => task.parent_task_id === parentId);
  return siblings.length ? Math.max(...siblings.map((task) => task.position)) + 1 : 0;
}

export type PositionChange = { id: string; position: number };

/** Moves one sibling next to another; returns the new list and only the positions that changed. */
export function reorderSiblings(
  tasks: Task[],
  activeId: string,
  overId: string,
): { tasks: Task[]; changes: PositionChange[] } {
  const active = tasks.find((task) => task.id === activeId);
  const over = tasks.find((task) => task.id === overId);
  if (!active || !over || active.parent_task_id !== over.parent_task_id || activeId === overId) {
    return { tasks, changes: [] };
  }

  const siblings = tasks
    .filter((task) => task.parent_task_id === active.parent_task_id)
    .sort((a, b) => a.position - b.position);
  const from = siblings.findIndex((task) => task.id === activeId);
  const to = siblings.findIndex((task) => task.id === overId);
  siblings.splice(to, 0, siblings.splice(from, 1)[0]);

  const positions = new Map(siblings.map((task, index) => [task.id, index]));
  const changes = siblings
    .filter((task, index) => task.position !== index)
    .map((task) => ({ id: task.id, position: positions.get(task.id)! }));
  return {
    tasks: tasks
      .map((task) =>
        positions.has(task.id) ? { ...task, position: positions.get(task.id)! } : task,
      )
      .sort((a, b) => a.position - b.position),
    changes,
  };
}

/** Open milestones first by nearest target date (undated last), finished ones dimmed at the end. */
export function sortMilestones(milestones: MilestoneWithCounts[]): MilestoneWithCounts[] {
  const open = (m: MilestoneWithCounts) => (m.status === "completed" ? 1 : 0);
  return [...milestones].sort((a, b) => {
    if (open(a) !== open(b)) return open(a) - open(b);
    if (a.status === "completed") {
      return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
    }
    if (a.target_date !== b.target_date) {
      if (!a.target_date) return 1;
      if (!b.target_date) return -1;
      return a.target_date.localeCompare(b.target_date);
    }
    return a.position - b.position || a.created_at.localeCompare(b.created_at);
  });
}

/** How deep a task sits: 0 for a top-level task, 1 for its subtask and so on. */
export function taskDepth(tasks: Pick<Task, "id" | "parent_task_id">[], taskId: string): number {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let depth = 0;
  let parent = byId.get(taskId)?.parent_task_id ?? null;
  // The guard stops a broken cycle from looping forever.
  while (parent && depth < 100) {
    depth += 1;
    parent = byId.get(parent)?.parent_task_id ?? null;
  }
  return depth;
}
