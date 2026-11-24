import { capped } from "./engine";
import { EVENT_CATALOG, type RewardEvent, type TaskKind, type Via } from "./catalog";
import { onceOf, tierAmount, whoOf, type RuleDefinition } from "./definition";

/**
 * Whether a rule pays an event and how much: the TypeScript side of
 * reward_rule_matches(), reward_rule_amount() and the counting in
 * supabase/migrations/20261205090000_reward_event_rules.sql. The database
 * runs the real thing; "Try it" runs simulate() over the worker's real
 * events of the last 30 days (reward_history()), nothing is written.
 */

/** One thing that happened, as reward_history() and the triggers describe it. */
export type EventSubject = {
  event: RewardEvent;
  at: string;
  source_kind: string;
  source_id: string;
  /** What "only the first time" counts on (a contact, a deal), or the record itself. */
  subject_id: string | null;
  /** The worker did it. */
  did: boolean;
  /** The worker is on the record (on the deal, the task is theirs). */
  on_record: boolean;
  via?: Via | null;
  from_id?: string | null;
  to_id?: string | null;
  value?: number | null;
  currency?: string | null;
  units?: number | null;
  tags?: string[] | null;
  task_kind?: TaskKind | null;
  on_time?: boolean | null;
  priced?: boolean | null;
  price?: number | null;
  price_currency?: string | null;
  has_phone?: boolean | null;
  has_email?: boolean | null;
  /** Leaving the meeting table (a meeting from a call taken back). */
  undo?: boolean | null;
  note?: string | null;
};

export type MatchContext = { planCurrency: string; timeZone: string };

