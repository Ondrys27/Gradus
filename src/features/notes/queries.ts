"use client";

import { useEffect } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { clientOps } from "@/lib/ops-client";
import { createClient } from "@/lib/supabase/client";
import { closeSession, flushSession, pullSessions, revokeSession } from "./collab/registry";
import { NoteNotWritableError, setNotePinned, trashNote, writeNote } from "./ops";
import { previewFromText, type DocNode, type NoteDraft } from "./document";
import type { MapDoc, NoteKind } from "./mindmap/map-doc";
import { noteContentOf, noteKindOf } from "./mindmap/note-row";
import { NoteSaver, type BackupEntry, type DraftBackup } from "./note-saver";
import { sortNotes, TRASH_DAYS } from "./notes-logic";
import { noteRoleOf, type NoteRole } from "./sharing/logic";
import type { NoteTemplateKey } from "./templates";
import type { IndustryKey } from "@/features/onboarding/industries";

const TRASH_LIMIT = 200;
export const SEARCH_LIMIT = 50;

export const NOTE_LIST_COLUMNS =
  "id, kind, title, preview, pinned, created_at, updated_at, is_demo" as const;
const NOTE_DETAIL_COLUMNS =
  `${NOTE_LIST_COLUMNS}, content, content_text, user_id, space_id, folder_id, folder_private` as const;

/** How the account reaches a note (28.3); a note of its own when absent (older reads). */
export type NoteAccess = {
  /** owner, editor (writes the text) or viewer (reads). */
  role?: NoteRole;
  can_reshare?: boolean;
  /** The owner's account, and their name when the note is someone else's. */
  owner_id?: string;
  owner_name?: string | null;
  folder_id?: string | null;
  folder_private?: boolean;
  /** Someone besides the owner reaches it (a share of it or of its folder). */
  shared?: boolean;
};

export type NoteListItem = {
  id: string;
  /** Text, or a mind map (the content is then a MapDoc). */
  kind: NoteKind;
  title: string;
  preview: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  /** Sample data of the tutorial (labelled "sample"); absent in older reads. */
  is_demo?: boolean | null;
} & NoteAccess;
export type NoteDetail = NoteListItem & {
  content: DocNode | MapDoc;
  content_text: string;
  space_id?: string;
};

export type TrashedNote = { id: string; title: string; preview: string | null; deleted_at: string };
export type NoteSearchHit = { id: string; title: string; rank: number };

export const noteKeys = {
  all: (userId: string) => ["notes", userId] as const,
  list: (userId: string) => ["notes", userId, "list"] as const,
  detail: (userId: string, id: string) => ["notes", userId, "detail", id] as const,
  trash: (userId: string) => ["notes", userId, "trash"] as const,
  search: (userId: string, query: string) => ["notes", userId, "search", query] as const,
};

// ---------------------------------------------------------------------------
// Autosave: one saver per signed-in user, kept across page changes so leaving
// the Notes page never cancels a save that is still running.
// ---------------------------------------------------------------------------

const savers = new Map<string, NoteSaver>();

function localBackup(userId: string): DraftBackup {
  const key = `gradus:notes:unsaved:${userId}`;
  return {
    read() {
      try {
        const raw = window.localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? (parsed as Record<string, BackupEntry>) : {};
      } catch {
        return {};
      }
    },
    write(entries) {
      try {
        if (Object.keys(entries).length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        // Private mode or full storage: saving to the server still works.
      }
    },
  };
}

/**
 * Writes a note's text. A note made in the app exists only in the browser
 * until its first save, so creating works offline too: the update finds no
 * row the first time and the note is inserted (a parallel insert that won the
 * race just means updating again).
 */
async function saveNote(userId: string, id: string, draft: NoteDraft): Promise<void> {
  await writeNote({ db: createClient() }, { userId, id, draft });
}

export function getNoteSaver(userId: string): NoteSaver {
  let saver = savers.get(userId);
  if (saver) return saver;
  saver = new NoteSaver({
    save: (id, draft) => saveNote(userId, id, draft),
    backup: localBackup(userId),
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    isDenied: (error) => error instanceof NoteNotWritableError,
  });
  savers.set(userId, saver);

  if (typeof window !== "undefined") {
    const s = saver;
    window.addEventListener("online", () => s.retryNow());
    // Unsaved text goes to the backup before the page can disappear, and a
    // closing tab with unsaved text asks first.
    window.addEventListener("pagehide", () => s.writeBackup());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        s.writeBackup();
        void s.flushAll();
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (!s.hasUnsaved()) return;
      s.writeBackup();
      event.preventDefault();
      event.returnValue = "";
    });
  }
  return saver;
}

export function useNoteSaver(): NoteSaver {
  const { user } = useSession();
  return getNoteSaver(user.id);
}

