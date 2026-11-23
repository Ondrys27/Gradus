/**
 * The document schema of a text note, the same for the editor in the browser
 * and for the server (Grady writing into a shared note, building the live
 * state from stored content). The editor adds only what does not change the
 * schema: the placeholder, shortcuts, the chip's look, cursors.
 */
import { getSchema, type AnyExtension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import type { Schema } from "@tiptap/pm/model";
import { isAllowedLink } from "../links";

/** StarterKit as notes use it; undo comes from the live document (own changes only). */
export function noteStarterKit() {
  return StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    undoRedo: false,
    link: {
      openOnClick: true,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      protocols: ["mailto"],
      isAllowedUri: (url) => isAllowedLink(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    },
  });
}

/** The attributes of a record chip: { type, id, label } (id and label from Mention). */
export const mentionTypeAttribute = {
  type: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-mention-type"),
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.type === "string" ? { "data-mention-type": attributes.type } : {},
  },
};

/** The chip without its look, for the schema on the server. */
const RecordMention = Mention.extend({
  addAttributes() {
    return { ...this.parent?.(), ...mentionTypeAttribute };
  },
});

export function noteSchemaExtensions(): AnyExtension[] {
  return [noteStarterKit(), TaskList, TaskItem.configure({ nested: true }), RecordMention];
}

let schema: Schema | null = null;

export function noteSchema(): Schema {
  schema ??= getSchema(noteSchemaExtensions());
  return schema;
}
