import { FormatError } from "./errors";
import { node, type MindMapTree } from "./tree";
import {
  childElements,
  escapeAttribute,
  firstChild,
  parseXml,
  textContent,
  type XmlElement,
} from "./xml";

/**
 * OPML 1.0 / 2.0, the outline format of MindNode, Workflowy, OmniOutliner and
 * most mind map apps. A node is an `<outline text="…">`; done is
 * `_status="checked"` (OmniOutliner) or `_complete="true"` (Workflowy).
 */

function outlineState(outline: XmlElement): boolean | undefined {
  const status = outline.attributes._status?.toLowerCase();
  if (status === "checked" || status === "done" || status === "complete") return true;
  if (status === "unchecked" || status === "indeterminate") return false;
  const complete = outline.attributes._complete?.toLowerCase();
  if (complete === "true") return true;
  if (complete === "false") return false;
  return undefined;
}

function fromOutline(outline: XmlElement): MindMapTree {
  return node(
    outline.attributes.text ?? outline.attributes.title ?? "",
    childElements(outline, "outline").map(fromOutline),
    outlineState(outline),
  );
}

export function parseOpml(text: string): MindMapTree {
  const root = parseXml(text);
  if (root.name !== "opml") throw new FormatError("unsupported");
  const body = firstChild(root, "body");
  if (!body) throw new FormatError("unreadable");
  const outlines = childElements(body, "outline").map(fromOutline);
  if (outlines.length === 1) return outlines[0];
  const head = firstChild(root, "head");
  const title = head && firstChild(head, "title");
  return node(title ? textContent(title) : "", outlines);
}

export function toOpml(tree: MindMapTree): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeAttribute(tree.title)}</title>`,
    "  </head>",
    "  <body>",
  ];
  const write = (item: MindMapTree, depth: number) => {
    const pad = "  ".repeat(depth);
    const state = item.done ? ' _status="checked"' : "";
    const open = `${pad}<outline text="${escapeAttribute(item.title)}"${state}`;
    if (item.children.length === 0) {
      lines.push(`${open}/>`);
      return;
    }
    lines.push(`${open}>`);
    item.children.forEach((child) => write(child, depth + 1));
    lines.push(`${pad}</outline>`);
  };
  write(tree, 2);
  lines.push("  </body>", "</opml>");
  return `${lines.join("\n")}\n`;
}
