"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { PresenceLookupProvider, type PresenceStatus } from "@/components/ui/presence";
import { useSession, useUserSettings } from "@/features/account/queries";
import { createClient, joinSignedIn } from "@/lib/supabase/client";
import {
  channelSpaces,
  isIdle,
  presenceIdleMs,
  presenceIn,
  presenceTopic,
  PRESENCE_TOUCH_MS,
  statusesOf,
  type PresenceMeta,
  type PresencePerson,
} from "./logic";

/**
 * Online status in the company (30.5), for the whole app frame: who is
 * listed comes from presence_people() (the database decides who may see
 * whom, nothing for an account that hides its status), who is there now from
 * Realtime Presence on the private channel of each company, and when someone
 * was last there from the one stored moment, written here at most once a
 * minute while the app is in front of the person and once more on leaving.
 *
 * Nothing goes to analytics, nothing is kept besides that one moment.
 */

export const presenceKeys = {
  all: (userId: string) => ["presence", userId] as const,
  // Turning the switch back on starts from a fresh list.
  people: (userId: string, enabled: boolean) => ["presence", userId, "people", enabled] as const,
};

/** A new arrival or a departure refreshes the stored moments after this (the leaver's last write lands first). */
const REFRESH_AFTER_MS = 1_500;
/** Who joined a company or turned the switch on shows up at the latest after this. */
const PEOPLE_REFETCH_MS = 5 * 60_000;
/** The address the tab calls while it is being closed (sendBeacon carries the session cookies). */
const LEAVE_URL = "/api/presence";

/** Channels of the same topic must be fully gone before a new one is made, or `channel()` returns the old one. */
const removing = new Map<string, Promise<unknown>>();

function usePresencePeople(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: presenceKeys.people(user.id, enabled),
    enabled,
    refetchInterval: PEOPLE_REFETCH_MS,
    staleTime: 30_000,
    queryFn: async (): Promise<PresencePerson[]> => {
      const { data, error } = await createClient().rpc("presence_people");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        spaceId: row.space_id,
        userId: row.user_id,
        lastSeenAt: row.last_seen_at ?? null,
      }));
    },
  });
}

/** Whether this tab has gone 10 minutes without a touch. */
function useIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const idleMs = presenceIdleMs();
    let last = Date.now();
    let idleNow = false;
    const set = (next: boolean) => {
      if (next === idleNow) return;
      idleNow = next;
      setIdle(next);
    };
    const touched = () => {
      last = Date.now();
      set(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") touched();
    };
    const check = setInterval(
      () => set(isIdle(last, Date.now(), idleMs)),
      Math.min(15_000, idleMs / 4),
    );
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
      "focus",
    ] as const;
    for (const event of events)
      window.addEventListener(event, touched, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(check);
      for (const event of events) window.removeEventListener(event, touched, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      setIdle(false);
    };
  }, [enabled]);
  return idle;
}

/** The stored moment: now and every minute while the app is in front, and on leaving. */
function useLastSeenTouch(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const touch = (leaving: boolean) => {
      void supabase.rpc("presence_touch", { _leaving: leaving }).then(
        () => undefined,
        () => undefined,
      );
    };
    const tick = () => {
      if (document.visibilityState === "visible") touch(false);
    };
    tick();
    const interval = setInterval(tick, PRESENCE_TOUCH_MS);
    const onVisibility = () => {
      // Hidden: the page still runs, an ordinary call lands.
      if (document.visibilityState === "hidden") touch(true);
      else tick();
    };
    const onPageHide = () => {
      if (!navigator.sendBeacon?.(LEAVE_URL)) {
        void fetch(LEAVE_URL, {
          method: "POST",
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled]);
}

/**
 * One private channel per company where someone else shows their status:
 * this tab is present there with its idle flag, and hears everybody's.
 */
function useChannels(
  spaces: readonly string[],
  me: string,
  idle: boolean,
  onChange: () => void,
): Record<string, Map<string, PresenceStatus>> {
  const [statuses, setStatuses] = useState<Record<string, Map<string, PresenceStatus>>>({});
  const idleRef = useRef(idle);
  idleRef.current = idle;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const joined = useRef(new Map<string, RealtimeChannel>());
  const key = spaces.join(",");

  useEffect(() => {
    if (!key) return;
    const supabase = createClient();
    const channels = joined.current;
    const live = new Set<string>();
    const leaves: Array<() => Promise<void>> = [];
    let stopped = false;
    for (const space of key.split(",")) {
      const topic = presenceTopic(space);
      const before = removing.get(topic) ?? Promise.resolve();
      void before.then(() => {
        if (stopped) return;
        const channel = supabase.channel(topic, {
          config: { private: true, presence: { key: me, enabled: true } },
        });
        const sync = () =>
          setStatuses((previous) => ({
            ...previous,
            [space]: statusesOf(channel.presenceState() as Record<string, unknown[]>),
          }));
        channel.on("presence", { event: "sync" }, sync);
        channel.on("presence", { event: "join" }, () => onChangeRef.current());
        channel.on("presence", { event: "leave" }, () => onChangeRef.current());
        const { leave } = joinSignedIn(supabase, channel, (status) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            live.add(space);
            channels.set(space, channel);
            const meta: PresenceMeta = { idle: idleRef.current };
            void channel.track(meta);
          } else {
            live.delete(space);
            channels.delete(space);
          }
        });
        leaves.push(async () => {
          const done = leave();
          removing.set(topic, done);
          await done;
          if (removing.get(topic) === done) removing.delete(topic);
        });
      });
    }
    return () => {
      stopped = true;
      for (const space of live) channels.delete(space);
      for (const leave of leaves) void leave();
      setStatuses({});
    };
  }, [key, me]);

  // A change of the idle flag goes to every joined channel at once.
  useEffect(() => {
    const meta: PresenceMeta = { idle };
    for (const channel of joined.current.values()) void channel.track(meta);
  }, [idle]);

  return statuses;
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, spaceId } = useSession();
  const settings = useUserSettings();
  const enabled = settings.show_online !== false;
  const client = useQueryClient();
  const people = usePresencePeople(enabled);
  const list = useMemo(() => (enabled ? (people.data ?? []) : []), [enabled, people.data]);
  const spaces = useMemo(() => channelSpaces(list, user.id), [list, user.id]);
  const inCompany = spaces.length > 0;
  const idle = useIdle(enabled && inCompany);
  useLastSeenTouch(enabled && inCompany);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPeople = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void client.invalidateQueries({ queryKey: presenceKeys.all(user.id) });
    }, REFRESH_AFTER_MS);
  }, [client, user.id]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const statuses = useChannels(enabled ? spaces : [], user.id, idle, refreshPeople);
  const lookup = useCallback(
    (userId: string) => (enabled ? presenceIn(list, statuses[spaceId], spaceId, userId) : null),
    [enabled, list, statuses, spaceId],
  );
  return <PresenceLookupProvider value={lookup}>{children}</PresenceLookupProvider>;
}
