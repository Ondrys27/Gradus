"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSession, useUserSettings } from "@/features/account/queries";
import { isSoundEnabled } from "@/lib/sound-preference";
import { createClient, realtimeTopic, subscribeSignedIn } from "@/lib/supabase/client";
import { isSilenced, mentionsIn, titleWithUnread } from "./logic";
import { afterFailure, dueItems, type OutboxItem } from "./outbox";
import {
  fileBlob,
  openOutbox,
  outboxItems,
  removeItem,
  updateItem,
  useOutbox,
} from "./outbox-store";
import { chatKeys, upsertMessage, useChatMe, useChatUnread } from "./queries";
import type { ChatChannel, ChatMessage } from "./types";

/**
 * Keeps Messages live everywhere in the app, without a reload: new and
 * changed messages, reads and conversations arrive over Supabase Realtime
 * (the chat tables' policies decide who hears what), the unread count goes
 * into the tab title, a soft sound plays for a new message (when wanted and
 * the conversation is not open in front of the person), and the outbox is
 * delivered and retried.
 */

let activeChannel: string | null = null;

/** The conversation open on screen (no sound for it, it is marked read there). */
export function setActiveChannel(id: string | null) {
  activeChannel = id;
}

export function ChatSync() {
  const { user } = useSession();
  const { me, space } = useChatMe();
  const client = useQueryClient();
  const settings = useUserSettings();
  const soundOn = useRef(settings.chat_sound);
  soundOn.current = settings.chat_sound;

  useEffect(() => {
    openOutbox(user.id);
  }, [user.id]);

  useEffect(() => {
    const supabase = createClient();
    let refresh: ReturnType<typeof setTimeout> | null = null;
    const refreshOverview = () => {
      if (refresh) clearTimeout(refresh);
      refresh = setTimeout(() => {
        void client.invalidateQueries({ queryKey: chatKeys.overview(user.id, space) });
      }, 250);
    };
    const channel = supabase
      .channel(realtimeTopic(`chat-${space}-${me}`))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `owner_id=eq.${space}` },
        (payload) => {
          const message = payload.new as ChatMessage;
          upsertMessage(client, user.id, message);
          refreshOverview();
          if (message.sender !== me) chime(client, user.id, space, message, me, soundOn.current);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `owner_id=eq.${space}` },
        (payload) => {
          upsertMessage(client, user.id, payload.new as ChatMessage);
          refreshOverview();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_members", filter: `owner_id=eq.${space}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { channel_id?: string } | null;
          if (row?.channel_id) {
            void client.invalidateQueries({ queryKey: chatKeys.members(user.id, row.channel_id) });
          }
          refreshOverview();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_channels", filter: `owner_id=eq.${space}` },
        refreshOverview,
      );
    const unsubscribe = subscribeSignedIn(supabase, channel);
    return () => {
      if (refresh) clearTimeout(refresh);
      unsubscribe();
    };
  }, [client, me, space, user.id]);

  useUnreadTitle();
  useOutboxRunner();
  return null;
}

/** "(3) …" in front of the tab title while something is unread; kept when a page sets its title. */
function useUnreadTitle() {
  const count = useChatUnread();
  useEffect(() => {
    const apply = () => {
      const next = titleWithUnread(document.title, count);
      if (next !== document.title) document.title = next;
    };
    apply();
    // Next.js may set the title or swap the element on a page change.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      document.title = titleWithUnread(document.title, 0);
    };
  }, [count]);
}

let audio: AudioContext | null = null;

/** Two soft notes, synthesised (no file to load); only when sound is on and the message is not in front of the person. */
function chime(
  client: QueryClient,
  userId: string,
  space: string,
  message: ChatMessage,
  me: string,
  wanted: boolean,
) {
  if (!wanted || !isSoundEnabled()) return;
  if (activeChannel === message.channel_id && document.visibilityState === "visible") return;
  const channels = client.getQueryData<ChatChannel[]>(chatKeys.overview(userId, space));
  const channel = channels?.find((item) => item.id === message.channel_id);
  if (channel && isSilenced(channel) && !mentionsIn(message.body).includes(me)) return;
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.01;
    [880, 1174.66].forEach((frequency, index) => {
      const at = start + index * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.08, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    });
  } catch {
    // No audio: silence.
  }
}

/** Delivers what waits in the outbox, one message at a time, in order. */
function useOutboxRunner() {
  const { user } = useSession();
  const { space } = useChatMe();
  const client = useQueryClient();
  const items = useOutbox();
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  const wake = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    window.addEventListener("online", wake);
    const timer = window.setInterval(wake, 1_000);
    return () => {
      window.removeEventListener("online", wake);
      window.clearInterval(timer);
    };
  }, [wake]);

  useEffect(() => {
    if (busy.current || !navigator.onLine) return;
    const [next] = dueItems(outboxItems(), Date.now());
    if (!next) return;
    busy.current = true;
    void deliver(next)
      .then((result) => {
        if (result.ok) {
          upsertMessage(client, user.id, result.message);
          removeItem(next.id);
          void client.invalidateQueries({ queryKey: chatKeys.overview(user.id, space) });
        } else {
          const current = outboxItems().find((item) => item.id === next.id);
          if (current) {
            updateItem(next.id, afterFailure(current, result.status, result.error, Date.now()));
          }
        }
      })
      .finally(() => {
        busy.current = false;
        wake();
      });
  }, [items, tick, client, user.id, space, wake]);
}

type DeliverResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; status: number | null; error?: string };

async function deliver(item: OutboxItem): Promise<DeliverResult> {
  const supabase = createClient();
  for (const file of item.files) {
    if (file.uploaded) continue;
    const blob = fileBlob(file.id);
    if (!blob) return { ok: false, status: 400, error: "fileMissing" };
    const { error } = await supabase.storage
      .from("chat-attachments")
      .upload(`${item.space}/${item.id}/${file.id}`, blob, { contentType: file.mime, upsert: false });
    if (error) {
      const status = Number((error as { statusCode?: string | number }).statusCode ?? 0) || null;
      // Already up from an earlier attempt.
      if (status !== 409 && !/exists/i.test(error.message)) {
        return { ok: false, status, error: "upload" };
      }
    }
    updateItem(item.id, {
      files: (outboxItems().find((entry) => entry.id === item.id)?.files ?? item.files).map((entry) =>
        entry.id === file.id ? { ...entry, uploaded: true } : entry,
      ),
    });
  }
  try {
    const response = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        ...(item.channelId ? { channelId: item.channelId } : { to: item.to }),
        body: item.body,
        replyTo: item.replyTo,
        files: item.files.map(({ id, name, mime, width, height }) => ({
          id,
          name,
          mime,
          ...(width && height ? { width, height } : {}),
        })),
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      message?: ChatMessage;
      error?: string;
    } | null;
    if (response.ok && body?.message) return { ok: true, message: body.message };
    return { ok: false, status: response.status, error: body?.error };
  } catch {
    return { ok: false, status: null, error: "network" };
  }
}
