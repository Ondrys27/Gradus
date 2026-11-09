import type { Billing, PriceCurrency } from "@/config/pricing";
import { promoFirstPayment, type PromoPriceBenefit } from "@/features/plan/plan";
import { minorUnits } from "./prices";

/**
 * The Stripe coupon of a promo code (22.2) in Checkout, so Stripe charges
 * exactly what promoFirstPayment() promised:
 * - percent off the first month: monthly a coupon of that percent for one
 *   invoice; yearly the year costs that part of one month less, a fixed
 *   amount off once;
 * - free months: monthly 100 % for that many months, then the full price;
 *   yearly that many twelfths of the year off once;
 * - extra trial days: no coupon. promo_redeem() already moved trial_ends_at
 *   and Checkout ends its trial there (checkoutStart), so the days are never
 *   counted twice.
 * Coupons are made by the server with an id derived from everything that
 * decides them (the code, the benefit, and for a fixed amount the period,
 * currency and catalog version), so making one twice is the same coupon.
 */

export type CouponSpec = {
  id: string;
  name: string;
  duration: "once" | "repeating";
  durationInMonths?: number;
  percentOff?: number;
  /** In the smallest unit of `currency`. */
  amountOff?: number;
  currency?: Lowercase<PriceCurrency>;
};

export type PromoCouponInput = {
  code: string;
  benefit: PromoPriceBenefit;
  billing: Billing;
  currency: PriceCurrency;
  /** The regular price of one period of the plan (without workers). */
  regular: number;
  /** The published catalog version the price comes from. */
  version: number;
};

const NAME_MAX = 40;

export function promoCoupon(input: PromoCouponInput): CouponSpec | null {
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return null;
  const value = Math.max(0, Math.floor(input.benefit.value));
  const name = `Promo ${code}`.slice(0, NAME_MAX);
  switch (input.benefit.benefit) {
    case "trial_days_extra":
      return null;
    case "percent_off_first":
    case "months_free": {
      if (value < 1) return null;
      if (input.billing === "monthly") {
        return input.benefit.benefit === "percent_off_first"
          ? { id: `promo_${code}_pct${Math.min(value, 100)}`, name, duration: "once", percentOff: Math.min(value, 100) }
          : {
              id: `promo_${code}_free${Math.min(value, 12)}m`,
              name,
              duration: "repeating",
              durationInMonths: Math.min(value, 12),
              percentOff: 100,
            };
      }
      const price = promoFirstPayment(input.regular, "yearly", input.benefit);
      const amountOff = minorUnits(price.regular) - minorUnits(price.first);
      if (amountOff <= 0) return null;
      const kind = input.benefit.benefit === "percent_off_first" ? `pct${value}` : `free${value}`;
      return {
        id: `promo_${code}_${kind}_y_${input.currency}_v${input.version}`,
        name,
        duration: "once",
        amountOff,
        currency: input.currency.toLowerCase() as Lowercase<PriceCurrency>,
      };
    }
  }
}
