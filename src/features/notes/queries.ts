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
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  appendToDoc,
  draftFromDoc,
  previewFromText,
  type DocNode,
  type NoteDraft,
} from "./document";
import { useMentionText } from "./mention-queries";
import { NoteSaver, type BackupEntry, type DraftBackup } from "./note-saver";
import { sortNotes, TRASH_DAYS } from "./notes-logic";
import type { NoteTemplateKey } from "./templates";
import type { IndustryKey } from "@/features/onboarding/industries";

/** A person keeps tens, maybe hundreds of notes; this only bounds the query. */
const LIST_LIMIT = 500;
const TRASH_LIMIT = 200;
export const SEARCH_LIMIT = 50;

/** Sent with { id, content } when a note's text was changed outside its editor. */
export const NOTE_REPLACED_EVENT = "gradus:note-replaced";

export const NOTE_LIST_COLUMNS = "id, title, preview, pinned, created_at, updated_at" as const;
const NOTE_DETAIL_COLUMNS = `${NOTE_LIST_COLUMNS}, content, content_text` as const;

export type NoteListItem = {
  id: string;
  title: string;
  preview: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};
export type NoteDetail = NoteListItem & { content: DocNode; content_text: string };
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
  const supabase = createClient();
  const text = {
    title: draft.title,
    content: draft.content as never,
    content_text: draft.content_text,
  };
  const update = () =>
    supabase.from("notes").update(text).eq("user_id", userId).eq("id", id).select("id");
  const updated = await update();
  if (updated.error) throw updated.error;
  if (updated.data.length > 0) return;
  const inserted = await supabase.from("notes").insert({ id, user_id: userId, ...text });
  if (!inserted.error) return;
  if (inserted.error.code !== "23505") throw inserted.error;
  const again = await update();
  if (again.error) throw again.error;
}

export function getNoteSaver(userId: string): NoteSaver {
  let saver = savers.get(userId);
  if (saver) return saver;
  saver = new NoteSaver({
    save: (id, draft) => saveNote(userId, id, draft),
    backup: localBackup(userId),
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
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
    id,
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
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: noteKeys.list(user.id),
    queryFn: async (): Promise<NoteListItem[]> => {
      const { data, error } = await createClient()
        .from("notes")
        .select(NOTE_LIST_COLUMNS)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      // Text typed but not confirmed yet wins over what the server still has,
      // and a note made while offline stays in the list until it is saved.
      const saver = getNoteSaver(user.id);
      const onServer = new Set(data.map((note) => note.id));
      const notYetSaved = (
        queryClient.getQueryData<NoteListItem[]>(noteKeys.list(user.id)) ?? []
      ).filter((note) => !onServer.has(note.id) && saver.unsavedDraft(note.id));
      return sortNotes([
        ...data.map((note) => {
          const draft = saver.unsavedDraft(note.id);
          return draft
            ? { ...note, title: draft.title, preview: previewFromText(draft.content_text) }
            : note;
        }),
        ...notYetSaved,
      ]);
    },
  });
}

/** One note with its document; `null` when it does not exist, is not the user's or is deleted. */
export function useNote(id: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: noteKeys.detail(user.id, id ?? ""),
    queryFn: async (): Promise<NoteDetail | null> => {
      const { data, error } = await createClient()
        .from("notes")
        .select(NOTE_DETAIL_COLUMNS)
        .eq("user_id", user.id)
        .eq("id", id!)
        .is("deleted_at", null)
        .maybeSingle();
      // A malformed id (22P02) is just a note that does not exist.
      if (error && error.code !== "22P02") throw error;
      if (!data) return null;
      const draft = getNoteSaver(user.id).latestDraft(data.id);
      return {
        ...data,
        content: (draft?.content ?? data.content) as DocNode,
        content_text: draft?.content_text ?? data.content_text,
        title: draft?.title ?? data.title,
      };
    },
    enabled: !!id,
    // The open editor owns the text; a background refetch must never replace it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useNotesTrash(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: noteKeys.trash(user.id),
    queryFn: async (): Promise<TrashedNote[]> => {
      const since = new Date(Date.now() - TRASH_DAYS * 24 * 3600 * 1000).toISOString();
      const { data, error } = await createClient()
        .from("notes")
        .select("id, title, preview, deleted_at")
        .eq("user_id", user.id)
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
  return useQuery({
    queryKey: noteKeys.search(user.id, query),
    queryFn: async ({ signal }): Promise<NoteSearchHit[]> => {
      const { data, error } = await createClient()
        .rpc("search_notes", { _query: query, _limit: SEARCH_LIMIT })
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
  where: "list" | "empty_state" | "shortcut" | "task" | "milestone" | "deal" | "jarvis";
  template?: { key: NoteTemplateKey; industry: IndustryKey | null };
};

/**
 * A new note shows at once and is saved through the autosave like any edit,
 * so it survives a lost connection the same way.
 */
export function useCreateNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return (input: CreateNoteInput): string => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const note: NoteDetail = {
      id,
      title: input.draft.title,
      preview: previewFromText(input.draft.content_text),
      pinned: false,
      created_at: now,
      updated_at: now,
      content: input.draft.content,
      content_text: input.draft.content_text,
    };
    queryClient.setQueryData(noteKeys.detail(user.id, id), note);
    queryClient.setQueryData<NoteListItem[]>(noteKeys.list(user.id), (list) =>
      sortNotes([note, ...(list ?? [])]),
    );
    const saver = getNoteSaver(user.id);
    saver.edit(id, input.draft);
    void saver.flush(id);
    track("note_created", { source: input.template ? "template" : "blank", where: input.where });
    if (input.template) {
      track("note_template_used", {
        template: input.template.key,
        industry: input.template.industry ?? undefined,
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
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await createClient()
        .from("notes")
        .update({ pinned })
        .eq("user_id", user.id)
        .eq("id", id);
      if (error) throw error;
    },
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
    }: {
      id: string;
      pinned: boolean;
      /** Where it was deleted: the open note's bin, the list's bin or the Delete key. */
      from: "editor" | "list" | "keyboard";
    }) => {
      await getNoteSaver(user.id).flush(id);
      const { error } = await createClient()
        .from("notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: ({ id }) => {
      const previous = queryClient.getQueryData<NoteListItem[]>(key);
      queryClient.setQueryData<NoteListItem[]>(key, (list) => list?.filter((n) => n.id !== id));
      return { previous };
    },
    onSuccess: (_data, { id, pinned, from }) => {
      track("note_deleted", { pinned, from });
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
      saver.discard(id);
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
 * Adds a small heading and blocks at the end of an existing note (one of
 * Jarvis's answers), through the autosave like any edit. An open editor of
 * the note takes the new text over, so its next keystroke keeps it.
 */
export function useAppendToNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const mentionText = useMentionText();
  return useMutation({
    mutationFn: async ({ id, heading, blocks }: { id: string; heading: string; blocks: DocNode[] }) => {
      const saver = getNoteSaver(user.id);
      let content = saver.latestDraft(id)?.content;
      if (!content) {
        const { data, error } = await createClient()
          .from("notes")
          .select("content")
          .eq("user_id", user.id)
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("note_not_found");
        content = data.content as DocNode;
      }
      const next = appendToDoc(content, heading, blocks);
      const draft = draftFromDoc(next, { mentionText });
      saver.edit(id, draft);
      applyDraftToCache(queryClient, user.id, id, draft);
      window.dispatchEvent(new CustomEvent(NOTE_REPLACED_EVENT, { detail: { id, content: next } }));
      await saver.flush(id);
      if (saver.unsavedDraft(id)) throw new Error("note_not_saved");
    },
  });
}
