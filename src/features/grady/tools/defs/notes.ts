import { z } from "zod";
import {
  appendToDoc,
  blocksFromPlainText,
  docWithTitle,
  draftFromDoc,
  fitsLimits,
  type DocNode,
  type NoteDraft,
} from "@/features/notes/document";
import { appendTextToMap } from "@/features/notes/mindmap/convert";
import { isMapDoc, mapDraft, newMapDoc, sanitizeMapDoc } from "@/features/notes/mindmap/map-doc";
import { noteContentOf, noteKindOf } from "@/features/notes/mindmap/note-row";
import { linkNote, setNotePinned, trashNote, writeNote } from "@/features/notes/ops";
import type { Json } from "@/types/database";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, inserted, mustFind, ops, quoted, updated, uuid } from "./shared";

/**
 * Notes are always the account's own (never a company's), so these tools are
 * offered only in the account's own space. A note's text is the user's data;
 * Grady writes into it only on the user's word in the chat.
 */

const TEXT_MAX = 20_000;
/** A note bigger than this is changed, but its old text is not kept for Undo. */
const UNDO_CONTENT_MAX = 100_000;

async function readNote(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("notes")
      .select("id, title, kind, content, content_text, pinned")
      .eq("user_id", ctx.userId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
  );
}

/** The note's text as it was, for Undo, when it is small enough to keep. */
function textBefore(note: {
  id: string;
  title: string;
  kind: string;
  content: Json;
  content_text: string;
}): UndoRecord[] {
  if (JSON.stringify(note.content).length > UNDO_CONTENT_MAX) return [];
  return [
    updated("notes", note.id, {
      title: note.title,
      kind: note.kind,
      content: note.content,
      content_text: note.content_text,
    }),
  ];
}

function checked(draft: NoteDraft): NoteDraft {
  if (!fitsLimits(draft)) throw new ToolError("tooLong");
  return draft;
}

