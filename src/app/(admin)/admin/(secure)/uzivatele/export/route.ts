import type { NextRequest } from "next/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";
import { peopleDirectory } from "@/features/admin/server/people";
import { loadUsersForExport, USER_SORTS, type UserSort } from "@/features/admin/server/users-data";
import { mayExport } from "@/features/admin/roles";
import { usersCsv } from "@/features/admin/users-export";
import { parseAdminView } from "@/features/admin/view-state";

export const dynamic = "force-dynamic";

/**
 * The list of accounts (the same view, search and order as on screen) as CSV
 * with names and e-mails. It names people: the owner's only, an admin gets
 * the 404. Written to the audit before the file leaves; if that fails,
 * nothing is exported.
 */
export async function GET(request: NextRequest) {
  const context = await adminAccess(true);
  if (!context || !mayExport(context.role, "users")) return adminNotFound();

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const rawSort = params.sort ?? "";
  const sort: UserSort = (USER_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as UserSort)
    : "activity";
  const rows = await loadUsersForExport({
    view: parseAdminView(params),
    query: (params.q ?? "").slice(0, 200),
    sort,
  });
  const { nameOf, emailOf } = await peopleDirectory(
    rows.map((row) => row.userId),
    { strict: true },
  );
  if (!(await logAdminAction(context, "export", "users"))) {
    return new Response("Audit unavailable", { status: 503 });
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(usersCsv(rows, nameOf, emailOf), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="admin-users-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
