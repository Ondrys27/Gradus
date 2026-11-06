import { describe, expect, it } from "vitest";
import type { MapBranch } from "@/components/tree-map/tree-map-layout";
import {
  branchDropTarget,
  branchKeyboardTarget,
  branchSubtree,
  indexBranches,
  mapDropZone,
  moveDirectionOf,
} from "./mind-map-tree";

const b = (id: string, children: MapBranch[] = []): MapBranch => ({ id, children });
// root · a (a1, a2) · b · c (c1)
const tree = b("root", [b("a", [b("a1"), b("a2")]), b("b"), b("c", [b("c1")])]);

describe("mind map tree", () => {
  it("indexes parents and subtrees from ids and children only", () => {
    const { parents } = indexBranches(tree);
    expect(parents.get("a1")).toBe("a");
    expect(parents.get("a")).toBe("root");
    expect(parents.has("root")).toBe(false);
    expect([...branchSubtree(tree, "a")].sort()).toEqual(["a", "a1", "a2"]);
  });

  it("drop zones: top and bottom quarter next to the node, the middle under it", () => {
    const rect = { top: 100, height: 40 };
    expect(mapDropZone(rect, 105)).toBe("before");
    expect(mapDropZone(rect, 120)).toBe("inside");
    expect(mapDropZone(rect, 135)).toBe("after");
  });

  it("a drop goes onto, before or after a node; never into its own subtree", () => {
    expect(branchDropTarget(tree, "b", "root", "inside")).toEqual({ parentId: "root", index: 2 });
    expect(branchDropTarget(tree, "b", "a", "inside")).toEqual({ parentId: "a", index: 2 });
    expect(branchDropTarget(tree, "b", "a1", "after")).toEqual({ parentId: "a", index: 1 });
    expect(branchDropTarget(tree, "c1", "a", "before")).toEqual({ parentId: "root", index: 0 });
    expect(branchDropTarget(tree, "a", "a2", "inside")).toBeNull();
    expect(branchDropTarget(tree, "a", "a", "inside")).toBeNull();
    expect(branchDropTarget(tree, "root", "a", "inside")).toBeNull();
  });

  it("⌘/Ctrl + arrows: order, out to the parent's level, into the sibling above", () => {
    expect(
      moveDirectionOf({
        key: "ArrowUp",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("up");
    expect(
      moveDirectionOf({
        key: "ArrowUp",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(branchKeyboardTarget(tree, "b", "up")).toEqual({ parentId: "root", index: 0 });
    expect(branchKeyboardTarget(tree, "a", "up")).toBeNull();
    expect(branchKeyboardTarget(tree, "a2", "left")).toEqual({ parentId: "root", index: 1 });
    expect(branchKeyboardTarget(tree, "b", "right")).toEqual({ parentId: "a", index: 2 });
    expect(branchKeyboardTarget(tree, "a", "left")).toBeNull();
    expect(branchKeyboardTarget(tree, "c", "down")).toBeNull();
  });
});
