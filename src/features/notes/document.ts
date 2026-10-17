/**
 * The editor's document (Tiptap / ProseMirror JSON) and what is derived from
 * it: the plain text kept for search and Jarvis, the title (its first line)
 * and the size limits the database enforces as well.
 */

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export type NoteDraft = {
  title: string;
  content: DocNode;
  content_text: string;
};

/**
 * Mirrors the check constraints of public.notes. The database allows 400 kB of
 * content as jsonb text, which adds a space after every colon and comma, so
 * the browser stops earlier on the compact JSON.
 */
export const NOTE_LIMITS = {
  title: 200,
  contentText: 100_000,
  contentBytes: 300_000,
} as const;

export const EMPTY_DOC: DocNode = { type: "doc", content: [] };

/** Blocks that are one line of text each. */
const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

function inlineText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(inlineText).join("");
}

/**
 * The document as plain lines: one per paragraph or heading, list items with
 * their marker ("- ", "1. ", "[x] "), empty lines left out. The first line is
 * the title.
 */
export function extractText(doc: DocNode | null | undefined): string {
  const lines: string[] = [];

  function walk(node: DocNode, prefix: string, depth: number) {
    if (TEXT_BLOCKS.has(node.type)) {
      const text = inlineText(node).replace(/\s+/g, " ").trim();
      if (text) lines.push(`${"  ".repeat(depth)}${prefix}${text}`);
      return;
    }
    switch (node.type) {
      case "bulletList":
        for (const item of node.content ?? []) walkItem(item, "- ", depth);
        return;
      case "orderedList": {
        const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
        (node.content ?? []).forEach((item, i) => walkItem(item, `${start + i}. `, depth));
        return;
      }
      case "taskList":
        for (const item of node.content ?? []) {
          walkItem(item, item.attrs?.checked ? "[x] " : "[ ] ", depth);
        }
        return;
      default:
        for (const child of node.content ?? []) walk(child, prefix, depth);
    }
  }

  /** The item's first block carries the marker, nested lists go one level deeper. */
  function walkItem(item: DocNode, marker: string, depth: number) {
    let first = true;
    for (const child of item.content ?? []) {
      if (TEXT_BLOCKS.has(child.type)) {
        walk(child, first ? marker : "", depth);
        first = false;
      } else {
        walk(child, "", depth + 1);
      }
    }
  }

  if (doc) walk(doc, "", 0);
  return lines.join("\n");
}

/** The first line without a list marker, cut to the title limit. */
export function titleFromText(text: string): string {
  const first = text.split("\n", 1)[0] ?? "";
  return first
    .trim()
    .replace(/^(- |\d+\. |\[[ x]\] )/, "")
    .slice(0, NOTE_LIMITS.title);
}

/** Everything the database stores for a document. */
export function draftFromDoc(doc: DocNode): NoteDraft {
  const text = extractText(doc).slice(0, NOTE_LIMITS.contentText);
  return { title: titleFromText(text), content: doc, content_text: text };
}

/** The text under the title, as the list shows it (the database computes the same). */
export function previewFromText(text: string): string {
  const at = text.indexOf("\n");
  if (at < 0) return "";
  return text
    .slice(at + 1)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Whether the database would accept the draft. */
export function fitsLimits(draft: NoteDraft): boolean {
  const bytes = new TextEncoder().encode(JSON.stringify(draft.content)).length;
  return bytes <= NOTE_LIMITS.contentBytes && draft.title.length <= NOTE_LIMITS.title;
}

/** A note with no text at all: one left like that is removed when the user moves on. */
export function isBlank(draft: Pick<NoteDraft, "content_text">): boolean {
  return draft.content_text.trim() === "";
}

function paragraph(value: string): DocNode {
  return value ? { type: "paragraph", content: [{ type: "text", text: value }] } : { type: "paragraph" };
}

/**
 * Plain text (one of Jarvis's answers) as editor blocks: lines starting with
 * "- " or "1. " become lists, other lines paragraphs, empty lines go.
 */
export function blocksFromPlainText(text: string): DocNode[] {
  const blocks: DocNode[] = [];
  let list: DocNode | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const ordered = bullet ? null : /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const type = bullet ? "bulletList" : "orderedList";
      if (!list || list.type !== type) {
        list = ordered
          ? { type, attrs: { start: Number(ordered[1]) }, content: [] }
          : { type, content: [] };
        blocks.push(list);
      }
      const value = (bullet ? bullet[1] : ordered![2]).trim();
      list.content!.push({ type: "listItem", content: [paragraph(value)] });
      continue;
    }
    list = null;
    if (line) blocks.push(paragraph(line));
  }
  return blocks;
}

/** A new document: a title line, then the blocks. */
export function docWithTitle(title: string, blocks: DocNode[]): DocNode {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: title ? [{ type: "text", text: title }] : [] },
      ...blocks,
    ],
  };
}

/** The document with a small heading and the blocks added at its end. */
export function appendToDoc(doc: DocNode, heading: string, blocks: DocNode[]): DocNode {
  const content = (doc.content ?? []).filter(
    // An empty last paragraph would leave a gap before the added part.
    (node, i, all) => !(i === all.length - 1 && node.type === "paragraph" && !node.content?.length),
  );
  return {
    ...doc,
    type: "doc",
    content: [
      ...content,
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: heading }] },
      ...blocks,
    ],
  };
}
