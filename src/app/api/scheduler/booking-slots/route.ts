import { NextResponse } from "next/server";
import { z } from "zod";
import { canReschedule } from "@/features/scheduler/booking/state";
import { loadBookingContext, rescheduleSlots } from "@/features/scheduler/server/bookings";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ booking: z.uuid(), tz: z.string().min(1).max(64) });

/**
 * The free times the host may move one of their bookings to (24.4): the
 * user's own client decides it is theirs (RLS and host = the session), only
 * then the busy times are read for them with the admin client.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = query.safeParse({
    booking: url.searchParams.get("booking"),
    tz: url.searchParams.get("tz"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: own, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("id", parsed.data.booking)
    .eq("host_user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "unknown" }, { status: 500 });
  if (!own) return NextResponse.json({ error: "notFound" }, { status: 404 });
  try {
    const admin = createAdminClient();
    const ctx = await loadBookingContext(admin, own.id, await siteOrigin());
    if (!ctx || !canReschedule(ctx.booking, Date.now())) {
      return NextResponse.json({ error: "notFound" }, { status: 404 });
    }
    const slots = await rescheduleSlots(admin, ctx, parsed.data.tz);
    if (!slots) return NextResponse.json({ error: "notFound" }, { status: 404 });
    return NextResponse.json(slots, { headers: { "cache-control": "no-store" } });
  } catch (loadError) {
    console.error("booking slots failed", loadError instanceof Error ? loadError.name : "unknown");
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}
