"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { connectApple, disconnectCalendar, saveCalendarSelection, type SyncActionError } from "./actions";
import type { CalendarSyncOverview } from "./overview";
import { CALENDAR_SYNC_API } from "./paths";

/**
 * Two-way calendar sync in the browser (28.10): the overview for Settings,
 * the read when the calendar opens, the nudge after a change, and the link
 * an event has to Google or Apple (its detail).
 */

export const syncKeys = {
  all: (userId: string) => ["calendar-sync", userId] as const,
  overview: (userId: string) => ["calendar-sync", userId, "overview"] as const,
  link: (userId: string, eventId: string) => ["calendar-sync", userId, "link", eventId] as const,
  meet: (userId: string) => ["calendar-sync", userId, "meet"] as const,
};

export class SyncActionFailure extends Error {
  constructor(readonly code: SyncActionError | "tooSoon") {
    super(code);
  }
}

export function useCalendarSyncOverview() {
  const { user } = useSession();
  return useQuery({
    queryKey: syncKeys.overview(user.id),
    queryFn: async (): Promise<CalendarSyncOverview> => {
      const response = await fetch(CALENDAR_SYNC_API, { cache: "no-store" });
      if (!response.ok) throw new Error(`calendar sync overview ${response.status}`);
      return (await response.json()) as CalendarSyncOverview;
    },
  });
}

/** After a change of an event: whatever waits goes to the person's calendar now. */
export function requestCalendarPush(): void {
  void fetch(CALENDAR_SYNC_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trigger: "change" }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Opening the calendar reads the connected calendars (the server skips it
 * when it read them in the last two minutes); what came in is shown at once.
 */
export function useSyncOnOpen(onChanged: () => void) {
  const done = useRef(false);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void fetch(CALENDAR_SYNC_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "open" }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { applied?: number } | null) => {
        if (body?.applied) changed.current();
      })
      .catch(() => undefined);
  }, []);
}

export function useSyncNow() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(CALENDAR_SYNC_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "manual", connectionId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; failed?: number };
      if (!response.ok) throw new SyncActionFailure((body.error as SyncActionError) ?? "unknown");
      return body;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: syncKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: ["calendar", user.id] });
    },
  });
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: SyncActionError }): T {
  if (!result.ok) throw new SyncActionFailure(result.error);
  return result.data;
}

export function useConnectApple() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { appleId: string; password: string }) => unwrap(await connectApple(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: syncKeys.all(user.id) }),
  });
}

export function useSaveSelection() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { connectionId: string; read: string[]; write: string | null }) =>
      unwrap(await saveCalendarSelection(input)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: syncKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: ["calendar", user.id] });
    },
  });
}

export function useDisconnect() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => unwrap(await disconnectCalendar(connectionId)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: syncKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: ["calendar", user.id] });
    },
  });
}

export type EventLink = {
  provider: "google" | "apple";
  origin: "gradus" | "external";
  conflictAt: string | null;
  conflictWinner: "gradus" | "external" | null;
};

/** Where an event is mirrored, and the last time both sides changed it at once. */
export function useEventLink(eventId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: syncKeys.link(user.id, eventId ?? "none"),
    enabled: Boolean(eventId),
    queryFn: async (): Promise<EventLink | null> => {
      const { data, error } = await createClient()
        .from("calendar_external_links")
        .select("origin, conflict_at, conflict_winner, connection:calendar_connections(provider)")
        .eq("event_id", eventId!)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) return null;
      const connection = data.connection as { provider: string } | null;
      return {
        provider: connection?.provider === "apple" ? "apple" : "google",
        origin: data.origin === "gradus" ? "gradus" : "external",
        conflictAt: data.conflict_at,
        conflictWinner:
          data.conflict_winner === "gradus" || data.conflict_winner === "external" ? data.conflict_winner : null,
      };
    },
  });
}

/** Whether the person writes to a Google calendar (a type may then ask for Google Meet). */
export function useGoogleMeetReady() {
  const { user } = useSession();
  return useQuery({
    queryKey: syncKeys.meet(user.id),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await createClient()
        .from("calendar_connection_calendars")
        .select("id, connection:calendar_connections(provider, status)")
        .eq("user_id", user.id)
        .eq("write", true)
        .maybeSingle();
      if (error || !data) return false;
      const connection = data.connection as { provider: string; status: string } | null;
      return connection?.provider === "google" && connection.status === "active";
    },
  });
}
