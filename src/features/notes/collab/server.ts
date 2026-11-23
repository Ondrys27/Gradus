import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import { fitsLimits, type DocNode, type NoteDraft, type TextOptions } from "../document";
import type { MapDoc, NoteKind } from "../mindmap/map-doc";
import { noteKindOf } from "../mindmap/note-row";
import { fromByteaHex, toBase64, toByteaHex } from "./encoding";
import { COLLAB } from "./limits";
import { toWire, type Envelope } from "./protocol";
import { applyContent, contentOf, draftOf, genOf, seedGen, seedState } from "./ydoc";

/**
 * Grady writing into a note as one more participant (28.4): the server reads
 * the note's live state (built from its content when there is none yet),
 * makes the change in it, saves it with the version lock like a browser does
 * (as the signed-in person, so only where they may write) and sends the
 * change to whoever has the note open. Someone typing at the same time keeps
 * what they type: the change merges, it never replaces the text.
 */

export type ParticipantChange = (current: { kind: NoteKind; content: DocNode | MapDoc }) => DocNode | MapDoc;

export type ParticipantResult =
  | { ok: true; kind: NoteKind; draft: NoteDraft; before: { title: string; content: unknown; content_text: string } }
  | { ok: false; reason: "notFound" | "denied" | "tooLong" | "busy" };

type Db = SupabaseClient<Database>;

/** Sends the change to the note's live channel; a failure only means the others see it on their next save. */
async function broadcast(noteId: string, envelope: Envelope) {
  try {
    const admin = createAdminClient();
    const channel = admin.channel(`note:${noteId}`, { config: { private: true } });
    try {
      for (const wire of toWire(envelope, COLLAB.chunkChars)) await channel.httpSend("collab", wire);
    } finally {
      await admin.removeChannel(channel);
    }
  } catch (error) {
    console.warn("notes live broadcast failed", error instanceof Error ? error.message : error);
  }
}

export async function writeAsParticipant(
  db: Db,
  args: { noteId: string; userId: string; change: ParticipantChange; textOptions?: TextOptions },
): Promise<ParticipantResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row, error } = await db
      .from("notes")
      .select("kind, title, ydoc, ydoc_version, content, content_text, deleted_at")
      .eq("id", args.noteId)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error;
    if (!row || row.deleted_at) return { ok: false, reason: "notFound" };
    const kind = noteKindOf(row.kind);
    const stored = fromByteaHex(row.ydoc);

    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, stored ?? seedState(kind, row.content, seedGen(row.ydoc_version)));
      const gen = genOf(doc) ?? seedGen(row.ydoc_version);
      const before = Y.encodeStateVector(doc);
      applyContent(doc, kind, args.change({ kind, content: contentOf(doc, kind) }), "grady");
      const draft = draftOf(doc, kind, args.textOptions);
      if (!fitsLimits(draft)) return { ok: false, reason: "tooLong" };
      const state = Y.encodeStateAsUpdate(doc);
      if (state.byteLength > COLLAB.docBytes) return { ok: false, reason: "tooLong" };

      const { data, error: saveError } = await db.rpc("note_collab_save", {
        _note: args.noteId,
        _base: row.ydoc_version,
        _ydoc: toByteaHex(state),
        _kind: kind,
        _title: draft.title,
        _content: draft.content as never,
        _content_text: draft.content_text,
        _authors: [args.userId],
      });
      if (saveError) {
        if (saveError.code === "P0001" && /read_only/.test(saveError.message)) return { ok: false, reason: "denied" };
        if (saveError.code === "23514") return { ok: false, reason: "tooLong" };
        throw saveError;
      }
      const status = data?.[0]?.status;
      if (status === "conflict") continue; // someone saved meanwhile: read their state and do it again
      if (status === "missing" || status === "deleted") return { ok: false, reason: "notFound" };
      if (status !== "saved") return { ok: false, reason: status === "too_large" ? "tooLong" : "denied" };

      const diff = Y.encodeStateAsUpdate(doc, before);
      await broadcast(args.noteId, {
        from: args.userId,
        sid: `server:${crypto.randomUUID()}`,
        m: { t: "update", gen, d: toBase64(diff), p: 1 },
      });
      return {
        ok: true,
        kind,
        draft,
        before: { title: row.title, content: row.content, content_text: row.content_text },
      };
    } finally {
      doc.destroy();
    }
  }
  return { ok: false, reason: "busy" };
}
