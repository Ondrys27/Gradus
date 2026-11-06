/**
 * A stored note as the editor of its kind can open it, shared by the browser
 * and the server: anything but a map is text, and a map is checked node by
 * node before it is drawn or read.
 */
import type { DocNode } from "../document";
import { isMapDoc, sanitizeMapDoc, type MapDoc, type NoteKind } from "./map-doc";

export function noteKindOf(value: unknown): NoteKind {
  return value === "mindmap" ? "mindmap" : "text";
}

export function noteContentOf(kind: NoteKind, content: unknown): DocNode | MapDoc {
  if (kind === "mindmap") return sanitizeMapDoc(content);
  return (
    content && typeof content === "object" && !isMapDoc(content) ? content : { type: "doc", content: [] }
  ) as DocNode;
}
