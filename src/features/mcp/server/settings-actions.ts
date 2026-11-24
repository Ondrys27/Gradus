"use server";

import { undoRecords, type UndoRecord } from "@/features/grady/tools/records";
import { isTrashKind } from "@/features/trash/trash";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isMcpLevel } from "../levels";
import { revokeGrant, setGrantLevel } from "./store";

/**
 * Settings → Integrations → Connected apps (28.8): change the level of a
 * connection or disconnect it (its tokens end at once), restore from the
 * trash, and the owner's switch of connected apps for the company. The
 * admin client only touches the person's own grants (always filtered by the
 * session's user); restoring goes through the person's own client.
 */

export type McpActionResult =
  { ok: true } | { ok: false; error: "forbidden" | "notFound" | "invalid" | "changed" | "failed" };

async function sessionUser() {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  return { db, userId: data?.claims?.sub ?? null };
}

export async function setConnectedAppLevel(
  grantId: string,
  level: string,
): Promise<McpActionResult> {
  const { userId } = await sessionUser();
  if (!userId) return { ok: false, error: "forbidden" };
  if (!isMcpLevel(level)) return { ok: false, error: "invalid" };
  const admin = createAdminClient();
  const before = await admin
    .from("mcp_grants")
    .select("level")
    .eq("id", grantId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = await setGrantLevel(admin, userId, grantId, level);
  if (!row) return { ok: false, error: "notFound" };
  if (before.data && isMcpLevel(before.data.level)) {
    await track("mcp_level_changed", { from: before.data.level, to: level }, { userId, admin });
  }
  return { ok: true };
}

export async function disconnectApp(grantId: string): Promise<McpActionResult> {
  const { userId } = await sessionUser();
  if (!userId) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const done = await revokeGrant(admin, userId, grantId);
  if (!done) return { ok: false, error: "notFound" };
  await track("mcp_client_disconnected", { by: "user" }, { userId, admin });
  return { ok: true };
}

/** Back from the trash, with the person's own client and current rights. */
export async function restoreFromTrash(trashId: string): Promise<McpActionResult> {
  const { db, userId } = await sessionUser();
  if (!userId) return { ok: false, error: "forbidden" };
  const { data: item, error } = await db
    .from("trash_items")
    .select("id, kind, record_id, records, restored_at")
    .eq("id", trashId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error && error.code !== "22P02") return { ok: false, error: "failed" };
  if (!item || item.restored_at || !isTrashKind(item.kind)) return { ok: false, error: "notFound" };
  if (item.kind === "deal" || item.kind === "contact") {
    const restored = await db.rpc("trash_restore_record", {
      _kind: item.kind,
      _id: item.record_id,
    });
    if (restored.error)
      return { ok: false, error: restored.error.code === "42501" ? "forbidden" : "failed" };
  } else {
    const records = (Array.isArray(item.records) ? item.records : []) as unknown as UndoRecord[];
    const outcome = await undoRecords(db, records);
    if (!outcome.ok)
      return { ok: false, error: outcome.reason === "changed" ? "changed" : "failed" };
    await db.rpc("trash_mark_restored", { _id: item.id });
  }
  await track("trash_restored", { kind: item.kind, via: "settings" }, { userId });
  return { ok: true };
}

/** The owner's switch: connected apps of the company's people on or off (their own space stays theirs). */
export async function setCompanyMcp(enabled: boolean): Promise<McpActionResult> {
  const { db, userId } = await sessionUser();
  if (!userId) return { ok: false, error: "forbidden" };
  const { error } = await db
    .from("mcp_space_settings")
    .upsert({ space_id: userId, enabled }, { onConflict: "space_id" });
  if (error) return { ok: false, error: "failed" };
  await track("mcp_company_toggled", { enabled }, { userId });
  return { ok: true };
}
