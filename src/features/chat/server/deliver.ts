import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { CHAT_MESSAGE_COLUMNS, type ChatMessage } from "@/features/chat/types";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";
import { SNIFF_BYTES } from "./file-check";
import { notifyChatRecipients } from "./notify";
import { sendChatMessage, type SendResult } from "./send";
import { CHAT_BUCKET } from "./storage";

/**
 * Sends a message of Messages, for the composer's route and Grady's tool
 * alike. The message is written with the user's own client (RLS and
 * chat_messages_guard decide who may write where and stamp the sender); the
 * admin client only looks at the uploaded files (size, first bytes) and
 * removes one that is not what it claims. E-mails to away members go out
 * afterwards.
 */
export async function deliverChatMessage(
  supabase: SupabaseClient<Database>,
  userId: string | null,
  payload: unknown,
): Promise<SendResult> {
  const admin = createAdminClient();
  const bucket = admin.storage.from(CHAT_BUCKET);

  const result = await sendChatMessage(payload, {
    userId,
    openDirect: async (to) => {
      const { data, error } = await supabase.rpc("chat_open_direct", { _to: to });
      return { id: (data as string | null) ?? null, error };
    },
    channel: async (id) => {
      const { data } = await supabase
        .from("chat_channels")
        .select("owner_id, kind, archived_at")
        .eq("id", id)
        .maybeSingle();
      return data ? { ...data, kind: data.kind === "direct" ? "direct" : "group" } : null;
    },
    fileInfo: async (path) => {
      const folder = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const { data } = await bucket.list(folder, { search: name, limit: 5 });
      const entry = data?.find((item) => item.name === name);
      const size = Number((entry?.metadata as { size?: number } | null)?.size ?? 0);
      if (!entry) return null;
      const signed = await bucket.createSignedUrl(path, 30);
      if (!signed.data) return null;
      const response = await fetch(signed.data.signedUrl, {
        headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const head = new Uint8Array(await response.arrayBuffer()).slice(0, SNIFF_BYTES);
      return { size, head };
    },
    removeFile: async (path) => {
      await bucket.remove([path]);
    },
    insert: async (row) => {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ ...row, attachments: row.attachments as unknown as Json })
        .select(CHAT_MESSAGE_COLUMNS)
        .single();
      return { message: (data as ChatMessage | null) ?? null, error };
    },
    existing: async (id) => {
      const { data } = await supabase
        .from("chat_messages")
        .select(CHAT_MESSAGE_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      return (data as ChatMessage | null) ?? null;
    },
  });
  if (result.ok && !result.repeated && result.message.sender) {
    const { channel, message, mentions } = result;
    const sender = message.sender!;
    const origin = await siteOrigin();
    await track(
      "chat_message_sent",
      {
        kind: channel.kind,
        files: message.attachments.length,
        mentions: mentions.length,
        reply: Boolean(message.reply_to_id),
      },
      { userId, ownerId: channel.ownerId, admin },
    );
    runInBackground("chat-notify", () =>
      notifyChatRecipients(admin, {
        channelId: channel.id,
        ownerId: channel.ownerId,
        kind: channel.kind,
        sender,
        mentions,
        origin,
      }),
    );
  }
  return result;
}
