import { z } from "zod";
import {
  blocksFromPlainText,
  docWithTitle,
  draftFromDoc,
  extractText,
  fitsLimits,
  type DocNode,
  type NoteDraft,
} from "@/features/notes/document";
import { appendAnswer } from "@/features/notes/collab/append";
import type { ParticipantChange } from "@/features/notes/collab/server";
import { mapDraft, newMapDoc, sanitizeMapDoc } from "@/features/notes/mindmap/map-doc";
import { noteKindOf } from "@/features/notes/mindmap/note-row";
import { linkNote, setNotePinned, trashNote, writeNote } from "@/features/notes/ops";
import { FOLDER_COLORS, SHARE_TARGETS } from "@/features/notes/sharing/logic";
import type { Json } from "@/types/database";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, inserted, mustFind, ops, quoted, updated, uuid } from "./shared";

/**
 * Notes of the active space the account reaches: its own and those shared
 * with it (28.3). Grady works within the asking person's rights: an editor's
 * shared note may be changed, a viewer's only read; pinning and the trash are
 * the owner's. A note's text is the user's data; Grady writes into it only on
 * the user's word in the chat.
 */

const TEXT_MAX = 20_000;
const FOLDER_NAME_MAX = 80;

/** A folder of the active space the account reaches (RLS). */
async function readFolder(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("note_folders")
      .select("id, name")
      .eq("space_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}
/** A note bigger than this is changed, but its old text is not kept for Undo. */
const UNDO_CONTENT_MAX = 100_000;

type NeedRole = "read" | "write" | "own";

/** The note (RLS: only one the account reaches) when its role allows `need`. */
async function readNote(ctx: ToolContext, id: string, need: NeedRole = "write") {
  const note = await mustFind(
    ctx.db
      .from("notes")
      .select("id, title, kind, content, content_text, pinned, user_id")
      .eq("id", id)
      // Notes belong to a space (28.x): only the active one's, as the Notes section lists them.
      .eq("space_id", ctx.workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  if (need === "read") return note;
  const own = note.user_id === ctx.userId;
  if (need === "own" && !own) throw new ToolError("noteOwnerOnly", "Only the owner of the note may do this.");
  if (need === "write" && !own) {
    const { data, error } = await ctx.db.rpc("note_role", { _note: note.id });
    if (error) throw error;
    if (data?.[0]?.role !== "editor") {
      throw new ToolError("noteReadOnly", "The note is shared with the user for reading only.");
    }
  }
  return note;
}

/** The document with its first text line (the title) replaced; the rest stays as it is. */
function withFirstLine(doc: DocNode, title: string): DocNode {
  const content = doc.content ?? [];
  const first = content.findIndex((node) => extractText({ type: "doc", content: [node] }) !== "");
  const node = content[first];
  if (!node || (node.type !== "heading" && node.type !== "paragraph"))
    return docWithTitle(title, content);
  const line: DocNode = { ...node, content: [{ type: "text", text: title }] };
  return { ...doc, type: "doc", content: [...content.slice(0, first), line, ...content.slice(first + 1)] };
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

/**
 * A change of an existing note, written by the server into its live document
 * as one more participant (28.4) with the asking person's rights.
 */
async function participantWrite(ctx: ToolContext, noteId: string, change: ParticipantChange) {
  const { writeAsParticipant } = await import("@/features/notes/collab/server");
  const result = await writeAsParticipant(ctx.db, { noteId, userId: ctx.userId, change });
  if (result.ok) return result;
  if (result.reason === "tooLong") throw new ToolError("tooLong");
  if (result.reason === "notFound") throw new ToolError("notFound", "The note is not there any more.");
  if (result.reason === "denied") throw new ToolError("noteReadOnly", "The note is shared with the user for reading only.");
  throw new ToolError("busy", "Others are saving the note right now; try again.");
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
      if (input.linkTo && ctx.workspace.id !== ctx.userId) {
        throw new ToolError("ownSpaceOnly", "Notes are tied to milestones, tasks and deals only in the user's own space.");
      }
      const id = crypto.randomUUID();
      const kind = input.kind ?? "text";
      const draft = checked(
        kind === "mindmap"
          ? mapDraft(newMapDoc(input.title, input.branches ?? []))
          : draftFromDoc(docWithTitle(input.title, blocksFromPlainText(input.text ?? ""))),
      );
      await writeNote(ops(ctx), {
        userId: ctx.userId,
        id,
        draft: { ...draft, place: { spaceId: ctx.workspace.id, folderId: null } },
      });
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
      const records = textBefore(note);
      // Into the live document as one more participant: whoever has the note open keeps typing.
      await participantWrite(ctx, note.id, (current) => appendAnswer(current, input.heading ?? "", input.text));
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
      if (noteKindOf(note.kind) === "mindmap" && input.text !== undefined) {
        throw new ToolError("mindMapNote", "A mind map note is changed in the map, not as text.");
      }
      const records = textBefore(note);
      let title = input.title ?? note.title;
      await participantWrite(ctx, note.id, (current) => {
        if (current.kind === "mindmap") {
          const map = sanitizeMapDoc(current.content);
          return { ...map, root: { ...map.root, title: input.title ?? map.root.title } };
        }
        title = input.title ?? note.title;
        // Only a new title: the document keeps its formatting, chips and lists, the first line changes.
        return input.text === undefined
          ? withFirstLine(current.content as DocNode, title)
          : docWithTitle(title, blocksFromPlainText(input.text));
      });
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
    kind: "write",
    risk: "instant",
    description: "Pin a note to the top of the list, or unpin it.",
    input: z.object({ noteId: uuid, pinned: z.boolean() }),
    describe: (input, t) => t(input.pinned ? "pin_note" : "unpin_note", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId, "own");
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
      const note = await readNote(ctx, input.noteId, "read");
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
    level: "delete",
    section: "notes",
    action: null,
    kind: "write",
    risk: "confirm",
    description:
      "Move a note to Recently Deleted (it can be restored for 30 days). The user confirms it first.",
    input: z.object({ noteId: uuid }),
    describe: (_input, t) => t("trash_note", { title: "" }),
    async prepare(ctx, input) {
      const note = await readNote(ctx, input.noteId, "own");
      return {
        summary: ctx.t("trash_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId, "own");
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

  defineTool({
    name: "create_note_folder",
    section: "notes",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Create a folder for notes in the active space (optionally inside another folder), with one of the colours violet, teal, gold, green, orange, pink.",
    input: z.object({
      name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
      color: z.enum(FOLDER_COLORS).optional(),
      parentId: uuid.optional(),
    }),
    describe: (input, t) => t("create_note_folder", { name: quoted(input.name) }),
    async execute(ctx, input) {
      if (input.parentId) await readFolder(ctx, input.parentId);
      const id = crypto.randomUUID();
      const { error } = await ctx.db.from("note_folders").insert({
        id,
        space_id: ctx.workspaceId,
        name: input.name,
        color: input.color ?? "violet",
        parent_id: input.parentId ?? null,
        position: Date.now() % 1_000_000,
      });
      if (error) throw error;
      ctx.track("note_folder_created", { nested: Boolean(input.parentId) });
      return {
        output: { folderId: id },
        records: [inserted("note_folders", id)],
        href: "/app/poznamky",
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "move_note_to_folder",
    section: "notes",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Put one of the user's own notes into a folder (folderId null takes it out of every folder). Folder ids from search_records or the user's words.",
    input: z.object({ noteId: uuid, folderId: uuid.nullable() }),
    describe: (_input, t) => t("move_note_to_folder", { title: "" }),
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId, "own");
      if (input.folderId) await readFolder(ctx, input.folderId);
      const { data: before, error: readError } = await ctx.db
        .from("notes")
        .select("folder_id")
        .eq("id", note.id)
        .single();
      if (readError) throw readError;
      const { error } = await ctx.db
        .from("notes")
        .update({ folder_id: input.folderId })
        .eq("id", note.id)
        .eq("user_id", ctx.userId);
      if (error) throw error;
      ctx.track("note_moved", { to: input.folderId ? "folder" : "none", via: "menu" });
      return {
        output: { noteId: note.id, folderId: input.folderId },
        records: [updated("notes", note.id, { folder_id: before.folder_id })],
        summary: ctx.t("move_note_to_folder", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "restore_note",
    section: "notes",
    action: null,
    kind: "write",
    risk: "instant",
    description: "Bring one of the user's notes back from Recently Deleted.",
    input: z.object({ noteId: uuid }),
    describe: (_input, t) => t("restore_note", { title: "" }),
    async execute(ctx, input) {
      const note = await mustFind(
        ctx.db
          .from("notes")
          .select("id, title, deleted_at")
          .eq("id", input.noteId)
          .eq("user_id", ctx.userId)
          .eq("space_id", ctx.workspaceId)
          .not("deleted_at", "is", null)
          .maybeSingle(),
      );
      const { error } = await ctx.db
        .from("notes")
        .update({ deleted_at: null })
        .eq("id", note.id)
        .eq("user_id", ctx.userId);
      if (error) throw error;
      return {
        output: { noteId: note.id, restored: true },
        records: [updated("notes", note.id, { deleted_at: note.deleted_at })],
        summary: ctx.t("restore_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    undoable: true,
    invalidates: ["notes"],
  }),

  defineTool({
    name: "share_note",
    section: "notes",
    action: null,
    kind: "write",
    risk: "confirm",
    description:
      "Share one of the user's notes (or one they may share further) in this company: with a person (target member, their account id from list_people), a group (target group, its id from list_workers) or the whole company (target space), for reading (viewer) or editing (editor). The user confirms it first.",
    input: z.object({
      noteId: uuid,
      target: z.enum(SHARE_TARGETS),
      targetId: uuid.optional(),
      role: z.enum(["viewer", "editor"]),
    }),
    describe: (_input, t) => t("share_note", { title: "" }),
    async prepare(ctx, input) {
      const note = await readNote(ctx, input.noteId, "read");
      if (input.target !== "space" && !input.targetId) throw new ToolError("invalid");
      return {
        summary: ctx.t("share_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    async execute(ctx, input) {
      const note = await readNote(ctx, input.noteId, "read");
      if (input.target !== "space" && !input.targetId) throw new ToolError("invalid");
      const { error } = await ctx.db.rpc("note_share_set", {
        _note: note.id,
        _folder: null as unknown as string,
        _target_kind: input.target,
        _target: (input.target === "space" ? null : input.targetId) as unknown as string,
        _role: input.role,
        _can_reshare: false,
      });
      if (error) throw error;
      ctx.track("note_shared", { on: "note", target: input.target, role: input.role, reshare: false });
      return {
        output: { noteId: note.id, shared: true },
        summary: ctx.t("shared_note", { title: quoted(note.title) }),
        href: hrefs.note(note.id),
      };
    },
    // Whoever it was shared with may already have it open; taking it back is Sharing's own step.
    undoable: false,
    invalidates: ["notes"],
  }),
];
