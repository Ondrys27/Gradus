import { describe, expect, it } from "vitest";
import {
  COLUMN_GAP,
  collapsedEdgePath,
  descendantCount,
  edgeLength,
  edgePath,
  fitView,
  layoutTree,
  ROW_GAP,
  toBranch,
  type Box,
  type MapBranch,
  type Size,
} from "./task-map-layout";
import { buildTree } from "./task-tree";
import type { Task } from "./types";

const branch = (id: string, children: MapBranch[] = []): MapBranch => ({ id, children });

function sizes(entries: Record<string, [number, number]>): Map<string, Size> {
  return new Map(Object.entries(entries).map(([id, [width, height]]) => [id, { width, height }]));
}

const centreY = (box: Box) => box.y + box.height / 2;

describe("layoutTree", () => {
  // root ── a ── a1
  //      │    └─ a2
  //      └─ b
  const tree = branch("root", [branch("a", [branch("a1"), branch("a2")]), branch("b")]);
  const measured = sizes({
    root: [200, 60],
    a: [140, 40],
    b: [260, 80],
    a1: [180, 40],
    a2: [150, 64],
  });

  it("waits until every visible node is measured", () => {
    const partial = new Map(measured);
    partial.delete("a2");
    expect(layoutTree(tree, partial, new Set())).toBeNull();
    // A hidden node does not need a size.
    expect(layoutTree(tree, partial, new Set(["a"]))).not.toBeNull();
  });

  it("puts each depth into its own column as wide as the widest node", () => {
    const layout = layoutTree(tree, measured, new Set())!;
    expect(layout.boxes.get("root")!.x).toBe(0);
    expect(layout.boxes.get("a")!.x).toBe(200 + COLUMN_GAP);
    expect(layout.boxes.get("b")!.x).toBe(200 + COLUMN_GAP);
    expect(layout.boxes.get("a1")!.x).toBe(200 + COLUMN_GAP + 260 + COLUMN_GAP);
    expect(layout.width).toBe(200 + 260 + 180 + COLUMN_GAP * 2);
  });

  it("stacks siblings without overlap and centres parents on their children", () => {
    const layout = layoutTree(tree, measured, new Set())!;
    const a1 = layout.boxes.get("a1")!;
    const a2 = layout.boxes.get("a2")!;
    const a = layout.boxes.get("a")!;
    const b = layout.boxes.get("b")!;
    expect(a2.y).toBe(a1.y + a1.height + ROW_GAP);
    expect(centreY(a)).toBe((centreY(a1) + centreY(a2)) / 2);
    // a's subtree is 40 + 16 + 64 = 120 high, b follows after one gap.
    expect(b.y).toBe(120 + ROW_GAP);
    expect(layout.height).toBe(120 + ROW_GAP + 80);
    expect(centreY(layout.boxes.get("root")!)).toBe((centreY(a) + centreY(b)) / 2);
  });

  it("keeps a node taller than its children inside its own block", () => {
    const layout = layoutTree(
      branch("root", [branch("tall", [branch("x")])]),
      sizes({ root: [140, 40], tall: [140, 200], x: [140, 40] }),
      new Set(),
    )!;
    const tall = layout.boxes.get("tall")!;
    const x = layout.boxes.get("x")!;
    expect(tall.y).toBe(0);
    expect(centreY(x)).toBe(centreY(tall));
  });

  it("hides the children of a collapsed branch and their edges", () => {
    const layout = layoutTree(tree, measured, new Set(["a"]))!;
    expect(layout.boxes.has("a1")).toBe(false);
    expect(layout.edges).toEqual([
      { parentId: "root", childId: "a" },
      { parentId: "root", childId: "b" },
    ]);
  });

  it("records the depth of every node", () => {
    const layout = layoutTree(tree, measured, new Set())!;
    expect(layout.boxes.get("root")!.depth).toBe(0);
    expect(layout.boxes.get("b")!.depth).toBe(1);
    expect(layout.boxes.get("a2")!.depth).toBe(2);
  });
});

describe("toBranch and descendantCount", () => {
  const task = (id: string, parent: string | null = null): Task => ({
    id,
    milestone_id: "m",
    parent_task_id: parent,
    title: id,
    description: null,
    status: "todo",
    position: 0,
    due_date: null,
    completed_at: null,
  });

  it("hangs the tasks under the milestone at any depth", () => {
    const root = toBranch(
      "m",
      buildTree([task("a"), task("a1", "a"), task("a1x", "a1"), task("b")]),
    );
    expect(root.id).toBe("m");
    expect(root.children.map((child) => child.id)).toEqual(["a", "b"]);
    expect(descendantCount(root)).toBe(4);
    expect(descendantCount(root.children[0])).toBe(2);
  });
});

describe("edges", () => {
  const parent: Box = { x: 0, y: 0, width: 100, height: 40, depth: 0 };
  const child: Box = { x: 180, y: 100, width: 140, height: 60, depth: 1 };

  it("runs from the parent's right middle to the child's left middle", () => {
    expect(edgePath(parent, child)).toBe("M 100 20 C 140 20 140 130 180 130");
  });

  it("grows from a path with the same shape collapsed onto the parent's port", () => {
    const numbers = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.length;
    expect(collapsedEdgePath(parent)).toBe("M 100 20 C 100 20 100 20 100 20");
    expect(numbers(collapsedEdgePath(parent))).toBe(numbers(edgePath(parent, child)));
  });

  it("measures a straight edge exactly and a curved one longer than its chord", () => {
    const level: Box = { ...child, y: -10 };
    expect(edgeLength(parent, level)).toBeCloseTo(80, 5);
    expect(edgeLength(parent, child)).toBeGreaterThan(Math.hypot(80, 110));
  });
});

describe("fitView", () => {
  it("centres a tree that fits, never above 100 %", () => {
    expect(fitView({ width: 400, height: 200 }, { width: 1000, height: 600 }, 100)).toEqual({
      x: 300,
      y: 200,
      scale: 1,
    });
  });

  it("shrinks a large tree down to the minimum and keeps the root in sight", () => {
    const view = fitView({ width: 4000, height: 3000 }, { width: 390, height: 600 }, 1500);
    expect(view.scale).toBe(0.75);
    expect(view.x).toBe(24);
    // The root's centre lands in the middle of the viewport.
    expect(view.y + 1500 * view.scale).toBe(300);
  });

  it("does not push a tall tree past its top edge", () => {
    const view = fitView({ width: 300, height: 3000 }, { width: 390, height: 600 }, 20);
    expect(view.y).toBe(24);
  });
});
