import { after, NextResponse } from "next/server";
import { z } from "zod";
import { guestCanManage } from "@/features/scheduler/booking/state";
import { loadManagedBooking, rescheduleSlots } from "@/features/scheduler/server/bookings";
import { loadTypeSlots } from "@/features/scheduler/server/busy";
import { siteOrigin } from "@/lib/site-origin";
import {
  loadHostOfProfile,
  loadPublicProfile,
  loadPublicTypeRow,
} from "@/features/scheduler/server/public-data";
import { refreshStaleForUser } from "@/features/scheduler/server/subscriptions";
import { SUBSCRIPTION_STALE_MS } from "@/features/scheduler/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const byType = z.object({
  handle: z.string().min(3).max(30),
  slug: z.string().min(1).max(60),
  tz: z.string().min(1).max(64),
});
const byToken = z.object({ token: z.string().min(40).max(60), tz: z.string().min(1).max(64) });

const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

/**
 * The free times of a meeting type for the public booking page (24.4), in
 * the guest's zone; with the link's token, the times the guest's own booking
 * may move to. No session: the handle and slug (or the token) decide whose
 * times these are, and only an active type of a host who can be booked
 * answers. Expired holds of the host are cleared on the way, and calendars
 * older than ten minutes are fetched again after the answer.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const admin = createAdminClient();
  try {
    if (params.token) {
      const parsed = byToken.safeParse(params);
      if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });
      const ctx = await loadManagedBooking(admin, parsed.data.token, await siteOrigin());
      if (!ctx || !guestCanManage(ctx.booking, Date.now()) || !ctx.host?.available) {
        return NextResponse.json({ error: "notFound" }, { status: 404, headers: HEADERS });
      }
      const slots = await rescheduleSlots(admin, ctx, parsed.data.tz);
      if (!slots) return NextResponse.json({ error: "notFound" }, { status: 404, headers: HEADERS });
      return NextResponse.json(slots, { headers: HEADERS });
    }

    const parsed = byType.safeParse(params);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });
    const profile = await loadPublicProfile(admin, parsed.data.handle);
    if (!profile) return NextResponse.json({ error: "notFound" }, { status: 404, headers: HEADERS });
    const [host, row] = await Promise.all([
      loadHostOfProfile(admin, profile),
      loadPublicTypeRow(admin, profile.id, parsed.data.slug),
    ]);
    if (!row) return NextResponse.json({ error: "notFound" }, { status: 404, headers: HEADERS });
    if (!host.available) {
      return NextResponse.json({ error: "unavailable" }, { status: 409, headers: HEADERS });
    }
    // Holds that ran out free their times for everyone.
    await admin
      .from("bookings")
      .delete()
      .eq("host_user_id", profile.user_id)
      .eq("status", "held")
      .lt("hold_expires_at", new Date().toISOString());
    const slots = await loadTypeSlots(admin, row, parsed.data.tz);
    after(() =>
      refreshStaleForUser(admin, profile.user_id, SUBSCRIPTION_STALE_MS).catch((error) =>
        console.error("booking page refresh failed", error instanceof Error ? error.name : "unknown"),
      ),
    );
    return NextResponse.json(slots, { headers: HEADERS });
  } catch (error) {
    console.error("booking slots failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "unknown" }, { status: 500, headers: HEADERS });
  }
}
