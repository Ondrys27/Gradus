import { NextResponse } from "next/server";
import { adminWidgetAllowed, isAdminWidgetKey } from "@/features/admin/dashboard/catalog";
import { loadAdminWidget } from "@/features/admin/dashboard/server/widget-data";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";
import { adminQuery } from "@/features/admin/server/metrics-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/widgets/<key>?<view>: the numbers of one widget of the
 * overview (29.2) for the view of the top bar (or the widget's own period,
 * already folded into the query). Owner or admin with a live admin session;
 * a widget the administrator may not use (a limited admin and the Money
 * widgets) is the same 404 as an unknown one. The check does not count as
 * activity, so an open overview refreshing itself does not keep the session
 * alive, and it writes no audit row: the overview's view is audited once
 * when the page opens, not once per widget.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const context = await adminAccess(false);
  if (!context) return adminNotFound();
  const { key } = await params;
  if (!isAdminWidgetKey(key) || !adminWidgetAllowed(key, context)) return adminNotFound();
  const search = new URL(request.url).searchParams;
  const q = adminQuery(Object.fromEntries(search.entries()), "overview");
  try {
    const data = await loadAdminWidget(key, q, context);
    if (!data) return adminNotFound();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`[admin] widget ${key} failed`, error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
