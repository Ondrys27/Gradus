import { countNodes, flattenFrom, node, treeDepth, type MindMapTree } from "@/lib/mindmap/formats";
import { TITLE_MAX } from "./schemas";
import { MAX_TASK_LEVELS, siblingsOf } from "./task-tree";
import type { Milestone, Task } from "./types";

/**
 * Between a milestone's tasks and the mind map tree of the formats: the
 * milestone is the root, its tasks the branches. Pure, so the import plan and
 * the export are tested without a browser.
 */

/** Tasks of one milestone the app reads at most (useTasks); an import keeps within it. */
export const MILESTONE_TASK_LIMIT = 2000;
/** Most tasks one import adds. */
export const IMPORT_MAX_TASKS = 1000;

export const EXPORT_FORMATS = ["markdown", "opml", "freemind", "png"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const IMPORT_MODES = ["append", "replace", "new"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** The milestone as a tree: its title at the root, every task with its state, in order. */
export function tasksToMindMap(
  milestone: Pick<Milestone, "title">,
  tasks: Pick<Task, "id" | "parent_task_id" | "position" | "title" | "status">[],
): MindMapTree {
  const below = (parentId: string | null): MindMapTree[] =>
    siblingsOf(tasks, parentId).map((task) =>
      node(task.title, below(task.id), task.status === "done"),
    );
  return node(milestone.title, below(null));
}

/**
 * What becomes tasks: the root's children. A file with a single node and
 * nothing below it is that one task.
 */
export function importItems(tree: MindMapTree): MindMapTree {
  return tree.children.length === 0 && tree.title ? node("", [tree]) : tree;
}

/** A node counts as done only with everything below it done, as the app requires. */
export function consistentTree(item: MindMapTree): MindMapTree {
  const children = item.children.map(consistentTree);
  const done = item.done === true && children.every((child) => child.done === true);
  return node(item.title, children, done);
}

export type ImportSummary = {
  /** Tasks the import would add. */
  tasks: number;
  /** Levels below the milestone. */
  depth: number;
  /** Of them already done. */
  done: number;
  /** Deeper than a milestone holds: flattening is needed. */
  tooDeep: boolean;
};

export function importSummary(items: MindMapTree, maxLevels = MAX_TASK_LEVELS): ImportSummary {
  let done = 0;
  const walk = (item: MindMapTree) => {
    if (item.done) done += 1;
    item.children.forEach(walk);
  };
  consistentTree(items).children.forEach(walk);
  const depth = treeDepth(items);
  return { tasks: countNodes(items), depth, done, tooDeep: depth > maxLevels };
}

/** The tree as it will be imported: flattened from `level` when it is too deep. */
export function prepareImport(items: MindMapTree, flattenLevel: number | null): MindMapTree {
  return flattenLevel === null ? items : flattenFrom(items, flattenLevel);
}

export type ImportRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: "todo" | "done";
  position: number;
  /** 1 for a task right under the milestone. */
  level: number;
};

/**
 * The rows to insert, parents before their children. A done node becomes a
 * done task only when everything below it is done too (a task with open
 * subtasks can not be ticked); the first level continues after the
 * milestone's last task, deeper levels count from 0.
 */
export function planImport(
  items: MindMapTree,
  { startPosition, newId }: { startPosition: number; newId: () => string },
): ImportRow[] {
  const rows: ImportRow[] = [];
  const walk = (list: MindMapTree[], parentId: string | null, level: number) => {
    list.forEach((item, index) => {
      const id = newId();
      rows.push({
        id,
        parent_task_id: parentId,
        title: item.title.slice(0, TITLE_MAX).trim(),
        status: item.done ? "done" : "todo",
        position: level === 1 ? startPosition + index : index,
        level,
      });
      walk(item.children, id, level + 1);
    });
  };
  walk(consistentTree(items).children, null, 1);
  return rows;
}

export type ImportBlock = "tooMany" | "milestoneFull" | "tooDeep" | "empty";

/** Why an import can not go ahead as it is, or null. */
export function importBlock(
  summary: ImportSummary,
  { existing, replace, flattened }: { existing: number; replace: boolean; flattened: boolean },
): ImportBlock | null {
  if (summary.tasks === 0) return "empty";
  if (summary.tooDeep && !flattened) return "tooDeep";
  if (summary.tasks > IMPORT_MAX_TASKS) return "tooMany";
  if ((replace ? 0 : existing) + summary.tasks > MILESTONE_TASK_LIMIT) return "milestoneFull";
  return null;
}

/** A file name from a title: no characters file systems refuse, at most 80 long. */
export function mapFileName(title: string, extension: string, fallback: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return `${base || fallback}.${extension}`;
}
