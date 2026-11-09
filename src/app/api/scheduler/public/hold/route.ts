import { NextResponse } from "next/server";
import { z } from "zod";
import { holdSlot } from "@/features/scheduler/server/bookings";
import { visitorHash } from "@/features/scheduler/server/visitor";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  handle: z.string().min(3).max(30),
  slug: z.string().min(1).max(60),
  start: z.number().int().positive(),
  tz: z.string().min(1).max(64),
  release: z.uuid().nullish(),
});

const HEADERS = { "cache-control": "no-store" };

/**
 * A time clicked on the public booking page (24.4) is held for five minutes:
 * only one of the type's free times, only while the host can be booked, at
 * most 30 holds an hour from one visitor. The hold's secret goes back to the
 * browser alone; the database keeps its hash.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ problem: "invalid" }, { status: 400, headers: HEADERS });
  try {
    const result = await holdSlot(createAdminClient(), {
      handle: parsed.data.handle,
      slug: parsed.data.slug,
      start: parsed.data.start,
      guestTimeZone: parsed.data.tz,
      clientHash: await visitorHash(request),
      release: parsed.data.release ?? null,
    });
    if (!result.ok) {
      const status = result.problem === "rateLimited" ? 429 : result.problem === "notFound" ? 404 : 409;
      return NextResponse.json({ problem: result.problem }, { status, headers: HEADERS });
    }
    return NextResponse.json(result.data, { headers: HEADERS });
  } catch (error) {
    console.error("booking hold failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ problem: "unknown" }, { status: 500, headers: HEADERS });
  }
}
