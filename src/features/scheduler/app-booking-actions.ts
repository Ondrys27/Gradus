"use server";

import { after } from "next/server";
import { z } from "zod";
import { measure } from "@/lib/analytics/instrument";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BOOKING_DIALOG_SOURCES } from "./analytics";
import {
  attachDealToBooking,
  bookForContact,
  extendAppHold,
  holdForApp,
  loadAppSlots,
  loadMeetingSetup,
  releaseAppHold,
  type Actor,
  type AppHold,
  type AppResult,
  type BookForContactResult,
  type MeetingSetup,
} from "./server/app-booking";
import type { TypeSlots } from "./server/busy";
import { refreshStaleForUser } from "./server/subscriptions";
import { SUBSCRIPTION_STALE_MS } from "./types";

/**
 * The meeting dialog's server side (30.4, server/app-booking.ts): the caller
 * is the session's in the active space; every step checks again who may be
 * booked and by whom. Failures come back as codes, never thrown.
 */

async function actor(): Promise<Actor | null> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  const { data: space, error } = await db.rpc("current_workspace_id");
  if (error || typeof space !== "string") return null;
  return { db, userId, spaceId: space };
}

function run<T>(name: string, work: (who: Actor) => Promise<AppResult<T>>): Promise<AppResult<T>> {
  return measure(`scheduler.${name}`, async (): Promise<AppResult<T>> => {
    try {
      const who = await actor();
      if (!who) return { ok: false, problem: "forbidden" };
      return await work(who);
    } catch (error) {
      console.error(
        `scheduler action ${name} failed`,
        error instanceof Error ? error.message : "unknown",
      );
      return { ok: false, problem: "unknown" };
    }
  })();
}

const id = z.uuid();
const zone = z.string().min(1).max(64);

export async function meetingSetupAction(contactId: string): Promise<AppResult<MeetingSetup>> {
  return run("meetingSetup", async (who) => {
    if (!id.safeParse(contactId).success) return { ok: false, problem: "invalid" };
    return loadMeetingSetup(createAdminClient(), who, contactId);
  });
}

export async function appSlotsAction(input: {
  hostId: string;
  typeId: string;
  timeZone: string;
}): Promise<AppResult<TypeSlots & { ignoreNotice: boolean }>> {
  return run("appSlots", async (who) => {
    const parsed = z.object({ hostId: id, typeId: id, timeZone: zone }).safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    const admin = createAdminClient();
    const result = await loadAppSlots(admin, who, parsed.data);
    // Subscribed calendars older than ten minutes are fetched again; the next look has them.
    if (result.ok) {
      after(() =>
        refreshStaleForUser(admin, parsed.data.hostId, SUBSCRIPTION_STALE_MS).catch(
          () => undefined,
        ),
      );
    }
    return result;
  });
}

export async function holdAppSlotAction(input: {
  hostId: string;
  typeId: string;
  start: number;
  force: boolean;
  release: string | null;
  from: (typeof BOOKING_DIALOG_SOURCES)[number];
}): Promise<AppResult<AppHold>> {
  return run("appHold", async (who) => {
    const parsed = z
      .object({
        hostId: id,
        typeId: id,
        start: z.number().int().positive(),
        force: z.boolean(),
        release: id.nullable(),
        from: z.enum(BOOKING_DIALOG_SOURCES),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    return holdForApp(createAdminClient(), who, {
      ...parsed.data,
      source: parsed.data.from === "cold_calling" ? "cold_calling" : "app",
    });
  });
}

const holdInput = z.object({ holdId: id, holdToken: z.string().min(20).max(100) });

export async function extendAppHoldAction(input: {
  holdId: string;
  holdToken: string;
}): Promise<AppResult<{ expiresAt: string }>> {
  return run("appHoldExtend", async (who) => {
    const parsed = holdInput.safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    return extendAppHold(createAdminClient(), who, parsed.data);
  });
}

export async function releaseAppHoldAction(input: {
  holdId: string;
  holdToken: string;
}): Promise<AppResult<null>> {
  return run("appHoldRelease", async (who) => {
    const parsed = holdInput.safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    await releaseAppHold(createAdminClient(), who, parsed.data);
    return { ok: true, data: null };
  });
}

const answerValue = z.union([z.string().max(5000), z.boolean()]);

export async function bookForContactAction(input: {
  holdId: string;
  holdToken: string;
  contactId: string;
  dealId: string | null;
  sendEmail: boolean;
  email: string | null;
  answers: Record<string, string | boolean>;
  forced: boolean;
  from: (typeof BOOKING_DIALOG_SOURCES)[number];
  locale: string;
  timeZone: string;
}): Promise<AppResult<BookForContactResult>> {
  return run("appBook", async (who) => {
    const parsed = z
      .object({
        holdId: id,
        holdToken: z.string().min(20).max(100),
        contactId: id,
        dealId: id.nullable(),
        sendEmail: z.boolean(),
        email: z.string().trim().max(254).nullable(),
        answers: z.record(id, answerValue).refine((value) => Object.keys(value).length <= 100),
        forced: z.boolean(),
        from: z.enum(BOOKING_DIALOG_SOURCES),
        locale: z.enum(["cs", "en"]),
        timeZone: zone,
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    return bookForContact(createAdminClient(), who, {
      ...parsed.data,
      origin: await siteOrigin(),
    });
  });
}

export async function attachDealToBookingAction(input: {
  bookingId: string;
  dealId: string;
}): Promise<AppResult<null>> {
  return run("appBookingDeal", async (who) => {
    const parsed = z.object({ bookingId: id, dealId: id }).safeParse(input);
    if (!parsed.success) return { ok: false, problem: "invalid" };
    return attachDealToBooking(createAdminClient(), who, parsed.data);
  });
}
