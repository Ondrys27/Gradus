"use client";

import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import type { NoteKind } from "../mindmap/map-doc";
import { noteKindOf } from "../mindmap/note-row";
import type { TextOptions } from "../document";
import { fromByteaHex, toByteaHex } from "./encoding";
import { COLLAB } from "./limits";
import type { CollabSaveResult } from "./persister";
import { realtimeTransport } from "./realtime-transport";
import { CollabSession, type LocalReplica, type Me, type SessionIO, type StoredNote } from "./session";

/**
 * The live sessions of the signed-in account, one per open note and tab,
 * kept a moment after the editor closes (Strict Mode mounts twice, a quick
 * return to the note reuses it). Closing saves, ends the version and leaves
 * the channel.
 */

type Entry = { session: CollabSession; refs: number; timer: ReturnType<typeof setTimeout> | null };

const registries = new Map<string, Map<string, Entry>>();

function registryOf(userId: string): Map<string, Entry> {
  let registry = registries.get(userId);
  if (registry) return registry;
  registry = new Map();
  registries.set(userId, registry);
  if (typeof window !== "undefined") {
    const all = registry;
    window.addEventListener("online", () => {
      for (const entry of all.values()) entry.session.online();
    });
    window.addEventListener("pagehide", () => {
      for (const entry of all.values()) entry.session.hide();
    });
    // A hidden tab saves; only closing the page ends the version (a snapshot).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      for (const entry of all.values()) void entry.session.flush();
    });
  }
  return registry;
}

function localReplica(name: string, doc: Y.Doc): LocalReplica {
  if (typeof indexedDB === "undefined") return memoryReplica();
  let persistence: IndexeddbPersistence;
  try {
    persistence = new IndexeddbPersistence(name, doc);
  } catch {
    return memoryReplica();
  }
  return {
    origin: persistence,
    ready: persistence.whenSynced.then(() => undefined),
    get: (key) => persistence.get(key),
    set: async (key, value) => {
      await persistence.set(key, value);
    },
    clear: () => persistence.clearData(),
    destroy: () => {
      void persistence.destroy();
    },
  };
}

/** Private browsing without IndexedDB: the session still works, nothing survives a reload. */
function memoryReplica(): LocalReplica {
  const values = new Map<string, unknown>();
  return {
    origin: null,
    ready: Promise.resolve(),
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
    },
    clear: async () => values.clear(),
    destroy: () => undefined,
  };
}

/** Errors of the database that mean "you may not write this". */
function isRefusal(error: { code?: string; message?: string }): boolean {
  return error.code === "P0001" && /read_only|not_authenticated/.test(error.message ?? "");
}

function browserIO(userId: string, noteId: string): SessionIO {
  const supabase = createClient();
  return {
    async load(): Promise<StoredNote | null> {
      const { data, error } = await supabase
        .from("notes")
        .select("kind, ydoc, ydoc_version, content, deleted_at")
        .eq("id", noteId)
        .maybeSingle();
      if (error) {
        if (error.code === "22P02") return null;
        throw error;
      }
      if (!data || data.deleted_at) return null;
      return {
        kind: noteKindOf(data.kind),
        version: data.ydoc_version,
        state: fromByteaHex(data.ydoc),
        content: data.content,
      };
    },
    async save({ base, state, draft, authors }): Promise<CollabSaveResult> {
      const { data, error } = await supabase.rpc("note_collab_save", {
        _note: noteId,
        _base: base,
        _ydoc: toByteaHex(state),
        _kind: draft.kind ?? "text",
        _title: draft.title,
        _content: draft.content as never,
        _content_text: draft.content_text,
        _authors: authors,
      });
      if (error) {
        if (isRefusal(error)) return { status: "denied" };
        // A check of the size (content, text, state).
        if (error.code === "23514") return { status: "tooLarge" };
        throw error;
      }
      const row = data?.[0];
      switch (row?.status) {
        case "saved":
          return { status: "saved", version: row.version ?? base + 1 };
        case "conflict":
          return {
            status: "conflict",
            version: row.version ?? base,
            state: fromByteaHex(row.ydoc),
            kind: row.kind ?? "text",
          };
        case "deleted":
          return { status: "deleted" };
        case "denied":
          return { status: "denied" };
        case "too_large":
          return { status: "tooLarge" };
        default:
          return { status: "missing" };
      }
    },
    async checkpoint() {
      await supabase.rpc("note_version_checkpoint", { _note: noteId });
    },
    openLocal: (doc) => localReplica(`gradus-note:${userId}:${noteId}`, doc),
    transport: (sid) => realtimeTransport(noteId, sid),
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    track(event, props) {
      if (event === "opened") {
        track("note_live_opened", { writer: props.writer === true, others: Number(props.others) || 0 });
      } else if (event === "limited") {
        track("note_live_limited", { reason: props.reason === "people" ? "people" : "size" });
      } else {
        track("note_live_merged", { from: props.from === "reopen" ? "reopen" : "save" });
      }
    },
  };
}

