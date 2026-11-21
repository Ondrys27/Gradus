"use server";

import { z } from "zod";
import { serverCan } from "@/features/account/server/permissions";
import { isWorkspaceReadOnly } from "@/features/plan/server";
import { measure } from "@/lib/analytics/instrument";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BookingProblem } from "./booking/state";
import {
  approveBooking,
  cancelBooking,
  declineBooking,
  dismissSurvey,
  rescheduleBooking,
  setMeetingLink,
  setNoShow,
} from "./server/bookings";
import { meetingLinkProblem } from "./booking/meeting-link";

/**
 * The host's decisions on their bookings (24.4): approve, decline (with a
 * reason and maybe another time), move, cancel, mark a no-show, skip the
 * meeting survey, give one meeting a link of its own (27.5). The booking
 * must be the session's own as host (read with the user's client, so RLS
 * decides) in a space where they still have
 * "scheduler: own"; only then the work runs with the admin client
 * (server/bookings.ts). Approving and moving wait while the space is
 * read-only; declining and cancelling only free time and tell the guest.
 */

export type BookingActionResult = { ok: true } | { ok: false; problem: BookingProblem };
/** The guest heard of the new link by e-mail (more than an hour before the meeting). */
export type LinkActionResult = { ok: true; emailed: boolean } | { ok: false; problem: BookingProblem };

const id = z.uuid();
const reason = z.string().trim().max(500).optional();

type Host =
  | { ok: false; problem: BookingProblem }
  | { ok: true; userId: string; booking: { id: string; space_id: string } };

async function hostOf(bookingId: string, writes: boolean): Promise<Host> {
  if (!id.safeParse(bookingId).success) return { ok: false, problem: "invalid" };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return { ok: false, problem: "forbidden" };
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, space_id, host_user_id")
    .eq("id", bookingId)
    .eq("host_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return { ok: false, problem: "notFound" };
  if (!(await serverCan(supabase, booking.space_id, "scheduler", "own"))) {
    return { ok: false, problem: "forbidden" };
  }
  // The space of the booking, whichever space is active (the admin client, after the check above).
  if (writes && (await isWorkspaceReadOnly(createAdminClient(), booking.space_id))) {
    return { ok: false, problem: "readOnly" };
  }
  return { ok: true, userId, booking };
}

function run<R extends BookingActionResult = BookingActionResult>(
  name: string,
  work: () => Promise<R | Extract<BookingActionResult, { ok: false }>>,
): Promise<R | Extract<BookingActionResult, { ok: false }>> {
  return measure(`scheduler.${name}`, async (): Promise<R | Extract<BookingActionResult, { ok: false }>> => {
    try {
      return await work();
    } catch (error) {
      console.error(`booking action ${name} failed`, error instanceof Error ? error.name : "unknown");
      return { ok: false, problem: "unknown" };
    }
  })();
}

const done = (result: { ok: true } | { ok: false; problem: BookingProblem }): BookingActionResult =>
  result.ok ? { ok: true } : { ok: false, problem: result.problem };

export async function approveBookingAction(bookingId: string): Promise<BookingActionResult> {
  return run("approveBooking", async () => {
    const host = await hostOf(bookingId, true);
    if (!host.ok) return host;
    return done(await approveBooking(createAdminClient(), bookingId, await siteOrigin()));
  });
}

export async function declineBookingAction(input: {
  bookingId: string;
  reason?: string;
  /** Another time the host offers, ISO. */
  alternative?: string | null;
}): Promise<BookingActionResult> {
  return run("declineBooking", async () => {
    const parsed = z
      .object({ reason, alternative: z.iso.datetime({ offset: true }).nullish() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    const host = await hostOf(input.bookingId, false);
    if (!host.ok) return host;
    const alternative =
      parsed.data.alternative && Date.parse(parsed.data.alternative) > Date.now()
        ? new Date(parsed.data.alternative).toISOString()
        : null;
    return done(
      await declineBooking(
        createAdminClient(),
        input.bookingId,
        parsed.data.reason || null,
        alternative,
        await siteOrigin(),
      ),
    );
  });
}

export async function cancelBookingAction(input: {
  bookingId: string;
  reason?: string;
}): Promise<BookingActionResult> {
  return run("cancelBooking", async () => {
    const parsed = reason.safeParse(input.reason);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    const host = await hostOf(input.bookingId, false);
    if (!host.ok) return host;
    return done(
      await cancelBooking(createAdminClient(), input.bookingId, "host", parsed.data || null, await siteOrigin()),
    );
  });
}

export async function rescheduleBookingAction(input: {
  bookingId: string;
  start: number;
}): Promise<BookingActionResult> {
  return run("rescheduleBooking", async () => {
    if (!Number.isSafeInteger(input.start) || input.start <= 0) return { ok: false, problem: "invalid" };
    const host = await hostOf(input.bookingId, true);
    if (!host.ok) return host;
    return done(
      await rescheduleBooking(createAdminClient(), input.bookingId, input.start, "host", await siteOrigin()),
    );
  });
}

export async function setNoShowAction(input: {
  bookingId: string;
  noShow: boolean;
}): Promise<BookingActionResult> {
  return run("setNoShow", async () => {
    const host = await hostOf(input.bookingId, true);
    if (!host.ok) return host;
    return done(await setNoShow(createAdminClient(), input.bookingId, input.noShow === true, host.userId));
  });
}

export async function dismissSurveyAction(bookingId: string): Promise<BookingActionResult> {
  return run("dismissSurvey", async () => {
    const host = await hostOf(bookingId, false);
    if (!host.ok) return host;
    return done(await dismissSurvey(createAdminClient(), bookingId, host.userId));
  });
}

/**
 * The host's own link of one video meeting (27.5), or none to go back to the
 * type's; the guest's page shows it at once (an e-mail only while the
 * meeting is more than an hour away). Waits while the space is read-only.
 */
export async function setBookingLinkAction(input: {
  bookingId: string;
  link: string | null;
}): Promise<LinkActionResult> {
  return run<LinkActionResult>("setBookingLink", async () => {
    const link = typeof input.link === "string" ? input.link.trim() : "";
    if (meetingLinkProblem(link)) return { ok: false, problem: "invalid" };
    const host = await hostOf(input.bookingId, true);
    if (!host.ok) return host;
    const result = await setMeetingLink(
      createAdminClient(),
      input.bookingId,
      link || null,
      await siteOrigin(),
      host.userId,
    );
    return result.ok
      ? { ok: true as const, emailed: result.data.emailed }
      : { ok: false as const, problem: result.problem };
  });
}
