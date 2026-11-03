import { describe, expect, it } from "vitest";
import {
  buildTree,
  flattenTree,
  keyboardTarget,
  listDropAt,
  mapDropTarget,
  planMove,
  siblingsOf,
  subtreeIds,
  type ListRowBox,
  type MapDropZone,
  type MoveError,
  type MoveTarget,
} from "./task-tree";
import type { Task, TaskStatus } from "./types";

/**
 * Property tests (K18): random trees and random moves through the list, the
 * map and the keyboard. Every path must end in the same tree, and that tree
 * must be the one move_task() + tasks_tree_guard + tasks_reopen_parent build
 * in the database (modelled below from 20261101090000_move_task.sql).
 */

/** mulberry32: small, seeded, deterministic. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof prng>;

/** A database row: the task plus created_at, the tie-break of equal positions. */
type Row = Task & { created: number };

// ---------------------------------------------------------------------------
// The database, as the migration writes it
// ---------------------------------------------------------------------------

type DbError = "task_move_cycle" | "task_too_deep" | "task_parent_invalid" | "task_not_found";

const DB_ERROR: Record<DbError, MoveError> = {
  task_move_cycle: "cycle",
  task_too_deep: "tooDeep",
  task_parent_invalid: "notFound",
  task_not_found: "notFound",
};

/** order by t.position, t.created_at, t.id */
const dbOrder = (a: Row, b: Row) =>
  a.position - b.position || a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dbChildren(rows: Row[], parentId: string | null, milestone: string): Row[] {
  return rows
    .filter((row) => row.milestone_id === milestone && row.parent_task_id === parentId)
    .sort(dbOrder);
}

/** tasks_tree_guard for an UPDATE of parent_task_id. */
function dbGuard(rows: Row[], taskId: string, parentId: string, limit: number): DbError | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let cursor: string | null = parentId;
  let depth = 0;
  while (cursor !== null) {
    if (cursor === taskId) return "task_move_cycle";
    depth += 1;
    if (depth > limit) return "task_too_deep";
    cursor = byId.get(cursor)?.parent_task_id ?? null;
  }
  let height = 0;
  let level = [taskId];
  while (level.length > 0 && height <= limit) {
    const next = rows.filter((row) => row.parent_task_id && level.includes(row.parent_task_id));
    if (next.length === 0) break;
    height += 1;
    level = next.map((row) => row.id);
  }
  return depth + 1 + height > limit ? "task_too_deep" : null;
}

/** tasks_reopen_parent, cascading through the parent's own update. */
function dbReopen(rows: Row[], taskId: string): Row[] {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));
  let child = byId.get(taskId)!;
  while (child.parent_task_id && child.status !== "done") {
    const parent = byId.get(child.parent_task_id)!;
    if (parent.status !== "done") break;
    parent.status = "in_progress";
    parent.completed_at = null;
    child = parent;
  }
  return rows.map((row) => byId.get(row.id)!);
}

function dbMoveTask(
  input: Row[],
  taskId: string,
  parentId: string | null,
  position: number,
  limit: number,
): { ok: true; rows: Row[] } | { ok: false; error: DbError } {
  let rows = input.map((row) => ({ ...row }));
  const task = rows.find((row) => row.id === taskId);
  if (!task) return { ok: false, error: "task_not_found" };
  const oldParent = task.parent_task_id;
  if (parentId !== null) {
    const parent = rows.find((row) => row.id === parentId);
    if (!parent || parent.milestone_id !== task.milestone_id) {
      return { ok: false, error: "task_parent_invalid" };
    }
  }
  const siblings = dbChildren(rows, parentId, task.milestone_id)
    .filter((row) => row.id !== taskId)
    .map((row) => row.id);
  const index = Math.min(Math.max(position, 0), siblings.length);
  siblings.splice(index, 0, taskId);

  if (oldParent !== parentId) {
    if (parentId !== null) {
      const error = dbGuard(rows, taskId, parentId, limit);
      if (error) return { ok: false, error };
    }
    task.parent_task_id = parentId;
    rows = dbReopen(rows, taskId);
  }
  const at = new Map(siblings.map((id, ord) => [id, ord]));
  rows = rows.map((row) => (at.has(row.id) ? { ...row, position: at.get(row.id)! } : row));
  if (oldParent !== parentId) {
    const left = dbChildren(rows, oldParent, task.milestone_id).map((row) => row.id);
    const gap = new Map(left.map((id, ord) => [id, ord]));
    rows = rows.map((row) => (gap.has(row.id) ? { ...row, position: gap.get(row.id)! } : row));
  }
  return { ok: true, rows };
}

