import { NextResponse } from "next/server";
import { z } from "zod";
import { isBookingLocale } from "@/features/scheduler/booking/page-locale";
import { bookHold } from "@/features/scheduler/server/bookings";
import { siteOrigin } from "@/lib/site-origin";
import { visitorHash } from "@/features/scheduler/server/visitor";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  holdId: z.uuid(),
  holdToken: z.string().min(40).max(60),
  values: z.record(z.string().max(40), z.union([z.string().max(2000), z.boolean()])),
  locale: z.string().max(5),
  tz: z.string().min(1).max(64),
  /** The honeypot: a field people never see. Anything in it is a bot. */
  website: z.string().max(500).optional(),
});

const HEADERS = { "cache-control": "no-store" };

/**
 * The guest's answers turn their hold into a booking (24.4): the answers are
 * checked against the type's questions, at most ten bookings an hour come
 * from one visitor, and a filled honeypot gets nothing. Then the contact, the
 * meeting in the host's calendar, the e-mails with the .ics and the
 * reminders follow (server/bookings.ts).
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ problem: "invalid" }, { status: 400, headers: HEADERS });
  if (parsed.data.website?.trim()) {
    return NextResponse.json({ problem: "invalid" }, { status: 400, headers: HEADERS });
  }
  try {
    const result = await bookHold(createAdminClient(), {
      holdId: parsed.data.holdId,
      holdToken: parsed.data.holdToken,
      values: parsed.data.values,
      locale: isBookingLocale(parsed.data.locale) ? parsed.data.locale : "en",
      timeZone: parsed.data.tz,
      clientHash: await visitorHash(request),
      origin: await siteOrigin(),
    });
    if (!result.ok) {
      const status = result.problem === "rateLimited" ? 429 : result.problem === "invalid" ? 400 : 409;
      return NextResponse.json(
        { problem: result.problem, ...("errors" in result ? { errors: result.errors } : {}) },
        { status, headers: HEADERS },
      );
    }
    return NextResponse.json(result.data, { headers: HEADERS });
  } catch (error) {
    console.error("booking failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ problem: "unknown" }, { status: 500, headers: HEADERS });
  }
}