/**
 * What the screen shows while a note is being edited: the list moves the note
 * to the top with its new title and preview, and reopening it shows the text
 * that may not be saved yet.
 */
export function applyDraftToCache(
  queryClient: QueryClient,
  userId: string,
  id: string,
  draft: NoteDraft,
  at = new Date().toISOString(),
) {
  const listed = queryClient
    .getQueryData<NoteListItem[]>(noteKeys.list(userId))
    ?.find((note) => note.id === id);
  queryClient.setQueryData<NoteDetail | null>(noteKeys.detail(userId, id), (old) => ({
    ...(old ?? listed ?? {}),
    id,
    kind: draft.kind ?? "text",
    pinned: old?.pinned ?? listed?.pinned ?? false,
    created_at: old?.created_at ?? listed?.created_at ?? at,
    title: draft.title,
    content: draft.content,
    content_text: draft.content_text,
    preview: previewFromText(draft.content_text),
    updated_at: at,
  }));
  queryClient.setQueryData<NoteListItem[]>(noteKeys.list(userId), (list) =>
    list
      ? sortNotes(
          list.map((note) =>
            note.id === id
              ? {
                  ...note,
                  kind: draft.kind ?? "text",
                  title: draft.title,
                  preview: previewFromText(draft.content_text),
                  updated_at: at,
                }
              : note,
          ),
        )
      : list,
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function useNotes() {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: noteKeys.list(user.id),
    queryFn: async (): Promise<NoteListItem[]> => {
      // The account's own notes of the active space and the ones shared with it.
      const { data, error } = await createClient().rpc("notes_list", { _space: space });
      if (error) throw error;
      // Text typed but not confirmed yet wins over what the server still has,
      // and a note made while offline stays in the list until it is saved.
      const saver = getNoteSaver(user.id);
      const onServer = new Set(data.map((note) => note.id));
      const notYetSaved = (
        queryClient.getQueryData<NoteListItem[]>(noteKeys.list(user.id)) ?? []
      ).filter((note) => !onServer.has(note.id) && saver.unsavedDraft(note.id));
      return sortNotes([
        ...data.map((row) => {
          const note: NoteListItem = {
            id: row.id,
            kind: noteKindOf(row.kind),
            title: row.title,
            preview: row.preview ?? null,
            pinned: row.pinned,
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_demo: row.is_demo,
            role: noteRoleOf(row.role),
            can_reshare: row.can_reshare,
            owner_id: row.owner_id,
            owner_name: row.owner_name ?? null,
            folder_id: row.folder_id ?? null,
            folder_private: row.folder_private,
            shared: row.shared,
          };
          const draft = saver.unsavedDraft(note.id);
          return draft
            ? {
                ...note,
                kind: draft.kind ?? "text",
                title: draft.title,
                preview: previewFromText(draft.content_text),
              }
            : note;
        }),
        ...notYetSaved,
      ]);
    },
    // Sharing changes from elsewhere: a note shared or taken away shows soon.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * One note with its document and the account's role to it; `null` when it
 * does not exist, is deleted or the account does not reach it.
 */
export function useNote(id: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: noteKeys.detail(user.id, id ?? ""),
    queryFn: async (): Promise<NoteDetail | null> => {
      const supabase = createClient();
      const [row, access] = await Promise.all([
        supabase
          .from("notes")
          .select(NOTE_DETAIL_COLUMNS)
          .eq("id", id!)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase.rpc("note_role", { _note: id! }),
      ]);
      // A malformed id (22P02) is just a note that does not exist.
      if (row.error && row.error.code !== "22P02") throw row.error;
      if (access.error && access.error.code !== "22P02") throw access.error;
      const data = row.data;
      if (!data) return null;
      const role = access.data?.[0];
      const draft = getNoteSaver(user.id).latestDraft(data.id);
      const kind = draft ? (draft.kind ?? "text") : noteKindOf(data.kind);
      return {
        ...data,
        kind,
        content: noteContentOf(kind, draft?.content ?? data.content),
        content_text: draft?.content_text ?? data.content_text,
        title: draft?.title ?? data.title,
        role: data.user_id === user.id ? "owner" : noteRoleOf(role?.role),
        can_reshare: data.user_id === user.id ? true : (role?.can_reshare ?? false),
        owner_id: data.user_id,
        folder_id: data.folder_id,
        folder_private: data.folder_private,
        space_id: data.space_id,
      };
    },
    enabled: !!id,
    // The open editor owns the text; a background refetch must never replace it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * The account's role to an open note someone else owns, read again every
 * 20 s and on focus. A share taken away (or a group, the company left) ends
 * it within seconds: the live session goes without saving, leaves the
 * channel and drops the browser's copy, and the note leaves the screen. A
 * changed role (editor ↔ viewer) reaches the open editor the same way.
 */
export function useNoteRoleWatch(note: NoteDetail | null | undefined) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const id = note?.id ?? "";
  const watched = !!note && note.role !== "owner";
  const access = useQuery({
    queryKey: ["notes", user.id, "role", id] as const,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("note_role", { _note: id });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: watched,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });
  const row = access.data;
  const fetched = access.isSuccess && !access.isFetching;
  useEffect(() => {
    if (!watched || !fetched) return;
    const key = noteKeys.detail(user.id, id);
    if (!row?.role) {
      revokeSession(user.id, id);
      queryClient.setQueryData<NoteDetail | null>(key, null);
      void queryClient.invalidateQueries({ queryKey: noteKeys.list(user.id) });
      return;
    }
    const role = noteRoleOf(row.role);
    const canReshare = row.can_reshare ?? false;
    queryClient.setQueryData<NoteDetail | null>(key, (old) =>
      old && (old.role !== role || old.can_reshare !== canReshare) ? { ...old, role, can_reshare: canReshare } : old,
    );
  }, [watched, fetched, row, id, user.id, queryClient]);
}

export function useNotesTrash(enabled: boolean) {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  return useQuery({
    queryKey: noteKeys.trash(user.id),
    queryFn: async (): Promise<TrashedNote[]> => {
      const since = new Date(Date.now() - TRASH_DAYS * 24 * 3600 * 1000).toISOString();
      const { data, error } = await createClient()
        .from("notes")
        .select("id, title, preview, deleted_at")
        .eq("user_id", user.id)
        .eq("space_id", space)
        .not("deleted_at", "is", null)
        .gt("deleted_at", since)
        .order("deleted_at", { ascending: false })
        .limit(TRASH_LIMIT);
      if (error) throw error;
      return data as TrashedNote[];
    },
    enabled,
  });
}

/** Full-text search of the user's notes (2+ characters), best first. */
export function useNoteSearch(query: string) {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  return useQuery({
    queryKey: noteKeys.search(user.id, query),
    queryFn: async ({ signal }): Promise<NoteSearchHit[]> => {
      const { data, error } = await createClient()
        .rpc("search_notes", { _query: query, _limit: SEARCH_LIMIT, _space: space })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map(({ id, title, rank }) => ({ id, title, rank }));
    },
    enabled: query.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Sends edits left unsaved by an earlier visit (closed tab, lost connection).
 * An edit older than what the server has (changed on another device since)
 * is dropped instead of overwriting newer text.
 */
export function useRestoreUnsavedNotes(notes: NoteListItem[] | undefined) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!notes) return;
    const saver = getNoteSaver(user.id);
    const backup = saver.readBackup();
    const byId = new Map(notes.map((note) => [note.id, note]));
    for (const [id, entry] of Object.entries(backup)) {
      if (saver.latestDraft(id) || !entry?.draft || typeof entry.editedAt !== "number") continue;
      const note = byId.get(id);
      if (note && new Date(note.updated_at).getTime() > entry.editedAt) continue;
      const at = new Date(entry.editedAt).toISOString();
      if (!note) {
        // Made while offline and never saved: it comes back as a new note.
        queryClient.setQueryData<NoteListItem[]>(noteKeys.list(user.id), (list) =>
          sortNotes([
            ...(list ?? []),
            {
              id,
              kind: entry.draft.kind ?? "text",
              title: entry.draft.title,
              preview: previewFromText(entry.draft.content_text),
              pinned: false,
              created_at: at,
              updated_at: at,
            },
          ]),
        );
      }
      saver.edit(id, entry.draft, entry.editedAt);
      applyDraftToCache(queryClient, user.id, id, entry.draft, at);
    }
    saver.writeBackup();
    // Once per loaded list is enough; later edits are tracked by the saver itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes === undefined, user.id]);
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export type CreateNoteInput = {
  draft: NoteDraft;
  where:
    | "list"
    | "empty_state"
    | "shortcut"
    | "task"
    | "milestone"
    | "deal"
    | "jarvis" // from Grady's answer: DB name kept from Jarvis (note_created.where)
    | "convert"
    | "dashboard";
  template?: { key: NoteTemplateKey; industry: IndustryKey | null };
  /** A note made from a file or from another note; by default blank or template. */
  source?: "import" | "convert";
  /** The folder it goes into (the open one), or none. */
  folderId?: string | null;
};

/**
 * A new note shows at once and is saved through the autosave like any edit,
 * so it survives a lost connection the same way.
 */
export function useCreateNote() {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  const queryClient = useQueryClient();
  return (input: CreateNoteInput): string => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const folderId = input.folderId ?? null;
    const note: NoteDetail = {
      id,
      kind: input.draft.kind ?? "text",
      title: input.draft.title,
      preview: previewFromText(input.draft.content_text),
      pinned: false,
      created_at: now,
      updated_at: now,
      content: input.draft.content,
      content_text: input.draft.content_text,
      role: "owner",
      can_reshare: true,
      owner_id: user.id,
      owner_name: null,
      folder_id: folderId,
      folder_private: false,
      space_id: space,
    };
    queryClient.setQueryData(noteKeys.detail(user.id, id), note);
    queryClient.setQueryData<NoteListItem[]>(noteKeys.list(user.id), (list) =>
      sortNotes([note, ...(list ?? [])]),
    );
    const saver = getNoteSaver(user.id);
    saver.edit(id, { ...input.draft, place: { spaceId: space, folderId } });
    void saver.flush(id);
    const kind = input.draft.kind ?? "text";
    track("note_created", {
      source: input.source ?? (input.template ? "template" : "blank"),
      where: input.where,
      kind,
    });
    if (input.template) {
      track("note_template_used", {
        template: input.template.key,
        industry: input.template.industry ?? undefined,
        kind,
      });
    }
    return id;
  };
}

export function usePinNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = noteKeys.list(user.id);
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      setNotePinned({ db: createClient() }, { userId: user.id, id, pinned }),
    onMutate: ({ id, pinned }) => {
      const previous = queryClient.getQueryData<NoteListItem[]>(key);
      queryClient.setQueryData<NoteListItem[]>(key, (list) =>
        list ? sortNotes(list.map((n) => (n.id === id ? { ...n, pinned } : n))) : list,
      );
      queryClient.setQueryData<NoteDetail | null>(noteKeys.detail(user.id, id), (old) =>
        old ? { ...old, pinned } : old,
      );
      return { previous };
    },
    onError: (_error, { id, pinned }, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      queryClient.setQueryData<NoteDetail | null>(noteKeys.detail(user.id, id), (old) =>
        old ? { ...old, pinned: !pinned } : old,
      );
    },
  });
}

/** Moves a note to Recently Deleted; its last text is saved first. */
export function useDeleteNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = noteKeys.list(user.id);
  return useMutation({
    mutationFn: async ({
      id,
      pinned,
      from,
    }: {
      id: string;
      pinned: boolean;
      /** Where it was deleted: the open note's bin, the list's bin or the Delete key. */
      from: "editor" | "list" | "keyboard";
    }) => {
      await getNoteSaver(user.id).flush(id);
      await flushSession(user.id, id);
      await trashNote(clientOps(), { userId: user.id, id, pinned, from });
      void closeSession(user.id, id);
    },
    onMutate: ({ id }) => {
      const previous = queryClient.getQueryData<NoteListItem[]>(key);
      queryClient.setQueryData<NoteListItem[]>(key, (list) => list?.filter((n) => n.id !== id));
      return { previous };
    },
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: noteKeys.detail(user.id, id) });
      void queryClient.invalidateQueries({ queryKey: noteKeys.trash(user.id) });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

/** Brings a note back from Recently Deleted. */
export function useRestoreNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient()
        .from("notes")
        .update({ deleted_at: null })
        .eq("user_id", user.id)
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: (id) => {
      queryClient.setQueryData<TrashedNote[]>(noteKeys.trash(user.id), (list) =>
        list?.filter((note) => note.id !== id),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.all(user.id) });
    },
  });
}

