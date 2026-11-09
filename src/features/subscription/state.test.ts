import { describe, expect, it } from "vitest";
import type { PlanLimits } from "@/config/pricing";
import {
  canCancel,
  canOpenPortal,
  canResume,
  changeBlock,
  changeDirection,
  chosenPlan,
  displayStatus,
  hasLiveGateway,
  isExpired,
  limitOverages,
  nextPayment,
  paymentRoute,
  plannedChange,
  showPastDueBanner,
  toSubscription,
  type Subscription,
  type SubscriptionRow,
} from "./state";

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

function sub(overrides: Partial<SubscriptionRow> = {}): Subscription {
  return toSubscription({
    plan_key: "pro",
    billing: "monthly",
    status: "active",
    trial_ends_at: null,
    current_period_start: at(-10),
    current_period_end: at(20),
    cancel_at_period_end: false,
    cancel_reason: null,
    scheduled_plan_key: null,
    scheduled_billing: null,
    scheduled_at: null,
    ...overrides,
  });
}
const trial = (days = 5, overrides: Partial<SubscriptionRow> = {}) =>
  sub({ status: "trialing", trial_ends_at: at(days), current_period_end: at(days), ...overrides });
const beta = () => sub({ plan_key: "beta", current_period_end: null });

describe("expiry (as subscription_expired)", () => {
  it("ends a trial at its end", () => {
    expect(isExpired(trial(1), NOW)).toBe(false);
    expect(isExpired(trial(-1), NOW)).toBe(true);
    expect(displayStatus(trial(-1), NOW)).toBe("expired");
  });

  it("ends a cancelled subscription at the end of its period, not before", () => {
    expect(isExpired(sub({ cancel_at_period_end: true }), NOW)).toBe(false);
    expect(displayStatus(sub({ cancel_at_period_end: true }), NOW)).toBe("ending");
    expect(isExpired(sub({ cancel_at_period_end: true, current_period_end: at(-1) }), NOW)).toBe(true);
  });

  it("never ends an active period nobody cancelled: the gateway renews it", () => {
    expect(isExpired(sub({ current_period_end: at(-3) }), NOW)).toBe(false);
  });

  it("ends what the gateway cancelled once its period is over", () => {
    expect(isExpired(sub({ status: "cancelled" }), NOW)).toBe(false);
    expect(isExpired(sub({ status: "cancelled", current_period_end: at(-1) }), NOW)).toBe(true);
    expect(isExpired(sub({ status: "cancelled", current_period_end: null }), NOW)).toBe(true);
  });

  it("reads beta as beta and keeps unknown values safe", () => {
    expect(displayStatus(beta(), NOW)).toBe("beta");
    expect(sub({ status: "weird", billing: "weekly" })).toMatchObject({
      status: "active",
      billing: "monthly",
    });
  });
});

describe("changing the plan (as subscription_request_change)", () => {
  it("orders the plans solo < pro < team, and a year above a month", () => {
    const pro = { planKey: "pro", billing: "monthly" } as const;
    expect(changeDirection(pro, { planKey: "team", billing: "monthly" })).toBe("upgrade");
    expect(changeDirection(pro, { planKey: "solo", billing: "yearly" })).toBe("downgrade");
    expect(changeDirection(pro, { planKey: "pro", billing: "yearly" })).toBe("upgrade");
    expect(changeDirection({ ...pro, billing: "yearly" }, pro)).toBe("downgrade");
    expect(changeDirection(pro, pro)).toBe("same");
  });

  it("upgrades now and schedules a downgrade for the end of the period", () => {
    const active = sub() as Subscription & { planKey: "pro" };
    expect(plannedChange(active, { planKey: "team", billing: "monthly" }, NOW)).toEqual({
      direction: "upgrade",
      timing: "immediate",
      at: null,
    });
    expect(plannedChange(active, { planKey: "solo", billing: "monthly" }, NOW)).toEqual({
      direction: "downgrade",
      timing: "scheduled",
      at: at(20),
    });
    expect(plannedChange(active, { planKey: "pro", billing: "monthly" }, NOW).timing).toBe("none");
  });

  it("schedules a trial's downgrade for the trial's end", () => {
    const running = trial(4) as Subscription & { planKey: "pro" };
    expect(plannedChange(running, { planKey: "solo", billing: "monthly" }, NOW)).toMatchObject({
      timing: "scheduled",
      at: at(4),
    });
  });

  it("applies any change now without a period end or once expired", () => {
    const open = sub({ current_period_end: null }) as Subscription & { planKey: "pro" };
    const over = trial(-2) as Subscription & { planKey: "pro" };
    for (const current of [open, over]) {
      expect(plannedChange(current, { planKey: "solo", billing: "monthly" }, NOW).timing).toBe(
        "immediate",
      );
    }
  });

  it("leaves beta to the administration and waits for a cancellation to be taken back", () => {
    expect(changeBlock(beta(), NOW)).toBe("beta");
    expect(changeBlock(sub({ cancel_at_period_end: true }), NOW)).toBe("cancelPending");
    expect(changeBlock(sub({ cancel_at_period_end: true, current_period_end: at(-1) }), NOW)).toBeNull();
    expect(changeBlock(sub(), NOW)).toBeNull();
  });
});

