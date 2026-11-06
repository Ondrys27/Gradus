import { describe, expect, it } from "vitest";
import { node, parseMarkdown, toMarkdown } from "@/lib/mindmap/formats";
import {
  IMPORT_MAX_TASKS,
  importBlock,
  importItems,
  importSummary,
  mapFileName,
  planImport,
  prepareImport,
  tasksToMindMap,
} from "./map-io";
import { MAX_TASK_LEVELS } from "./task-tree";
import type { Task } from "./types";

const task = (
  id: string,
  parent: string | null,
  position: number,
  status: Task["status"] = "todo",
): Task => ({
  id,
  milestone_id: "m",
  parent_task_id: parent,
  title: `Úkol ${id}`,
  description: null,
  status,
  position,
  due_date: null,
  completed_at: null,
});

let counter = 0;
const newId = () => `n${++counter}`;

describe("milestone ↔ mind map", () => {
  it("the milestone is the root, tasks in their order with their state", () => {
    const tasks = [
      task("b", null, 1),
      task("a", null, 0, "done"),
      task("a2", "a", 1),
      task("a1", "a", 0, "done"),
    ];
    expect(toMarkdown(tasksToMindMap({ title: "Milník" }, tasks))).toBe(
      "# Milník\n\n- [x] Úkol a\n  - [x] Úkol a1\n  - [ ] Úkol a2\n- [ ] Úkol b\n",
    );
  });

  it("export → import gives the same tasks back", () => {
    const tasks = [task("a", null, 0), task("a1", "a", 0, "done"), task("b", null, 1, "done")];
    const tree = parseMarkdown(toMarkdown(tasksToMindMap({ title: "M" }, tasks)));
    counter = 0;
    const rows = planImport(importItems(tree), { startPosition: 0, newId });
    expect(
      rows.map(({ title, status, level, position }) => [title, status, level, position]),
    ).toEqual([
      ["Úkol a", "todo", 1, 0],
      ["Úkol a1", "done", 2, 0],
      ["Úkol b", "done", 1, 1],
    ]);
  });
});

describe("planImport", () => {
  it("parents come before their children, the first level continues after the last task", () => {
    counter = 0;
    const rows = planImport(node("", [node("A", [node("A1"), node("A2")]), node("B")]), {
      startPosition: 5,
      newId,
    });
    expect(rows).toEqual([
      { id: "n1", parent_task_id: null, title: "A", status: "todo", position: 5, level: 1 },
      { id: "n2", parent_task_id: "n1", title: "A1", status: "todo", position: 0, level: 2 },
      { id: "n3", parent_task_id: "n1", title: "A2", status: "todo", position: 1, level: 2 },
      { id: "n4", parent_task_id: null, title: "B", status: "todo", position: 6, level: 1 },
    ]);
  });

  it("done items are imported as done, but a parent with open subtasks stays open", () => {
    counter = 0;
    const rows = planImport(
      node("", [
        node("A", [node("A1", [], true), node("A2", [], false)], true),
        node("B", [node("B1", [], true)], true),
      ]),
      { startPosition: 0, newId },
    );
    expect(rows.map((row) => [row.title, row.status])).toEqual([
      ["A", "todo"],
      ["A1", "done"],
      ["A2", "todo"],
      ["B", "done"],
      ["B1", "done"],
    ]);
  });

  it("titles are cut to the task limit", () => {
    const rows = planImport(node("", [node("x".repeat(300))]), { startPosition: 0, newId });
    expect(rows[0].title).toHaveLength(120);
  });

  it("a single node without children is one task", () => {
    expect(importItems(node("Jediný"))).toEqual(node("", [node("Jediný")]));
    const tree = node("Střed", [node("a")]);
    expect(importItems(tree)).toBe(tree);
  });
});

describe("summary and limits", () => {
  const chain = (levels: number) => {
    let current = node(`L${levels}`);
    for (let level = levels - 1; level >= 1; level--) current = node(`L${level}`, [current]);
    return node("", [current]);
  };

  it("counts tasks, depth and done ones (consistently)", () => {
    const items = node("", [
      node("A", [node("A1", [], true)], true),
      node("B", [], true),
      node("C"),
    ]);
    expect(importSummary(items)).toEqual({ tasks: 4, depth: 2, done: 3, tooDeep: false });
  });

  it("deeper than a milestone holds needs flattening from a level", () => {
    const deep = chain(MAX_TASK_LEVELS + 3);
    const summary = importSummary(deep);
    expect(summary).toMatchObject({ depth: MAX_TASK_LEVELS + 3, tooDeep: true });
    expect(importBlock(summary, { existing: 0, replace: false, flattened: false })).toBe("tooDeep");
    const flat = prepareImport(deep, MAX_TASK_LEVELS);
    expect(importSummary(flat)).toMatchObject({
      depth: MAX_TASK_LEVELS,
      tooDeep: false,
      tasks: summary.tasks,
    });
    expect(
      importBlock(importSummary(flat), { existing: 0, replace: false, flattened: true }),
    ).toBeNull();
    expect(importSummary(prepareImport(chain(6), 2))).toMatchObject({ depth: 2, tasks: 6 });
  });

  it("refuses too many tasks at once and a milestone that would overflow", () => {
    const many = node(
      "",
      Array.from({ length: IMPORT_MAX_TASKS + 1 }, (_, index) => node(`${index}`)),
    );
    expect(
      importBlock(importSummary(many), { existing: 0, replace: false, flattened: false }),
    ).toBe("tooMany");
    const some = node(
      "",
      Array.from({ length: 600 }, (_, index) => node(`${index}`)),
    );
    expect(
      importBlock(importSummary(some), { existing: 1500, replace: false, flattened: false }),
    ).toBe("milestoneFull");
    expect(
      importBlock(importSummary(some), { existing: 1500, replace: true, flattened: false }),
    ).toBeNull();
    expect(
      importBlock(importSummary(node("")), { existing: 0, replace: false, flattened: false }),
    ).toBe("empty");
  });
});

describe("mapFileName", () => {
  it("keeps letters and diacritics, drops what file systems refuse", () => {
    expect(mapFileName("Spustit e-shop: léto/podzim?", "md", "mapa")).toBe(
      "Spustit e-shop léto podzim.md",
    );
    expect(mapFileName("  ...  ", "opml", "mapa")).toBe("mapa.opml");
    expect(mapFileName("x".repeat(200), "mm", "mapa")).toBe(`${"x".repeat(80)}.mm`);
  });
});
