import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CHAT_BUCKET,
  CHAT_SIGNED_URL_SECONDS,
  trashPath,
} from "@/features/chat/server/storage";
import type { ChatAttachment } from "@/features/chat/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const querySchema = z.object({ m: z.uuid(), f: z.uuid(), download: z.enum(["1"]).optional() });

/** The message as the signed-in user may read it, and the file of it. */
async function findFile(messageId: string, fileId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const userId = claims?.claims?.sub ?? null;
  if (!userId) return { error: 401 as const };
  const { data: message } = await supabase
    .from("chat_messages")
    .select("id, owner_id, attachments, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message || message.deleted_at) return { error: 404 as const };
  const file = ((message.attachments ?? []) as ChatAttachment[]).find((item) =>
    item.path.endsWith(`/${fileId}`),
  );
  if (!file) return { error: 404 as const };
  return { supabase, userId, ownerId: message.owner_id, file };
}

/**
 * Opens a file of a message: a link valid for a minute, signed with the
 * user's own client so the bucket's policies decide again (a live message of
 * a conversation they are in). Counts the opening for the yearly trash.
 */
export async function GET(request: Request) {
  const params = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return NextResponse.json({ error: "notFound" }, { status: 404 });
  const found = await findFile(params.data.m, params.data.f);
  if ("error" in found) {
    return NextResponse.json({ error: found.error === 401 ? "unauthorized" : "notFound" }, { status: found.error });
  }
  const admin = createAdminClient();
  const { data: tracked } = await admin
    .from("chat_attachment_files")
    .select("trashed_at")
    .eq("path", found.file.path)
    .maybeSingle();
  if (tracked?.trashed_at) return NextResponse.json({ error: "trashed" }, { status: 410 });

  const { data, error } = await found.supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(
      found.file.path,
      CHAT_SIGNED_URL_SECONDS,
      params.data.download ? { download: found.file.name } : undefined,
    );
  if (error || !data) return NextResponse.json({ error: "notFound" }, { status: 404 });
  await admin.rpc("chat_attachment_opened", { _path: found.file.path });
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": `private, max-age=${CHAT_SIGNED_URL_SECONDS - 10}` },
  });
}

const restoreSchema = z.strictObject({ m: z.uuid(), f: z.uuid() });

/** The owner of the space takes a file back out of the trash. */
export async function POST(request: Request) {
  const body = restoreSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const found = await findFile(body.data.m, body.data.f);
  if ("error" in found) {
    return NextResponse.json({ error: found.error === 401 ? "unauthorized" : "notFound" }, { status: found.error });
  }
  if (found.ownerId !== found.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const { data: tracked } = await admin
    .from("chat_attachment_files")
    .select("trashed_at")
    .eq("path", found.file.path)
    .eq("owner_id", found.userId)
    .maybeSingle();
  if (!tracked) return NextResponse.json({ error: "notFound" }, { status: 404 });
  if (tracked.trashed_at) {
    const moved = await admin.storage.from(CHAT_BUCKET).move(trashPath(found.file.path), found.file.path);
    if (moved.error) return NextResponse.json({ error: "notFound" }, { status: 404 });
    await admin.rpc("chat_attachments_mark", { _paths: [found.file.path], _action: "restore" });
  }
  return NextResponse.json({ ok: true });
}