/** The day of an instant in a time zone, YYYY-MM-DD. */
export function dayIn(at: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const lower = (items: readonly string[] | null | undefined) => (items ?? []).map((item) => item.toLowerCase());

/** All conditions of the rule hold for the event. */
export function ruleMatches(definition: RuleDefinition, subject: EventSubject, ctx: MatchContext): boolean {
  const { event, conditions, reward } = definition;
  if (event.key !== subject.event || subject.undo) return false;
  const who = whoOf(definition);
  if (who === "self" ? !subject.did : !subject.on_record) return false;

  if (event.from && event.from.mode !== "any") {
    const inside = subject.from_id ? event.from.ids.includes(subject.from_id) : false;
    if (event.from.mode === "only" ? !inside : inside) return false;
  }
  if (event.to?.mode === "only" && !(subject.to_id && event.to.ids.includes(subject.to_id))) return false;
  if (event.via && subject.via && !event.via.includes(subject.via)) return false;
  if (event.onTime && subject.on_time === false) return false;
  if (event.taskKinds?.length && !(subject.task_kind && event.taskKinds.includes(subject.task_kind))) return false;
  if (subject.priced !== undefined && subject.priced !== null && (reward.type === "price") !== subject.priced) {
    return false;
  }
  if (event.require && event.require !== "none") {
    const phone = Boolean(subject.has_phone);
    const email = Boolean(subject.has_email);
    const ok = event.require === "phone" ? phone : event.require === "email" ? email : phone || email;
    if (!ok) return false;
  }

  const range = conditions.value;
  if (range && (range.min !== undefined || range.max !== undefined)) {
    // A range in the plan's currency compares only an amount in the same currency.
    if (subject.currency !== ctx.planCurrency) return false;
    const value = subject.value ?? 0;
    if (range.min !== undefined && value < range.min) return false;
    if (range.max !== undefined && value > range.max) return false;
  }
  if (conditions.tags?.length) {
    const tags = lower(subject.tags);
    if (!lower(conditions.tags).some((tag) => tags.includes(tag))) return false;
  }
  if (conditions.window) {
    const day = dayIn(subject.at, ctx.timeZone);
    if (conditions.window.from && day < conditions.window.from) return false;
    if (conditions.window.to && day > conditions.window.to) return false;
  }
  return true;
}

export type RuleAmount = { amount: number; currency: string; cap: number | null };

/**
 * What the rule pays for the event before the monthly cap: a fixed amount, a
 * share of the value (in its currency; the cap counts only in the plan's), an
 * amount per unit, the tier of the nth event of the month, or the task's own
 * price. Null when there is nothing to pay (a share of nothing).
 */
export function ruleAmount(
  definition: RuleDefinition,
  subject: EventSubject,
  ctx: MatchContext,
  nth: number,
): RuleAmount | null {
  const { reward, limits } = definition;
  const cap = limits.cap ?? null;
  switch (reward.type) {
    case "fixed":
      return { amount: reward.amount, currency: ctx.planCurrency, cap };
    case "unit":
      return {
        amount: Math.round(reward.amount * (subject.units ?? 0) * 100) / 100,
        currency: ctx.planCurrency,
        cap,
      };
    case "tiers":
      return { amount: tierAmount(reward.tiers, nth), currency: ctx.planCurrency, cap };
    case "percent": {
      const value = subject.value ?? 0;
      if (!(value > 0) || !subject.currency) return null;
      return {
        amount: Math.round(value * reward.percent) / 100,
        currency: subject.currency,
        cap: subject.currency === ctx.planCurrency ? cap : null,
      };
    }
    case "price":
      if (subject.price === null || subject.price === undefined) return null;
      return { amount: subject.price, currency: subject.price_currency ?? ctx.planCurrency, cap };
  }
}

/** The month of an instant in the space's zone, YYYY-MM. */
const monthIn = (at: string, timeZone: string) => dayIn(at, timeZone).slice(0, 7);

export type SimulatedEntry = {
  at: string;
  event: RewardEvent;
  note: string | null;
  amount: number;
  currency: string;
  bonus: boolean;
};

export type Simulation = {
  /** Events the rule paid (bonuses aside). */
  count: number;
  totals: Array<{ currency: string; amount: number }>;
  /** The first paid events, oldest first, bonuses included. */
  first: SimulatedEntry[];
};

export const PREVIEW_FIRST = 10;

/**
 * A dry run of one rule over events in time order, as the engine would have
 * paid them: once per contact or deal, counted and capped per month, a bonus
 * when the month's count reaches it, and a move back cancelling the last
 * reward of that contact or deal (when the rule cancels).
 */
export function simulate(
  definition: RuleDefinition,
  subjects: readonly EventSubject[],
  ctx: MatchContext,
  firstLimit = PREVIEW_FIRST,
): Simulation {
  const spec = EVENT_CATALOG[definition.event.key];
  const once = onceOf(definition);
  const paid: Array<SimulatedEntry & { subject: string | null; month: string }> = [];
  const seen = new Set<string>();
  const sorted = [...subjects].sort((a, b) => a.at.localeCompare(b.at));
  const bonusMonths = new Set<string>();

  const earnedIn = (month: string) => paid.filter((entry) => !entry.bonus && entry.month === month);

  for (const subject of sorted) {
    if (subject.event !== definition.event.key) continue;
    if (definition.undo === "cancel" && spec.undoable && leaves(definition, subject)) {
      const index = findLastIndex(paid, (entry) => !entry.bonus && entry.subject === subject.subject_id);
      if (index >= 0) {
        const [removed] = paid.splice(index, 1);
        if (removed && once && removed.subject) seen.delete(removed.subject);
      }
      continue;
    }
    if (!ruleMatches(definition, subject, ctx)) continue;
    if (once && subject.subject_id && seen.has(subject.subject_id)) continue;
    const month = monthIn(subject.at, ctx.timeZone);
    const earned = earnedIn(month);
    const amount = ruleAmount(definition, subject, ctx, earned.length + 1);
    if (!amount) continue;
    const used = earned
      .filter((entry) => entry.currency === amount.currency)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const value = Math.round(capped(amount.amount, amount.cap, used) * 100) / 100;
    if (value <= 0) continue;
    if (once && subject.subject_id) seen.add(subject.subject_id);
    paid.push({
      at: subject.at,
      event: subject.event,
      note: subject.note ?? null,
      amount: value,
      currency: amount.currency,
      bonus: false,
      subject: subject.subject_id,
      month,
    });
    const bonus = definition.limits.bonus;
    if (bonus && !bonusMonths.has(month) && earnedIn(month).length >= bonus.count) {
      bonusMonths.add(month);
      paid.push({
        at: subject.at,
        event: subject.event,
        note: null,
        amount: bonus.amount,
        currency: ctx.planCurrency,
        bonus: true,
        subject: null,
        month,
      });
    }
  }

  const totals = new Map<string, number>();
  for (const entry of paid) totals.set(entry.currency, Math.round(((totals.get(entry.currency) ?? 0) + entry.amount) * 100) / 100);
  return {
    count: paid.filter((entry) => !entry.bonus).length,
    totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
    first: paid.slice(0, firstLimit).map((entry) => ({
      at: entry.at,
      event: entry.event,
      note: entry.note,
      amount: entry.amount,
      currency: entry.currency,
      bonus: entry.bonus,
    })),
  };
}

/** A move that takes the subject out of the rule's "to" (or a meeting from a call taken back). */
export function leaves(definition: RuleDefinition, subject: EventSubject): boolean {
  if (subject.undo) {
    return definition.event.key === "meeting.booked" && (definition.event.via ?? []).includes("calls");
  }
  const to = definition.event.to;
  if (!to || to.mode !== "only" || !subject.from_id) return false;
  return to.ids.includes(subject.from_id) && !(subject.to_id && to.ids.includes(subject.to_id));
}

function findLastIndex<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i;
  return -1;
}

/** Where a bonus stands this month: "7 of 10 meetings". */
export function bonusProgress(
  definition: RuleDefinition,
  entries: ReadonlyArray<{ rule_id: string | null; source_kind: string; amount: number; status: string; corrects_id: string | null }>,
  ruleId: string,
): { done: number; goal: number; reached: boolean } | null {
  const bonus = definition.limits.bonus;
  if (!bonus) return null;
  const done = entries.filter(
    (entry) =>
      entry.rule_id === ruleId &&
      entry.source_kind !== "bonus" &&
      entry.corrects_id === null &&
      entry.amount > 0 &&
      (entry.status === "pending" || entry.status === "approved" || entry.status === "paid"),
  ).length;
  return { done: Math.min(done, bonus.count), goal: bonus.count, reached: done >= bonus.count };
}