describe("cancelling and taking it back", () => {
  it("cancels a running catalog plan that has an end, once", () => {
    expect(canCancel(sub(), NOW)).toBe(true);
    expect(canCancel(trial(3), NOW)).toBe(true);
    expect(canCancel(sub({ cancel_at_period_end: true }), NOW)).toBe(false);
    expect(canCancel(sub({ current_period_end: null }), NOW)).toBe(false);
    expect(canCancel(beta(), NOW)).toBe(false);
    expect(canCancel(trial(-1), NOW)).toBe(false);
  });

  it("takes a cancellation back only while the period runs", () => {
    expect(canResume(sub({ cancel_at_period_end: true }), NOW)).toBe(true);
    expect(canResume(sub(), NOW)).toBe(false);
    expect(canResume(sub({ cancel_at_period_end: true, current_period_end: at(-1) }), NOW)).toBe(false);
  });
});

describe("next payment", () => {
  it("is the end of a paid period that goes on, for the plan in force then", () => {
    expect(nextPayment(sub(), NOW)).toEqual({ at: at(20), planKey: "pro", billing: "monthly" });
    expect(
      nextPayment(
        sub({ scheduled_plan_key: "solo", scheduled_billing: "yearly", scheduled_at: at(20) }),
        NOW,
      ),
    ).toEqual({ at: at(20), planKey: "solo", billing: "yearly" });
  });

  it("is none while trialing, cancelled, open-ended or on beta", () => {
    expect(nextPayment(trial(3), NOW)).toBeNull();
    expect(nextPayment(sub({ cancel_at_period_end: true }), NOW)).toBeNull();
    expect(nextPayment(sub({ current_period_end: null }), NOW)).toBeNull();
    expect(nextPayment(beta(), NOW)).toBeNull();
  });
});

describe("limitOverages", () => {
  const solo: PlanLimits = {
    daily_contacts: 30,
    monthly_contacts: 100,
    ai_calls: 300,
    ai_files: 0,
    workers: 0,
    storage_mb: 500,
  };

  it("lists what the data already exceeds; workers and storage lock the workspace", () => {
    const over = limitOverages(solo, {
      workers: 2,
      storageBytes: 600 * 1_048_576 + 1,
      monthlyContacts: 250,
      aiCalls: 300,
      aiFiles: 4,
    });
    expect(over).toEqual([
      { limit: "workers", used: 2, allowed: 0, locks: true },
      { limit: "storage_mb", used: 601, allowed: 500, locks: true },
      { limit: "monthly_contacts", used: 250, allowed: 100, locks: false },
      { limit: "ai_files", used: 4, allowed: 0, locks: false },
    ]);
  });

  it("has nothing to say without a limit or within it", () => {
    expect(
      limitOverages(
        { ...solo, workers: null, storage_mb: null },
        { workers: 9, storageBytes: 9e12, monthlyContacts: 100, aiCalls: 0, aiFiles: 0 },
      ),
    ).toEqual([]);
  });
});

