import { PAID_PLANS, type PaidPlanKey } from "./pricing";

/**
 * What running Gradus costs per use, in one place. The administration turns
 * the counts from metric_cost_inputs() into money with these; the AI cost is
 * not here because ai_usage already stores the price of every model call.
 */

/**
 * Czech crowns for one US dollar. Update now and then from the ČNB rate:
 * https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/
 */
export const USD_CZK = 21.5;

/**
 * Google Places API (New) Text Search, USD per 1,000 requests (0–100k a month).
 * Source: https://developers.google.com/maps/billing-and-pricing/pricing
 * (checked 2026-10-08): Text Search Pro 32 USD, Enterprise 35 USD.
 * Our field mask (src/features/contacts/server/places.ts) asks for
 * internationalPhoneNumber and websiteUri, which Google bills as the
 * Enterprise SKU (https://developers.google.com/maps/documentation/places/web-service/text-search),
 * so every request costs the Enterprise price. The first 1,000 Enterprise
 * requests a month are free; that is left out, so the estimate is on the safe side.
 */
export const GOOGLE_PLACES_USD_PER_1000 = 35;

/**
 * One sent e-mail through Resend, USD: the extra price on the Pro plan,
 * 0.90 USD per 1,000 above the included volume.
 * Source: https://resend.com/pricing (checked 2026-10-08).
 */
export const EMAIL_USD = 0.0009;

export type CostRates = {
  placesUsdPer1000: number;
  emailUsd: number;
  usdCzk: number;
};

export const COST_RATES: CostRates = {
  placesUsdPer1000: GOOGLE_PLACES_USD_PER_1000,
  emailUsd: EMAIL_USD,
  usdCzk: USD_CZK,
};

/** One row of metric_cost_inputs(): the usage of a period. */
export type CostInputs = {
  activeUsers: number;
  aiCostUsd: number;
  placesRequests: number;
  emailsSent: number;
};

export type CostBreakdown = {
  aiUsd: number;
  placesUsd: number;
  emailsUsd: number;
  totalUsd: number;
  totalCzk: number;
};

export function costBreakdown(inputs: CostInputs, rates: CostRates = COST_RATES): CostBreakdown {
  const aiUsd = inputs.aiCostUsd;
  const placesUsd = (inputs.placesRequests / 1000) * rates.placesUsdPer1000;
  const emailsUsd = inputs.emailsSent * rates.emailUsd;
  const totalUsd = aiUsd + placesUsd + emailsUsd;
  return { aiUsd, placesUsd, emailsUsd, totalUsd, totalCzk: totalUsd * rates.usdCzk };
}

/** All costs of the period divided by the users active in it; null without active users. */
export function costPerActiveUser(
  inputs: CostInputs,
  rates: CostRates = COST_RATES,
): { usd: number; czk: number } | null {
  if (inputs.activeUsers <= 0) return null;
  const { totalUsd } = costBreakdown(inputs, rates);
  const usd = totalUsd / inputs.activeUsers;
  return { usd, czk: usd * rates.usdCzk };
}

/** The usage of one plan in a period, as metric_cost_inputs() returns it. */
export type PlanCostInputs = CostInputs & { plan: string };

export type PlanMargin = {
  plan: string;
  /** Monthly price in CZK from src/config/pricing.ts; null for beta and the trial. */
  priceCzk: number | null;
  /** Cost per active user, scaled to 30 days. */
  costPerActiveUserCzk: number | null;
  marginCzk: number | null;
  /** Margin as a share of the price, 0–1 (negative when a user costs more than they pay). */
  marginShare: number | null;
};

/**
 * Estimated monthly margin per plan: the plan's CZK price against what one
 * active user of it cost, the period scaled to 30 days. The Team plan's
 * price per worker is not included (the worker's costs count on their own).
 */
export function marginByPlan(
  rows: readonly PlanCostInputs[],
  periodDays: number,
  rates: CostRates = COST_RATES,
): PlanMargin[] {
  const scale = periodDays > 0 ? 30 / periodDays : 0;
  return rows.map((row) => {
    const paid = PAID_PLANS.find((plan) => plan.key === (row.plan as PaidPlanKey));
    const priceCzk = paid ? paid.monthly.CZK : null;
    const perUser = costPerActiveUser(row, rates);
    const costPerActiveUserCzk = perUser ? perUser.czk * scale : null;
    const marginCzk =
      priceCzk !== null && costPerActiveUserCzk !== null ? priceCzk - costPerActiveUserCzk : null;
    return {
      plan: row.plan,
      priceCzk,
      costPerActiveUserCzk,
      marginCzk,
      marginShare: marginCzk !== null && priceCzk ? marginCzk / priceCzk : null,
    };
  });
}
