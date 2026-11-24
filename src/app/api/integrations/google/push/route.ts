import { after, NextResponse } from "next/server";
import { checkPush, syncUser } from "@/features/calendar/sync/server/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A calendar notified again within this is not read again (Google sends bursts). */
const DEBOUNCE_MS = 5_000;

/**
 * Google's notification that a watched calendar changed (events.watch,
 * 28.10). Only a channel we made, with its secret token and its resource,
 * is believed; the body is empty and never read. The answer is immediate;
 * the calendar is read after it.
 */
export async function POST(request: Request) {
  const admin = createAdminClient();
  const check = await checkPush(admin, {
    channelId: request.headers.get("x-goog-channel-id"),
    token: request.headers.get("x-goog-channel-token"),
    resourceId: request.headers.get("x-goog-resource-id"),
    state: request.headers.get("x-goog-resource-state"),
  });
  if (!check.ok) return new NextResponse(null, { status: check.status });
  // The first message of a new channel says only that it works.
  if (check.state === "sync") return new NextResponse(null, { status: 200 });

  after(async () => {
    const { data } = await admin
      .from("calendar_connection_calendars")
      .select("synced_at")
      .eq("id", check.calendarId)
      .maybeSingle();
    if (data?.synced_at && Date.now() - Date.parse(data.synced_at) < DEBOUNCE_MS) return;
    await syncUser(admin, check.userId, { trigger: "push", connectionId: check.connectionId }).catch((error) =>
      console.error("[calendar-sync] push sync failed", error instanceof Error ? error.message : "unknown"),
    );
  });
  return new NextResponse(null, { status: 200 });
}
