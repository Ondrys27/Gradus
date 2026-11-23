"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, useSession } from "@/features/account/queries";
import { useMentionText } from "../mention-queries";
import { applyDraftToCache, noteKeys, type NoteDetail } from "../queries";
import { colorForPerson } from "./people";
import { acquireSession, releaseSession } from "./registry";
import type { CollabSession, SessionSnapshot } from "./session";

const LOADING: SessionSnapshot = {
  phase: "loading",
  kind: "text",
  generation: 0,
  writable: false,
  limit: null,
  connection: "connecting",
  save: "saved",
  people: [],
  typing: [],
};
const noop = () => () => undefined;

/**
 * The live session of an open note: made when the editor shows, kept a
 * moment after it goes. The list and the reopened note follow every change
 * (own and others') through the query cache, as with the autosave before.
 */
export function useCollabSession(note: NoteDetail, canWrite: boolean) {
  const { user } = useSession();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const mentionText = useMentionText();
  const [session, setSession] = useState<CollabSession | null>(null);

  useEffect(() => {
    const opened = acquireSession({
      noteId: note.id,
      kind: note.kind,
      me: {
        userId: user.id,
        name: profile?.display_name?.trim() || user.email?.split("@")[0] || "",
        avatarUrl: profile?.avatar_url ?? null,
        color: colorForPerson(user.id),
      },
      canWrite,
      initial: note.content,
      textOptions: () => ({ mentionText }),
    });
    setSession(opened);
    return () => releaseSession(user.id, note.id, opened);
    // One session per note; rights follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, user.id]);

  useEffect(() => {
    session?.setCanWrite(canWrite);
  }, [session, canWrite]);

  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? (() => LOADING),
    () => LOADING,
  );

  // The list's title and preview, and the detail when it is opened again.
  useEffect(() => {
    if (!session || snapshot.phase !== "ready") return;
    const doc = session.doc;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        applyDraftToCache(queryClient, user.id, note.id, session.draft());
      }, 300);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [session, snapshot.phase, snapshot.generation, queryClient, user.id, note.id]);

  // Converted to the other kind by someone else: the screen reads the note again.
  useEffect(() => {
    if (snapshot.phase === "ready" && snapshot.kind !== note.kind) {
      void queryClient.invalidateQueries({ queryKey: noteKeys.detail(user.id, note.id) });
    }
  }, [snapshot.phase, snapshot.kind, note.kind, note.id, queryClient, user.id]);

  return { session, snapshot };
}
