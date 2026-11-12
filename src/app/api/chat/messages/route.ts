import { NextResponse } from "next/server";
import { deliverChatMessage } from "@/features/chat/server/deliver";
import { createClient } from "@/lib/supabase/server";

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
  const result = await deliverChatMessage(supabase, userId, payload);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    { message: result.message, channelId: result.channel.id },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}