export const noteTools = [
  defineTool({
    name: "create_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Create a note: a text note (plain text, lines starting with '- ' become bullets) or a mind map with branches under the title. Optionally tie it to a milestone, task or deal.",
    input: z.object({
      title: z.string().trim().min(1).max(200),
      kind: z.enum(["text", "mindmap"]).optional(),
      text: z.string().max(TEXT_MAX).optional(),
      branches: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
      linkTo: z.object({ kind: z.enum(["task", "milestone", "deal"]), id: uuid }).optional(),
    }),
    describe: (input, t) => t("create_note", { title: quoted(input.title) }),
    async execute(ctx, input) {
      const id = crypto.randomUUID();
      const kind = input.kind ?? "text";
      const draft = checked(
        kind === "mindmap"
          ? mapDraft(newMapDoc(input.title, input.branches ?? []))
          : draftFromDoc(docWithTitle(input.title, blocksFromPlainText(input.text ?? ""))),
      );
      await writeNote(ops(ctx), { userId: ctx.userId, id, draft });
      ctx.track("note_created", { source: "blank", where: "jarvis", kind });
      const records: UndoRecord[] = [inserted("notes", id)];
      if (input.linkTo) {
        const link = await linkNote(ops(ctx), { noteId: id, target: input.linkTo, how: "write" });
        if (link.id) records.push(inserted("note_links", link.id));
      }
      return { output: { noteId: id }, records, href: hrefs.note(id) };
    },
    undoable: true,
    invalidates: ["notes", "note-links"],
  }),

  defineTool({
    name: "append_to_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Add text at the end of an existing note under an optional small heading (in a mind map it becomes a new branch).",
    input: z.object({
      noteId: uuid,
      heading: z.string().trim().max(200).optional(),
      text: z.string().trim().min(1).max(TEXT_MAX),
    }),
    describe: (_input, t) => t("append_to_note", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      const content = noteContentOf(noteKindOf(note.kind), note.content);
      const heading = input.heading ?? "";
      const next = isMapDoc(content)
        ? appendTextToMap(sanitizeMapDoc(content), heading, input.text)
        : appendToDoc(content as DocNode, heading, blocksFromPlainText(input.text));
      const draft = checked(isMapDoc(next) ? mapDraft(next) : draftFromDoc(next as DocNode));
      const records = textBefore(note);
      await writeNote(ops(ctx), { userId: ctx.userId, id: note.id, draft });
      return {
        output: { noteId: note.id },
        records,
        summary: ctx.t("append_to_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "update_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Rewrite a text note: a new title and / or the whole new text (it replaces the old text). For adding to a note use append_to_note.",
    input: z.object({
      noteId: uuid,
      title: z.string().trim().min(1).max(200).optional(),
      text: z.string().max(TEXT_MAX).optional(),
    }),
    describe: (_input, t) => t("update_note", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      if (noteKindOf(note.kind) === "mindmap") {
        if (input.text !== undefined)
          throw new ToolError("mindMapNote", "A mind map note is changed in the map, not as text.");
        const map = sanitizeMapDoc(noteContentOf("mindmap", note.content));
        const draft = checked(
          mapDraft({ ...map, root: { ...map.root, title: input.title ?? map.root.title } }),
        );
        const records = textBefore(note);
        await writeNote(ops(ctx), { userId: ctx.userId, id: note.id, draft });
        return {
          output: { noteId: note.id },
          records,
          summary: ctx.t("update_note", { title: quoted(draft.title) }),
          href: hrefs.note(note.id),
        };
      }
      const title = input.title ?? note.title;
      const body = input.text ?? note.content_text.split("\n").slice(1).join("\n");
      const draft = checked(draftFromDoc(docWithTitle(title, blocksFromPlainText(body))));
      const records = textBefore(note);
      await writeNote(ops(ctx), { userId: ctx.userId, id: note.id, draft });
      return {
        output: { noteId: note.id },
        records,
        summary: ctx.t("update_note", { title: quoted(title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "pin_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "instant",
    description: "Pin a note to the top of the list, or unpin it.",
    input: z.object({ noteId: uuid, pinned: z.boolean() }),
    describe: (input, t) => t(input.pinned ? "pin_note" : "unpin_note", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      await setNotePinned(ops(ctx), { userId: ctx.userId, id: note.id, pinned: input.pinned });
      return {
        output: { noteId: note.id, pinned: input.pinned },
        records: [updated("notes", note.id, { pinned: note.pinned })],
        summary: ctx.t(input.pinned ? "pin_note" : "unpin_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "link_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Tie an existing note to a milestone, a milestone task or a deal of the user's own space.",
    input: z.object({
      noteId: uuid,
      target: z.object({ kind: z.enum(["task", "milestone", "deal"]), id: uuid }),
    }),
    describe: (_input, t) => t("link_note", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      const link = await linkNote(ops(ctx), {
        noteId: note.id,
        target: input.target,
        how: "attach",
      });
      return {
        output: { noteId: note.id, linked: true },
        records: link.id ? [inserted("note_links", link.id)] : [],
        summary: ctx.t("link_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["note-links", "notes"],
  }),

  defineTool({
    name: "trash_note",
    section: "notes",
    action: null,
    ownSpaceOnly: true,
    kind: "write",
    risk: "confirm",
    description:
      "Move a note to Recently Deleted (it can be restored for 30 days). The user confirms it first.",
    input: z.object({ noteId: uuid }),
    describe: (_input, t) => t("trash_note", { title: "" }),
    async prepare(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      return {
        summary: ctx.t("trash_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId);
      await trashNote(ops(ctx), { userId: ctx.userId, id: note.id, pinned: note.pinned });
      return {
        output: { noteId: note.id, trashed: true },
        // Undo brings it back from the trash.
        records: [updated("notes", note.id, { deleted_at: null })],
        summary: ctx.t("trashed_note", { title: quoted(note.title) }),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),
];
