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
  while (parent && depth < MAX_TASK_LEVELS) {
    depth += 1;
    parent = byId.get(parent)?.parent_task_id ?? null;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Moving tasks: the map, the list and the keyboard all end in move_task() in
// the database, which follows the same rules and has the last word.
// ---------------------------------------------------------------------------

/**
 * How many levels the tasks of a milestone may have; a top-level task is on
 * level 1. Tasks nest to any depth in practice, the limit only keeps a tree
 * finite. The database (tasks_tree_guard) holds the same number.
 */
export const MAX_TASK_LEVELS = 100;

/** Where a task goes: under a parent (null = the milestone itself), at an index among its new siblings. */
export type MoveTarget = { parentId: string | null; index: number };

export type MoveError = "notFound" | "cycle" | "tooDeep";

export type MovePlan =
  | {
      ok: true;
      /** False when the task would land where it already is. */
      changed: boolean;
      tasks: Task[];
      /** Where the task was, for undo. */
      from: MoveTarget;
    }
  | { ok: false; error: MoveError };

/** Direct children of a parent (null = top level) in their order. */
export function siblingsOf<T extends Pick<Task, "parent_task_id" | "position">>(
  tasks: T[],
  parentId: string | null,
): T[] {
  // A stable sort keeps the database's tie-break (created_at) for equal positions.
  return tasks
    .filter((task) => task.parent_task_id === parentId)
    .sort((a, b) => a.position - b.position);
}

/** How many levels reach below a task: 0 for a task without subtasks. */
export function subtreeHeight(
  tasks: Pick<Task, "id" | "parent_task_id">[],
  taskId: string,
): number {
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const list = children.get(task.parent_task_id) ?? [];
    list.push(task.id);
    children.set(task.parent_task_id, list);
  }
  let height = 0;
  let level = [taskId];
  const seen = new Set(level);
  while (level.length > 0 && height <= MAX_TASK_LEVELS) {
    const next = level.flatMap((id) => children.get(id) ?? []).filter((id) => !seen.has(id));
    if (next.length === 0) break;
    next.forEach((id) => seen.add(id));
    height += 1;
    level = next;
  }
  return height;
}

/**
 * Moves a task, with everything below it, under a new parent at an index
 * among its new siblings, as move_task() does: positions of the new and the old
 * siblings are renumbered from 0, a task never goes under itself or its own
 * subtask, the tree stays within `maxLevels`, and an open task under a done
 * parent reopens it and its done ancestors. Nothing is ever completed by a move.
 */
export function planMove(
  tasks: Task[],
  taskId: string,
  target: MoveTarget,
  maxLevels: number = MAX_TASK_LEVELS,
): MovePlan {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return { ok: false, error: "notFound" };
  const { parentId } = target;
  if (parentId !== null) {
    const parent = tasks.find((item) => item.id === parentId);
    if (!parent || parent.milestone_id !== task.milestone_id)
      return { ok: false, error: "notFound" };
    if (subtreeIds(tasks, taskId).has(parentId)) return { ok: false, error: "cycle" };
  }
  const level = parentId === null ? 1 : taskDepth(tasks, parentId) + 2;
  if (level + subtreeHeight(tasks, taskId) > maxLevels) return { ok: false, error: "tooDeep" };

  const oldSiblings = siblingsOf(tasks, task.parent_task_id);
  const from: MoveTarget = {
    parentId: task.parent_task_id,
    index: oldSiblings.findIndex((item) => item.id === taskId),
  };
  const siblings = siblingsOf(tasks, parentId).filter((item) => item.id !== taskId);
  const index = Math.min(Math.max(Math.trunc(target.index) || 0, 0), siblings.length);
  if (parentId === task.parent_task_id && index === from.index) {
    return { ok: true, changed: false, tasks, from };
  }

  const positions = new Map<string, number>();
  siblings.splice(index, 0, task);
  siblings.forEach((item, position) => positions.set(item.id, position));
  if (parentId !== task.parent_task_id) {
    oldSiblings
      .filter((item) => item.id !== taskId)
      .forEach((item, position) => positions.set(item.id, position));
  }

  const moved = tasks.map((item) => {
    const position = positions.get(item.id);
    if (item.id === taskId) return { ...item, parent_task_id: parentId, position: position! };
    return position === undefined || position === item.position ? item : { ...item, position };
  });
  return {
    ok: true,
    changed: true,
    tasks: reopenAncestors(moved, taskId).sort((a, b) => a.position - b.position),
    from,
  };
}