describe("how a plan is paid for (step 23.1)", () => {
  it("a subscription in Stripe changes through Stripe while it runs", () => {
    const stripe = sub({ provider: "stripe" });
    expect(stripe.gateway).toBe("stripe");
    expect(hasLiveGateway(stripe, NOW)).toBe(true);
    expect(paymentRoute(stripe, NOW)).toBe("gateway");
    expect(paymentRoute(sub({ provider: "stripe", status: "past_due" }), NOW)).toBe("gateway");
  });

  it("the trial without a card and an ended plan are paid through Checkout", () => {
    expect(paymentRoute(sub({ status: "trialing", trial_ends_at: at(5), current_period_end: at(5) }), NOW)).toBe(
      "checkout",
    );
    expect(paymentRoute(sub({ status: "trialing", trial_ends_at: at(-1), current_period_end: at(-1) }), NOW)).toBe(
      "checkout",
    );
    const ended = sub({ provider: "stripe", status: "cancelled", current_period_end: at(-1) });
    expect(hasLiveGateway(ended, NOW)).toBe(false);
    expect(paymentRoute(ended, NOW)).toBe("checkout");
  });

  it("a plan the administration set stays manual; beta never pays", () => {
    expect(paymentRoute(sub(), NOW)).toBe("manual");
    expect(paymentRoute(sub({ plan_key: "beta", current_period_end: null }), NOW)).toBe("none");
  });
});

describe("a failed payment (step 23.2)", () => {
  const stripe = (overrides: Partial<SubscriptionRow> = {}) => sub({ provider: "stripe", ...overrides });
  const owner = { worker: false };

  it("shows the banner to the owner while Stripe retries, never to a worker", () => {
    const pastDue = stripe({ status: "past_due" });
    expect(showPastDueBanner(pastDue, owner, NOW)).toBe(true);
    expect(showPastDueBanner(pastDue, { worker: true }, NOW)).toBe(false);
    expect(showPastDueBanner(null, owner, NOW)).toBe(false);
    // The app runs as before while it retries: not expired, not read-only.
    expect(isExpired(pastDue, NOW)).toBe(false);
    expect(displayStatus(pastDue, NOW)).toBe("pastDue");
    expect(hasLiveGateway(pastDue, NOW)).toBe(true);
  });

  it("hides it once paid again, and once Stripe ended the subscription after the last attempt", () => {
    expect(showPastDueBanner(stripe({ status: "active" }), owner, NOW)).toBe(false);
    // subscription.deleted: cancelled when Stripe ended it (now), expired like after a trial.
    const ended = stripe({ status: "cancelled", current_period_end: at(-0.01) });
    expect(showPastDueBanner(ended, owner, NOW)).toBe(false);
    expect(isExpired(ended, NOW)).toBe(true);
    expect(displayStatus(ended, NOW)).toBe("expired");
    expect(paymentRoute(ended, NOW)).toBe("checkout");
  });

  it("no banner for beta or a plan outside the catalog", () => {
    expect(showPastDueBanner(stripe({ status: "past_due", plan_key: "beta" }), owner, NOW)).toBe(false);
  });

  it("offers Stripe's portal for a subscription that runs or ran in Stripe", () => {
    expect(canOpenPortal(stripe())).toBe(true);
    expect(canOpenPortal(stripe({ status: "past_due" }))).toBe(true);
    expect(canOpenPortal(stripe({ status: "cancelled", current_period_end: at(-3) }))).toBe(true);
    expect(canOpenPortal(sub())).toBe(false);
    expect(canOpenPortal(trial())).toBe(false);
    expect(canOpenPortal(stripe({ plan_key: "beta" }))).toBe(false);
  });
});

describe("the plan picked on the website (step 23.3)", () => {
  const picked = { chosen_plan_key: "team", chosen_billing: "yearly" };

  it("is what a trial would pay for, and after it ended too", () => {
    expect(trial(5, picked).chosen).toEqual({ planKey: "team", billing: "yearly" });
    expect(chosenPlan(trial(5, picked), NOW)).toEqual({ planKey: "team", billing: "yearly" });
    expect(chosenPlan(trial(-2, picked), NOW)).toEqual({ planKey: "team", billing: "yearly" });
  });

  it("is gone once the plan runs in Stripe, without a choice, or with a plan outside the catalog", () => {
    expect(chosenPlan(trial(5, { ...picked, provider: "stripe", status: "active" }), NOW)).toBeNull();
    expect(chosenPlan(trial(5), NOW)).toBeNull();
    expect(trial(5, { chosen_plan_key: "beta", chosen_billing: "monthly" }).chosen).toBeNull();
    expect(chosenPlan(sub({ ...picked, plan_key: "beta" }), NOW)).toBeNull();
  });
});
