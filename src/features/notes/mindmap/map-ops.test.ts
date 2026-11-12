import { describe, expect, it } from "vitest";
import { canRedo, canUndo, historyKeyOf, pushHistory, redoHistory, startHistory, undoHistory } from "./map-history";
import type { MapDoc, MapNode } from "./map-doc";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  addChild,
  addSibling,
  branchColors,
  findNode,
  focusAfterRemove,
  insertSuggestions,
  moveNode,
  outdentTarget,
  parentOf,
  rejectAllSuggestions,
  rejectSuggestion,
  removeNode,
  stepSelection,
  suggestedIds,
  toBranch,
  updateNode,
} from "./map-ops";

const n = (id: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({
  id,
  title: id.toUpperCase(),
  children,
  ...extra,
});

/** root ─ a ─ a1
 *       │   └ a2
 *       └ b */
function sample(): MapDoc {
  return { type: "mindmap", version: 1, root: n("root", [n("a", [n("a1"), n("a2")]), n("b")]) };
}

const ids = (node: MapNode): string[] => node.children.map((child) => child.id);

describe("map operations", () => {
  it("adds a child at the end and a sibling right after, never touching the old map", () => {
    const doc = sample();
    const child = addChild(doc, "a", "new");
    expect(ids(findNode(child.doc, "a")!)).toEqual(["a1", "a2", "new"]);
    expect(ids(findNode(doc, "a")!)).toEqual(["a1", "a2"]);

    const sibling = addSibling(doc, "a1", "s");
    expect(ids(findNode(sibling.doc, "a")!)).toEqual(["a1", "s", "a2"]);
    expect(findNode(sibling.doc, "s")).toMatchObject({ title: "", children: [] });

    // The centre has no siblings: Enter there adds a child.
    const fromRoot = addSibling(doc, "root", "r");
    expect(ids(fromRoot.doc.root)).toEqual(["a", "b", "r"]);
  });

  it("removes a branch with everything under it and picks the next selection", () => {
    const doc = sample();
    const next = removeNode(doc, "a");
    expect(ids(next.root)).toEqual(["b"]);
    expect(findNode(next, "a1")).toBeNull();
    expect(removeNode(doc, "root")).toBe(doc);

    expect(focusAfterRemove(doc, "a2")).toBe("a1");
    expect(focusAfterRemove(doc, "a1")).toBe("a2");
    expect(focusAfterRemove(doc, "b")).toBe("a");
    const single = removeNode(doc, "b");
    expect(focusAfterRemove(single, "a")).toBe("root");
  });

  it("moves a node with its subtree, never into itself, and a move to the same place is no step", () => {
    const doc = sample();
    const moved = moveNode(doc, "a", { parentId: "b", index: 0 });
    expect(ids(moved.root)).toEqual(["b"]);
    expect(ids(findNode(moved, "b")!)).toEqual(["a"]);
    expect(ids(findNode(moved, "a")!)).toEqual(["a1", "a2"]);

    expect(moveNode(doc, "a", { parentId: "a1", index: 0 })).toBe(doc);
    expect(moveNode(doc, "a2", { parentId: "a", index: 1 })).toBe(doc);
    expect(moveNode(doc, "root", { parentId: "b", index: 0 })).toBe(doc);

    const reordered = moveNode(doc, "a2", { parentId: "a", index: 0 });
    expect(ids(findNode(reordered, "a")!)).toEqual(["a2", "a1"]);
  });

  it("outdents right after the parent (Shift+Tab)", () => {
    const doc = sample();
    expect(outdentTarget(doc, "a1")).toEqual({ parentId: "root", index: 1 });
    expect(outdentTarget(doc, "a")).toBeNull();
    const next = moveNode(doc, "a1", outdentTarget(doc, "a1")!);
    expect(ids(next.root)).toEqual(["a", "a1", "b"]);
    expect(parentOf(next, "a1")?.id).toBe("root");
  });

  it("updates fields and removes the ones set empty; the title stays even when empty", () => {
    const doc = sample();
    const withNote = updateNode(doc, "b", { note: "Pozor na ceny", color: "gold" });
    expect(findNode(withNote, "b")).toMatchObject({ note: "Pozor na ceny", color: "gold" });
    const cleared = updateNode(withNote, "b", { note: undefined, title: "" });
    expect(findNode(cleared, "b")).toEqual({ id: "b", title: "", color: "gold", children: [] });
    expect(updateNode(doc, "b", { title: "B" })).toBe(doc);
    expect(updateNode(doc, "nope", { title: "x" })).toBe(doc);
  });

  it("colours each first-level branch in turn and lets a set colour flow down", () => {
    const doc = updateNode(sample(), "a1", { color: "pink" });
    const colors = branchColors(doc);
    expect(colors.get("root")).toBeNull();
    expect(colors.get("a")).toBe("violet");
    expect(colors.get("a2")).toBe("violet");
    expect(colors.get("a1")).toBe("pink");
    expect(colors.get("b")).toBe("teal");
  });

  it("moves the selection with the arrows, skipping hidden children", () => {
    const doc = sample();
    expect(stepSelection(doc, "a", "down")).toBe("b");
    expect(stepSelection(doc, "b", "up")).toBe("a");
    expect(stepSelection(doc, "a", "right")).toBe("a1");
    expect(stepSelection(doc, "a", "right", new Set(["a"]))).toBeNull();
    expect(stepSelection(doc, "a1", "left")).toBe("a");
    expect(stepSelection(doc, "root", "up")).toBeNull();
  });

  it("gives the map component ids and children only", () => {
    expect(toBranch(sample().root)).toEqual({
      id: "root",
      children: [
        { id: "a", children: [{ id: "a1", children: [] }, { id: "a2", children: [] }] },
        { id: "b", children: [] },
      ],
    });
  });
});

describe("Grady's suggestions", () => {
  it("inserts suggested branches marked, under the node, after what is there", () => {
    const { doc, ids: added } = insertSuggestions(sample(), "b", [
      { title: "  Ceny  ", children: [{ title: "Levnější" }, { title: "" }] },
      { title: "" },
      { title: "Lokalita" },
    ]);
    expect(added).toHaveLength(3);
    const b = findNode(doc, "b")!;
    expect(b.children.map((child) => [child.title, child.suggested])).toEqual([
      ["Ceny", true],
      ["Lokalita", true],
    ]);
    expect(b.children[0].children[0]).toMatchObject({ title: "Levnější", suggested: true });
    expect(suggestedIds(doc)).toHaveLength(3);
  });

  it("accepting keeps the branch below and any suggestion above it", () => {
    const { doc } = insertSuggestions(sample(), "b", [{ title: "Ceny", children: [{ title: "Levnější" }] }]);
    const child = findNode(doc, "b")!.children[0].children[0];
    const kept = acceptSuggestion(doc, child.id);
    expect(suggestedIds(kept)).toEqual([]);

    const parent = findNode(doc, "b")!.children[0];
    const keptParent = acceptSuggestion(doc, parent.id);
    expect(suggestedIds(keptParent)).toEqual([]);
  });

  it("deleting removes only suggestions, one or all", () => {
    const { doc } = insertSuggestions(sample(), "root", [{ title: "X" }, { title: "Y" }]);
    const [x] = suggestedIds(doc);
    expect(ids(rejectSuggestion(doc, x).root)).toEqual(["a", "b", findNode(doc, suggestedIds(doc)[1])!.id]);
    expect(rejectSuggestion(doc, "a")).toBe(doc);
    expect(ids(rejectAllSuggestions(doc).root)).toEqual(["a", "b"]);
    expect(suggestedIds(acceptAllSuggestions(doc))).toEqual([]);
    expect(ids(acceptAllSuggestions(doc).root)).toHaveLength(4);
  });
});

describe("undo and redo", () => {
  it("steps back and forth, a new change drops redo, the same map is no step", () => {
    const a = sample();
    const b = removeNode(a, "b");
    const c = removeNode(b, "a");
    let history = pushHistory(pushHistory(startHistory(a), b), c);
    expect(pushHistory(history, c)).toBe(history);
    history = undoHistory(history);
    expect(history.present).toBe(b);
    expect(canRedo(history)).toBe(true);
    history = redoHistory(history);
    expect(history.present).toBe(c);
    history = undoHistory(undoHistory(history));
    expect(history.present).toBe(a);
    expect(canUndo(history)).toBe(false);
    expect(undoHistory(history)).toBe(history);
    history = pushHistory(history, b);
    expect(canRedo(history)).toBe(false);
  });

  it("reads ⌘Z as undo and ⌘⇧Z or Ctrl+Y as redo", () => {
    const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
    });
    expect(historyKeyOf(key("z", { metaKey: true }))).toBe("undo");
    expect(historyKeyOf(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyKeyOf(key("y", { ctrlKey: true }))).toBe("redo");
    expect(historyKeyOf(key("z"))).toBeNull();
    expect(historyKeyOf(key("z", { metaKey: true, altKey: true }))).toBeNull();
  });
});