export type MoveDirection = "up" | "down" | "left" | "right";

/**
 * ⌘/Ctrl + arrows on a selected task: ↑/↓ swap it with the sibling above or
 * below, ← makes it a sibling of its parent (right after it), → a subtask of
 * the sibling above (at the end). Null when there is nowhere to go.
 */
export function keyboardTarget(
  tasks: Task[],
  taskId: string,
  direction: MoveDirection,
): MoveTarget | null {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return null;
  const siblings = siblingsOf(tasks, task.parent_task_id);
  const index = siblings.findIndex((item) => item.id === taskId);
  switch (direction) {
    case "up":
      return index > 0 ? { parentId: task.parent_task_id, index: index - 1 } : null;
    case "down":
      return index < siblings.length - 1
        ? { parentId: task.parent_task_id, index: index + 1 }
        : null;
    case "left": {
      const parent = tasks.find((item) => item.id === task.parent_task_id);
      if (!parent) return null;
      const parentIndex = siblingsOf(tasks, parent.parent_task_id).findIndex(
        (item) => item.id === parent.id,
      );
      return { parentId: parent.parent_task_id, index: parentIndex + 1 };
    }
    case "right": {
      const above = siblings[index - 1];
      return above ? { parentId: above.id, index: siblingsOf(tasks, above.id).length } : null;
    }
  }
}

/** One visible row of the list. */
export type FlatTask = {
  task: Task;
  /** 0 for a top-level task. */
  depth: number;
  parentId: string | null;
  childCount: number;
  /** Has subtasks that are not shown. */
  collapsed: boolean;
};

