import { syncAllConnections } from "@/features/finance/fakturoid/service";
import { runCron } from "@/lib/analytics/instrument";

export const runtime = "nodejs";
/** Accounts are synced one after another; each is a few Fakturoid requests. */
export const maxDuration = 300;

/**
 * Daily: brings paid, cancelled and changed invoices back from Fakturoid for
 * every connected account. One failing account is recorded on its connection
 * and does not stop the rest.
 */
export function GET(request: Request) {
  return runCron("fakturoid_sync", request, async () => {
    const summary = await syncAllConnections();
    return { processed: summary.users, body: summary };
  });
}
