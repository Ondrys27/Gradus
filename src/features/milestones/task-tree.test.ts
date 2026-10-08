import { describe, expect, it } from "vitest";
import {
  applyStatusChange,
  buildTree,
  countTasks,
  milestoneCompletion,
  openSubtasks,
  progressOf,
  reopenAncestors,
  reopenedMilestone,
  reorderSiblings,
  sortMilestones,
  subtreeIds,
} from "./task-tree";
import type { MilestoneWithCounts, Task } from "./types";

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

function milestone(id: string, patch: Partial<MilestoneWithCounts> = {}): MilestoneWithCounts {
  return {
    id,
    title: id,
    description: null,
    category: "work",
    tag: null,
    target_date: null,
    status: "active",
    position: 0,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ai_feedback: null,
    reward: null,
    total: 0,
    done: 0,
    ...patch,
  };
}

describe("progress", () => {
  it("is done over all tasks, subtasks included, and zero without tasks", () => {
    const tasks = [
      task("a", { status: "done" }),
      task("b", { parent_task_id: "a", status: "done" }),
      task("c"),
      task("d", { parent_task_id: "c" }),
    ];
    const counts = countTasks(tasks);
    expect(counts).toMatchObject({ total: 4, done: 2 });
    expect(progressOf(counts)).toBe(0.5);
    expect(progressOf({ total: 0, done: 0 })).toBe(0);
  });

  it("counts in-progress tasks as not done", () => {
    const counts = countTasks([
      task("a", { status: "in_progress" }),
      task("b", { status: "done" }),
    ]);
    expect(counts).toEqual({ total: 2, done: 1, inProgress: 1 });
    expect(progressOf(counts)).toBe(0.5);
  });

  it("follows ticks through a deep tree and never reaches 100 % by itself", () => {
    // root > mid > leaf, plus a separate task
    let tasks = [
      task("root"),
      task("mid", { parent_task_id: "root" }),
      task("leaf", { parent_task_id: "mid" }),
      task("solo"),
    ];
    const progress = () => progressOf(countTasks(tasks));
    const tick = (id: string, status: Task["status"] = "done") => {
      const result = applyStatusChange(tasks, id, status);
      tasks = result.tasks;
      return result.error;
    };

    expect(progress()).toBe(0);
    expect(tick("root")).toBe("openSubtasks");
    expect(tick("mid")).toBe("openSubtasks");
    expect(progress()).toBe(0);

    expect(tick("leaf")).toBeUndefined();
    expect(progress()).toBe(0.25);
    // The unlocked parent stays open until the user ticks it.
    expect(tasks.find((t) => t.id === "mid")?.status).toBe("todo");

    tick("mid");
    tick("root");
    tick("solo");
    expect(progress()).toBe(1);

    // Reopening the leaf sends both completed ancestors back to in progress.
    tick("leaf", "todo");
    expect(tasks.map((t) => [t.id, t.status])).toEqual([
      ["root", "in_progress"],
      ["mid", "in_progress"],
      ["leaf", "todo"],
      ["solo", "done"],
    ]);
    expect(progress()).toBe(0.25);
  });

  it("drops with a new open subtask under a finished task", () => {
    const tasks = reopenAncestors(
      [task("a", { status: "done" }), task("b", { parent_task_id: "a" })],
      "b",
    );
    expect(tasks[0].status).toBe("in_progress");
    expect(progressOf(countTasks(tasks))).toBe(0);
  });
});

describe("buildTree", () => {
  it("nests subtasks of any depth", () => {
    const tree = buildTree([
      task("a"),
      task("b", { parent_task_id: "a" }),
      task("c", { parent_task_id: "b" }),
      task("d"),
    ]);
    expect(tree.map((n) => n.task.id)).toEqual(["a", "d"]);
    expect(tree[0].children[0].children[0].task.id).toBe("c");
  });
});