/** The tree as visible rows, top to bottom; nothing below a collapsed task. */
export function flattenTree(nodes: TaskNode[], collapsed: ReadonlySet<string>): FlatTask[] {
  const rows: FlatTask[] = [];
  const walk = (list: TaskNode[], depth: number) => {
    for (const node of list) {
      const hidden = collapsed.has(node.task.id) && node.children.length > 0;
      rows.push({
        task: node.task,
        depth,
        parentId: node.task.parent_task_id,
        childCount: node.children.length,
        collapsed: hidden,
      });
      if (!hidden) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}

/** A visible row of the list with where it is drawn: px from the top of the list. */
export type ListRowBox = FlatTask & { top: number; height: number };

/**
 * Where a task dragged in the list would land: under a row (the middle of a
 * row, like a drop on a node of the map) or at a line between rows, drawn
 * `y` px from the top of the list and indented to `depth`. `valid` says
 * whether the move keeps the rules (planMove); a drop that does not is refused.
 */
export type ListDrop =
  | { kind: "inside"; overId: string; depth: number; target: MoveTarget; valid: boolean }
  | { kind: "line"; y: number; depth: number; target: MoveTarget; valid: boolean };

/** The share of a row at its top and its bottom that means "next to it"; the rest means "under it". */
export const LIST_DROP_EDGE = 0.3;

/** How far above the first or below the last row a drop still counts, px. */
export const LIST_DROP_REACH = 48;

/** Whole levels from a sideways drag: a level as soon as it passes half an indent, either way. */
export function levelsFromOffset(offsetX: number, indent: number): number {
  if (!(indent > 0) || !Number.isFinite(offsetX)) return 0;
  const levels = Math.floor(Math.abs(offsetX) / indent + 0.5);
  return offsetX < 0 && levels > 0 ? -levels : levels;
}

/**
 * The drop under the pointer while a task is dragged in the list. `rows` are
 * the visible rows top to bottom, the dragged one included and nothing below it
 * (its subtree travels with it). The pointer is `y` px from the top of the list
 * and `offsetX` px sideways from where the drag started.
 *
 * - the middle of a row: the task becomes its last subtask, collapsed or not;
 * - the top or the bottom edge of a row, or the dragged row itself: a line
 *   between the rows; the vertical place picks the gap, the sideways drag the
 *   level (from the task's own level, a level per indent with a threshold of
 *   half an indent), kept between the row below and one deeper than the row
 *   above, so it can go several levels at once. The parent is the nearest row
 *   above on the level just above, the index counts its subtasks above the line.
 */
export function listDropAt(
  tasks: Task[],
  rows: ListRowBox[],
  activeId: string,
  pointer: { y: number; offsetX: number },
  indent: number,
  maxLevels: number = MAX_TASK_LEVELS,
): ListDrop | null {
  const activeIndex = rows.findIndex((row) => row.task.id === activeId);
  if (activeIndex < 0) return null;
  const active = rows[activeIndex];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const { y } = pointer;
  if (y < first.top - LIST_DROP_REACH || y > last.top + last.height + LIST_DROP_REACH) {
    return null;
  }
  const valid = (target: MoveTarget) => planMove(tasks, activeId, target, maxLevels).ok;

  // The gap among the other rows: gap k sits right above others[k].
  const others = rows.filter((_, index) => index !== activeIndex);
  let gap: number;
  const index = rows.findIndex((row) => y < row.top + row.height);
  if (index < 0) gap = others.length;
  else if (index === activeIndex) gap = activeIndex;
  else {
    const row = rows[index];
    const share = row.height > 0 ? (y - row.top) / row.height : 0.5;
    const before = index < activeIndex ? index : index - 1;
    if (share < LIST_DROP_EDGE) gap = before;
    else if (share > 1 - LIST_DROP_EDGE) gap = before + 1;
    else {
      const target = {
        parentId: row.task.id,
        index: tasks.filter((task) => task.parent_task_id === row.task.id && task.id !== activeId)
          .length,
      };
      return {
        kind: "inside",
        overId: row.task.id,
        depth: row.depth + 1,
        target,
        valid: valid(target),
      };
    }
  }

  const above = others[gap - 1];
  const below = others[gap];
  const deepest = above ? above.depth + 1 : 0;
  const shallowest = below ? Math.min(below.depth, deepest) : 0;
  const wanted = active.depth + levelsFromOffset(pointer.offsetX, indent);
  const depth = Math.min(Math.max(wanted, shallowest), deepest);

  let parent: ListRowBox | undefined;
  if (depth > 0) {
    for (let row = gap - 1; row >= 0 && !parent; row -= 1) {
      if (others[row].depth === depth - 1) parent = others[row];
    }
  }
  const parentId = parent?.task.id ?? null;
  // Under a collapsed task it goes after the subtasks that are not shown.
  const at = parent?.collapsed
    ? parent.childCount
    : others.slice(0, gap).filter((row) => row.parentId === parentId).length;
  const target = { parentId, index: at };

  // Between two rows; on the dragged row itself, across its middle.
  const lineY =
    gap === activeIndex
      ? active.top + active.height / 2
      : above
        ? above.top + above.height
        : (below?.top ?? 0);
  return { kind: "line", y: lineY, depth, target, valid: valid(target) };
}

/** Where a node dragged in the map is over another node. */
export type MapDropZone = "before" | "inside" | "after";

/** The upper and the lower quarter of a node put the task next to it, the middle under it. */
export function mapDropZone(rect: { top: number; height: number }, y: number): MapDropZone {
  const share = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  if (share < 0.25) return "before";
  if (share > 0.75) return "after";
  return "inside";
}

/**
 * The target of a drop in the map: on the milestone (`overId` null) = level 1
 * at the end, inside a task = its last subtask, before or after a task = its
 * sibling right there.
 */
export function mapDropTarget(
  tasks: Task[],
  activeId: string,
  overId: string | null,
  zone: MapDropZone,
): MoveTarget | null {
  const others = (parentId: string | null) =>
    siblingsOf(tasks, parentId).filter((task) => task.id !== activeId);
  if (overId === null) return { parentId: null, index: others(null).length };
  const over = tasks.find((task) => task.id === overId);
  if (!over || overId === activeId) return null;
  if (zone === "inside") return { parentId: overId, index: others(overId).length };
  const index = others(over.parent_task_id).findIndex((task) => task.id === overId);
  return { parentId: over.parent_task_id, index: zone === "before" ? index : index + 1 };
}
