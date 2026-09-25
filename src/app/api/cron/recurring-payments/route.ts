import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron/verify";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily booking of recurring payments that have come due. The work happens in
 * post_due_recurring_payments(): one transaction per due day in each user's own
 * time zone, so running it twice books nothing twice.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("post_due_recurring_payments");
  if (error) {
    console.error("post_due_recurring_payments failed", error);
    return NextResponse.json({ error: "posting_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, booked: data });
}
