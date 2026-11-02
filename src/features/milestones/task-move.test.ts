import { describe, expect, it } from "vitest";
import {
  buildTree,
  flattenTree,
  keyboardTarget,
  mapDropTarget,
  mapDropZone,
  MAX_TASK_LEVELS,
  levelsFromOffset,
  listDropAt,
  planMove,
  siblingsOf,
  subtreeHeight,
  type ListRowBox,
  type MovePlan,
} from "./task-tree";
import type { Task } from "./types";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    milestone_id: "m",
    parent_task_id: null,
    title: id,
    description: null,
    status: "todo",
    position: 0,
    due_date: null,
    completed_at: null,
    ...patch,
  };
}

/**
 *   a        (0)
 *   ├ a1     (0)
 *   │ └ a1x  (0)
 *   └ a2     (1)
 *   b        (1)
 *   c        (2)
 */
const tree = (): Task[] => [
  task("a", { position: 0 }),
  task("b", { position: 1 }),
  task("c", { position: 2 }),
  task("a1", { parent_task_id: "a", position: 0 }),
  task("a2", { parent_task_id: "a", position: 1 }),
  task("a1x", { parent_task_id: "a1", position: 0 }),
];

function moved(plan: MovePlan): Task[] {
  if (!plan.ok) throw new Error(plan.error);
  return plan.tasks;
}
const order = (tasks: Task[], parentId: string | null) =>
  siblingsOf(tasks, parentId).map((t) => `${t.id}:${t.position}`);
const byId = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)!;

describe("planMove · position", () => {
  it("reorders siblings and renumbers them from 0", () => {
    const plan = planMove(tree(), "c", { parentId: null, index: 0 });
    expect(order(moved(plan), null)).toEqual(["c:0", "a:1", "b:2"]);
    expect(plan.ok && plan.from).toEqual({ parentId: null, index: 2 });
  });

  it("moves under another task with its whole subtree and closes the gap it left", () => {
    const next = moved(planMove(tree(), "a1", { parentId: "b", index: 0 }));
    expect(order(next, "b")).toEqual(["a1:0"]);
    expect(order(next, "a")).toEqual(["a2:0"]);
    // The subtask travels along.
    expect(byId(next, "a1x").parent_task_id).toBe("a1");
  });

  it("puts a subtask on level 1 when dropped on the milestone", () => {
    const next = moved(planMove(tree(), "a1x", { parentId: null, index: 3 }));
    expect(order(next, null)).toEqual(["a:0", "b:1", "c:2", "a1x:3"]);
    expect(order(next, "a1")).toEqual([]);
  });

  it("clamps the index into the new siblings", () => {
    expect(order(moved(planMove(tree(), "a", { parentId: null, index: 99 })), null)).toEqual([
      "b:0",
      "c:1",
      "a:2",
    ]);
    expect(order(moved(planMove(tree(), "c", { parentId: null, index: -4 })), null)[0]).toBe("c:0");
  });

  it("reports no change when the task would land where it is", () => {
    const plan = planMove(tree(), "b", { parentId: null, index: 1 });
    expect(plan).toMatchObject({ ok: true, changed: false });
  });

  it("keeps the order of equal positions as the database sorts them", () => {
    const tasks = [task("x"), task("y"), task("z")];
    expect(order(moved(planMove(tasks, "z", { parentId: null, index: 1 })), null)).toEqual([
      "x:0",
      "z:1",
      "y:2",
    ]);
  });
});

