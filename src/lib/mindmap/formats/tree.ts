/**
 * The tree every mind map format turns into, and every export starts from:
 * a node with a title, its children in order and, for tasks, whether it is
 * done (`undefined` = the format says nothing about it).
 */
export type MindMapTree = { title: string; children: MindMapTree[]; done?: boolean };

/** Largest file a mind map is read from. */
export const MINDMAP_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** More nodes than this in one file is refused, whatever the format. */
export const MINDMAP_MAX_NODES = 5000;
/** A longer title is cut; it only bounds what a file can carry. */
export const MINDMAP_TITLE_MAX = 1000;

export function node(title: string, children: MindMapTree[] = [], done?: boolean): MindMapTree {
  return done === undefined ? { title, children } : { title, children, done };
}

/** Every node below the root, however deep. */
export function countNodes(tree: MindMapTree): number {
  let count = 0;
  const stack = [...tree.children];
  while (stack.length) {
    const next = stack.pop()!;
    count += 1;
    stack.push(...next.children);
  }
  return count;
}

/** How many levels reach below the root: 0 without children, 1 for a flat list. */
export function treeDepth(tree: MindMapTree): number {
  let depth = 0;
  let level = tree.children;
  while (level.length) {
    depth += 1;
    level = level.flatMap((child) => child.children);
  }
  return depth;
}

/** Whitespace of a title collapsed to single spaces and trimmed, cut to the limit. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MINDMAP_TITLE_MAX);
}

/**
 * Clean titles everywhere; a node without a title gives its children to its
 * parent in its place, so nothing below it is lost. The root keeps an empty
 * title (the caller names it, e.g. after the file).
 */
export function normalizeTree(tree: MindMapTree): MindMapTree {
  const clean = (list: MindMapTree[]): MindMapTree[] =>
    list.flatMap((item) => {
      const title = cleanTitle(item.title);
      const children = clean(item.children);
      if (!title) return children;
      return [node(title, children, item.done)];
    });
  return node(cleanTitle(tree.title), clean(tree.children), tree.done);
}

/**
 * A root without a title around exactly one node is that node: a file with
 * one central topic (a single heading, a single outline) has it as the root.
 */
export function unwrapRoot(tree: MindMapTree): MindMapTree {
  let current = tree;
  while (!current.title && current.children.length === 1) current = current.children[0];
  return current;
}

/**
 * Nodes deeper than `level` (1 = the root's children) move up to `level`,
 * right after their ancestor on that level, in the order they were in.
 */
export function flattenFrom(tree: MindMapTree, level: number): MindMapTree {
  const keep = Math.max(1, Math.trunc(level));
  const all = (item: MindMapTree): MindMapTree[] =>
    item.children.flatMap((child) => [node(child.title, [], child.done), ...all(child)]);
  const walk = (list: MindMapTree[], depth: number): MindMapTree[] =>
    list.flatMap((item) =>
      depth < keep
        ? [node(item.title, walk(item.children, depth + 1), item.done)]
        : [node(item.title, [], item.done), ...all(item)],
    );
  return node(tree.title, walk(tree.children, 1), tree.done);
}

/** One line of an indented outline: how far in it starts, its title and its tick. */
export type OutlineLine = { indent: number; title: string; done?: boolean };

/**
 * An outline from indented lines: a line indented further than the one above
 * is its child, as far in is its sibling, less goes back up to the nearest
 * line that is not further in. Works for 2 or 4 spaces and tabs alike.
 */
export function fromOutline(lines: OutlineLine[], parent: MindMapTree = node("")): MindMapTree {
  const stack: { indent: number; node: MindMapTree }[] = [];
  for (const line of lines) {
    while (stack.length && stack[stack.length - 1].indent >= line.indent) stack.pop();
    const item = node(line.title, [], line.done);
    (stack.length ? stack[stack.length - 1].node : parent).children.push(item);
    stack.push({ indent: line.indent, node: item });
  }
  return parent;
}

/** Leading whitespace as a width: a tab is four spaces. */
export function indentWidth(whitespace: string): number {
  let width = 0;
  for (const character of whitespace) width += character === "\t" ? 4 : 1;
  return width;
}
