"use client";

import { useCallback } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { searchParams, shouldQueryDatabase } from "@/features/search/search-logic";
import type { SearchHit } from "@/features/search/queries";
import { todayIsoDate, type FormatSettings } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  contactName,
  idsByKind,
  isMentionKind,
  MENTION_KINDS,
  mentionKey,
  mentionSetKey,
  type MentionAttrs,
  type MentionKind,
  type MentionTarget,
  type MentionTextFn,
} from "./mentions";

/**
 * Reading what notes mention: the records behind the chips of an open note
 * (their current names, or that they are gone), the search of the @ menu and
 * the notes that mention one record. Notes are private to the account's own
 * space, so everything here reads the signed-in user's own rows.
 */

export const mentionKeys = {
  targets: (userId: string, set: string) => ["note-mentions", userId, "targets", set] as const,
  search: (userId: string, query: string) => ["note-mentions", userId, "search", query] as const,
  notesOf: (userId: string, kind: MentionKind, id: string) =>
    ["note-mentions", userId, "notes", kind, id] as const,
};

/** "[kontakt: Jan Novák]": a mention in the note's plain text, in the interface language. */
export function useMentionText(): MentionTextFn {
  const t = useTranslations("notes.mention.kind");
  return useCallback((kind, label) => `[${t(kind)}: ${label}]`, [t]);
}

/** Where a mentioned record opens: its detail, the deal's panel, the event on its day. */
export function mentionHref(
  kind: MentionKind,
  id: string,
  settings: FormatSettings,
  startsAt?: string | null,
): string {
  const safe = encodeURIComponent(id);
  switch (kind) {
    case "contact":
      return `/app/kontakty/${safe}`;
    case "deal":
      return `/app/pipeline?deal=${safe}`;
    case "event": {
      const date = startsAt ? todayIsoDate(settings, new Date(startsAt)) : null;
      return date ? `/app/kalendar?event=${safe}&date=${date}` : `/app/kalendar?event=${safe}`;
    }
    case "worker":
      return `/app/pracovnici/${safe}`;
  }
}

/**
 * The current state of every record the note mentions. A record that is not
 * found among the user's own rows is gone; when the lookup itself fails the
 * chips keep their stored labels and are not marked as gone.
 */
export function useMentionTargets(mentions: readonly MentionAttrs[]) {
  const { user } = useSession();
  const set = mentionSetKey(mentions);
  return useQuery({
    queryKey: mentionKeys.targets(user.id, set),
    queryFn: async (): Promise<Map<string, MentionTarget>> => {
      const supabase = createClient();
      const ids = idsByKind(mentions);
      const found = new Map<string, MentionTarget>();
      const [contacts, deals, events, workers] = await Promise.all([
        ids.contact.length
          ? supabase
              .from("contacts")
              .select("id, company_name, first_name, last_name")
              .eq("user_id", user.id)
              .in("id", ids.contact)
          : null,
        ids.deal.length
          ? supabase.from("deals").select("id, title").eq("user_id", user.id).in("id", ids.deal)
          : null,
        ids.event.length
          ? supabase
              .from("calendar_events")
              .select("id, title, starts_at")
              .eq("user_id", user.id)
              .in("id", ids.event)
          : null,
        ids.worker.length
          ? supabase.from("workers").select("id, name").eq("owner_id", user.id).in("id", ids.worker)
          : null,
      ]);
      for (const result of [contacts, deals, events, workers]) if (result?.error) throw result.error;
      for (const row of contacts?.data ?? []) {
        found.set(mentionKey("contact", row.id), { exists: true, label: contactName(row) });
      }
      for (const row of deals?.data ?? []) {
        found.set(mentionKey("deal", row.id), { exists: true, label: row.title });
      }
      for (const row of events?.data ?? []) {
        found.set(mentionKey("event", row.id), {
          exists: true,
          label: row.title,
          startsAt: row.starts_at,
        });
      }
      for (const row of workers?.data ?? []) {
        found.set(mentionKey("worker", row.id), { exists: true, label: row.name });
      }
      for (const mention of mentions) {
        const key = mentionKey(mention.type, mention.id);
        if (!found.has(key)) found.set(key, { exists: false });
      }
      return found;
    },
    enabled: mentions.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export type MentionOption = MentionAttrs & { startsAt: string | null; detail: string | null };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A search hit as a choice of the @ menu, with a quiet second line where it helps. */
export function optionFromHit(hit: SearchHit): MentionOption | null {
  if (!isMentionKind(hit.kind)) return null;
  const label = hit.title?.trim();
  if (!label) return null;
  const data = hit.data ?? {};
  const detail =
    hit.kind === "contact"
      ? text(data.company) && text(data.person)
        ? text(data.person)
        : text(data.table)
      : hit.kind === "deal"
        ? text(data.contact) ?? text(data.stage)
        : hit.kind === "worker"
          ? text(data.jobTitle)
          : null;
  return {
    type: hit.kind,
    id: hit.id,
    label,
    startsAt: hit.kind === "event" ? text(data.startsAt) : null,
    detail,
  };
}

/**
 * The @ menu's search: the global search (src/features/search) limited to
 * contacts, deals, events and workers, with the user's own client, so row
 * level security decides what can come back.
 */
export function useMentionSearch(query: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: mentionKeys.search(user.id, query),
    queryFn: async ({ signal }): Promise<MentionOption[]> => {
      const params = searchParams(query, MENTION_KINDS);
      const { data, error } = await createClient()
        .rpc("global_search", {
          _query: params._query,
          _phone_patterns: params._phone_patterns,
          _limit: params._limit,
          // The generated type misses that this one is nullable.
          _amount: params._amount as unknown as number,
          _kinds: [...MENTION_KINDS],
        })
        .abortSignal(signal);
      if (error) throw error;
      return ((data ?? []) as SearchHit[]).flatMap((hit) => {
        const option = optionFromHit(hit);
        return option ? [option] : [];
      });
    },
    enabled: shouldQueryDatabase(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

export type MentioningNote = { id: string; title: string; preview: string | null; updated_at: string };

/** A record is mentioned in a handful of notes; this only bounds the query. */
const NOTES_OF_LIMIT = 50;

/** The notes (not in the trash) that mention one record, last edited first. */
export function useNotesMentioning(kind: MentionKind, id: string, enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: mentionKeys.notesOf(user.id, kind, id),
    queryFn: async (): Promise<MentioningNote[]> => {
      const { data, error } = await createClient()
        .from("note_mentions")
        .select("note:notes(id, title, preview, updated_at, deleted_at)")
        .eq("user_id", user.id)
        .eq("target_type", kind)
        .eq("target_id", id)
        .limit(NOTES_OF_LIMIT);
      if (error) throw error;
      return data
        .flatMap(({ note }) =>
          note && !note.deleted_at
            ? [{ id: note.id, title: note.title, preview: note.preview, updated_at: note.updated_at }]
            : [],
        )
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    },
    enabled,
  });
}