/** A note left without any text is removed when the user moves on (like Apple Notes). */
export function useRemoveBlankNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Whatever was typed and erased again reaches the server first, so the
      // check below sees the note as blank; a note with text is never removed.
      const saver = getNoteSaver(user.id);
      await saver.flush(id);
      await flushSession(user.id, id);
      saver.discard(id);
      await closeSession(user.id, id);
      const { error } = await createClient()
        .from("notes")
        .delete()
        .eq("user_id", user.id)
        .eq("id", id)
        .eq("content_text", "");
      if (error) throw error;
    },
    onMutate: (id) => {
      queryClient.setQueryData<NoteListItem[]>(noteKeys.list(user.id), (list) =>
        list?.filter((note) => note.id !== id),
      );
      queryClient.removeQueries({ queryKey: noteKeys.detail(user.id, id) });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.list(user.id) });
    },
  });
}

/**
 * Adds a small heading and the text at the end of an existing note (one of
 * Grady's answers). The server writes it into the note's live document as
 * one more participant (28.4), so whoever has the note open sees it arrive
 * and nothing they type meanwhile is overwritten.
 */
export function useAppendToNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      heading,
      text,
    }: {
      id: string;
      heading: string;
      /** The answer as plain text; the server makes the blocks (or a map's branch) from it. */
      text: string;
    }) => {
      // Own unsaved typing reaches the database first, so the addition lands after it.
      await getNoteSaver(user.id).flush(id);
      await flushSession(user.id, id);
      const response = await fetch("/api/notes/append", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: id, heading, text }),
      });
      if (!response.ok) throw new Error("note_not_saved");
      pullSessions(user.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.list(user.id) });
    },
  });
}
