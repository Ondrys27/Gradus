import { NextResponse } from "next/server";
import { fingerprint, requestInfo } from "@/features/admin/server/request-info";
import { BUG_REPORT_LIMIT_ANONYMOUS, BUG_REPORT_LIMIT_USER } from "@/features/errors/report";
import { submitBugReport, type SubmitOutcome } from "@/features/errors/server/submit-bug-report";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Far more than a report with the longest description needs. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * "Send feedback" on the error page: one bug report per error code. Works
 * signed out too (the error page of the public website, an expired session);
 * the user is the session's when there is one, never one named in the body.
 * The limits (per account, anonymous per address) are in bug_report_submit.
 */
export async function POST(request: Request) {
  // A JSON body only: a form posted from another site can not send one without CORS.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getClaims();
    userId = data?.claims?.sub ?? null;
  } catch {
    // No usable session: the report is anonymous.
  }
  const { ip, userAgent } = await requestInfo();
  const admin = createAdminClient();

  try {
    const result = await submitBugReport(payload, {
      userId,
      store: async (report, sender) => {
        const { data, error } = await admin.rpc("bug_report_submit", {
          // Null for an anonymous report; the generated type does not know SQL null.
          _user_id: sender as string,
          _ip_hash: fingerprint("ip", ip),
          _source: "error_page",
          _page: report.page,
          _error_code: report.code,
          _description: report.description ?? undefined,
          _error_message: report.message ?? undefined,
          _error_digest: report.digest ?? undefined,
          _browser: browserOf(userAgent),
          _device: deviceOf(userAgent),
          _viewport: report.viewport ?? undefined,
          _locale: report.locale ?? undefined,
          _app_version: report.version ?? undefined,
          _limit_user: BUG_REPORT_LIMIT_USER,
          _limit_anonymous: BUG_REPORT_LIMIT_ANONYMOUS,
        });
        if (error) throw error;
        return data as SubmitOutcome;
      },
      record: (report) =>
        track(
          "bug_report_sent",
          { source: "error_page", described: Boolean(report.description), signed_in: !!userId },
          { userId, admin },
        ),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[bug-report] failed", (error as { code?: string })?.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
