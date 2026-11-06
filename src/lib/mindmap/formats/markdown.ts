import { fromOutline, indentWidth, node, unwrapRoot, type MindMapTree } from "./tree";

/**
 * Markdown outlines: headings `#`…`######` are levels, list items under them
 * nest by their indent (2 or 4 spaces or tabs), `[ ]` / `[x]` after the bullet
 * is the task's state. Other text lines are nodes at their indent too, so an
 * outline written without bullets still keeps its shape. Front matter, code
 * blocks and rules are skipped.
 */

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const EMPTY_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]*$/;
const CHECKBOX = /^\[([ xX])\][ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** Characters that mean something inline and are escaped on export. */
const ESCAPED = /[\\`*[\]]/g;

/** Inline Markdown to plain text: links to their text, emphasis and code marks dropped. */
export function plainInline(text: string): string {
  const kept: string[] = [];
  const hold = (character: string) => {
    kept.push(character);
    return `\uE000${kept.length - 1}\uE001`;
  };
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, (_, character: string) => hold(character))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\uE000(\d+)\uE001/g, (_, index: string) => kept[Number(index)] ?? "");
}

export function parseMarkdown(text: string): MindMapTree {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  const root = node("");
  const headings: { level: number; node: MindMapTree }[] = [{ level: 0, node: root }];
  let block: { parent: MindMapTree; lines: { indent: number; title: string; done?: boolean }[] } = {
    parent: root,
    lines: [],
  };
  const flush = () => {
    fromOutline(block.lines, block.parent);
    block.lines = [];
  };

  let index = 0;
  // Front matter at the very top.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, at) => at > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) index = end + 1;
  }
  let fence: string | null = null;

  for (; index < lines.length; index++) {
    const line = lines[index];
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence) {
      if (fenceMark === fence) fence = null;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark;
      continue;
    }
    if (!line.trim() || RULE.test(line) || EMPTY_ITEM.test(line)) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headings[headings.length - 1].level >= level) headings.pop();
      const item = node(plainInline(heading[2]));
      headings[headings.length - 1].node.children.push(item);
      headings.push({ level, node: item });
      block = { parent: item, lines: [] };
      continue;
    }

    const quoted = line.replace(/^(\s*)(?:>\s?)+/, "$1");
    const listItem = ITEM.exec(quoted);
    const indent = indentWidth(/^[ \t]*/.exec(quoted)![0]);
    let content = listItem ? listItem[2] : quoted.trim();
    let done: boolean | undefined;
    const checkbox = listItem ? CHECKBOX.exec(content) : null;
    if (checkbox) {
      done = checkbox[1] !== " ";
      content = checkbox[2];
    }
    block.lines.push({ indent, title: plainInline(content), done });
  }
  flush();
  return unwrapRoot(root);
}

export type MarkdownOptions = {
  /** Every item gets `[ ]` or `[x]`; by default when any node says whether it is done. */
  checkboxes?: boolean;
};

function escapeInline(text: string): string {
  return text.replace(ESCAPED, (character) => `\\${character}`);
}

function hasState(tree: MindMapTree): boolean {
  return tree.children.some((child) => child.done !== undefined || hasState(child));
}

/** The root as a `#` heading, everything below as a list indented by two spaces. */
export function toMarkdown(tree: MindMapTree, options: MarkdownOptions = {}): string {
  const checkboxes = options.checkboxes ?? hasState(tree);
  const lines: string[] = [];
  if (tree.title) lines.push(`# ${escapeInline(tree.title)}`, "");
  const walk = (list: MindMapTree[], depth: number) => {
    for (const item of list) {
      const box = checkboxes ? (item.done ? "[x] " : "[ ] ") : "";
      lines.push(`${"  ".repeat(depth)}- ${box}${escapeInline(item.title)}`);
      walk(item.children, depth + 1);
    }
  };
  walk(tree.children, 0);
  return `${lines.join("\n")}\n`;
}
