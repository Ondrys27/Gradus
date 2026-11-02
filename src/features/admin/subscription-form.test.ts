import { describe, expect, it } from "vitest";
import { adminSubscriptionSchema, periodEndDate, periodEndInstant } from "./subscription-form";

const base = { planKey: "pro", billing: "monthly", status: "active", periodEnd: "", cancelAtPeriodEnd: false } as const;

describe("adminSubscriptionSchema", () => {
  it("takes an open-ended active plan and a dated trial", () => {
    expect(adminSubscriptionSchema.safeParse(base).success).toBe(true);
    expect(
      adminSubscriptionSchema.safeParse({ ...base, status: "trialing", periodEnd: "2026-12-01" }).success,
    ).toBe(true);
  });

  it("wants an end for a trial and for a cancellation", () => {
    expect(adminSubscriptionSchema.safeParse({ ...base, status: "trialing" }).success).toBe(false);
    expect(adminSubscriptionSchema.safeParse({ ...base, cancelAtPeriodEnd: true }).success).toBe(false);
    expect(adminSubscriptionSchema.safeParse({ ...base, planKey: "free" }).success).toBe(false);
    expect(adminSubscriptionSchema.safeParse({ ...base, periodEnd: "1. 12. 2026" }).success).toBe(false);
  });
});

describe("period end", () => {
  it("is the end of the day in the zone and reads back as the same day", () => {
    const instant = periodEndInstant("2026-12-01", "Europe/Prague");
    expect(instant).toBe("2026-12-01T22:59:00.000Z");
    expect(periodEndDate(instant, "Europe/Prague")).toBe("2026-12-01");
    expect(periodEndInstant("", "Europe/Prague")).toBeNull();
    expect(periodEndDate(null, "Europe/Prague")).toBe("");
  });
});
