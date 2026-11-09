import { NextResponse } from "next/server";
import { buildAccountFeed, feedOwner, parseFeedToken } from "@/features/scheduler/server/feed";
import { APP_NAME } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The account's Gradus calendar for Google Calendar, Apple Calendar or
 * Outlook to subscribe to. No session: the secret in the address is the key
 * (only its hash is stored); a wrong or revoked one answers 404 like any
 * unknown address.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = parseFeedToken((await params).token);
  if (!token) return new NextResponse(null, { status: 404 });
  try {
    const admin = createAdminClient();
    const userId = await feedOwner(admin, token);
    if (!userId) return new NextResponse(null, { status: 404 });
    const body = await buildAccountFeed(admin, userId, APP_NAME);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="calendar.ics"',
        "cache-control": "private, max-age=300",
        "x-robots-tag": "noindex",
      },
    });
  } catch (error) {
    console.error("calendar feed failed", error instanceof Error ? error.name : "unknown");
    return new NextResponse(null, { status: 503 });
  }
}
