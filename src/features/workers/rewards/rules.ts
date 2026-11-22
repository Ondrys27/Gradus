import { z } from "zod";
import { convertAmount, type RateTable } from "@/lib/exchange-rates";
import type { IsoDate } from "@/lib/format";
import { RULE_KINDS, type RewardPlan, type RewardRule, type RuleFilter, type RuleKind } from "./types";

/**
 * The rules of a plan as the owner builds them: what each kind pays, how it
 * reads as a sentence, the templates and the checks (the same as
 * reward_rule_ok() in the database).
 */

export const AMOUNT_MAX = 10_000_000;
export const CAP_MAX = 100_000_000;
export const RULES_PER_PLAN = 30;
export const NOTE_MAX = 300;
export const PLAN_NAME_MAX = 80;

/** How a kind is paid: the price on the task, a share, or a fixed amount (per item, hour, month). */
export type RuleMeasure = "price" | "percent" | "amount";

export function measureOf(kind: RuleKind): RuleMeasure {
  if (kind === "task_fixed") return "price";
  if (kind === "deal_percent") return "percent";
  return "amount";
}

/** Which limits a kind can have. */
export function limitsOf(kind: RuleKind): { cap: boolean; onTime: boolean; minDeal: boolean } {
  return {
    cap: kind !== "monthly_fixed",
    onTime: kind === "task_fixed" || kind === "task_default",
    minDeal: kind === "deal_fixed" || kind === "deal_percent",
  };
}

/** The wizard's first step, grouped the way people think about the work. */
export const RULE_GROUPS: ReadonlyArray<{ key: string; kinds: readonly RuleKind[] }> = [
  { key: "tasks", kinds: ["task_fixed", "task_default", "project_done"] },
  { key: "sales", kinds: ["deal_percent", "deal_fixed"] },
  { key: "calls", kinds: ["per_call", "per_meeting", "per_contact"] },
  { key: "time", kinds: ["hourly", "monthly_fixed"] },
];

export type RuleInput = {
  kind: RuleKind;
  amount: number | null;
  percent: number | null;
  filter: RuleFilter;
  cap_per_period: number | null;
};

export type RuleErrorKey = "amountInvalid" | "percentInvalid" | "capInvalid" | "minDealInvalid";

/** Keeps only what the kind uses: a stray amount, share or limit never reaches the database. */
export function normalizeRule(input: RuleInput): RuleInput {
  const measure = measureOf(input.kind);
  const limits = limitsOf(input.kind);
  const filter: RuleFilter = {};
  if (limits.onTime && input.filter.onTimeOnly) filter.onTimeOnly = true;
  if (limits.minDeal && input.filter.minDealValue !== undefined && input.filter.minDealValue > 0) {
    filter.minDealValue = round2(input.filter.minDealValue);
  }
  return {
    kind: input.kind,
    amount: measure === "amount" && input.amount !== null ? round2(input.amount) : null,
    percent: measure === "percent" && input.percent !== null ? round2(input.percent) : null,
    filter,
    cap_per_period:
      limits.cap && input.cap_per_period !== null ? round2(input.cap_per_period) : null,
  };
}

/** What is wrong with a rule, field by field; empty when the database will take it. */
export function ruleErrors(input: RuleInput): Partial<Record<keyof RuleInput | "minDeal", RuleErrorKey>> {
  const rule = normalizeRule(input);
  const errors: Partial<Record<keyof RuleInput | "minDeal", RuleErrorKey>> = {};
  const measure = measureOf(rule.kind);
  if (measure === "amount" && !(rule.amount !== null && rule.amount > 0 && rule.amount <= AMOUNT_MAX)) {
    errors.amount = "amountInvalid";
  }
  if (measure === "percent" && !(rule.percent !== null && rule.percent > 0 && rule.percent <= 100)) {
    errors.percent = "percentInvalid";
  }
  if (rule.cap_per_period !== null && !(rule.cap_per_period > 0 && rule.cap_per_period <= CAP_MAX)) {
    errors.cap_per_period = "capInvalid";
  }
  if (input.filter.minDealValue !== undefined && !(input.filter.minDealValue >= 0)) {
    errors.minDeal = "minDealInvalid";
  }
  return errors;
}

