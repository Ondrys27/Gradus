import { z } from "zod";
import { convertAmount, type RateTable } from "@/lib/exchange-rates";
import type { IsoDate } from "@/lib/format";
import {
  AMOUNT_MAX,
  CAP_MAX,
  LEGACY_KINDS,
  legacyDefinition,
  newDefinition,
  normalizeDefinition,
  parseDefinition,
  type RuleDefinition,
  type SpaceRefs,
} from "./definition";
import type { RewardPlan, RewardRule } from "./types";

/**
 * The plan around the rules: reading a stored rule, the plan's dates, the
 * default price of a task and the templates (29.1: every rule is an event
 * rule, see definition.ts and catalog.ts).
 */

export { AMOUNT_MAX, CAP_MAX };
export const RULES_PER_PLAN = 30;
export const NOTE_MAX = 300;
export const PLAN_NAME_MAX = 80;

const ruleRowSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  worker_id: z.string(),
  kind: z.string(),
  definition: z.unknown().optional(),
  // A rule of 28.2 (an invite of an older app, a row not converted yet).
  amount: z.coerce.number().nullable().optional(),
  percent: z.coerce.number().nullable().optional(),
  filter: z
    .object({ onTimeOnly: z.boolean().optional(), minDealValue: z.number().optional() })
    .optional()
    .catch({}),
  cap_per_period: z.coerce.number().nullable().optional(),
  active: z.boolean(),
  position: z.number(),
});

/** A stored rule, or null when it is not one this app knows. */
export function parseRule(row: unknown): RewardRule | null {
  const parsed = ruleRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const { kind, definition: raw, amount, percent, filter, cap_per_period, ...rest } = parsed.data;
  let definition: RuleDefinition | null = null;
  if (kind === "event") definition = parseDefinition(raw);
  else if ((LEGACY_KINDS as readonly string[]).includes(kind)) {
    definition = legacyDefinition(
      {
        kind: kind as (typeof LEGACY_KINDS)[number],
        amount: amount ?? null,
        percent: percent ?? null,
        filter: filter ?? {},
        cap_per_period: cap_per_period ?? null,
      },
      {},
    );
  }
  return definition ? { ...rest, definition } : null;
}

/** Whether a plan holds on a day (open ends hold always). */
export function planActiveOn(
  plan: Pick<RewardPlan, "active_from" | "active_to">,
  day: IsoDate,
): boolean {
  return (!plan.active_from || plan.active_from <= day) && (!plan.active_to || plan.active_to >= day);
}

/**
 * What a new task of this person is worth by default: the first active rule
 * paying a fixed amount for any task done (its tiers' first amount).
 */
export function defaultTaskPrice(plan: RewardPlan | null | undefined): number | null {
  for (const rule of plan?.rules ?? []) {
    const { event, reward } = rule.definition;
    if (!rule.active || event.key !== "task.done" || event.taskKinds?.length) continue;
    if (reward.type === "fixed") return reward.amount;
    if (reward.type === "tiers") return reward.tiers[0]?.amount ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const REWARD_TEMPLATES = ["coldCaller", "salesCommission", "developer", "assistant"] as const;
export type RewardTemplate = (typeof REWARD_TEMPLATES)[number];

/** Two significant digits: 123 → 120, 2 480 → 2 500, 0.48 → 0.48. */
export function niceAmount(value: number): number {
  if (!(value > 0)) return 0;
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(Math.round(value / magnitude) * magnitude * 100) / 100;
}

/** The id of a system table of the space ("Meeting scheduled"), or none. */
function tableId(refs: SpaceRefs, key: string): string[] {
  const table = refs.tables.find((item) => item.system_key === key);
  return table ? [table.id] : [];
}

/**
 * A template's rules in the plan's currency. Amounts are a suggestion in
 * EUR rounded to a nice number in the plan's currency (empty without a
 * fresh rate); the owner sees and changes them before anything is saved.
 * Cold caller since 29.1: any move into "Meeting scheduled", only the
 * first time per contact.
 */
export function templateRules(
  template: RewardTemplate,
  currency: string,
  rates: RateTable,
  refs: SpaceRefs,
  now: Date = new Date(),
): RuleDefinition[] {
  const money = (eur: number) => {
    const converted = convertAmount(eur, "EUR", currency, rates, now);
    return converted === null ? 0 : niceAmount(converted);
  };
  const withCap = (definition: RuleDefinition, eur: number) => {
    const cap = money(eur);
    return cap > 0 ? { ...definition, limits: { ...definition.limits, cap } } : definition;
  };
  const rules: RuleDefinition[] = [];
  switch (template) {
    case "coldCaller": {
      const call = newDefinition("contact.moved", money(0.5));
      call.event.from = { mode: "only", ids: [...tableId(refs, "unreached"), ...tableId(refs, "no_answer")] };
      call.event.to = { mode: "any", ids: [] };
      call.conditions.once = false;
      rules.push(withCap(call, 200));
      const meeting = newDefinition("contact.moved", money(20));
      meeting.event.to = { mode: "only", ids: tableId(refs, "meeting_scheduled") };
      rules.push(meeting);
      break;
    }
    case "salesCommission": {
      rules.push(newDefinition("time.month", money(600)));
      const share = newDefinition("deal.won");
      share.reward = { type: "percent", percent: 5 };
      rules.push(withCap(share, 2000));
      break;
    }
    case "developer": {
      rules.push({ ...newDefinition("task.done"), reward: { type: "price" } });
      rules.push(newDefinition("milestone.done", money(1500)));
      break;
    }
    case "assistant": {
      rules.push(newDefinition("time.hour", money(12)));
      rules.push({ ...newDefinition("task.done"), reward: { type: "price" } });
      break;
    }
  }
  return rules.map(normalizeDefinition);
}
