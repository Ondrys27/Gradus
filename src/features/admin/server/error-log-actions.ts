"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ERROR_LOG_PATH } from "@/features/errors/alerts/server/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { isErrorGroupStatus, isFingerprint, statusChange, type ErrorGroupStatus } from "../error-log";
import { logAdminAction } from "./audit";
import { adminAccess, adminAccessFor } from "./guard";

/**
 * The error log's actions. A status is triage, like the feedback's: the
 * owner and every admin set it (admin client after the guard, a row in
 * admin_audit with the short fingerprint, never a message). The e-mails
 * "X changed …" are each person's own switch; only those who get them
 * (the owner and full admins) see it.
 */

type Result = { ok: true } | { ok: false; error: "forbidden" | "invalid" | "failed" };

export async function setErrorGroupStatus(fingerprint: string, status: ErrorGroupStatus): Promise<Result> {
  if (!isFingerprint(fingerprint) || !isErrorGroupStatus(status)) return { ok: false, error: "invalid" };
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const { data: before, error: readError } = await admin
    .from("error_groups")
    .select("status")
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (readError) {
    console.error("[admin] error group read failed", readError.message);
    return { ok: false, error: "failed" };
  }
  const from = isErrorGroupStatus(before?.status) ? before.status : "new";
  if (from === status) return { ok: true };
  const now = new Date().toISOString();
  const { error } = await admin.from("error_groups").upsert(
    { fingerprint, ...statusChange(status, now), updated_at: now, updated_by: context.userId },
    { onConflict: "fingerprint" },
  );
  if (error) {
    console.error("[admin] error group status failed", error.message);
    return { ok: false, error: "failed" };
  }
  await logAdminAction(context, "update", "errors.status", {
    group: fingerprint.slice(0, 16),
    from: { status: from },
    to: { status },
  });
  revalidatePath(ERROR_LOG_PATH);
  return { ok: true };
}

export async function setPeerNotices(on: boolean): Promise<Result> {
  if (!z.boolean().safeParse(on).success) return { ok: false, error: "invalid" };
  const context = await adminAccessFor("peerNotices");
  if (!context) return { ok: false, error: "forbidden" };
  const { error } = await createAdminClient()
    .from("admin_notify_prefs")
    .upsert(
      { user_id: context.userId, peer_changes: on, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) {
    console.error("[admin] peer notice preference failed", error.message);
    return { ok: false, error: "failed" };
  }
  await logAdminAction(context, "update", "admins.notify", {
    from: { peer_changes: !on },
    to: { peer_changes: on },
  });
  revalidatePath(ERROR_LOG_PATH);
  return { ok: true };
}
