import type { MapBranch } from "@/components/tree-map/tree-map-layout";

/**
 * The tree of a mind map as the map sees it: ids and children only, nothing
 * about tasks or notes. What a drop or a key means for the data is up to the
 * screen using the map; these are the defaults and the shared rules.
 */

/** Where a node dragged in the map is over another node. */
export type MapDropZone = "before" | "inside" | "after";

export type MindMapDirection = "up" | "down" | "left" | "right";

/** Where a node goes: under a parent (the root's id for the first level), at an index among its new siblings. */
export type BranchTarget = { parentId: string; index: number };

/** The upper and the lower quarter of a node put the dragged one next to it, the middle under it. */
export function mapDropZone(rect: { top: number; height: number }, y: number): MapDropZone {
  const share = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  if (share < 0.25) return "before";
  if (share > 0.75) return "after";
  return "inside";
}

const ARROWS: Record<string, MindMapDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** The direction of ⌘/Ctrl + an arrow, or null for any other key. */
export function moveDirectionOf(event: KeyLike): MindMapDirection | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  return ARROWS[event.key] ?? null;
}

/** Every node's parent (the root has none) and its branch. */
export function indexBranches(tree: MapBranch) {
  const parents = new Map<string, string>();
  const branches = new Map<string, MapBranch>();
  const stack = [tree];
  while (stack.length) {
    const branch = stack.pop()!;
    branches.set(branch.id, branch);
    for (const child of branch.children) {
      parents.set(child.id, branch.id);
      stack.push(child);
    }
  }
  return { parents, branches };
}

/** A node and everything below it. */
export function branchSubtree(tree: MapBranch, id: string): Set<string> {
  const start = indexBranches(tree).branches.get(id);
  const found = new Set<string>();
  const stack = start ? [start] : [];
  while (stack.length) {
    const branch = stack.pop()!;
    found.add(branch.id);
    stack.push(...branch.children);
  }
  return found;
}

/**
 * The default meaning of a drop: on the root = last on the first level,
 * inside a node = its last child, before or after = its sibling right there.
 * Null for a drop onto the node itself or into its own subtree.
 */
export function branchDropTarget(
  tree: MapBranch,
  activeId: string,
  overId: string,
  zone: MapDropZone,
): BranchTarget | null {
  const { parents, branches } = indexBranches(tree);
  if (activeId === tree.id || !branches.has(activeId) || !branches.has(overId)) return null;
  if (branchSubtree(tree, activeId).has(overId)) return null;
  const others = (parentId: string) =>
    (branches.get(parentId)?.children ?? []).filter((child) => child.id !== activeId);
  if (overId === tree.id || zone === "inside") {
    return { parentId: overId, index: others(overId).length };
  }
  const parentId = parents.get(overId)!;
  const index = others(parentId).findIndex((child) => child.id === overId);
  return { parentId, index: zone === "before" ? index : index + 1 };
}

/**
 * ⌘/Ctrl + arrows on a node: ↑/↓ swap it with the sibling above or below,
 * ← makes it a sibling of its parent (right after it), → the last child of
 * the sibling above. Null when there is nowhere to go.
 */
export function branchKeyboardTarget(
  tree: MapBranch,
  id: string,
  direction: MindMapDirection,
): BranchTarget | null {
  const { parents, branches } = indexBranches(tree);
  const parentId = parents.get(id);
  if (parentId === undefined) return null;
  const siblings = branches.get(parentId)!.children;
  const index = siblings.findIndex((child) => child.id === id);
  switch (direction) {
    case "up":
      return index > 0 ? { parentId, index: index - 1 } : null;
    case "down":
      return index < siblings.length - 1 ? { parentId, index: index + 1 } : null;
    case "left": {
      const grandparent = parents.get(parentId);
      if (grandparent === undefined) return null;
      const at = branches.get(grandparent)!.children.findIndex((child) => child.id === parentId);
      return { parentId: grandparent, index: at + 1 };
    }
    case "right": {
      const above = siblings[index - 1];
      return above ? { parentId: above.id, index: above.children.length } : null;
    }
  }
}
