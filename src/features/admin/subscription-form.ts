import { z } from "zod";
import { PAID_PLAN_KEYS } from "@/config/pricing";
import { BILLINGS, STORED_STATUSES } from "@/features/subscription/state";
import { toZonedWallClock, zonedWallClockToInstant, type IsoDate } from "@/lib/format";

/**
 * The administration's form for one account's subscription (owner only):
 * what the database's admin_subscription_set() accepts. A trial and a
 * cancellation need the end of the period; the end is the end of that day in
 * the administration's zone.
 */

export const ADMIN_PLAN_KEYS = ["beta", ...PAID_PLAN_KEYS] as const;

export const adminSubscriptionSchema = z
  .object({
    planKey: z.enum(ADMIN_PLAN_KEYS),
    billing: z.enum(BILLINGS),
    status: z.enum(STORED_STATUSES),
    /** YYYY-MM-DD, empty = open-ended. */
    periodEnd: z.union([z.literal(""), z.iso.date()]),
    cancelAtPeriodEnd: z.boolean(),
  })
  .refine(
    (value) => value.periodEnd !== "" || (value.status !== "trialing" && !value.cancelAtPeriodEnd),
    { path: ["periodEnd"], message: "periodEndRequired" },
  );
export type AdminSubscriptionForm = z.input<typeof adminSubscriptionSchema>;

/** The last minute of the day in `timeZone`, as the instant stored. */
export function periodEndInstant(date: string, timeZone: string): string | null {
  if (!date) return null;
  return zonedWallClockToInstant(date as IsoDate, "23:59", timeZone).toISOString();
}

/** The day of a stored instant in `timeZone`, for the date field. */
export function periodEndDate(instant: string | null, timeZone: string): string {
  if (!instant) return "";
  const wall = toZonedWallClock(new Date(instant), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.getFullYear()}-${pad(wall.getMonth() + 1)}-${pad(wall.getDate())}`;
}

export function sameSubscription(a: AdminSubscriptionForm, b: AdminSubscriptionForm): boolean {
  return (
    a.planKey === b.planKey &&
    a.billing === b.billing &&
    a.status === b.status &&
    a.periodEnd === b.periodEnd &&
    a.cancelAtPeriodEnd === b.cancelAtPeriodEnd
  );
}
