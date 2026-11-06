import { unzipSync } from "fflate";
import { FormatError } from "./errors";
import { node, type MindMapTree } from "./tree";
import { childElements, firstChild, parseXml, textContent, XmlError, type XmlElement } from "./xml";

/**
 * XMind `.xmind` (import only): a ZIP with `content.json` (XMind Zen and
 * later) or `content.xml` (XMind 8). Only the first sheet and its attached
 * topics are read; done is the `task-done` marker. Nothing is ever written to
 * disk: only those two entries are unpacked, an entry whose name climbs out of
 * the archive (`../`, an absolute path) refuses the whole file, and an entry
 * that unpacks larger than the limit is refused too (a ZIP bomb).
 */

/** Largest unpacked content part that is read. */
const MAX_UNPACKED = 20 * 1024 * 1024;
const CONTENT_PARTS = new Set(["content.json", "content.xml"]);

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** An entry name that would leave the folder it is unpacked into. */
export function climbsOut(name: string): boolean {
  const path = name.replace(/\\/g, "/");
  return path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..");
}

/** The names of a ZIP's entries, without unpacking anything. */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    throw new FormatError("unreadable");
  }
  return names;
}

function readContent(bytes: Uint8Array): { name: string; text: string } {
  const names = zipEntryNames(bytes);
  if (names.some(climbsOut)) throw new FormatError("unsafe");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => CONTENT_PARTS.has(file.name) && file.originalSize <= MAX_UNPACKED,
    });
  } catch {
    throw new FormatError("unreadable");
  }
  const decoder = new TextDecoder();
  for (const name of ["content.json", "content.xml"]) {
    const data = files[name];
    if (!data) continue;
    if (data.byteLength > MAX_UNPACKED) throw new FormatError("unsafe");
    return { name, text: decoder.decode(data) };
  }
  if (names.some((name) => CONTENT_PARTS.has(name))) throw new FormatError("unsafe");
  throw new FormatError("unsupported");
}

type JsonTopic = {
  title?: unknown;
  children?: { attached?: unknown };
  markers?: unknown;
};

function jsonState(markers: unknown): boolean | undefined {
  if (!Array.isArray(markers)) return undefined;
  const ids = markers
    .map((marker) => (marker as { markerId?: unknown })?.markerId)
    .filter((id): id is string => typeof id === "string");
  if (ids.includes("task-done")) return true;
  if (ids.some((id) => id.startsWith("task-"))) return false;
  return undefined;
}

function fromJsonTopic(topic: JsonTopic, depth: number): MindMapTree {
  if (depth > 1000) throw new FormatError("unsafe");
  const attached = Array.isArray(topic.children?.attached) ? topic.children.attached : [];
  return node(
    typeof topic.title === "string" ? topic.title : "",
    attached
      .filter((child): child is JsonTopic => typeof child === "object" && child !== null)
      .map((child) => fromJsonTopic(child, depth + 1)),
    jsonState(topic.markers),
  );
}

function fromXmlTopic(topic: XmlElement): MindMapTree {
  const title = firstChild(topic, "title");
  const children = firstChild(topic, "children");
  const attached = children
    ? childElements(children, "topics").filter(
        (topics) => (topics.attributes.type ?? "attached") === "attached",
      )
    : [];
  const markers = firstChild(topic, "marker-refs");
  const ids = markers
    ? childElements(markers, "marker-ref").map((ref) => ref.attributes["marker-id"] ?? "")
    : [];
  const done = ids.includes("task-done")
    ? true
    : ids.some((id) => id.startsWith("task-"))
      ? false
      : undefined;
  return node(
    title ? textContent(title) : "",
    attached.flatMap((topics) => childElements(topics, "topic").map(fromXmlTopic)),
    done,
  );
}

export function parseXmind(bytes: Uint8Array): MindMapTree {
  const content = readContent(bytes);
  if (content.name === "content.json") {
    let sheets: unknown;
    try {
      sheets = JSON.parse(content.text);
    } catch {
      throw new FormatError("unreadable");
    }
    const sheet = Array.isArray(sheets) ? sheets[0] : null;
    const root = (sheet as { rootTopic?: unknown } | null)?.rootTopic;
    if (typeof root !== "object" || root === null) throw new FormatError("unreadable");
    return fromJsonTopic(root as JsonTopic, 0);
  }
  let xml: XmlElement;
  try {
    xml = parseXml(content.text);
  } catch (error) {
    throw new FormatError(
      error instanceof XmlError && error.code === "unsafe" ? "unsafe" : "unreadable",
    );
  }
  const sheet = firstChild(xml, "sheet");
  const topic = sheet && firstChild(sheet, "topic");
  if (!topic) throw new FormatError("unreadable");
  return fromXmlTopic(topic);
}
