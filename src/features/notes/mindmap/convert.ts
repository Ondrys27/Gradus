/**
 * Turning notes into maps and back, and maps into the shared mind map tree
 * of the file formats (src/lib/mindmap/formats):
 *   - a text note (headings, lists, paragraphs) → a map: the first line is
 *     the centre, headings nest by their level, list items by their indent,
 *     other lines hang under the heading above them;
 *   - a map → a text note: the centre as the title, the branches as a
 *     nested bullet list (Markdown in the editor), notes and links kept;
 *   - a map ↔ MindMapTree for import and export.
 * Suggestions nobody accepted are never converted or exported.
 */
import { flattenFrom, parsePlainText, treeDepth, type MindMapTree } from "@/lib/mindmap/formats";
import type { DocNode } from "../document";
import { mentionAttrsOf, type MentionAttrs } from "../mentions";
import {
  acceptedRoot,
  cleanNodeTitle,
  MAP_DOC_TYPE,
  MAP_LIMITS,
  newNodeId,
  normalizeUrl,
  type MapDoc,
  type MapLink,
  type MapNode,
} from "./map-doc";

// ---------------------------------------------------------------------------
// Text note → map
// ---------------------------------------------------------------------------

const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

type Line = { title: string; link?: MapLink };

/** One block's text as a node: its words, and the record or page it links to. */
function lineOf(block: DocNode): Line {
  const mentions: MentionAttrs[] = [];
  let href: string | null = null;
  const parts: { text: string; mention?: MentionAttrs }[] = [];
  const walk = (node: DocNode) => {
    if (node.type === "text") {
      parts.push({ text: node.text ?? "" });
      const mark = node.marks?.find((m) => m.type === "link");
      if (!href && typeof mark?.attrs?.href === "string") href = mark.attrs.href;
      return;
    }
    if (node.type === "hardBreak") {
      parts.push({ text: " " });
      return;
    }
    const mention = mentionAttrsOf(node);
    if (mention) {
      mentions.push(mention);
      parts.push({ text: mention.label, mention });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(block);
  // One record in the line becomes the node's chip, the rest of the words its title.
  const single = mentions.length === 1 ? mentions[0] : null;
  const title = cleanNodeTitle(
    parts
      .filter((part) => !(single && part.mention === single))
      .map((part) => part.text)
      .join(""),
  );
  if (mentions[0]) return { title, link: { type: "mention", attrs: mentions[0] } };
  const url = href ? normalizeUrl(href) : null;
  return url ? { title, link: { type: "url", href: url } } : { title };
}

function nodeOf(line: Line): MapNode {
  return line.link
    ? { id: newNodeId(), title: line.title, link: line.link, children: [] }
    : { id: newNodeId(), title: line.title, children: [] };
}

const hasContent = (line: Line) => !!line.title || !!line.link;

/**
 * A text note as a map. The first line (the note's title) is the centre;
 * headings below it are branches by level, list items nest under the
 * heading above them, plain lines too.
 */
export function textDocToMap(doc: DocNode | null | undefined, fallbackTitle = ""): MapDoc {
  const root: MapNode = { id: newNodeId(), title: "", children: [] };
  let titled = false;
  const headings: { level: number; node: MapNode }[] = [{ level: 0, node: root }];
  const under = () => headings[headings.length - 1].node;

  const addItem = (item: DocNode, parent: MapNode) => {
    let node: MapNode | null = null;
    for (const child of item.content ?? []) {
      if (TEXT_BLOCKS.has(child.type)) {
        const line = lineOf(child);
        if (!hasContent(line)) continue;
        if (!node) {
          node = nodeOf(line);
          parent.children.push(node);
        } else {
          node.children.push(nodeOf(line));
        }
      } else if (LISTS.has(child.type)) {
        const host = node ?? parent;
        for (const nested of child.content ?? []) addItem(nested, host);
      }
    }
  };

  const block = (node: DocNode) => {
    if (TEXT_BLOCKS.has(node.type)) {
      const line = lineOf(node);
      if (!hasContent(line)) return;
      if (!titled) {
        titled = true;
        root.title = cleanNodeTitle(line.title, MAP_LIMITS.rootTitle);
        if (line.link) root.link = line.link;
        return;
      }
      if (node.type === "heading") {
        const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
        while (headings.length > 1 && headings[headings.length - 1].level >= level) headings.pop();
        const item = nodeOf(line);
        under().children.push(item);
        headings.push({ level, node: item });
        return;
      }
      under().children.push(nodeOf(line));
      return;
    }
    if (LISTS.has(node.type)) {
      for (const item of node.content ?? []) addItem(item, under());
      return;
    }
    for (const child of node.content ?? []) block(child);
  };

  for (const node of doc?.content ?? []) block(node);
  if (!root.title) root.title = cleanNodeTitle(fallbackTitle, MAP_LIMITS.rootTitle);
  return limitMap({ type: MAP_DOC_TYPE, version: 1, root });
}

/** Keeps a converted or imported map within the depth and the node count of a note. */
function limitMap(doc: MapDoc): MapDoc {
  let budget = MAP_LIMITS.nodes;
  const cut = (node: MapNode, depth: number): MapNode => {
    const children: MapNode[] = [];
    if (depth < MAP_LIMITS.depth) {
      for (const child of node.children) {
        if (budget <= 0) break;
        budget -= 1;
        children.push(cut(child, depth + 1));
      }
    }
    return { ...node, children };
  };
  return { ...doc, root: cut(doc.root, 0) };
}

// ---------------------------------------------------------------------------
// Map → text note
// ---------------------------------------------------------------------------

function text(value: string, href?: string): DocNode {
  return href
    ? { type: "text", text: value, marks: [{ type: "link", attrs: { href } }] }
    : { type: "text", text: value };
}

function inline(node: MapNode): DocNode[] {
  const out: DocNode[] = [];
  if (node.link?.type === "url") {
    out.push(text(node.title || node.link.href, node.link.href));
    return out;
  }
  if (node.title) out.push(text(node.title));
  if (node.link?.type === "mention") {
    if (node.title) out.push(text(" "));
    out.push({ type: "mention", attrs: { ...node.link.attrs } });
  }
  return out;
}

function paragraph(content: DocNode[]): DocNode {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function list(nodes: MapNode[]): DocNode {
  return {
    type: "bulletList",
    content: nodes.map((node) => ({
      type: "listItem",
      content: [
        paragraph(inline(node)),
        ...(node.note ? [paragraph([text(node.note)])] : []),
        ...(node.children.length ? [list(node.children)] : []),
      ],
    })),
  };
}

/** A map as a text note: the centre as its title, the branches as a nested bullet list. */
export function mapToTextDoc(doc: MapDoc): DocNode {
  const root = acceptedRoot(doc.root);
  const content: DocNode[] = [
    { type: "heading", attrs: { level: 1 }, content: inline(root) },
  ];
  if (root.note) content.push(paragraph([text(root.note)]));
  content.push(root.children.length ? list(root.children) : { type: "paragraph" });
  return { type: "doc", content };
}

// ---------------------------------------------------------------------------
// Map ↔ the formats' tree
// ---------------------------------------------------------------------------

/** For export: titles and order; suggestions left out. */
export function mapToMindTree(doc: MapDoc): MindMapTree {
  const walk = (node: MapNode): MindMapTree => ({
    title: node.title,
    children: node.children.map(walk),
  });
  return walk(acceptedRoot(doc.root));
}

function nodesOf(trees: MindMapTree[]): MapNode[] {
  return trees.map((tree) => ({
    id: newNodeId(),
    title: cleanNodeTitle(tree.title),
    children: nodesOf(tree.children),
  }));
}

/** A tree read from a file as a whole map; deeper than a note allows is flattened. */
export function mindTreeToMap(tree: MindMapTree, fallbackTitle = ""): MapDoc {
  const flat = treeDepth(tree) > MAP_LIMITS.depth ? flattenFrom(tree, MAP_LIMITS.depth) : tree;
  return limitMap({
    type: MAP_DOC_TYPE,
    version: 1,
    root: {
      id: newNodeId(),
      title: cleanNodeTitle(flat.title || fallbackTitle, MAP_LIMITS.rootTitle),
      children: nodesOf(flat.children),
    },
  });
}

/** Import into an open map: the file's branches go under its centre, after what is there. */
export function appendTreeToMap(doc: MapDoc, tree: MindMapTree): MapDoc {
  const imported = mindTreeToMap(tree);
  const root: MapNode = {
    ...doc.root,
    title: doc.root.title || imported.root.title,
    children: [...doc.root.children, ...imported.root.children],
  };
  return limitMap({ ...doc, root });
}

/** Import that replaces the map: the file's tree, the centre keeps its title when the file has none. */
export function replaceMapWithTree(doc: MapDoc, tree: MindMapTree): MapDoc {
  const imported = mindTreeToMap(tree, doc.root.title);
  return { ...imported, root: { ...imported.root, id: doc.root.id } };
}

/**
 * One of Grady's answers kept in a map note: a new branch named `heading`
 * with the answer's lines below it, nested by their indent.
 */
export function appendTextToMap(doc: MapDoc, heading: string, answer: string): MapDoc {
  const outline = parsePlainText(answer);
  const branches = outline.title ? [outline] : outline.children;
  const branch: MapNode = {
    id: newNodeId(),
    title: cleanNodeTitle(heading),
    children: nodesOf(branches),
  };
  return limitMap({ ...doc, root: { ...doc.root, children: [...doc.root.children, branch] } });
}