describe("planMove · cycle and depth", () => {
  it("never puts a task under itself or anything below it", () => {
    expect(planMove(tree(), "a", { parentId: "a", index: 0 })).toEqual({
      ok: false,
      error: "cycle",
    });
    expect(planMove(tree(), "a", { parentId: "a1x", index: 0 })).toEqual({
      ok: false,
      error: "cycle",
    });
  });

  it("refuses a parent that is not there", () => {
    expect(planMove(tree(), "a", { parentId: "nope", index: 0 })).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(planMove(tree(), "nope", { parentId: null, index: 0 })).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("refuses a move that takes the subtree past the level limit", () => {
    // a → a1 → a1x is three levels; under c (level 1) it would need four.
    expect(planMove(tree(), "a", { parentId: "c", index: 0 }, 3)).toEqual({
      ok: false,
      error: "tooDeep",
    });
    expect(planMove(tree(), "a", { parentId: "c", index: 0 }, 4).ok).toBe(true);
    expect(planMove(tree(), "a2", { parentId: "a1x", index: 0 }, 3)).toEqual({
      ok: false,
      error: "tooDeep",
    });
  });

  it("allows the same number of levels as the database", () => {
    expect(MAX_TASK_LEVELS).toBe(100);
    const chain = Array.from({ length: MAX_TASK_LEVELS }, (_, i) =>
      task(`t${i}`, { parent_task_id: i === 0 ? null : `t${i - 1}` }),
    );
    const tasks = [...chain, task("loose", { position: 1 })];
    expect(planMove(tasks, "loose", { parentId: `t${MAX_TASK_LEVELS - 2}`, index: 0 }).ok).toBe(
      true,
    );
    expect(planMove(tasks, "loose", { parentId: `t${MAX_TASK_LEVELS - 1}`, index: 0 })).toEqual({
      ok: false,
      error: "tooDeep",
    });
  });

  it("measures how far a subtree reaches", () => {
    expect(subtreeHeight(tree(), "a")).toBe(2);
    expect(subtreeHeight(tree(), "a1")).toBe(1);
    expect(subtreeHeight(tree(), "c")).toBe(0);
  });
});

describe("planMove · completion", () => {
  it("reopens a done parent and its done ancestors when an open task comes under it", () => {
    const tasks = [
      task("p", { status: "done", completed_at: "2026-10-01T00:00:00Z" }),
      task("q", { parent_task_id: "p", status: "done", completed_at: "2026-10-01T00:00:00Z" }),
      task("open", { position: 1 }),
    ];
    const next = moved(planMove(tasks, "open", { parentId: "q", index: 0 }));
    expect(byId(next, "q")).toMatchObject({ status: "in_progress", completed_at: null });
    expect(byId(next, "p")).toMatchObject({ status: "in_progress", completed_at: null });
    expect(byId(next, "open").status).toBe("todo");
  });

  it("leaves a done task done under an open parent and never completes anything", () => {
    const tasks = [
      task("p"),
      task("open", { parent_task_id: "p" }),
      task("done", { parent_task_id: "p", position: 1, status: "done" }),
      task("other", { position: 1 }),
    ];
    // The open subtask leaves: p is unlocked, but it waits for the user.
    const next = moved(planMove(tasks, "open", { parentId: "other", index: 0 }));
    expect(byId(next, "p").status).toBe("todo");
    expect(byId(next, "other").status).toBe("todo");
    const back = moved(planMove(next, "done", { parentId: "other", index: 1 }));
    expect(byId(back, "done").status).toBe("done");
    expect(byId(back, "other").status).toBe("todo");
  });
});

describe("keyboardTarget", () => {
  it("moves up and down among siblings", () => {
    expect(keyboardTarget(tree(), "b", "up")).toEqual({ parentId: null, index: 0 });
    expect(keyboardTarget(tree(), "b", "down")).toEqual({ parentId: null, index: 2 });
    expect(keyboardTarget(tree(), "a", "up")).toBeNull();
    expect(keyboardTarget(tree(), "c", "down")).toBeNull();
  });

  it("goes a level up right after its parent, and a level down under the sibling above", () => {
    expect(keyboardTarget(tree(), "a1", "left")).toEqual({ parentId: null, index: 1 });
    expect(keyboardTarget(tree(), "a", "left")).toBeNull();
    expect(keyboardTarget(tree(), "b", "right")).toEqual({ parentId: "a", index: 2 });
    expect(keyboardTarget(tree(), "a", "right")).toBeNull();
  });
});

describe("list drop", () => {
  const INDENT = 28;
  const ROW = 44;
  const rows = (collapsed: string[] = []) => flattenTree(buildTree(tree()), new Set(collapsed));
  /** The rows during a drag of `activeId`: its subtree travels with it, 44 px each. */
  const boxes = (activeId: string, collapsed: string[] = []): ListRowBox[] =>
    rows([...collapsed, activeId]).map((row, index) => ({ ...row, top: index * ROW, height: ROW }));
  /** The pointer at a share of the n-th visible row. */
  const at = (row: number, share: number, offsetX = 0) => ({ y: (row + share) * ROW, offsetX });
  const drop = (
    activeId: string,
    pointer: { y: number; offsetX: number },
    options: { collapsed?: string[]; tasks?: Task[]; maxLevels?: number } = {},
  ) =>
    listDropAt(
      options.tasks ?? tree(),
      boxes(activeId, options.collapsed),
      activeId,
      pointer,
      INDENT,
      options.maxLevels,
    );

  it("flattens the visible tree with depths", () => {
    expect(rows().map((r) => `${r.task.id}@${r.depth}`)).toEqual([
      "a@0",
      "a1@1",
      "a1x@2",
      "a2@1",
      "b@0",
      "c@0",
    ]);
    expect(rows(["a"]).map((r) => r.task.id)).toEqual(["a", "b", "c"]);
  });

  it("counts a level once the sideways drag passes half an indent, both ways", () => {
    expect(levelsFromOffset(13, INDENT)).toBe(0);
    expect(levelsFromOffset(14, INDENT)).toBe(1);
    expect(levelsFromOffset(-14, INDENT)).toBe(-1);
    expect(levelsFromOffset(-13, INDENT)).toBe(0);
    expect(levelsFromOffset(42, INDENT)).toBe(2);
    expect(levelsFromOffset(-70, INDENT)).toBe(-3);
    expect(levelsFromOffset(50, 0)).toBe(0);
  });

  it("drops onto the middle of a row: the last subtask of that task", () => {
    // Rows while c is dragged: a, a1, a1x, a2, b, c.
    expect(drop("c", at(2, 0.5))).toEqual({
      kind: "inside",
      overId: "a1x",
      depth: 3,
      target: { parentId: "a1x", index: 0 },
      valid: true,
    });
    expect(drop("c", at(0, 0.5))).toMatchObject({
      kind: "inside",
      target: { parentId: "a", index: 2 },
    });
  });

  it("drops onto a collapsed task: after the subtasks that are not shown", () => {
    // Rows while c is dragged with a collapsed: a, b, c.
    expect(drop("c", at(0, 0.5), { collapsed: ["a"] })).toMatchObject({
      kind: "inside",
      overId: "a",
      target: { parentId: "a", index: 2 },
    });
  });

  it("the edge of a row is a line between rows, on the task's own level", () => {
    // c over the top edge of b: before b at the top level.
    expect(drop("c", at(4, 0.1))).toEqual({
      kind: "line",
      y: 4 * ROW,
      depth: 0,
      target: { parentId: null, index: 1 },
      valid: true,
    });
    // The bottom edge of a2 is the same gap.
    expect(drop("c", at(3, 0.9))).toMatchObject({
      y: 4 * ROW,
      target: { parentId: null, index: 1 },
    });
  });

  it("picks the level from the sideways drag, several levels at once", () => {
    // c (level 0) at the gap between a2 (1) and b (0): may be 0, 1 or 2.
    expect(drop("c", at(4, 0.1, INDENT))).toMatchObject({
      depth: 1,
      target: { parentId: "a", index: 2 },
    });
    expect(drop("c", at(4, 0.1, INDENT * 2))).toMatchObject({
      depth: 2,
      target: { parentId: "a2", index: 0 },
    });
    // Never deeper than one level below the row above.
    expect(drop("c", at(4, 0.1, INDENT * 9))).toMatchObject({ depth: 2 });
    // Between a1x (2) and a2 (1): two levels deeper than c in one drag.
    expect(drop("c", at(3, 0.1, INDENT * 2))).toMatchObject({
      depth: 2,
      target: { parentId: "a1", index: 1 },
    });
    // Three levels deeper, as a subtask of a1x.
    expect(drop("c", at(3, 0.1, INDENT * 3))).toMatchObject({
      depth: 3,
      target: { parentId: "a1x", index: 0 },
    });
  });

  it("keeps the level between the row below and the row above", () => {
    // c dragged left at the gap above a1 (level 1) cannot get shallower than a1.
    expect(drop("c", at(1, 0.1, -INDENT * 4))).toMatchObject({
      depth: 1,
      target: { parentId: "a", index: 0 },
    });
  });

  it("on the dragged row itself: a sideways drag changes only the level", () => {
    // a2 (level 1) dragged left in place goes to level 1 right after a.
    expect(drop("a2", at(3, 0.5, -INDENT))).toEqual({
      kind: "line",
      y: 3.5 * ROW,
      depth: 0,
      target: { parentId: null, index: 1 },
      valid: true,
    });
    // Without a sideways drag it stays where it is.
    const still = drop("a2", at(3, 0.5));
    expect(still).toMatchObject({ depth: 1, target: { parentId: "a", index: 1 } });
    expect(planMove(tree(), "a2", still!.target)).toMatchObject({ ok: true, changed: false });
  });

  it("a dragged subtree is one row: a1 left in place stays under a while a2 is below", () => {
    // Rows while a1 is dragged: a, a1, a2, b, c.
    expect(drop("a1", at(1, 0.5, -INDENT))).toMatchObject({
      depth: 1,
      target: { parentId: "a", index: 0 },
    });
    // Moved below a2, it can leave a.
    expect(drop("a1", at(3, 0.1, -INDENT))).toMatchObject({
      depth: 0,
      target: { parentId: null, index: 1 },
    });
  });

  it("the top and the bottom of the list", () => {
    expect(drop("b", at(0, 0.1))).toMatchObject({ y: 0, target: { parentId: null, index: 0 } });
    expect(drop("a", at(-0.5, 0))).toMatchObject({
      target: { parentId: null, index: 0 },
    });
    // Rows while a is dragged: a, b, c. Below the last row: the end of level 1.
    expect(drop("a", { y: 3 * ROW + 20, offsetX: 0 })).toMatchObject({
      y: 3 * ROW,
      target: { parentId: null, index: 2 },
    });
    // Far away from the list: no drop.
    expect(drop("a", { y: 3 * ROW + 200, offsetX: 0 })).toBeNull();
    expect(drop("a", { y: -200, offsetX: 0 })).toBeNull();
  });

  it("marks a drop that would take the subtree too deep as not allowed", () => {
    // a with its two levels below onto a1x (level 3) needs 6 levels.
    const result = drop("c", at(2, 0.5), {
      tasks: [...tree(), task("c1", { parent_task_id: "c" }), task("c2", { parent_task_id: "c1" })],
      maxLevels: 5,
    });
    expect(result).toMatchObject({ kind: "inside", overId: "a1x", valid: false });
    expect(drop("c", at(2, 0.5), { maxLevels: 4 })).toMatchObject({ valid: true });
  });
});

describe("map drop", () => {
  it("splits a node into before, inside and after", () => {
    const rect = { top: 100, height: 40 };
    expect(mapDropZone(rect, 104)).toBe("before");
    expect(mapDropZone(rect, 120)).toBe("inside");
    expect(mapDropZone(rect, 136)).toBe("after");
  });

  it("puts the task at the end of level 1 on the milestone, and at the end of a task's subtasks", () => {
    expect(mapDropTarget(tree(), "a1", null, "inside")).toEqual({ parentId: null, index: 3 });
    expect(mapDropTarget(tree(), "c", null, "before")).toEqual({ parentId: null, index: 2 });
    expect(mapDropTarget(tree(), "c", "a", "inside")).toEqual({ parentId: "a", index: 2 });
  });

  it("puts the task next to a sibling, counted without the task itself", () => {
    expect(mapDropTarget(tree(), "c", "a", "before")).toEqual({ parentId: null, index: 0 });
    expect(mapDropTarget(tree(), "a", "c", "after")).toEqual({ parentId: null, index: 2 });
    expect(mapDropTarget(tree(), "b", "a2", "after")).toEqual({ parentId: "a", index: 2 });
    expect(mapDropTarget(tree(), "a", "a", "inside")).toBeNull();
  });
});
