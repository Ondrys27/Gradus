import { appendToDoc, blocksFromPlainText, type DocNode } from "../document";
import { appendTextToMap } from "../mindmap/convert";
import { sanitizeMapDoc, type MapDoc, type NoteKind } from "../mindmap/map-doc";

/**
 * One of Grady's answers added to a note: under a small heading at the end of
 * a text note, as a new branch of a map. The same for the "Save to notes"
 * button and Grady's append_to_note tool.
 */
export function appendAnswer(
  current: { kind: NoteKind; content: DocNode | MapDoc },
  heading: string,
  text: string,
): DocNode | MapDoc {
  return current.kind === "mindmap"
    ? appendTextToMap(sanitizeMapDoc(current.content), heading, text)
    : appendToDoc(current.content as DocNode, heading, blocksFromPlainText(text));
}
