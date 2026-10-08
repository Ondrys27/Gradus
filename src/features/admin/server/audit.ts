import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { AdminContext } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

export type AdminAuditKind = Database["public"]["Enums"]["admin_audit_kind"];

/** Identifiers only: "audit", "growth.funnel". Never free text. */
const TARGET = /^[a-z0-9_.:-]{1,80}$/;

/**
 * One row in admin_audit for a view, an export or a sign-in. Only after the
 * guard has let the owner in, so the user id always comes from the session.
 * Returns false when the row could not be written; an export must then stop.
 */
export async function logAdminAction(
  context: Pick<AdminContext, "userId">,
  kind: AdminAuditKind,
  target: string,
): Promise<boolean> {
  if (!TARGET.test(target)) throw new Error(`Invalid admin audit target: ${target}`);
  const { ip } = await requestInfo();
  const { error } = await createAdminClient()
    .from("admin_audit")
    .insert({ user_id: context.userId, kind, target, ip_hash: fingerprint("ip", ip) });
  if (error) {
    console.error("[admin] audit write failed", error.message);
    return false;
  }
  return true;
}
