import { describe, expect, it } from "vitest";
import { promoFirstPayment, toPlanSnapshot, trialNotice, UNKNOWN_PLAN, type PlanSnapshot } from "./plan";

const now = new Date("2026-10-06T10:00:00Z");
const day = 86_400_000;

function trial(endsInMs: number): PlanSnapshot {
  return {
    planKey: "pro",
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + endsInMs).toISOString(),
    readOnly: false,
  };
}

describe("trialNotice", () => {
  it("shows a quiet bar with the days left", () => {
    expect(trialNotice(trial(9 * day), now)).toEqual({ kind: "trial", daysLeft: 9, urgent: false });
    expect(trialNotice(trial(13.5 * day), now)).toEqual({
      kind: "trial",
      daysLeft: 14,
      urgent: false,
    });
  });

  it("gets louder in the last three days", () => {
    expect(trialNotice(trial(3 * day), now)).toMatchObject({ daysLeft: 3, urgent: true });
    expect(trialNotice(trial(2 * 3_600_000), now)).toMatchObject({ daysLeft: 1, urgent: true });
  });

  it("turns into the plan card once the trial is over", () => {
    expect(trialNotice(trial(-1), now)).toEqual({ kind: "expired" });
    expect(
      trialNotice({ ...trial(-day), status: "expired", readOnly: true }, now),
    ).toEqual({ kind: "expired" });
  });

  it("tells a workspace over its plan's limits apart from an ended trial", () => {
    expect(trialNotice({ ...trial(5 * day), readOnly: true }, now)).toEqual({ kind: "overLimit" });
    expect(trialNotice({ ...trial(day), status: "active", readOnly: true }, now)).toEqual({
      kind: "overLimit",
    });
    expect(trialNotice({ ...trial(-1), readOnly: true }, now)).toEqual({ kind: "expired" });
  });

  it("shows nothing for beta and paid plans", () => {
    expect(trialNotice(UNKNOWN_PLAN, now)).toEqual({ kind: "none" });
    expect(trialNotice({ ...trial(day), status: "active" }, now)).toEqual({ kind: "none" });
  });
});

describe("toPlanSnapshot", () => {
  it("reads current_plan() and never locks out when it is missing", () => {
    expect(
      toPlanSnapshot({
        plan_key: "pro",
        status: "expired",
        trial_ends_at: "2026-10-01T00:00:00Z",
        read_only: true,
      }),
    ).toEqual({
      planKey: "pro",
      status: "expired",
      trialEndsAt: "2026-10-01T00:00:00Z",
      readOnly: true,
    });
    expect(toPlanSnapshot(null)).toEqual(UNKNOWN_PLAN);
  });
});

describe("promoFirstPayment", () => {
  it("leaves the price alone without a code or with trial days", () => {
    expect(promoFirstPayment(499, "monthly", null)).toEqual({ regular: 499, first: 499, freeMonths: 0 });
    expect(promoFirstPayment(499, "monthly", { benefit: "trial_days_extra", value: 14 })).toEqual({
      regular: 499,
      first: 499,
      freeMonths: 0,
    });
  });

  it("takes a percentage off the first month", () => {
    expect(promoFirstPayment(499, "monthly", { benefit: "percent_off_first", value: 50 }).first).toBe(249.5);
    expect(promoFirstPayment(499, "monthly", { benefit: "percent_off_first", value: 100 }).first).toBe(0);
    expect(promoFirstPayment(19.9, "monthly", { benefit: "percent_off_first", value: 33 }).first).toBe(13.33);
    // Yearly: half of one month off the year (4 990 / 12 / 2 = 207.92).
    expect(promoFirstPayment(4990, "yearly", { benefit: "percent_off_first", value: 50 }).first).toBe(4782.08);
  });

  it("gives free months before the first monthly payment, or twelfths off the year", () => {
    expect(promoFirstPayment(499, "monthly", { benefit: "months_free", value: 2 })).toEqual({
      regular: 499,
      first: 499,
      freeMonths: 2,
    });
    expect(promoFirstPayment(4990, "yearly", { benefit: "months_free", value: 1 }).first).toBe(4574.17);
    expect(promoFirstPayment(4990, "yearly", { benefit: "months_free", value: 12 }).first).toBe(0);
  });

  it("never goes below zero or past the limits of a benefit", () => {
    expect(promoFirstPayment(499, "monthly", { benefit: "percent_off_first", value: 150 }).first).toBe(0);
    expect(promoFirstPayment(4990, "yearly", { benefit: "months_free", value: 20 }).first).toBe(0);
    expect(promoFirstPayment(0, "monthly", { benefit: "percent_off_first", value: 50 }).first).toBe(0);
  });
});
