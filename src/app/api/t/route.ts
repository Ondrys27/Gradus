import { NextResponse } from "next/server";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { CLIENT_RATE_LIMIT, ingest, MAX_BODY_BYTES } from "@/lib/analytics/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

/**
 * Batches of events from the browser (fetch, or sendBeacon when the page is
 * hidden) and the once-a-minute heartbeat. The user is the session's, never
 * one named in the body; only client events of the catalog pass.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Refuse an announced oversize body before reading it into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  }
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

  const userAgent = request.headers.get("user-agent");
  const device = deviceOf(userAgent);
  const admin = createAdminClient();

  try {
    const result = await ingest(payload, {
      userId,
      takeQuota: async (user, units) => {
        const { data: granted, error } = await admin.rpc("analytics_take_quota", {
          _user_id: user,
          _units: units,
          _limit: CLIENT_RATE_LIMIT,
        });
        if (error) throw error;
        return granted ?? 0;
      },
      touchSession: async (user) => {
        const { data: sessionId, error } = await admin.rpc("touch_app_session", {
          _user_id: user,
          _device: device,
          _browser: browserOf(userAgent),
        });
        if (error) throw error;
        return sessionId ?? null;
      },
      insert: async (user, sessionId, rows) => {
        const { error } = await admin.from("analytics_events").insert(
          rows.map((row) => ({
            user_id: user,
            event: row.event,
            props: row.props as Json,
            session_id: sessionId,
            device,
          })),
        );
        if (error) throw error;
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[analytics] /api/t failed", (error as { code?: string })?.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