/** What useTasks reads back: order by position, created_at. */
const readBack = (rows: Row[]): Task[] =>
  [...rows].sort(dbOrder).map((row) => {
    const task: Task & { created?: number } = { ...row };
    delete task.created;
    return task;
  });

// ---------------------------------------------------------------------------
// Random trees
// ---------------------------------------------------------------------------

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

/** A random tree of 1–14 tasks; positions with gaps and ties, statuses that keep the rules. */
function randomRows(rng: Rng, maxLevels: number): Row[] {
  const count = rng.int(1, 14);
  const rows: Row[] = [];
  for (let n = 0; n < count; n += 1) {
    const depthOf = (id: string | null): number => {
      let depth = 0;
      for (let at = id; at; at = rows.find((row) => row.id === at)!.parent_task_id) depth += 1;
      return depth;
    };
    const candidates = [null, ...rows.map((row) => row.id)].filter((id) => depthOf(id) < maxLevels);
    const parent = rng.chance(0.3) ? null : rng.pick(candidates);
    rows.push({
      id: `t${n}`,
      milestone_id: "m",
      parent_task_id: parent,
      title: `t${n}`,
      description: null,
      status: rng.pick(STATUSES),
      position: rng.int(0, 6),
      due_date: null,
      completed_at: null,
      created: rng.int(0, 1000) * 100 + n,
    });
  }
  // A done task has only done subtasks (the database refuses anything else).
  const done = (id: string): boolean =>
    rows.every((row) => row.parent_task_id !== id || (row.status === "done" && done(row.id)));
  for (const row of rows) if (row.status === "done" && !done(row.id)) row.status = "in_progress";
  return rows;
}

/** The tree as parent → children in order, with statuses: what both views draw. */
function shape(tasks: Pick<Task, "id" | "parent_task_id" | "position" | "status">[]) {
  const ids = [null, ...tasks.map((task) => task.id)];
  return Object.fromEntries(
    ids.map((id) => [
      id ?? "∅",
      siblingsOf(tasks as Task[], id).map((task) => `${task.id}:${task.position}:${task.status}`),
    ]),
  );
}

// ---------------------------------------------------------------------------
// The list: boxes of visible rows and every pointer that means something
// ---------------------------------------------------------------------------

const INDENT = 28;

function listBoxes(tasks: Task[], collapsed: Set<string>, activeId: string, rng: Rng) {
  const hidden = new Set(collapsed);
  hidden.add(activeId);
  let top = 0;
  return flattenTree(buildTree(tasks), hidden).map((row): ListRowBox => {
    const height = rng.int(40, 72);
    const box = { ...row, top, height };
    top += height;
    return box;
  });
}

/** The tops, edges and middles of every row, plus above and below the list. */
function listPointers(boxes: ListRowBox[]) {
  const ys = [boxes[0].top - 20];
  for (const box of boxes) {
    ys.push(box.top + 1, box.top + box.height * 0.15, box.top + box.height / 2);
    ys.push(box.top + box.height * 0.85, box.top + box.height - 1);
  }
  const last = boxes[boxes.length - 1];
  ys.push(last.top + last.height + 20);
  const offsets = Array.from({ length: 11 }, (_, n) => (n - 5) * INDENT);
  return ys.flatMap((y) => offsets.map((offsetX) => ({ y, offsetX })));
}

/** Parents and the order of their subtasks, without positions. */
const order = (list: Task[]) =>
  Object.fromEntries(
    [null, ...list.map((t) => t.id)].map((id) => [
      id ?? "∅",
      siblingsOf(list, id)
        .map((t) => t.id)
        .join(","),
    ]),
  );

const targetKey = (target: MoveTarget) => `${target.parentId ?? "∅"}#${target.index}`;

