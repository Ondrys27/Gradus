import { NextResponse } from "next/server";
import { syncAllConnections } from "@/features/finance/fakturoid/service";
import { isCronRequest } from "@/lib/cron/verify";

export const runtime = "nodejs";
/** Accounts are synced one after another; each is a few Fakturoid requests. */
export const maxDuration = 300;

/**
 * Daily: brings paid, cancelled and changed invoices back from Fakturoid for
 * every connected account. One failing account is recorded on its connection
 * and does not stop the rest.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncAllConnections()) });
  } catch (error) {
    console.error("fakturoid sync failed", error);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
