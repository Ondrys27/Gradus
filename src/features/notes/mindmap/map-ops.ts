/**
 * Changes to a note's mind map: pure functions from one map to the next, so
 * every change is one step of undo and can be tested without a screen. A
 * function that cannot do what it is asked returns the same object.
 */
import type { MapBranch } from "@/components/tree-map/tree-map-layout";
import type { BranchTarget } from "@/components/mindmap/mind-map-tree";
import {
  BRANCH_COLORS,
  MAP_LIMITS,
  newNodeId,
  type BranchColor,
  type MapDoc,
  type MapNode,
} from "./map-doc";

/** The ids and children the map component draws. */
export function toBranch(node: MapNode): MapBranch {
  return { id: node.id, children: node.children.map(toBranch) };
}

export function findNode(doc: MapDoc, id: string): MapNode | null {
  const stack = [doc.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return null;
}

/** The node's parent, or null for the root (and for an id that is not there). */
export function parentOf(doc: MapDoc, id: string): MapNode | null {
  const stack = [doc.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children.some((child) => child.id === id)) return node;
    stack.push(...node.children);
  }
  return null;
}

/** Copies the path down to the node with `id` and gives it to `change`. */
function mapNode(doc: MapDoc, id: string, change: (node: MapNode) => MapNode): MapDoc {
  let changed = false;
  const walk = (node: MapNode): MapNode => {
    if (node.id === id) {
      const next = change(node);
      if (next !== node) changed = true;
      return next;
    }
    let children: MapNode[] | null = null;
    node.children.forEach((child, index) => {
      const next = walk(child);
      if (next !== child) {
        children ??= [...node.children];
        children[index] = next;
      }
    });
    return children ? { ...node, children } : node;
  };
  const root = walk(doc.root);
  return changed ? { ...doc, root } : doc;
}

export type NodePatch = Partial<Pick<MapNode, "title" | "note" | "color" | "link">>;

