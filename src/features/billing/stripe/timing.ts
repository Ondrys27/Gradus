import { isExpired, type Subscription } from "@/features/subscription/state";

/**
 * When the paid period of a new Stripe subscription starts (step 23.1). The
 * trial needs no card; paying during it starts the paid period right after
 * the trial (trial_end = trial_ends_at, extra days of a promo code included),
 * paying after it starts it now. Stripe's Checkout wants a trial to end at
 * least 48 hours ahead; in the trial's last two days the subscription is
 * anchored at the trial's end instead, without prorations, so the days up
 * to it stay free all the same.
 */

/** Stripe's minimum for a Checkout trial, with a margin for the time the customer spends there. */
export const MIN_TRIAL_LEAD_MS = 48 * 3_600_000 + 15 * 60_000;
/** Less than this before the trial's end is not worth anchoring: the period starts now. */
export const MIN_ANCHOR_LEAD_MS = 10 * 60_000;

export type CheckoutStart =
  | { kind: "trial"; trialEnd: number }
  | { kind: "anchor"; anchor: number }
  | { kind: "now" };

const unix = (ms: number) => Math.floor(ms / 1000);

export function checkoutStart(sub: Subscription, now: Date = new Date()): CheckoutStart {
  if (sub.status !== "trialing" || !sub.trialEndsAt || isExpired(sub, now)) return { kind: "now" };
  const end = Date.parse(sub.trialEndsAt);
  if (!Number.isFinite(end)) return { kind: "now" };
  const lead = end - now.getTime();
  if (lead >= MIN_TRIAL_LEAD_MS) return { kind: "trial", trialEnd: unix(end) };
  if (lead >= MIN_ANCHOR_LEAD_MS) return { kind: "anchor", anchor: unix(end) };
  return { kind: "now" };
}
