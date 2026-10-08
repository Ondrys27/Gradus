import "server-only";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import type { AdminAuditKind } from "./audit";
import type { AdminContext } from "./guard";

export const AUDIT_PAGE_SIZE = 50;
/** The most an export carries in one file. */
export const AUDIT_EXPORT_LIMIT = 10_000;

export type AuditRow = {
  id: number;
  time: string;
  who: string;
  kind: AdminAuditKind;
  target: string;
  ip: string;
};

const COLUMNS = "id, created_at, user_id, kind, target, ip_hash";

/**
 * One page of the audit, newest first, with times already formatted in the
 * owner's zone and formats. Read only after the guard let the owner in.
 */
export async function loadAuditPage(
  context: AdminContext,
  page: number,
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  const admin = createAdminClient();
  const from = Math.max(0, page) * AUDIT_PAGE_SIZE;
  const [{ data, error }, { data: settings }] = await Promise.all([
    admin
      .from("admin_audit")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + AUDIT_PAGE_SIZE),
    admin
      .from("user_settings")
      .select(USER_SETTINGS_COLUMNS)
      .eq("user_id", context.userId)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`admin_audit read failed: ${error.message}`);

  const userIds = [...new Set(data.map((row) => row.user_id).filter((id): id is string => !!id))];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const format = toFormatSettings(settings);

  return {
    hasMore: data.length > AUDIT_PAGE_SIZE,
    rows: data.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
      id: row.id,
      time: formatDateTime(new Date(row.created_at), format),
      who: (row.user_id && names.get(row.user_id)) || row.user_id?.slice(0, 8) || "",
      kind: row.kind,
      target: row.target,
      ip: row.ip_hash ?? "",
    })),
  };
}

/** The audit for the CSV export: UTC times and identifiers, newest first. */
export async function loadAuditExport() {
  const { data, error } = await createAdminClient()
    .from("admin_audit")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(AUDIT_EXPORT_LIMIT);
  if (error) throw new Error(`admin_audit export failed: ${error.message}`);
  return data;
}