/** New title, note, colour or link; `undefined` in the patch removes the field. */
export function updateNode(doc: MapDoc, id: string, patch: NodePatch): MapDoc {
  return mapNode(doc, id, (node) => {
    const next: MapNode = { ...node };
    let changed = false;
    for (const key of Object.keys(patch) as (keyof NodePatch)[]) {
      const value = patch[key];
      if (JSON.stringify(value) === JSON.stringify(node[key])) continue;
      changed = true;
      if (key !== "title" && (value === undefined || value === "")) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    return changed ? next : node;
  });
}

export function canAddNodes(doc: MapDoc, count = 1): boolean {
  let nodes = 0;
  const stack = [...doc.root.children];
  while (stack.length) {
    const next = stack.pop()!;
    nodes += 1;
    stack.push(...next.children);
  }
  return nodes + count <= MAP_LIMITS.nodes;
}

function depthOf(doc: MapDoc, id: string): number {
  let depth = 0;
  let current = parentOf(doc, id);
  while (current) {
    depth += 1;
    current = parentOf(doc, current.id);
  }
  return depth;
}

export type Added = { doc: MapDoc; id: string | null };

/** A new empty node as the last child of `parentId`. */
export function addChild(doc: MapDoc, parentId: string, id = newNodeId()): Added {
  if (!canAddNodes(doc) || !findNode(doc, parentId)) return { doc, id: null };
  if (depthOf(doc, parentId) + 1 > MAP_LIMITS.depth) return { doc, id: null };
  const next = mapNode(doc, parentId, (node) => ({
    ...node,
    children: [...node.children, { id, title: "", children: [] }],
  }));
  return { doc: next, id };
}

/** A new empty node right after `id`; the root has no siblings, so it gets a child. */
export function addSibling(doc: MapDoc, siblingId: string, id = newNodeId()): Added {
  const parent = parentOf(doc, siblingId);
  if (!parent) return addChild(doc, siblingId, id);
  if (!canAddNodes(doc)) return { doc, id: null };
  const next = mapNode(doc, parent.id, (node) => {
    const at = node.children.findIndex((child) => child.id === siblingId);
    const children = [...node.children];
    children.splice(at + 1, 0, { id, title: "", children: [] });
    return { ...node, children };
  });
  return { doc: next, id };
}

/** Removes a node with everything below it; the root stays. */
export function removeNode(doc: MapDoc, id: string): MapDoc {
  const parent = parentOf(doc, id);
  if (!parent) return doc;
  return mapNode(doc, parent.id, (node) => ({
    ...node,
    children: node.children.filter((child) => child.id !== id),
  }));
}

/** Where the selection goes when `id` is removed: the sibling above, else below, else the parent. */
export function focusAfterRemove(doc: MapDoc, id: string): string | null {
  const parent = parentOf(doc, id);
  if (!parent) return null;
  const at = parent.children.findIndex((child) => child.id === id);
  return parent.children[at - 1]?.id ?? parent.children[at + 1]?.id ?? parent.id;
}

function contains(node: MapNode, id: string): boolean {
  return node.id === id || node.children.some((child) => contains(child, id));
}

/**
 * Moves a node with its subtree under `parentId` at `index` among the new
 * siblings (counted without the node itself). Never into its own subtree.
 */
export function moveNode(doc: MapDoc, id: string, target: BranchTarget): MapDoc {
  const node = findNode(doc, id);
  const from = parentOf(doc, id);
  if (!node || !from || contains(node, target.parentId)) return doc;
  const without = removeNode(doc, id);
  const moved = mapNode(without, target.parentId, (parent) => {
    const children = [...parent.children];
    const index = Math.max(0, Math.min(target.index, children.length));
    children.splice(index, 0, node);
    return { ...parent, children };
  });
  // The same place it was: nothing changed.
  if (from.id === target.parentId) {
    const before = from.children.map((child) => child.id).join(",");
    const after = findNode(moved, from.id)?.children.map((child) => child.id).join(",");
    if (before === after) return doc;
  }
  return moved;
}

/** The node one level up, right after its parent (Shift+Tab). */
export function outdentTarget(doc: MapDoc, id: string): BranchTarget | null {
  const parent = parentOf(doc, id);
  if (!parent) return null;
  const grandparent = parentOf(doc, parent.id);
  if (!grandparent) return null;
  const at = grandparent.children.findIndex((child) => child.id === parent.id);
  return { parentId: grandparent.id, index: at + 1 };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/**
 * The colour every node is drawn in: its own, else the nearest ancestor's,
 * else the colour of its first-level branch (the six in turn). The root has
 * none of its own unless set.
 */
export function branchColors(doc: MapDoc): Map<string, BranchColor | null> {
  const colors = new Map<string, BranchColor | null>();
  colors.set(doc.root.id, doc.root.color ?? null);
  const walk = (node: MapNode, inherited: BranchColor) => {
    const color = node.color ?? inherited;
    colors.set(node.id, color);
    for (const child of node.children) walk(child, color);
  };
  doc.root.children.forEach((branch, index) => {
    walk(branch, doc.root.color ?? BRANCH_COLORS[index % BRANCH_COLORS.length]);
  });
  return colors;
}

// ---------------------------------------------------------------------------
// Keyboard: moving the selection
// ---------------------------------------------------------------------------

export type Step = "up" | "down" | "left" | "right";

/**
 * The node an arrow key selects: ↑/↓ the sibling above or below, ← the
 * parent, → the first child (hidden children of a collapsed node are skipped
 * by the caller passing `collapsed`).
 */
export function stepSelection(
  doc: MapDoc,
  id: string,
  step: Step,
  collapsed: ReadonlySet<string> = new Set(),
): string | null {
  const node = findNode(doc, id);
  if (!node) return null;
  const parent = parentOf(doc, id);
  switch (step) {
    case "left":
      return parent?.id ?? null;
    case "right":
      return collapsed.has(id) ? null : (node.children[0]?.id ?? null);
    case "up":
    case "down": {
      if (!parent) return null;
      const at = parent.children.findIndex((child) => child.id === id);
      return parent.children[at + (step === "up" ? -1 : 1)]?.id ?? null;
    }
  }
}

// ---------------------------------------------------------------------------
// Jarvis's suggestions
// ---------------------------------------------------------------------------

export type SuggestedBranch = { title: string; children?: SuggestedBranch[] };

/** Suggested branches as nodes under `parentId`, marked as suggestions; their ids come back. */
export function insertSuggestions(
  doc: MapDoc,
  parentId: string,
  branches: readonly SuggestedBranch[],
): { doc: MapDoc; ids: string[] } {
  const ids: string[] = [];
  let room = MAP_LIMITS.nodes;
  const stack = [...doc.root.children];
  while (stack.length) {
    room -= 1;
    stack.push(...stack.pop()!.children);
  }
  const build = (branch: SuggestedBranch): MapNode | null => {
    const title = branch.title.replace(/\s+/g, " ").trim().slice(0, MAP_LIMITS.title);
    if (!title || room <= 0) return null;
    room -= 1;
    const id = newNodeId();
    ids.push(id);
    return {
      id,
      title,
      suggested: true,
      children: (branch.children ?? []).flatMap((child) => build(child) ?? []),
    };
  };
  const nodes = branches.flatMap((branch) => build(branch) ?? []);
  if (nodes.length === 0) return { doc, ids: [] };
  const next = mapNode(doc, parentId, (node) => ({ ...node, children: [...node.children, ...nodes] }));
  return next === doc ? { doc, ids: [] } : { doc: next, ids };
}

export function suggestedIds(doc: MapDoc): string[] {
  const ids: string[] = [];
  const walk = (node: MapNode) => {
    if (node.suggested) ids.push(node.id);
    node.children.forEach(walk);
  };
  walk(doc.root);
  return ids;
}

function clearMark(node: MapNode): MapNode {
  const { suggested: _suggested, ...rest } = node;
  void _suggested;
  return { ...rest, children: node.children.map(clearMark) };
}

/**
 * The user keeps a suggestion: the node with everything below it becomes
 * theirs, and so does any suggested node above it (a kept branch never
 * hangs under a suggestion).
 */
export function acceptSuggestion(doc: MapDoc, id: string): MapDoc {
  const node = findNode(doc, id);
  if (!node) return doc;
  let next = mapNode(doc, id, clearMark);
  for (let parent = parentOf(next, id); parent; parent = parentOf(next, parent.id)) {
    if (parent.suggested) {
      next = mapNode(next, parent.id, (item) => {
        const { suggested: _suggested, ...rest } = item;
        void _suggested;
        return rest;
      });
    }
  }
  return next;
}

/** The user does not want a suggestion: it goes with everything below it. */
export function rejectSuggestion(doc: MapDoc, id: string): MapDoc {
  return findNode(doc, id)?.suggested ? removeNode(doc, id) : doc;
}

export function acceptAllSuggestions(doc: MapDoc): MapDoc {
  return suggestedIds(doc).length ? { ...doc, root: clearMark(doc.root) } : doc;
}

export function rejectAllSuggestions(doc: MapDoc): MapDoc {
  const strip = (node: MapNode): MapNode => ({
    ...node,
    children: node.children.filter((child) => !child.suggested).map(strip),
  });
  return suggestedIds(doc).length ? { ...doc, root: strip(doc.root) } : doc;
}
