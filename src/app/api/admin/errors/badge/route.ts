import { NextResponse } from "next/server";
import { loadErrorBadge } from "@/features/admin/dashboard/server/error-badge";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";

export const dynamic = "force-dynamic";

/**
 * GET: how many errors are New (29.2), for the red badge at Operations →
 * Errors, the tab's title and the bell, with the newest few for the bell.
 * Every administrator (triage is everyone's); the check does not count as
 * activity and writes no audit row. Technical data only.
 */
export async function GET() {
  const context = await adminAccess(false);
  if (!context) return adminNotFound();
  try {
    return NextResponse.json(await loadErrorBadge(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin] error badge failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
