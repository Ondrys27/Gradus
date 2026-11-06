import { FormatError } from "./errors";
import { node, type MindMapTree } from "./tree";
import { childElements, escapeAttribute, parseXml, textContent, type XmlElement } from "./xml";

/**
 * FreeMind and Freeplane `.mm`: `<map><node TEXT="…">` nested. Long or
 * formatted text sits in `<richcontent TYPE="NODE">` as HTML. Done is the
 * "OK" icon (`button_ok`) or Freeplane's `checked`.
 */

const DONE_ICONS = new Set(["button_ok", "checked"]);
const OPEN_ICONS = new Set(["unchecked", "button_cancel"]);

function nodeTitle(element: XmlElement): string {
  const text = element.attributes.TEXT ?? element.attributes.LOCALIZED_TEXT;
  if (text !== undefined) return text;
  const rich = childElements(element, "richcontent").find(
    (content) => !content.attributes.TYPE || content.attributes.TYPE === "NODE",
  );
  return rich ? textContent(rich) : "";
}

function nodeState(element: XmlElement): boolean | undefined {
  const icons = childElements(element, "icon").map((icon) => icon.attributes.BUILTIN ?? "");
  if (icons.some((icon) => DONE_ICONS.has(icon))) return true;
  if (icons.some((icon) => OPEN_ICONS.has(icon))) return false;
  return undefined;
}

function fromNode(element: XmlElement): MindMapTree {
  return node(nodeTitle(element), childElements(element, "node").map(fromNode), nodeState(element));
}

export function parseFreeMind(text: string): MindMapTree {
  const root = parseXml(text);
  if (root.name !== "map") throw new FormatError("unsupported");
  const top = childElements(root, "node");
  if (top.length === 0) throw new FormatError("empty");
  return top.length === 1 ? fromNode(top[0]) : node("", top.map(fromNode));
}

export function toFreeMind(tree: MindMapTree): string {
  const lines = ['<map version="1.0.1">'];
  let id = 0;
  const write = (item: MindMapTree, depth: number) => {
    id += 1;
    const position = depth === 1 ? ' POSITION="right"' : "";
    const open = `<node TEXT="${escapeAttribute(item.title)}" ID="ID_${id}"${position}`;
    if (!item.done && item.children.length === 0) {
      lines.push(`${open}/>`);
      return;
    }
    lines.push(`${open}>`);
    if (item.done) lines.push('<icon BUILTIN="button_ok"/>');
    item.children.forEach((child) => write(child, depth + 1));
    lines.push("</node>");
  };
  write(tree, 0);
  lines.push("</map>");
  return `${lines.join("\n")}\n`;
}
