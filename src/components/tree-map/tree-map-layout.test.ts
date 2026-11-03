import { describe, expect, it } from "vitest";
import {
  collapsedEdgePath,
  edgePath,
  fitView,
  layoutTree,
  LEVEL_GAP_VERTICAL,
  SIBLING_GAP_VERTICAL,
  type MapBranch,
  type Size,
} from "./tree-map-layout";

// owner · ├ a · │ └ c · └ b
const tree: MapBranch = {
  id: "owner",
  children: [
    { id: "a", children: [{ id: "c", children: [] }] },
    { id: "b", children: [] },
  ],
};
const card: Size = { width: 200, height: 80 };
const sizes = new Map<string, Size>([
  ["owner", { width: 240, height: 96 }],
  ["a", card],
  ["b", card],
  ["c", card],
]);

describe("vertical layout (organisation chart)", () => {
  const layout = layoutTree(tree, sizes, new Set(), "vertical")!;
  const box = (id: string) => layout.boxes.get(id)!;

  it("puts every level in its own row below the one above", () => {
    expect(box("owner").y).toBe(0);
    expect(box("a").y).toBe(96 + LEVEL_GAP_VERTICAL);
    expect(box("b").y).toBe(box("a").y);
    expect(box("c").y).toBe(box("a").y + 80 + LEVEL_GAP_VERTICAL);
  });

  it("keeps the measured sizes and places siblings side by side", () => {
    expect(box("a")).toMatchObject(card);
    expect(box("owner")).toMatchObject({ width: 240, height: 96 });
    expect(box("b").x).toBe(box("a").x + 200 + SIBLING_GAP_VERTICAL);
    expect(layout.width).toBe(200 * 2 + SIBLING_GAP_VERTICAL);
    expect(layout.height).toBe(96 + 80 * 2 + LEVEL_GAP_VERTICAL * 2);
  });

  it("centres a parent above its children", () => {
    const centre = (id: string) => box(id).x + box(id).width / 2;
    expect(centre("owner")).toBeCloseTo((centre("a") + centre("b")) / 2);
    expect(centre("a")).toBeCloseTo(centre("c"));
  });

  it("draws an edge from the parent's bottom middle to the child's top middle", () => {
    const path = edgePath(box("owner"), box("a"), "vertical");
    const owner = box("owner");
    const a = box("a");
    expect(path.startsWith(`M ${owner.x + owner.width / 2} ${owner.height}`)).toBe(true);
    expect(path.endsWith(`${a.x + a.width / 2} ${a.y}`)).toBe(true);
    expect(collapsedEdgePath(owner, "vertical")).toContain(`M ${owner.x + owner.width / 2} 96`);
  });

  it("waits for every visible node to be measured", () => {
    const partial = new Map(sizes);
    partial.delete("c");
    expect(layoutTree(tree, partial, new Set(), "vertical")).toBeNull();
    // A collapsed branch hides c, so its size is not needed.
    expect(layoutTree(tree, partial, new Set(["a"]), "vertical")).not.toBeNull();
  });

  it("starts with the root on top, centred across, when the tree is too big", () => {
    const view = fitView({ width: 4000, height: 3000 }, { width: 800, height: 600 }, 2000, {
      orientation: "vertical",
    });
    expect(view.y).toBe(24);
    // The root's centre lands in the middle of the viewport.
    expect(view.x + 2000 * view.scale).toBeCloseTo(400);
  });
});

describe("horizontal layout stays as it was", () => {
  it("is the default and grows to the right", () => {
    const layout = layoutTree(tree, sizes, new Set())!;
    expect(layout.boxes.get("owner")!.x).toBe(0);
    expect(layout.boxes.get("a")!.x).toBe(240 + 72);
    expect(layout.boxes.get("c")!.x).toBeGreaterThan(layout.boxes.get("a")!.x);
  });
});
