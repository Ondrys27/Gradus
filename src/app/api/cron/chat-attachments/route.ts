import { CHAT_BUCKET, trashPath } from "@/features/chat/server/storage";
import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily: files of Messages not opened for a year move to the trash
 * (trash/<path>, out of every member's reach; the owner can bring one back),
 * files of deleted messages and uploads never sent are removed. Messages
 * themselves are never deleted.
 */
export function GET(request: Request) {
  return runCron("chat_attachments", request, async () => {
    const admin = createAdminClient();
    const bucket = admin.storage.from(CHAT_BUCKET);
    const { data: due, error } = await admin.rpc("chat_attachments_due", { _limit: 200 });
    if (error) throw error;

    const remove = (due ?? []).filter((row) => row.action === "remove").map((row) => row.path);
    let removed = 0;
    if (remove.length) {
      const result = await bucket.remove(remove);
      if (result.error) throw result.error;
      const { data } = await admin.rpc("chat_attachments_mark", { _paths: remove, _action: "remove" });
      removed = data ?? 0;
    }

    const trashed: string[] = [];
    for (const row of (due ?? []).filter((item) => item.action === "trash")) {
      const moved = await bucket.move(row.path, trashPath(row.path));
      if (!moved.error) trashed.push(row.path);
      else console.error("[chat-attachments] move failed", moved.error.message);
    }
    if (trashed.length) {
      await admin.rpc("chat_attachments_mark", { _paths: trashed, _action: "trash" });
    }

    const { data: orphans, error: orphanError } = await admin.rpc("chat_orphan_uploads", {
      _limit: 200,
    });
    if (orphanError) throw orphanError;
    const stray = (orphans ?? []).map((row) => row.path);
    if (stray.length) {
      const result = await bucket.remove(stray);
      if (result.error) throw result.error;
    }

    const processed = removed + trashed.length + stray.length;
    return { processed, body: { removed, trashed: trashed.length, orphans: stray.length } };
  });
}