function uniqueTargets(targets: MoveTarget[]): MoveTarget[] {
  return [...new Map(targets.map((target) => [targetKey(target), target])).values()];
}

/** The tree after a move the client accepts and then confirms with the database. */
function moveBoth(rows: Row[], tasks: Task[], taskId: string, target: MoveTarget, limit: number) {
  const plan = planMove(tasks, taskId, target, limit);
  const db = dbMoveTask(rows, taskId, target.parentId, target.index, limit);
  if (!plan.ok) {
    // The client refuses exactly what the database refuses, for the same reason.
    expect(db.ok).toBe(false);
    if (!db.ok) expect(DB_ERROR[db.error]).toBe(plan.error);
    return null;
  }
  expect(db.ok, `${taskId} → ${JSON.stringify(target)}`).toBe(true);
  if (!db.ok) return null;
  if (!plan.changed) {
    // Nothing is sent; the database would keep the same tree (at most closing gaps).
    expect(order(readBack(db.rows))).toEqual(order(tasks));
    return { rows, tasks, plan };
  }
  // The optimistic cache equals what the database writes and the list reads back.
  expect(shape(plan.tasks)).toEqual(shape(readBack(db.rows)));
  return { rows: db.rows, tasks: readBack(db.rows), plan };
}

const SEEDS = Array.from({ length: 60 }, (_, n) => n * 7919 + 17);

