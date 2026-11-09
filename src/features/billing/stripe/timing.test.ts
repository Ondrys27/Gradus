import { describe, expect, it } from "vitest";
import { toSubscription, type SubscriptionRow } from "@/features/subscription/state";
import { checkoutStart } from "./timing";

const NOW = new Date("2026-11-09T10:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

function sub(overrides: Partial<SubscriptionRow>) {
  return toSubscription({
    plan_key: "pro",
    billing: "monthly",
    status: "trialing",
    trial_ends_at: hours(24 * 10),
    current_period_start: hours(-24 * 4),
    current_period_end: hours(24 * 10),
    cancel_at_period_end: false,
    cancel_reason: null,
    scheduled_plan_key: null,
    scheduled_billing: null,
    scheduled_at: null,
    ...overrides,
  });
}

describe("when the paid period starts", () => {
  it("after the trial: Stripe's trial ends where Gradus's does", () => {
    expect(checkoutStart(sub({}), NOW)).toEqual({
      kind: "trial",
      trialEnd: Math.floor(Date.parse(hours(240)) / 1000),
    });
  });

  it("in the trial's last two days: anchored at its end instead", () => {
    expect(checkoutStart(sub({ trial_ends_at: hours(30) }), NOW)).toEqual({
      kind: "anchor",
      anchor: Math.floor(Date.parse(hours(30)) / 1000),
    });
  });

  it("now in the trial's last minutes, after it ended, or for a plan that ended", () => {
    expect(checkoutStart(sub({ trial_ends_at: hours(0.05) }), NOW)).toEqual({ kind: "now" });
    expect(checkoutStart(sub({ trial_ends_at: hours(-1) }), NOW)).toEqual({ kind: "now" });
    expect(
      checkoutStart(sub({ status: "cancelled", trial_ends_at: null, current_period_end: hours(-48) }), NOW),
    ).toEqual({ kind: "now" });
  });
});
