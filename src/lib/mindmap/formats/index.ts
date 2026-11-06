import { FormatError, type MindMapParseFailure } from "./errors";
import { parseFreeMind } from "./freemind";
import { parseMarkdown } from "./markdown";
import { parseOpml } from "./opml";
import { parsePlainText } from "./text";
import {
  countNodes,
  MINDMAP_FILE_MAX_BYTES,
  MINDMAP_MAX_NODES,
  normalizeTree,
  unwrapRoot,
  type MindMapTree,
} from "./tree";
import { isZip, parseXmind, zipEntryNames } from "./xmind";
import { XmlError } from "./xml";

export * from "./errors";
export * from "./tree";
export { parseMarkdown, toMarkdown } from "./markdown";
export { parseOpml, toOpml } from "./opml";
export { parseFreeMind, toFreeMind } from "./freemind";
export { parseXmind } from "./xmind";
export { parsePlainText } from "./text";

/** The formats a mind map is read from. */
export const MINDMAP_FORMATS = ["markdown", "opml", "freemind", "xmind", "text"] as const;
export type MindMapFormat = (typeof MINDMAP_FORMATS)[number];

/** What the file picker offers. A MindNode package is explained, not read. */
export const MINDMAP_ACCEPT = ".opml,.mm,.xmind,.md,.markdown,.txt,.xml";

export type MindMapParseResult =
  | { ok: true; format: MindMapFormat; tree: MindMapTree }
  | { ok: false; error: MindMapParseFailure };

const TEXT_EXTENSIONS: Record<string, MindMapFormat | "xml"> = {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  txt: "text",
  opml: "opml",
  mm: "freemind",
  xml: "xml",
  "": "xml",
};

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A package (a folder) or an archive MindNode saves, not one of its exports. */
function isMindNodePackage(names: string[]): boolean {
  return names.some((name) => /(^|\/)contents\.xml$/.test(name) || /\.mindnode\//.test(name));
}

function readAs(format: MindMapFormat, text: string): MindMapTree {
  switch (format) {
    case "opml":
      return parseOpml(text);
    case "freemind":
      return parseFreeMind(text);
    case "markdown":
      return parseMarkdown(text);
    case "text":
      return parsePlainText(text);
    case "xmind":
      throw new FormatError("unsupported");
  }
}

/** The format of an XML document from its root element. */
function xmlFormat(text: string): MindMapFormat | null {
  const root = /<([A-Za-z_][\w.:-]*)[\s>/]/.exec(
    text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ""),
  );
  const name = root?.[1].replace(/^.*:/, "");
  if (name === "opml") return "opml";
  if (name === "map") return "freemind";
  return null;
}

/** Markdown when the text has a heading or a ticked list; otherwise indented text. */
function looksLikeMarkdown(text: string): boolean {
  return /^ {0,3}#{1,6}[ \t]+\S/m.test(text) || /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]/m.test(text);
}

function detect(name: string, bytes: Uint8Array): MindMapFormat | MindMapParseFailure {
  const extension = extensionOf(name);
  if (extension === "mindnode") return "mindnodePackage";
  if (isZip(bytes)) {
    if (extension && extension !== "xmind") {
      return isMindNodePackage(zipEntryNames(bytes)) ? "mindnodePackage" : "unsupported";
    }
    const names = zipEntryNames(bytes);
    if (names.includes("content.json") || names.includes("content.xml")) return "xmind";
    return isMindNodePackage(names) ? "mindnodePackage" : "unsupported";
  }
  if (extension === "xmind") return "unreadable";
  if (!(extension in TEXT_EXTENSIONS)) return "unsupported";
  // Binary content is not a text format, whatever its name says.
  if (bytes.subarray(0, 4096).includes(0)) return "unsupported";
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("<")) {
    const format = xmlFormat(head);
    if (!format) return extension === "txt" || extension === "md" ? "text" : "unsupported";
    return format;
  }
  const expected = TEXT_EXTENSIONS[extension];
  if (expected === "opml" || expected === "freemind") return "unreadable";
  if (expected === "markdown" || expected === "text") return expected;
  return looksLikeMarkdown(head) ? "markdown" : "text";
}

/**
 * Reads a mind map file by its name and its content. Pure: runs the same on
 * the server and in tests. Every format ends in the same tree, cleaned
 * (normalizeTree) and with a single central topic as the root.
 */
export function parseMindMapFile(name: string, bytes: Uint8Array): MindMapParseResult {
  if (bytes.byteLength > MINDMAP_FILE_MAX_BYTES) return { ok: false, error: "tooLarge" };
  if (bytes.byteLength === 0) return { ok: false, error: "empty" };
  try {
    const format = detect(name, bytes);
    if (!(MINDMAP_FORMATS as readonly string[]).includes(format)) {
      return { ok: false, error: format as MindMapParseFailure };
    }
    const kind = format as MindMapFormat;
    const raw =
      kind === "xmind"
        ? parseXmind(bytes)
        : readAs(kind, new TextDecoder().decode(bytes).replace(/^﻿/, ""));
    const tree = unwrapRoot(normalizeTree(raw));
    const nodes = countNodes(tree);
    if (nodes > MINDMAP_MAX_NODES) return { ok: false, error: "tooManyNodes" };
    if (nodes === 0 && !tree.title) return { ok: false, error: "empty" };
    return { ok: true, format: kind, tree };
  } catch (error) {
    if (error instanceof FormatError) return { ok: false, error: error.code };
    if (error instanceof XmlError) {
      return { ok: false, error: error.code === "unsafe" ? "unsafe" : "unreadable" };
    }
    if (error instanceof RangeError) return { ok: false, error: "unsafe" };
    throw error;
  }
}
