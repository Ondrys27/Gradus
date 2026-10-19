import "server-only";
import { formatDateTime } from "@/lib/format";
import { auditDetailUser, describeAuditDetail } from "../audit-detail";
import { peopleNamer } from "./people";
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
  /** What a change changed, "field: old → new"; empty for views and exports. */
  detail: string;
};

const COLUMNS = "id, created_at, user_id, kind, target, ip_hash, detail";

/**
 * One page of the audit, newest first, with times already formatted in the
 * owner's zone and formats. Read only after the guard let the owner in.
 */
export async function loadAuditPage(
  context: AdminContext,
  page: number,
  emptyValue: string,
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

  const nameOf = await peopleNamer(
    data.flatMap((row) => [row.user_id, auditDetailUser(row.detail)]),
  );
  const format = toFormatSettings(settings);

  return {
    hasMore: data.length > AUDIT_PAGE_SIZE,
    rows: data.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
      id: row.id,
      time: formatDateTime(new Date(row.created_at), format),
      who: row.user_id ? nameOf(row.user_id) : "",
      kind: row.kind,
      target: row.target,
      ip: row.ip_hash ?? "",
      detail: describeAuditDetail(row.detail, emptyValue, nameOf),
    })),
  };
}

/**
 * The audit for the CSV export, newest first: UTC times, the ids and next to
 * them the names (of who acted and of the user a change was about).
 */
export async function loadAuditExport() {
  const { data, error } = await createAdminClient()
    .from("admin_audit")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(AUDIT_EXPORT_LIMIT);
  if (error) throw new Error(`admin_audit export failed: ${error.message}`);
  const nameOf = await peopleNamer(
    data.flatMap((row) => [row.user_id, auditDetailUser(row.detail)]),
  );
  return data.map((row) => {
    const subject = auditDetailUser(row.detail);
    return {
      ...row,
      user_name: row.user_id ? nameOf(row.user_id) : null,
      subject_id: subject,
      subject_name: subject ? nameOf(subject) : null,
    };
  });
}
