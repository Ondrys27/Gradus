import type { MapBranch } from "@/components/tree-map/tree-map-layout";
import type { TaskNode } from "./task-tree";

export * from "@/components/tree-map/tree-map-layout";

/** The milestone is the root, its tasks the branches, subtasks the leaves. */
export function toBranch(rootId: string, tree: TaskNode[]): MapBranch {
  const convert = (node: TaskNode): MapBranch => ({
    id: node.task.id,
    children: node.children.map(convert),
  });
  return { id: rootId, children: tree.map(convert) };
}
