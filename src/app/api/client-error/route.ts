import { NextResponse } from "next/server";
import { requestInfo } from "@/features/admin/server/request-info";
import {
  CLIENT_ERROR_LIMIT_ANONYMOUS,
  CLIENT_ERROR_LIMIT_USER,
  CLIENT_ERROR_MAX_BODY_BYTES,
  clientErrorSchema,
} from "@/features/errors/alerts/client-error";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { recordError } from "@/features/errors/alerts/server/capture";
import { dispatchErrorAlert } from "@/features/errors/alerts/server/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * An error the browser caught (the error page, a window error): stored in
 * error_events, then e-mailed to the owner after the response. Works signed
 * out too (the website's error page); the user is the session's, never one
 * named in the body. Limits per account and anonymously per address are in
 * error_event_record.
 */
export async function POST(request: Request) {
  // A JSON body only: a form posted from another site can not send one without CORS.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > CLIENT_ERROR_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > CLIENT_ERROR_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = clientErrorSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = parsed.data;

  let userId: string | null = null;
  let email: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getClaims();
    userId = data?.claims?.sub ?? null;
    email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  } catch {
    // No usable session: the error is anonymous.
  }
  const { ip, userAgent } = await requestInfo();
  const admin = createAdminClient();

  try {
    const recorded = await recordError(
      {
        code: body.code,
        source: body.source,
        page: body.page,
        message: body.message,
        stack: body.stack ?? null,
        digest: body.digest ?? null,
        userId,
        email,
        userAgent,
        ip: ip === "unknown" ? null : ip,
        viewport: body.viewport ?? null,
        locale: body.locale ?? null,
        version: body.version ?? null,
        limits: { user: CLIENT_ERROR_LIMIT_USER, anonymous: CLIENT_ERROR_LIMIT_ANONYMOUS },
      },
      admin,
    );
    if (recorded.outcome === "limited") {
      return NextResponse.json({ error: "limited" }, { status: 429 });
    }
    if (recorded.outcome === "created") {
      const id = recorded.id;
      runInBackground("error-alerts", () => dispatchErrorAlert(id, { admin }));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[client-error] failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