export const ruleRowSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  worker_id: z.string(),
  kind: z.enum(RULE_KINDS),
  amount: z.coerce.number().nullable(),
  percent: z.coerce.number().nullable(),
  filter: z
    .object({ onTimeOnly: z.boolean().optional(), minDealValue: z.number().optional() })
    .catch({}),
  cap_per_period: z.coerce.number().nullable(),
  active: z.boolean(),
  position: z.number(),
});

/** A stored rule, or null when it is not one this app knows. */
export function parseRule(row: unknown): RewardRule | null {
  const parsed = ruleRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * One rule in words: the main sentence (`workers.rewardPlan.sentence.<kind>`
 * with the amount or share) and its limits (`…limit.*`), e.g. "5 % from
 * won deals, at most 30 000 Kč a month". Numbers only; the caller formats.
 */
export type RuleSentence = {
  key: RuleKind;
  amount: number | null;
  percent: number | null;
  limits: Array<
    | { key: "cap"; value: number }
    | { key: "onTimeOnly" }
    | { key: "minDealValue"; value: number }
  >;
};

export function sentenceOf(rule: Pick<RewardRule, "kind" | "amount" | "percent" | "filter" | "cap_per_period">): RuleSentence {
  const limits: RuleSentence["limits"] = [];
  if (rule.filter.minDealValue !== undefined) {
    limits.push({ key: "minDealValue", value: rule.filter.minDealValue });
  }
  if (rule.filter.onTimeOnly) limits.push({ key: "onTimeOnly" });
  if (rule.cap_per_period !== null) limits.push({ key: "cap", value: rule.cap_per_period });
  return { key: rule.kind, amount: rule.amount, percent: rule.percent, limits };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Whether a plan holds on a day (open ends hold always). */
export function planActiveOn(
  plan: Pick<RewardPlan, "active_from" | "active_to">,
  day: IsoDate,
): boolean {
  return (!plan.active_from || plan.active_from <= day) && (!plan.active_to || plan.active_to >= day);
}

/** What a new task of this person is worth by default: their first active task_default rule. */
export function defaultTaskPrice(plan: RewardPlan | null | undefined): number | null {
  const rule = plan?.rules.find((item) => item.active && item.kind === "task_default");
  return rule?.amount ?? null;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const REWARD_TEMPLATES = ["coldCaller", "salesCommission", "developer", "assistant"] as const;
export type RewardTemplate = (typeof REWARD_TEMPLATES)[number];

type TemplateRule = { kind: RuleKind; eur?: number; percent?: number; capEur?: number; filter?: RuleFilter };

/**
 * The templates' rules. Amounts are a suggestion in EUR, shown in the plan's
 * currency rounded to a nice number (the owner sees and changes them before
 * anything is saved); without a fresh rate the amount stays empty.
 */
const TEMPLATE_RULES: Record<RewardTemplate, TemplateRule[]> = {
  coldCaller: [
    { kind: "per_call", eur: 0.5, capEur: 200 },
    { kind: "per_contact", eur: 2 },
    { kind: "per_meeting", eur: 20 },
  ],
  salesCommission: [
    { kind: "monthly_fixed", eur: 600 },
    { kind: "deal_percent", percent: 5, capEur: 2000 },
  ],
  developer: [
    { kind: "task_fixed" },
    { kind: "project_done", eur: 1500 },
  ],
  assistant: [
    { kind: "hourly", eur: 12 },
    { kind: "task_fixed" },
  ],
};

/** Two significant digits: 123 → 120, 2 480 → 2 500, 0.48 → 0.48. */
export function niceAmount(value: number): number {
  if (!(value > 0)) return 0;
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return round2(Math.round(value / magnitude) * magnitude);
}

/** A template's rules in the plan's currency; amounts without a rate stay empty. */
export function templateRules(
  template: RewardTemplate,
  currency: string,
  rates: RateTable,
  now: Date = new Date(),
): RuleInput[] {
  const inCurrency = (eur: number | undefined) => {
    if (eur === undefined) return null;
    const converted = convertAmount(eur, "EUR", currency, rates, now);
    return converted === null ? null : niceAmount(converted);
  };
  return TEMPLATE_RULES[template].map((rule) =>
    normalizeRule({
      kind: rule.kind,
      amount: inCurrency(rule.eur),
      percent: rule.percent ?? null,
      filter: rule.filter ?? {},
      cap_per_period: inCurrency(rule.capEur),
    }),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
