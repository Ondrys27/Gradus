/**
 * The little markdown of a person's description: paragraphs, line breaks,
 * `- ` lists, **bold**, *italic* and links (only http and https). Parsed into
 * plain data and drawn as React elements, never as HTML, so nothing typed
 * can run or style the page.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block = { kind: "paragraph"; lines: Inline[][] } | { kind: "list"; items: Inline[][] };

const TOKEN =
  /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;

/** Only absolute http(s) addresses survive; anything else stays text. */
export function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  const push = (item: Inline) => {
    const previous = result[result.length - 1];
    if (item.kind === "text" && previous?.kind === "text") previous.text += item.text;
    else result.push(item);
  };
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) push({ kind: "text", text: text.slice(last, index) });
    const [whole, bold, italic, label, href, bare] = match;
    if (bold !== undefined) push({ kind: "bold", text: bold });
    else if (italic !== undefined) push({ kind: "italic", text: italic });
    else {
      const target = safeHref(href ?? bare ?? "");
      if (target) push({ kind: "link", text: label ?? bare ?? whole, href: target });
      else push({ kind: "text", text: whole });
    }
    last = index + whole.length;
  }
  if (last < text.length) push({ kind: "text", text: text.slice(last) });
  return result;
}

const LIST_ITEM = /^\s*[-*]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Inline[][] | null = null;
  const close = () => {
    if (paragraph) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list) blocks.push({ kind: "list", items: list });
    paragraph = null;
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (paragraph) close();
      list ??= [];
      list.push(parseInline(item[1]!.trim()));
    } else {
      if (list) close();
      paragraph ??= [];
      paragraph.push(parseInline(line.trim()));
    }
  }
  close();
  return blocks;
}
