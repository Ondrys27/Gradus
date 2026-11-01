import { describe, expect, it } from "vitest";
import {
  buildTree,
  flattenTree,
  keyboardTarget,
  mapDropTarget,
  mapDropZone,
  MAX_TASK_LEVELS,
  planMove,
  projectListDrop,
  siblingsOf,
  subtreeHeight,
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

describe("list drop projection", () => {
  const INDENT = 28;
  const rows = (collapsed: string[] = []) => flattenTree(buildTree(tree()), new Set(collapsed));

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

  it("drags straight down: same level, new place", () => {
    // c over b, no sideways move: c goes before b at the top level.
    expect(projectListDrop(rows(), "c", "b", 0, INDENT)).toEqual({
      depth: 0,
      target: { parentId: null, index: 1 },
    });
  });

  it("drags right: becomes a subtask of the row above", () => {
    expect(projectListDrop(rows(), "b", "b", INDENT, INDENT)).toEqual({
      depth: 1,
      target: { parentId: "a", index: 2 },
    });
    // Never deeper than one level below the row above (a2 on level 2).
    expect(projectListDrop(rows(), "b", "b", INDENT * 5, INDENT)).toEqual({
      depth: 2,
      target: { parentId: "a2", index: 0 },
    });
  });

  it("drags left: leaves its parent", () => {
    // Without anything under it, a2 may go up to level 1 right after a.
    expect(projectListDrop(rows(), "a2", "a2", -INDENT, INDENT)).toEqual({
      depth: 0,
      target: { parentId: null, index: 1 },
    });
  });

  it("cannot leave a level while the row below still sits deeper", () => {
    // a1 dragged (its subtask hidden meanwhile) to the left: a2 below is still
    // a subtask of a, so a1 has to stay one too.
    const visible = rows().filter((r) => r.task.id !== "a1x");
    expect(projectListDrop(visible, "a1", "a1", -INDENT, INDENT)?.depth).toBe(1);
  });

  it("goes after the hidden subtasks of a collapsed task", () => {
    const visible = rows(["a"]);
    expect(projectListDrop(visible, "b", "b", INDENT, INDENT)).toEqual({
      depth: 1,
      target: { parentId: "a", index: 2 },
    });
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
