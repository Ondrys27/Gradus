"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, joinSignedIn } from "@/lib/supabase/client";
import type { CollabTransport, PeerMeta, TransportHandlers } from "./provider";
import type { Wire } from "./protocol";

/**
 * The live channel of a note on Supabase Realtime: a private broadcast
 * channel `note:<id>` (who may receive and send is decided by the policies
 * on realtime.messages, see 20261129090000_notes_live.sql) with presence for
 * who is there.
 *
 * Joined through joinSignedIn like every subscription. Unlike the others, the
 * topic must be the same in every browser (they talk to each other), so
 * realtimeTopic() can not make it unique. The
 * session registry keeps one channel per note and tab, and a new channel of
 * the same note waits until the previous one is fully removed, because
 * `channel()` would otherwise hand back the one being removed.
 */
const removing = new Map<string, Promise<unknown>>();

export const collabTopic = (noteId: string) => `note:${noteId}`;

function peersOf(channel: RealtimeChannel): PeerMeta[] {
  const state = channel.presenceState<PeerMeta>();
  const list: PeerMeta[] = [];
  for (const entries of Object.values(state)) {
    const meta = entries[0];
    if (meta && typeof meta.sid === "string" && typeof meta.userId === "string") list.push(meta);
  }
  return list;
}

export function realtimeTransport(noteId: string, sid: string): CollabTransport {
  const supabase = createClient();
  const topic = collabTopic(noteId);
  let channel: RealtimeChannel | null = null;
  let joined = false;
  let meta: PeerMeta | null = null;
  let stopped = false;
  let leave: (() => Promise<void>) | null = null;

  return {
    start(handlers: TransportHandlers) {
      handlers.status("connecting");
      const before = removing.get(topic) ?? Promise.resolve();
      void before.then(() => {
        if (stopped) return;
        const next = supabase.channel(topic, {
          config: { private: true, broadcast: { self: false, ack: false }, presence: { key: sid, enabled: true } },
        });
        channel = next;
        next.on("broadcast", { event: "collab" }, ({ payload }) => handlers.message(payload));
        next.on("presence", { event: "sync" }, () => handlers.peers(peersOf(next)));
        leave = joinSignedIn(supabase, next, (status) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            joined = true;
            if (meta) void next.track(meta);
            handlers.status("connected");
          } else if (status === "CLOSED") {
            joined = false;
            handlers.status("offline");
          } else {
            // CHANNEL_ERROR, TIMED_OUT: Realtime joins again by itself.
            joined = false;
            handlers.status("connecting");
          }
        }).leave;
      });
    },
    send(payload: Wire) {
      if (!channel || !joined) return;
      void channel.send({ type: "broadcast", event: "collab", payload });
    },
    track(next: PeerMeta) {
      meta = next;
      if (channel && joined) void channel.track(next);
    },
    stop() {
      stopped = true;
      const current = channel;
      channel = null;
      joined = false;
      if (!current) return;
      const done = (async () => {
        try {
          await current.untrack();
        } catch {
          // Leaving anyway.
        }
        await leave?.();
      })().finally(() => {
        if (removing.get(topic) === done) removing.delete(topic);
      });
      removing.set(topic, done);
    },
  };
}
