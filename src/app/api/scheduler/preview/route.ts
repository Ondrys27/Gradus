import { after, NextResponse } from "next/server";
import { z } from "zod";
import { loadTypeRow, loadTypeSlots } from "@/features/scheduler/server/busy";
import { refreshStaleForUser } from "@/features/scheduler/server/subscriptions";
import { SUBSCRIPTION_STALE_MS } from "@/features/scheduler/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const query = z.object({ type: z.uuid(), tz: z.string().min(1).max(64) });

/**
 * The free slots of one of the signed-in person's own meeting types, as the
 * booking page will offer them (the editor's Preview tab). Whose type it is
 * is decided with the user's own client; only then are the busy times read
 * with the admin client, for that person alone.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = query.safeParse({
    type: url.searchParams.get("type"),
    tz: url.searchParams.get("tz"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string")
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: own, error } = await supabase
    .from("event_types")
    .select("id")
    .eq("id", parsed.data.type)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "unknown" }, { status: 500 });
  if (!own) return NextResponse.json({ error: "notFound" }, { status: 404 });

  try {
    const admin = createAdminClient();
    const row = await loadTypeRow(admin, own.id);
    if (!row || row.user_id !== userId)
      return NextResponse.json({ error: "notFound" }, { status: 404 });
    const slots = await loadTypeSlots(admin, row, parsed.data.tz);
    // Calendars older than ten minutes are fetched again after the answer; the next look has them.
    after(() =>
      refreshStaleForUser(admin, userId, SUBSCRIPTION_STALE_MS).catch((refreshError) =>
        console.error(
          "scheduler refresh failed",
          refreshError instanceof Error ? refreshError.name : "unknown",
        ),
      ),
    );
    return NextResponse.json(slots, { headers: { "cache-control": "no-store" } });
  } catch (loadError) {
    console.error(
      "scheduler preview failed",
      loadError instanceof Error ? loadError.name : "unknown",
    );
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}
