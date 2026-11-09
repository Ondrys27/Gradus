import { NextResponse } from "next/server";
import { z } from "zod";
import { guestCanManage } from "@/features/scheduler/booking/state";
import {
  cancelBooking,
  loadManagedBooking,
  rescheduleBooking,
} from "@/features/scheduler/server/bookings";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    token: z.string().min(40).max(60),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("reschedule"),
    token: z.string().min(40).max(60),
    start: z.number().int().positive(),
  }),
]);

const HEADERS = { "cache-control": "no-store" };

/**
 * The guest moves or cancels their booking through the link of their e-mail
 * (/s/r/<token>, 24.4). The token is the only proof; it works for a live
 * booking until the meeting ends.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ problem: "invalid" }, { status: 400, headers: HEADERS });
  const admin = createAdminClient();
  const origin = await siteOrigin();
  try {
    const ctx = await loadManagedBooking(admin, parsed.data.token, origin);
    if (!ctx || !guestCanManage(ctx.booking, Date.now())) {
      return NextResponse.json({ problem: "notFound" }, { status: 404, headers: HEADERS });
    }
    const result =
      parsed.data.action === "cancel"
        ? await cancelBooking(admin, ctx.booking.id, "guest", parsed.data.reason?.trim() || null, origin)
        : await rescheduleBooking(admin, ctx.booking.id, parsed.data.start, "guest", origin);
    if (!result.ok) return NextResponse.json({ problem: result.problem }, { status: 409, headers: HEADERS });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error("booking manage failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ problem: "unknown" }, { status: 500, headers: HEADERS });
  }
}
