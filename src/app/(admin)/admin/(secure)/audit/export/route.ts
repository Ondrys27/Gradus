import { toCsv } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { loadAuditExport } from "@/features/admin/server/audit-data";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";

export const dynamic = "force-dynamic";

/**
 * The audit as CSV. Written to the audit before the file leaves; if that
 * fails, nothing is exported.
 */
export async function GET() {
  const context = await adminAccess(true);
  if (!context) return adminNotFound();

  const rows = await loadAuditExport();
  if (!(await logAdminAction(context, "export", "audit"))) {
    return new Response("Audit unavailable", { status: 503 });
  }
  const csv = toCsv(
    ["created_at", "user_id", "kind", "target", "ip_hash"],
    rows.map((row) => [row.created_at, row.user_id, row.kind, row.target, row.ip_hash]),
  );
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="admin-audit-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
