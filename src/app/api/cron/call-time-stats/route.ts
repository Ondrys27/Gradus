import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron/verify";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily rebuild of the shared "best time to call" statistics from every
 * account's moves. The work happens in refresh_call_time_stats(); the target
 * table has no link to any user.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("refresh_call_time_stats");
  if (error) {
    console.error("refresh_call_time_stats failed", error);
    return NextResponse.json({ error: "refresh_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cells: data });
}
