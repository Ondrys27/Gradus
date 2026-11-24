import { z } from "zod";
import {
  CONTACT_REQUIRES,
  EVENT_CATALOG,
  REWARD_EVENTS,
  TASK_KINDS,
  VIAS,
  WHO,
  type RewardEvent,
  type RewardType,
  type Who,
} from "./catalog";

/**
 * A rule of a plan (29.1): { event, conditions, reward } as JSON in
 * reward_plan_rules.definition. The same checks run in the database
 * (reward_definition_ok()); the engine there reads exactly these fields.
 * Tables and stages are kept by id, so a rule survives a rename; one whose
 * table or stage is gone "needs an edit" (computed, never stored).
 */

export const AMOUNT_MAX = 10_000_000;
export const CAP_MAX = 100_000_000;
export const VALUE_MAX = 1_000_000_000;
export const IDS_MAX = 50;
export const TAGS_MAX = 10;
export const TAG_MAX = 50;
export const TIERS_MAX = 10;
export const TIER_FROM_MAX = 10_000;
export const BONUS_COUNT_MAX = 1000;

const money = z.number().finite();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const rewardSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amount: money }),
  z.object({ type: z.literal("percent"), percent: money }),
  z.object({ type: z.literal("unit"), amount: money }),
  z.object({
    type: z.literal("tiers"),
    tiers: z.array(z.object({ from: z.number().int(), amount: money })).max(TIERS_MAX),
  }),
  z.object({ type: z.literal("price") }),
]);
export type RuleReward = z.infer<typeof rewardSchema>;

export const definitionSchema = z.object({
  event: z.object({
    key: z.enum(REWARD_EVENTS),
    from: z.object({ mode: z.enum(["any", "only", "except"]), ids: z.array(uuid).max(IDS_MAX) }).optional(),
    to: z.object({ mode: z.enum(["any", "only"]), ids: z.array(uuid).max(IDS_MAX) }).optional(),
    via: z.array(z.enum(VIAS)).optional(),
    onTime: z.boolean().optional(),
    taskKinds: z.array(z.enum(TASK_KINDS)).optional(),
    require: z.enum(CONTACT_REQUIRES).optional(),
  }),
  conditions: z.object({
    who: z.enum(WHO).optional(),
    value: z.object({ min: money.optional(), max: money.optional() }).optional(),
    tags: z.array(z.string()).max(TAGS_MAX).optional(),
    once: z.boolean().optional(),
    window: z.object({ from: isoDay.optional(), to: isoDay.optional() }).optional(),
  }),
  reward: rewardSchema,
  limits: z.object({
    cap: money.optional(),
    bonus: z.object({ count: z.number().int(), amount: money }).optional(),
  }),
  stack: z.enum(["sum", "max"]),
  undo: z.enum(["cancel", "keep"]),
});
export type RuleDefinition = z.infer<typeof definitionSchema>;
export type MoveSide = NonNullable<RuleDefinition["event"]["from"]>;

