import { sendErrorAlertDigest } from "@/features/errors/alerts/server/dispatch";
import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily at 7:00 UTC: in the digest mode of the error e-mails, one summary of
 * the errors that waited since the last one (nothing waited, nothing sent).
 * Also removes error records and the e-mail log older than 13 months
 * (purge_error_events, purge_email_log).
 */
export function GET(request: Request) {
  return runCron("error_alerts", request, async () => {
    const admin = createAdminClient();
    const digest = await sendErrorAlertDigest({ admin });
    const { data: removed, error } = await admin.rpc("purge_error_events");
    if (error) throw error;
    const mails = await admin.rpc("purge_email_log");
    if (mails.error) throw mails.error;
    return {
      processed: digest.errors,
      body: { digest: digest.sent, errors: digest.errors, removed: removed ?? 0, emailLog: mails.data ?? 0 },
    };
  });
}
