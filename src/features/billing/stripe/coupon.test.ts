import { describe, expect, it } from "vitest";
import { promoFirstPayment } from "@/features/plan/plan";
import { promoCoupon } from "./coupon";

const base = { code: "JANA50", billing: "monthly" as const, currency: "CZK" as const, regular: 890, version: 3 };

describe("promo code coupons", () => {
  it("percent off the first month: that percent once, monthly", () => {
    expect(promoCoupon({ ...base, benefit: { benefit: "percent_off_first", value: 50 } })).toEqual({
      id: "promo_JANA50_pct50",
      name: "Promo JANA50",
      duration: "once",
      percentOff: 50,
    });
  });

  it("free months: 100 % for that many months, monthly", () => {
    expect(promoCoupon({ ...base, benefit: { benefit: "months_free", value: 2 } })).toEqual({
      id: "promo_JANA50_free2m",
      name: "Promo JANA50",
      duration: "repeating",
      durationInMonths: 2,
      percentOff: 100,
    });
  });

  it("yearly: exactly what promoFirstPayment promised, off once, per currency and catalog version", () => {
    for (const benefit of [
      { benefit: "percent_off_first" as const, value: 50 },
      { benefit: "months_free" as const, value: 3 },
    ]) {
      const regular = 8900;
      const coupon = promoCoupon({ ...base, billing: "yearly", currency: "EUR", regular, benefit });
      const promised = promoFirstPayment(regular, "yearly", benefit);
      expect(coupon).toMatchObject({ duration: "once", currency: "eur" });
      expect(coupon!.amountOff).toBe(Math.round(promised.regular * 100) - Math.round(promised.first * 100));
      expect(coupon!.id).toMatch(/_y_EUR_v3$/);
    }
  });

  it("extra trial days need no coupon: the trial already ends later", () => {
    expect(promoCoupon({ ...base, benefit: { benefit: "trial_days_extra", value: 14 } })).toBeNull();
  });

  it("the same input is the same coupon id (made once in Stripe)", () => {
    const one = promoCoupon({ ...base, code: "jana-50", benefit: { benefit: "percent_off_first", value: 20 } });
    const two = promoCoupon({ ...base, code: "JANA50", benefit: { benefit: "percent_off_first", value: 20 } });
    expect(one?.id).toBe(two?.id);
    expect(promoCoupon({ ...base, code: "", benefit: { benefit: "percent_off_first", value: 20 } })).toBeNull();
  });
});