describe("applyStatusChange", () => {
  const tree = [
    task("parent"),
    task("child1", { parent_task_id: "parent" }),
    task("child2", { parent_task_id: "parent", status: "done" }),
  ];

  it("refuses to complete a task with open subtasks", () => {
    expect(openSubtasks(tree, "parent")).toBe(1);
    const result = applyStatusChange(tree, "parent", "done");
    expect(result.error).toBe("openSubtasks");
    expect(result.tasks).toBe(tree);
  });

  it("unlocks the parent when the last subtask is done, without completing it", () => {
    const result = applyStatusChange(tree, "child1", "done");
    expect(openSubtasks(result.tasks, "parent")).toBe(0);
    expect(result.tasks.find((t) => t.id === "parent")!.status).toBe("todo");
  });

  it("sends a completed parent back to in progress when a subtask is reopened", () => {
    const done = tree.map((t) => ({ ...t, status: "done" as const }));
    const result = applyStatusChange(done, "child1", "todo");
    expect(result.tasks.find((t) => t.id === "parent")).toMatchObject({
      status: "in_progress",
      completed_at: null,
    });
    expect(result.tasks.find((t) => t.id === "child1")!.status).toBe("todo");
  });

  it("reopens completed ancestors all the way up", () => {
    const deep = [
      task("a", { status: "done" }),
      task("b", { parent_task_id: "a", status: "done" }),
      task("c", { parent_task_id: "b", status: "done" }),
    ];
    const result = applyStatusChange(deep, "c", "in_progress");
    expect(result.tasks.map((t) => t.status)).toEqual([
      "in_progress",
      "in_progress",
      "in_progress",
    ]);
  });

  it("stamps completed_at when completing and clears it when reopening", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const done = applyStatusChange([task("a")], "a", "done", now).tasks[0];
    expect(done.completed_at).toBe(now.toISOString());
    expect(applyStatusChange([done], "a", "todo").tasks[0].completed_at).toBeNull();
  });
});

describe("reopenAncestors", () => {
  it("reopens a completed parent after an open subtask is added", () => {
    const tasks = [task("p", { status: "done" }), task("s", { parent_task_id: "p" })];
    expect(reopenAncestors(tasks, "s")[0].status).toBe("in_progress");
  });
});

describe("subtreeIds", () => {
  it("collects a task and all of its descendants", () => {
    const tasks = [
      task("a"),
      task("b", { parent_task_id: "a" }),
      task("c", { parent_task_id: "b" }),
      task("d"),
    ];
    expect([...subtreeIds(tasks, "a")].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("reorderSiblings", () => {
  const tasks = [
    task("a", { position: 0 }),
    task("b", { position: 1 }),
    task("c", { position: 2 }),
    task("x", { parent_task_id: "a", position: 0 }),
  ];

  it("moves within siblings and reports only changed positions", () => {
    const { tasks: next, changes } = reorderSiblings(tasks, "c", "a");
    expect(next.filter((t) => !t.parent_task_id).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(changes).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("ignores moves between different parents", () => {
    expect(reorderSiblings(tasks, "x", "b").changes).toEqual([]);
  });
});

describe("sortMilestones", () => {
  it("puts open ones first by nearest date, undated after, finished last", () => {
    const sorted = sortMilestones([
      milestone("done", { status: "completed", completed_at: "2026-05-01T00:00:00Z" }),
      milestone("undated"),
      milestone("late", { target_date: "2026-12-01" }),
      milestone("soon", { target_date: "2026-10-01" }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["soon", "late", "undated", "done"]);
  });
});

describe("milestone completion", () => {
  it("is locked with the number of open tasks until every task is done", () => {
    expect(milestoneCompletion("active", { total: 5, done: 2 })).toEqual({
      kind: "locked",
      remaining: 3,
    });
    expect(milestoneCompletion("active", { total: 5, done: 5 })).toEqual({ kind: "ready" });
  });

  it("asks for a first task when there is none and knows a completed one", () => {
    expect(milestoneCompletion("active", { total: 0, done: 0 })).toEqual({ kind: "empty" });
    expect(milestoneCompletion("completed", { total: 3, done: 3 })).toEqual({ kind: "completed" });
  });

  it("reopens a completed milestone as soon as a task is not done", () => {
    const done = milestone("m", { status: "completed", completed_at: "2026-09-01T00:00:00Z" });
    expect(reopenedMilestone(done, [task("a", { status: "done" })])).toBe(done);
    expect(
      reopenedMilestone(done, [
        task("a", { status: "done" }),
        task("b", { status: "in_progress" }),
      ]),
    ).toMatchObject({ status: "active", completed_at: null });
    const active = milestone("n");
    expect(reopenedMilestone(active, [task("a")])).toBe(active);
  });
});

describe("taskDepth", () => {
  const tree = [
    { id: "a", parent_task_id: null },
    { id: "b", parent_task_id: "a" },
    { id: "c", parent_task_id: "b" },
  ];

  it("counts the parents above a task", async () => {
    const { taskDepth } = await import("./task-tree");
    expect(taskDepth(tree, "a")).toBe(0);
    expect(taskDepth(tree, "b")).toBe(1);
    expect(taskDepth(tree, "c")).toBe(2);
    expect(taskDepth(tree, "missing")).toBe(0);
  });

  it("stops on a broken cycle", async () => {
    const { taskDepth } = await import("./task-tree");
    const cycle = [
      { id: "x", parent_task_id: "y" },
      { id: "y", parent_task_id: "x" },
    ];
    expect(taskDepth(cycle, "x")).toBe(100);
  });
});
