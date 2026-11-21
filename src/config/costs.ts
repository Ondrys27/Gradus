import { PAID_PLANS } from "./pricing";

/**
 * What running Gradus costs per use, in one place. The administration turns
 * the counts from metric_cost_inputs() into money with these. The AI cost of
 * a period is not computed here: ai_usage stores the price of every model
 * call, priced with MODEL_PRICES below when the call ends.
 */

/** USD per million tokens of one model: base input, 5-minute cache write, cache read, output. */
export type ModelPrice = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /**
   * Higher prices for a request whose prompt (input + cache reads + cache
   * writes) is over `aboveTokens`; the whole request then pays them.
   */
  longPrompt?: {
    aboveTokens: number;
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
  };
};

/**
 * The Claude models Grady may run on, cheapest first: the one list the
 * administration offers (AI and Grady → Models) and the price of every call
 * comes from. Adding a model = one row here (key, API id, name, prices,
 * date checked); the administration, the cost estimates and the settings
 * pick it up. `rank` orders the models from the cheapest: a feature never
 * runs below its minimum (model-settings.ts).
 *
 * List prices, first-party Claude API, global routing (no inference_geo), USD
 * per million tokens. Sources, checked 2026-11-21:
 * https://platform.claude.com/docs/en/about-claude/pricing and
 * https://platform.claude.com/docs/en/about-claude/models/overview
 * A 5-minute cache write is 1.25× input; cache reads are 0.1× input on Haiku
 * 5.5, 0.05× on Opus 5.5 and Sonnet 5.5 and 0.025× on Fable 5.2. Haiku 5.5
 * costs more above a 100,000-token prompt (the whole request pays it).
 * Fable 5.2 needs the organization's 30-day data retention (no ZDR).
 */
export const AI_MODELS = [
  {
    key: "haiku",
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    rank: 1,
    /** Output cap of one call (maxTokensFor): routine answers stay short. */
    maxTokens: 1024,
    /** Routine work answers without thinking first (accepted at low effort). */
    thinkingOff: true,
    verifiedOn: "2026-11-21",
    price: {
      input: 0.1,
      cacheWrite: 0.125,
      cacheRead: 0.01,
      output: 0.5,
      longPrompt: {
        aboveTokens: 100_000,
        input: 0.5,
        cacheWrite: 0.625,
        cacheRead: 0.05,
        output: 2.5,
      },
    },
  },
  {
    key: "sonnet",
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    rank: 2,
    maxTokens: 4096,
    thinkingOff: false,
    verifiedOn: "2026-11-21",
    price: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  },
  {
    key: "opus",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    rank: 3,
    maxTokens: 16000,
    thinkingOff: false,
    verifiedOn: "2026-11-21",
    price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  },
  {
    key: "fable",
    id: "claude-fable-5-2",
    name: "Claude Fable 5.2",
    rank: 4,
    maxTokens: 16000,
    thinkingOff: false,
    verifiedOn: "2026-11-21",
    price: { input: 8, cacheWrite: 10, cacheRead: 0.2, output: 40 },
  },
] as const satisfies readonly {
  key: string;
  id: string;
  name: string;
  rank: number;
  maxTokens: number;
  thinkingOff: boolean;
  verifiedOn: string;
  price: ModelPrice;
}[];

export type AiModel = (typeof AI_MODELS)[number];
export type AiModelKey = AiModel["key"];
export type AiModelId = AiModel["id"];

/** USD per million tokens by model id (the prices of AI_MODELS). */
export const MODEL_PRICES: Readonly<Record<AiModelId, ModelPrice>> = Object.fromEntries(
  AI_MODELS.map((model) => [model.id, model.price]),
) as Record<AiModelId, ModelPrice>;

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
  /** Monthly price in CZK of the published plan catalog; null for beta. */
  priceCzk: number | null;
  /** Cost per active user, scaled to 30 days. */
  costPerActiveUserCzk: number | null;
  marginCzk: number | null;
  /** Margin as a share of the price, 0–1 (negative when a user costs more than they pay). */
  marginShare: number | null;
};

/** Monthly CZK price per plan key; the published catalog's, or the seed's by default. */
export type PlanPricesCzk = Readonly<Record<string, number>>;

export const SEED_PRICES_CZK: PlanPricesCzk = Object.fromEntries(
  PAID_PLANS.map((plan) => [plan.key, plan.monthly.CZK]),
);

/**
 * Estimated monthly margin per plan: the plan's CZK price against what one
 * active user of it cost, the period scaled to 30 days. The Team plan's
 * price per worker is not included (the worker's costs count on their own).
 */
export function marginByPlan(
  rows: readonly PlanCostInputs[],
  periodDays: number,
  rates: CostRates = COST_RATES,
  prices: PlanPricesCzk = SEED_PRICES_CZK,
): PlanMargin[] {
  const scale = periodDays > 0 ? 30 / periodDays : 0;
  return rows.map((row) => {
    const priceCzk = Object.hasOwn(prices, row.plan) ? prices[row.plan] : null;
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