describe("task moves · property", () => {
  it("planMove builds the tree move_task() builds, and refuses what it refuses", () => {
    for (const seed of SEEDS) {
      const rng = prng(seed);
      const limit = rng.pick([3, 4, 100]);
      let rows = randomRows(rng, limit);
      let tasks = readBack(rows);
      for (let step = 0; step < 25; step += 1) {
        const task = rng.pick(tasks);
        const parentId = rng.chance(0.2) ? null : rng.pick(tasks).id;
        const index = rng.int(-1, siblingsOf(tasks, parentId).length + 1);
        const result = moveBoth(rows, tasks, task.id, { parentId, index }, limit);
        if (result) ({ rows, tasks } = result);
      }
    }
  });

  it("a drop in the list and a drop in the map give the same tree", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const rng = prng(seed + 1);
      const limit = rng.pick([3, 5, 100]);
      let rows = randomRows(rng, limit);
      let tasks = readBack(rows);
      for (let step = 0; step < 12; step += 1) {
        const active = rng.pick(tasks);
        const others = tasks.filter((task) => task.id !== active.id);

        // Every drop the map can make for this task.
        const zones: MapDropZone[] = ["before", "inside", "after"];
        const mapTargets = [
          mapDropTarget(tasks, active.id, null, "inside"),
          ...others.flatMap((over) =>
            zones.map((z) => mapDropTarget(tasks, active.id, over.id, z)),
          ),
        ].filter((target): target is MoveTarget => target !== null);

        // Every drop the list can make, with the tree fully open.
        const boxes = listBoxes(tasks, new Set(), active.id, rng);
        const listDrops = listPointers(boxes)
          .map((pointer) => listDropAt(tasks, boxes, active.id, pointer, INDENT, limit))
          .filter((drop) => drop !== null);

        // The list marks a drop valid exactly when the rules (and the database) allow it.
        const listTargets = uniqueTargets(listDrops.map((drop) => drop.target));
        const validity = new Map(listDrops.map((drop) => [targetKey(drop.target), drop.valid]));
        for (const target of listTargets) {
          expect(validity.get(targetKey(target))).toBe(
            planMove(tasks, active.id, target, limit).ok,
          );
        }

        // Both views end in the same tree for the same place, the one the database builds.
        const treeOf = new Map<string, string>();
        for (const target of uniqueTargets([...mapTargets, ...listTargets])) {
          const result = moveBoth(rows, tasks, active.id, target, limit);
          if (result) treeOf.set(targetKey(target), JSON.stringify(order(result.tasks)));
        }
        const listTrees = new Set(listTargets.flatMap((t) => treeOf.get(targetKey(t)) ?? []));
        const mapTrees = new Set(mapTargets.flatMap((t) => treeOf.get(targetKey(t)) ?? []));

        // Each place the map can reach the list reaches too, and the other way round.
        for (const target of mapTargets) {
          const tree = treeOf.get(targetKey(target));
          if (tree) {
            expect(
              listTrees.has(tree),
              `map ${active.id} → ${targetKey(target)} not in the list`,
            ).toBe(true);
          }
        }
        for (const target of listTargets) {
          const tree = treeOf.get(targetKey(target));
          if (tree) {
            expect(
              mapTrees.has(tree),
              `list ${active.id} → ${targetKey(target)} not in the map`,
            ).toBe(true);
          }
        }

        // Carry on from a random valid drop, alternately from the list and the map.
        const valid =
          step % 2 === 0
            ? uniqueTargets(listDrops.filter((drop) => drop.valid).map((drop) => drop.target))
            : mapTargets.filter((target) => planMove(tasks, active.id, target, limit).ok);
        if (valid.length === 0) continue;
        const result = moveBoth(rows, tasks, active.id, rng.pick(valid), limit);
        if (result) ({ rows, tasks } = result);
      }
    }
  }, 20_000);

  it("collapsed tasks: a drop under one goes after its hidden subtasks, as in the map", () => {
    for (const seed of SEEDS) {
      const rng = prng(seed + 2);
      const rows = randomRows(rng, 100);
      const tasks = readBack(rows);
      const parents = tasks.filter((task) => tasks.some((t) => t.parent_task_id === task.id));
      const collapsed = new Set(parents.filter(() => rng.chance(0.5)).map((task) => task.id));
      const visible = flattenTree(buildTree(tasks), collapsed).map((row) => row.task.id);
      const activeId = rng.pick(visible);
      const active = tasks.find((task) => task.id === activeId)!;
      const boxes = listBoxes(tasks, collapsed, active.id, rng);
      const checked = new Map<string, MoveTarget>();
      for (const pointer of listPointers(boxes)) {
        const drop = listDropAt(tasks, boxes, active.id, pointer, INDENT);
        if (!drop) continue;
        const parentId = drop.target.parentId;
        const siblings = siblingsOf(tasks, parentId).filter((task) => task.id !== active.id);
        expect(drop.target.index).toBeGreaterThanOrEqual(0);
        expect(drop.target.index).toBeLessThanOrEqual(siblings.length);
        // The line lands right after the visible row above it, among the parent's subtasks.
        if (drop.kind === "inside" || (parentId !== null && collapsed.has(parentId))) {
          expect(drop.target).toEqual(mapDropTarget(tasks, active.id, parentId, "inside"));
        }
        if (drop.valid) checked.set(targetKey(drop.target), drop.target);
      }
      for (const target of checked.values()) moveBoth(rows, tasks, active.id, target, 100);
    }
  });

  it("undo puts the tree back, and ⌘/Ctrl + arrows move as the database does", () => {
    for (const seed of SEEDS) {
      const rng = prng(seed + 3);
      let rows = randomRows(rng, 100);
      let tasks = readBack(rows);
      for (let step = 0; step < 20; step += 1) {
        const task = rng.pick(tasks);
        const target = keyboardTarget(tasks, task.id, rng.pick(["up", "down", "left", "right"]));
        if (!target) continue;
        const before = tasks;
        const forward = moveBoth(rows, tasks, task.id, target, 100);
        if (!forward || !forward.plan.ok || !forward.plan.changed) continue;
        const back = moveBoth(forward.rows, forward.tasks, task.id, forward.plan.from, 100);
        expect(back).not.toBeNull();
        // Same parents and order as before (positions are renumbered from 0).
        expect(order(back!.tasks)).toEqual(order(before));
        ({ rows, tasks } = forward);
      }
    }
  });

  it("refuses the own subtree as a parent, as tasks_tree_guard does", () => {
    for (const seed of SEEDS) {
      const rng = prng(seed + 4);
      const rows = randomRows(rng, 100);
      const tasks = readBack(rows);
      const active = rng.pick(tasks);
      for (const id of subtreeIds(tasks, active.id)) {
        const plan = planMove(tasks, active.id, { parentId: id, index: 0 });
        expect(plan).toEqual({ ok: false, error: "cycle" });
        expect(dbMoveTask(rows, active.id, id, 0, 100)).toEqual({
          ok: false,
          error: "task_move_cycle",
        });
      }
    }
  });
});
