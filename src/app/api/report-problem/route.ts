import { NextResponse } from "next/server";
import { requestInfo } from "@/features/admin/server/request-info";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { REPORT_LIMIT_USER, REPORT_MAX_BODY_BYTES } from "@/features/feedback/report";
import { mailOwnerAboutReport } from "@/features/feedback/server/notify";
import { submitReport } from "@/features/feedback/server/submit-report";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * "Report a problem": signed-in people only. The user is the session's, the
 * browser class comes from the User-Agent, the page, console lines and image
 * are checked again here. The screenshot goes to the private bucket
 * bug-screenshots under the author's folder; the owner gets an e-mail.
 */
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > REPORT_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > REPORT_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  let userId: string | null = null;
  let email: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getClaims();
    userId = data?.claims?.sub ?? null;
    email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  } catch {
    // No usable session: refused below.
  }
  const { userAgent } = await requestInfo();
  const admin = createAdminClient();

  try {
    const result = await submitReport(payload, {
      userId,
      store: async (report, sender) => {
        const { data, error } = await admin.rpc("bug_report_create", {
          _user_id: sender,
          _kind: report.kind,
          _page: report.page,
          _description: report.description,
          _expected: report.expected ?? undefined,
          _console_errors: report.consoleErrors,
          _browser: browserOf(userAgent),
          _device: deviceOf(userAgent),
          _viewport: report.viewport ?? undefined,
          _locale: report.locale ?? undefined,
          _app_version: report.version ?? undefined,
          _limit_user: REPORT_LIMIT_USER,
        });
        if (error) throw error;
        return (data as string | null) ?? null;
      },
      attachScreenshot: async (reportId, sender, image) => {
        const path = `${sender}/${reportId}.jpg`;
        const upload = await admin.storage
          .from("bug-screenshots")
          .upload(path, image, { contentType: "image/jpeg", upsert: false });
        if (upload.error) {
          console.error("[report] screenshot upload failed", upload.error.message);
          return false;
        }
        const { error } = await admin
          .from("bug_reports")
          .update({ screenshot_path: path })
          .eq("id", reportId)
          .eq("user_id", sender);
        if (error) {
          console.error("[report] screenshot path failed", error.message);
          return false;
        }
        return true;
      },
      afterStored: (report, reportId, screenshotKept) => {
        const sender = userId;
        runInBackground("report", async () => {
          await track(
            "bug_report_sent",
            {
              source: "report",
              described: true,
              signed_in: true,
              kind: report.kind,
              screenshot: screenshotKept,
              console_errors: report.consoleErrors.length,
            },
            { userId: sender, admin },
          );
          const [profile, origin] = await Promise.all([
            sender
              ? admin.from("profiles").select("display_name").eq("id", sender).maybeSingle()
              : null,
            siteOrigin().catch(() => null),
          ]);
          await mailOwnerAboutReport(
            admin,
            {
              id: reportId,
              kind: report.kind,
              description: report.description,
              expected: report.expected,
              page: report.page,
              browser: browserOf(userAgent),
              device: deviceOf(userAgent),
              viewport: report.viewport,
              locale: report.locale,
              version: report.version,
              consoleCount: report.consoleErrors.length,
              screenshot: screenshotKept,
              user: { name: profile?.data?.display_name ?? null, email },
            },
            origin,
          );
        });
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[report] failed", (error as { code?: string })?.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