/** A stored definition, or null when it is not one this app knows. */
export function parseDefinition(value: unknown): RuleDefinition | null {
  const parsed = definitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The rule's "who", with the event's default. */
export function whoOf(definition: RuleDefinition): Who {
  return definition.conditions.who ?? EVENT_CATALOG[definition.event.key].who[0]!;
}

/** "Only the first time" with its default: on wherever the event has something to count it on. */
export function onceOf(definition: RuleDefinition): boolean {
  if (!EVENT_CATALOG[definition.event.key].once) return false;
  return definition.conditions.once ?? true;
}

/** A new rule for an event with the defaults: from anywhere, first time only, cancelled when undone. */
export function newDefinition(event: RewardEvent, amount: number | null = null): RuleDefinition {
  const spec = EVENT_CATALOG[event];
  const reward: RuleReward =
    spec.rewards[0] === "unit"
      ? { type: "unit", amount: amount ?? 0 }
      : { type: "fixed", amount: amount ?? 0 };
  return normalizeDefinition({
    event: {
      key: event,
      ...(spec.move ? { from: { mode: "any", ids: [] }, to: { mode: "only", ids: [] } } : {}),
      ...(spec.via ? { via: [...spec.via] } : {}),
      ...(spec.require ? { require: "none" } : {}),
    },
    conditions: { ...(spec.once ? { once: true } : {}) },
    reward,
    limits: {},
    stack: "sum",
    undo: "cancel",
  });
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const uniq = <T,>(items: readonly T[]) => [...new Set(items)];

/**
 * Keeps only what the event uses: a stray range, tag or table never reaches
 * the database, amounts on haléře, sets without duplicates. The database
 * refuses what this would drop.
 */
export function normalizeDefinition(input: RuleDefinition): RuleDefinition {
  const key = input.event.key;
  const spec = EVENT_CATALOG[key];
  const event: RuleDefinition["event"] = { key };
  if (spec.move) {
    const from = input.event.from ?? { mode: "any", ids: [] };
    const to = input.event.to ?? { mode: "only", ids: [] };
    event.from = { mode: from.mode, ids: from.mode === "any" ? [] : uniq(from.ids) };
    event.to = { mode: to.mode, ids: to.mode === "any" ? [] : uniq(to.ids) };
  }
  if (spec.via) {
    const via = uniq((input.event.via ?? [...spec.via]).filter((item) => spec.via!.includes(item)));
    event.via = via.length ? via : [...spec.via];
  }
  if (spec.task) {
    if (input.event.onTime) event.onTime = true;
    const kinds = uniq(input.event.taskKinds ?? []);
    if (kinds.length && kinds.length < TASK_KINDS.length) event.taskKinds = kinds;
  }
  if (spec.require) event.require = input.event.require ?? "none";

  const conditions: RuleDefinition["conditions"] = {};
  const who = input.conditions.who;
  if (who && spec.who.includes(who) && who !== spec.who[0]) conditions.who = who;
  if (spec.value && input.conditions.value) {
    const { min, max } = input.conditions.value;
    const value: { min?: number; max?: number } = {};
    if (min !== undefined && Number.isFinite(min)) value.min = round2(min);
    if (max !== undefined && Number.isFinite(max)) value.max = round2(max);
    if (value.min !== undefined || value.max !== undefined) conditions.value = value;
  }
  if (spec.tags && input.conditions.tags?.length) {
    const tags = uniq(input.conditions.tags.map((tag) => tag.trim()).filter(Boolean));
    if (tags.length) conditions.tags = tags;
  }
  if (spec.once) conditions.once = input.conditions.once ?? true;
  const window = input.conditions.window;
  if (window && (window.from || window.to)) {
    conditions.window = { ...(window.from ? { from: window.from } : {}), ...(window.to ? { to: window.to } : {}) };
  }

  let reward: RuleReward = input.reward;
  if (!spec.rewards.includes(reward.type)) reward = { type: spec.rewards[0] === "unit" ? "unit" : "fixed", amount: 0 };
  if (reward.type === "fixed" || reward.type === "unit") reward = { type: reward.type, amount: round2(reward.amount) };
  if (reward.type === "percent") reward = { type: "percent", percent: round2(reward.percent) };
  if (reward.type === "tiers") {
    reward = {
      type: "tiers",
      tiers: [...reward.tiers]
        .map((tier) => ({ from: Math.round(tier.from), amount: round2(tier.amount) }))
        .sort((a, b) => a.from - b.from),
    };
  }

  const limits: RuleDefinition["limits"] = {};
  if (spec.cap && input.limits.cap !== undefined && input.limits.cap !== null) limits.cap = round2(input.limits.cap);
  if (spec.counted && input.limits.bonus) {
    limits.bonus = { count: Math.round(input.limits.bonus.count), amount: round2(input.limits.bonus.amount) };
  }

  return {
    event,
    conditions,
    reward,
    limits,
    stack: input.stack === "max" ? "max" : "sum",
    undo: spec.undoable && input.undo === "keep" ? "keep" : "cancel",
  };
}

export type DefinitionError =
  | "amountInvalid"
  | "percentInvalid"
  | "tiersInvalid"
  | "capInvalid"
  | "bonusInvalid"
  | "valueInvalid"
  | "tagsInvalid"
  | "windowInvalid"
  | "fromEmpty"
  | "toEmpty"
  | "viaEmpty"
  | "rewardInvalid";

const amountOk = (value: number) => Number.isFinite(value) && value > 0 && value <= AMOUNT_MAX;

/** What is wrong with a rule; empty when the database will take it. */
export function definitionErrors(input: RuleDefinition): DefinitionError[] {
  const definition = normalizeDefinition(input);
  const spec = EVENT_CATALOG[definition.event.key];
  const errors: DefinitionError[] = [];
  const { reward, limits, conditions, event } = definition;
  if (!spec.rewards.includes(reward.type)) errors.push("rewardInvalid");
  if ((reward.type === "fixed" || reward.type === "unit") && !amountOk(reward.amount)) errors.push("amountInvalid");
  if (reward.type === "percent" && !(reward.percent > 0 && reward.percent <= 100)) errors.push("percentInvalid");
  if (reward.type === "tiers" && !tiersOk(reward.tiers)) errors.push("tiersInvalid");
  if (limits.cap !== undefined && !(limits.cap > 0 && limits.cap <= CAP_MAX)) errors.push("capInvalid");
  if (
    limits.bonus &&
    !(limits.bonus.count >= 1 && limits.bonus.count <= BONUS_COUNT_MAX && amountOk(limits.bonus.amount))
  ) {
    errors.push("bonusInvalid");
  }
  const value = conditions.value;
  if (
    value &&
    ((value.min !== undefined && !(value.min >= 0 && value.min <= VALUE_MAX)) ||
      (value.max !== undefined && !(value.max > 0 && value.max <= VALUE_MAX)) ||
      (value.min !== undefined && value.max !== undefined && value.max < value.min))
  ) {
    errors.push("valueInvalid");
  }
  if (conditions.tags && conditions.tags.some((tag) => tag.length > TAG_MAX)) errors.push("tagsInvalid");
  const window = conditions.window;
  if (window?.from && window.to && window.to < window.from) errors.push("windowInvalid");
  if (event.from && event.from.mode !== "any" && event.from.ids.length === 0) errors.push("fromEmpty");
  if (event.to && event.to.mode === "only" && event.to.ids.length === 0) errors.push("toEmpty");
  if (event.via && event.via.length === 0) errors.push("viaEmpty");
  return errors;
}

export function tiersOk(tiers: ReadonlyArray<{ from: number; amount: number }>): boolean {
  if (tiers.length < 2 || tiers.length > TIERS_MAX || tiers[0]!.from !== 1) return false;
  return tiers.every(
    (tier, index) =>
      Number.isInteger(tier.from) &&
      tier.from <= TIER_FROM_MAX &&
      amountOk(tier.amount) &&
      (index === 0 || tier.from > tiers[index - 1]!.from),
  );
}

/** The amount of the nth event of a month on tiers (the highest tier that has started). */
export function tierAmount(tiers: ReadonlyArray<{ from: number; amount: number }>, nth: number): number {
  let amount = tiers[0]?.amount ?? 0;
  for (const tier of tiers) if (tier.from <= nth) amount = tier.amount;
  return amount;
}

// ---------------------------------------------------------------------------
// Tables and stages of the space
// ---------------------------------------------------------------------------

/** What the rule may point at in the space: contact tables and pipeline stages by id. */
export type SpaceRefs = {
  tables: ReadonlyArray<{ id: string; name: string; system_key: string | null }>;
  stages: ReadonlyArray<{ id: string; name: string; system_key?: string | null; is_won?: boolean; is_lost?: boolean }>;
};

/** The ids a rule points at that the space no longer has: it needs an edit. */
export function missingRefs(definition: RuleDefinition, refs: SpaceRefs): string[] {
  const move = EVENT_CATALOG[definition.event.key].move;
  if (!move) return [];
  const known = new Set((move === "tables" ? refs.tables : refs.stages).map((item) => item.id));
  return [...(definition.event.from?.ids ?? []), ...(definition.event.to?.ids ?? [])].filter(
    (id) => !known.has(id),
  );
}

export function needsReview(definition: RuleDefinition, refs: SpaceRefs | null): boolean {
  return refs !== null && missingRefs(definition, refs).length > 0;
}

// ---------------------------------------------------------------------------
// The kinds of 28.2 as rules (the same as reward_legacy_definition())
// ---------------------------------------------------------------------------

export const LEGACY_KINDS = [
  "task_fixed",
  "task_default",
  "project_done",
  "per_meeting",
  "per_call",
  "per_contact",
  "deal_percent",
  "deal_fixed",
  "hourly",
  "monthly_fixed",
] as const;
export type LegacyKind = (typeof LEGACY_KINDS)[number];

export type LegacyRule = {
  kind: LegacyKind;
  amount: number | null;
  percent: number | null;
  filter: { onTimeOnly?: boolean; minDealValue?: number };
  cap_per_period: number | null;
};

/**
 * What a rule of 28.2 becomes, so the same events pay the same: the fixed
 * kinds are events with the conditions they always had. Calls, contacts and
 * meetings point at the space's system tables (by id from `systemTables`).
 * Moving back never cancelled anything then, so it does not now ("keep").
 */
export function legacyDefinition(
  rule: LegacyRule,
  systemTables: Partial<Record<"unreached" | "no_answer" | "interested" | "meeting_scheduled", string>>,
): RuleDefinition {
  const amount = rule.amount ?? 0;
  const cap = rule.cap_per_period ?? undefined;
  const limits = cap !== undefined ? { cap } : {};
  const base = { stack: "sum" as const, undo: "keep" as const };
  const ids = (...keys: Array<keyof typeof systemTables>) =>
    keys.flatMap((key) => (systemTables[key] ? [systemTables[key]!] : []));
  const minDeal = rule.filter.minDealValue !== undefined ? { value: { min: rule.filter.minDealValue } } : {};
  switch (rule.kind) {
    case "task_fixed":
      return {
        event: { key: "task.done", ...(rule.filter.onTimeOnly ? { onTime: true } : {}) },
        conditions: {},
        reward: { type: "price" },
        limits,
        ...base,
      };
    case "task_default":
      return {
        event: { key: "task.done", ...(rule.filter.onTimeOnly ? { onTime: true } : {}) },
        conditions: {},
        reward: { type: "fixed", amount },
        limits,
        ...base,
      };
    case "project_done":
      return { event: { key: "milestone.done" }, conditions: {}, reward: { type: "fixed", amount }, limits, ...base };
    case "per_meeting":
      return {
        event: { key: "meeting.booked", via: ["calls", "scheduler"] },
        conditions: { once: true },
        reward: { type: "fixed", amount },
        limits,
        ...base,
      };
    case "per_call":
      return {
        event: {
          key: "contact.moved",
          from: { mode: "only", ids: ids("unreached", "no_answer") },
          to: { mode: "any", ids: [] },
        },
        conditions: { once: false },
        reward: { type: "fixed", amount },
        limits,
        ...base,
      };
    case "per_contact":
      return {
        event: {
          key: "contact.moved",
          from: { mode: "any", ids: [] },
          to: { mode: "only", ids: ids("interested", "meeting_scheduled") },
        },
        conditions: { once: true },
        reward: { type: "fixed", amount },
        limits,
        ...base,
      };
    case "deal_percent":
      return {
        event: { key: "deal.won" },
        conditions: minDeal,
        reward: { type: "percent", percent: rule.percent ?? 0 },
        limits,
        ...base,
      };
    case "deal_fixed":
      return { event: { key: "deal.won" }, conditions: minDeal, reward: { type: "fixed", amount }, limits, ...base };
    case "hourly":
      return { event: { key: "time.hour" }, conditions: {}, reward: { type: "unit", amount }, limits, ...base };
    case "monthly_fixed":
      return { event: { key: "time.month" }, conditions: {}, reward: { type: "fixed", amount }, limits: {}, ...base };
  }
}

// ---------------------------------------------------------------------------
// Two rules on the same event
// ---------------------------------------------------------------------------

const sideAllows = (side: MoveSide | undefined, id: string) =>
  !side || side.mode === "any" || (side.mode === "only" ? side.ids.includes(id) : !side.ids.includes(id));

/** Whether two sides of a move can both hold for some table (any id they name, or any other). */
function sidesMeet(a: MoveSide | undefined, b: MoveSide | undefined): boolean {
  if (!a || !b || a.mode === "any" || b.mode === "any") return true;
  if (a.mode === "only") return a.ids.some((id) => sideAllows(b, id));
  if (b.mode === "only") return b.ids.some((id) => sideAllows(a, id));
  // Both "except": some other table is left for both.
  return true;
}

const meet = <T,>(a: readonly T[] | undefined, b: readonly T[] | undefined) =>
  !a || !b || a.length === 0 || b.length === 0 || a.some((item) => b.includes(item));

/**
 * Whether one event can pay by both rules: the same event, sides of a move
 * that meet, the same sources of a meeting, kinds of task, and both paying
 * the task's price or neither. Conditions (value, tags, dates) are left
 * aside: the owner is warned when both can pay, not only when both will.
 */
export function rulesOverlap(a: RuleDefinition, b: RuleDefinition): boolean {
  if (a.event.key !== b.event.key) return false;
  if (a.event.key === "time.month") return true;
  if (!sidesMeet(a.event.from, b.event.from) || !sidesMeet(a.event.to, b.event.to)) return false;
  if (!meet(a.event.via, b.event.via) || !meet(a.event.taskKinds, b.event.taskKinds)) return false;
  if ((a.reward.type === "price") !== (b.reward.type === "price")) return false;
  return true;
}

/** The pairs of active rules of a plan that can pay the same event. */
export function overlappingPairs<R extends { id: string; active: boolean; definition: RuleDefinition }>(
  rules: readonly R[],
): Array<[R, R]> {
  const active = rules.filter((rule) => rule.active);
  const pairs: Array<[R, R]> = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (rulesOverlap(active[i]!.definition, active[j]!.definition)) pairs.push([active[i]!, active[j]!]);
    }
  }
  return pairs;
}

/** The reward types the event allows, for the picker. */
export function rewardTypesOf(event: RewardEvent): readonly RewardType[] {
  return EVENT_CATALOG[event].rewards;
}