export type AcquireOptions = {
  noteId: string;
  kind: NoteKind;
  me: Me;
  canWrite: boolean;
  initial: unknown;
  textOptions: () => TextOptions;
};

/** The session of a note, made on first use; `release` when the editor goes. */
export function acquireSession(options: AcquireOptions): CollabSession {
  const registry = registryOf(options.me.userId);
  const existing = registry.get(options.noteId);
  if (existing) {
    existing.refs += 1;
    if (existing.timer) clearTimeout(existing.timer);
    existing.timer = null;
    existing.session.setCanWrite(options.canWrite);
    return existing.session;
  }
  const session = new CollabSession({
    ...options,
    io: browserIO(options.me.userId, options.noteId),
  });
  registry.set(options.noteId, { session, refs: 1, timer: null });
  return session;
}

export function releaseSession(userId: string, noteId: string, session: CollabSession) {
  const registry = registryOf(userId);
  const entry = registry.get(noteId);
  if (!entry || entry.session !== session) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.timer = setTimeout(() => {
    if (registry.get(noteId) !== entry || entry.refs > 0) return;
    registry.delete(noteId);
    void entry.session.close();
  }, COLLAB.releaseGraceMs);
}

/** The open session of a note in this tab, if any. */
export function openSession(userId: string, noteId: string): CollabSession | null {
  return registries.get(userId)?.get(noteId)?.session ?? null;
}

/** Saves a note open in this tab now (before it is deleted, read by Grady, …). */
export async function flushSession(userId: string, noteId: string): Promise<boolean> {
  const session = openSession(userId, noteId);
  if (!session) return true;
  await session.flush();
  return !session.hasUnsaved();
}

/** Every open note reads its stored state again (Grady changed or undid something). */
export function pullSessions(userId: string) {
  for (const entry of registries.get(userId)?.values() ?? []) void entry.session.pull();
}

/** Ends a note's session without saving: the account lost its access to the note. */
export function revokeSession(userId: string, noteId: string) {
  const registry = registries.get(userId);
  const entry = registry?.get(noteId);
  if (!entry) return;
  registry!.delete(noteId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.session.revoke();
}

/** Closes a note's session at once (the note goes to the trash or is converted). */
export async function closeSession(userId: string, noteId: string) {
  const registry = registries.get(userId);
  const entry = registry?.get(noteId);
  if (!entry) return;
  registry!.delete(noteId);
  if (entry.timer) clearTimeout(entry.timer);
  await entry.session.close();
}

/**
 * Whether someone types in a live note open in this tab right now (the
 * typing line of the live bar). The theme transition (30.6) waits for it.
 */
export function anyLiveTyping(): boolean {
  for (const registry of registries.values()) {
    for (const entry of registry.values()) {
      if (entry.session.getSnapshot().typing.length > 0) return true;
    }
  }
  return false;
}
