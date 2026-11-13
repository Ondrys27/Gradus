import { NextResponse } from "next/server";
import { fingerprint, requestInfo } from "@/features/admin/server/request-info";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { mailOwnerAboutReport } from "@/features/feedback/server/notify";
import {
  SUPPORT_LIMIT_ANONYMOUS,
  SUPPORT_LIMIT_USER,
  SUPPORT_MAX_BODY_BYTES,
  SUPPORT_PAGE,
  submitSupport,
} from "@/features/feedback/support";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { track } from "@/lib/analytics/track";
import { APP_VERSION } from "@/lib/app-version";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The public support form (27.1): signed in or not, into bug_reports with
 * source support. The user is the session's; signed out, the limit is per
 * address (bug_report_support). The owner gets the same e-mail as for a
 * report from the app.
 */
export async function POST(request: Request) {
  // A JSON body only: a form posted from another site can not send one without CORS.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SUPPORT_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > SUPPORT_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  let userId: string | null = null;
  let sessionEmail: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getClaims();
    userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    sessionEmail = typeof data?.claims?.email === "string" ? data.claims.email : null;
  } catch {
    // No usable session: the request is anonymous.
  }
  const { ip, userAgent } = await requestInfo();
  const admin = createAdminClient();

  try {
    const result = await submitSupport(payload, {
      userId,
      store: async (support) => {
        const { data, error } = await admin.rpc("bug_report_support", {
          // Null for an anonymous request; the generated type does not know SQL null.
          _user_id: userId as string,
          _ip_hash: fingerprint("ip", ip),
          _kind: support.kind,
          _page: SUPPORT_PAGE,
          _description: support.description,
          _expected: support.expected ?? undefined,
          _contact_email: support.email ?? sessionEmail ?? undefined,
          _browser: browserOf(userAgent),
          _device: deviceOf(userAgent),
          _viewport: support.viewport ?? undefined,
          _locale: support.locale ?? undefined,
          _app_version: APP_VERSION,
          _limit_user: SUPPORT_LIMIT_USER,
          _limit_anonymous: SUPPORT_LIMIT_ANONYMOUS,
        });
        if (error) throw error;
        return (data as string | null) ?? null;
      },
      afterStored: (support, id) => {
        runInBackground("support", async () => {
          await track(
            "bug_report_sent",
            { source: "support", described: true, signed_in: Boolean(userId), kind: support.kind },
            { userId, admin },
          );
          const [profile, origin] = await Promise.all([
            userId ? admin.from("profiles").select("display_name").eq("id", userId).maybeSingle() : null,
            siteOrigin().catch(() => null),
          ]);
          await mailOwnerAboutReport(
            admin,
            {
              id,
              kind: support.kind,
              description: support.description,
              expected: support.expected,
              page: SUPPORT_PAGE,
              browser: browserOf(userAgent),
              device: deviceOf(userAgent),
              viewport: support.viewport,
              locale: support.locale,
              version: APP_VERSION,
              consoleCount: 0,
              screenshot: false,
              user: { name: profile?.data?.display_name ?? null, email: support.email ?? sessionEmail },
            },
            origin,
          );
        });
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[support] failed", (error as { code?: string })?.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
