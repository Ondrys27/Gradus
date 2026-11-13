import { NextResponse } from "next/server";
import { countBugReportsSince } from "@/features/admin/server/feedback-data";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";

export const dynamic = "force-dynamic";

/**
 * GET ?since=ISO: how many bug reports came in after the Feedback page was
 * rendered, for its "Refresh · 2 new" button (27.1). Owner or admin with a
 * live admin session; the check does not count as activity, so a tab left
 * open does not keep the admin session alive. Only a number leaves.
 */
export async function GET(request: Request) {
  const context = await adminAccess(false);
  if (!context) return adminNotFound();
  const since = new URL(request.url).searchParams.get("since") ?? "";
  const at = Date.parse(since);
  if (!Number.isFinite(at)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    const count = await countBugReportsSince(new Date(at).toISOString());
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin] new reports count failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
