import { NextResponse } from "next/server";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { CHAT_BUCKET } from "@/features/chat/server/storage";
import { notifyChatRecipients } from "@/features/chat/server/notify";
import { SNIFF_BYTES } from "@/features/chat/server/file-check";
import { sendChatMessage } from "@/features/chat/server/send";
import { CHAT_MESSAGE_COLUMNS, type ChatMessage } from "@/features/chat/types";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

/** A message with up to five file descriptions is far below this. */
const MAX_BODY_BYTES = 32 * 1024;

/**
 * Sends a message of Messages. The user is the session's and the message is
 * written with their own client (RLS and chat_messages_guard decide who may
 * write where and stamp the sender); the admin client only looks at the
 * uploaded files (size, first bytes) and removes one that is not what it
 * claims. The same id sent again returns the stored message, so the browser
 * may retry after a lost answer. E-mails to away members go out afterwards.
 */
export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "invalid" }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub ?? null;
  } catch {
    // No usable session: refused below.
  }
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

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (!result.repeated && result.message.sender) {
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
  return NextResponse.json(
    { message: result.message, channelId: result.channel.id },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}
