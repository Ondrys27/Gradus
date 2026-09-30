import { subDays } from "date-fns";
import { toZonedWallClock } from "@/lib/format";
import type { Json } from "@/types/database";

/** A deal that stays in one stage longer than this is worth a nudge. */
export const STALLED_AFTER_DAYS = 14;
/** The window the win rate looks at. */
export const WIN_RATE_DAYS = 90;
/** Points of the win-rate sparkline. */
export const SPARKLINE_POINTS = 12;

export type GreetingPart = "night" | "morning" | "afternoon" | "evening";

/** Part of the day by the wall clock in the user's zone, never UTC. */
export function greetingPart(now: Date, timeZone: string): GreetingPart {
  const hour = toZonedWallClock(now, timeZone).getHours();
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export type DayCounts = { tasks: number; events: number; followUps: number; deals: number };
export const DAY_PARTS = ["tasks", "events", "followUps", "deals"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** What the day holds, in the order the sentence names it. Empty parts are left out. */
export function daySummaryParts(counts: DayCounts): { part: DayPart; count: number }[] {
  return DAY_PARTS.flatMap((part) => (counts[part] > 0 ? [{ part, count: counts[part] }] : []));
}

/** Moment before which a deal has been standing in its stage for too long. */
export function stalledCutoff(now: Date, days = STALLED_AFTER_DAYS): string {
  return subDays(now, days).toISOString();
}

/** Share of today's tasks done, null while nothing is due today (so 0 % never reads as "none"). */
export function taskCompletionRate(done: number, total: number): number | null {
  return total > 0 ? done / total : null;
}

export type Direction = "up" | "down" | "same";

/** This period against the one before, in the same unit; cents do not count as a change. */
export function compareToPrevious(
  current: number,
  previous: number,
): { direction: Direction; difference: number } {
  const difference = Math.round(Math.abs(current - previous) * 100) / 100;
  if (difference === 0) return { direction: "same", difference: 0 };
  return { direction: current > previous ? "up" : "down", difference };
}

export type ClosedDeal = { won_at: string | null; lost_at: string | null };

function closedAt(deal: ClosedDeal): number | null {
  const value = deal.won_at ?? deal.lost_at;
  return value ? Date.parse(value) : null;
}

export type WinRate = { won: number; lost: number; rate: number | null };

/** Won out of closed. `rate` is null while nothing has closed, so 0 % never means "no data". */
export function winRate(deals: ClosedDeal[], since?: number): WinRate {
  let won = 0;
  let lost = 0;
  for (const deal of deals) {
    const at = closedAt(deal);
    if (at === null || (since !== undefined && at < since)) continue;
    if (deal.won_at) won += 1;
    else lost += 1;
  }
  const closed = won + lost;
  return { won, lost, rate: closed ? won / closed : null };
}

/**
 * The win rate as it stood at evenly spaced moments of the window (a running
 * figure over deals closed so far), null before the first deal closed.
 */
export function winRateSeries(
  deals: ClosedDeal[],
  now: Date,
  days = WIN_RATE_DAYS,
  points = SPARKLINE_POINTS,
): (number | null)[] {
  const end = now.getTime();
  const start = subDays(now, days).getTime();
  const inWindow = deals.filter((deal) => {
    const at = closedAt(deal);
    return at !== null && at >= start && at <= end;
  });
  return Array.from({ length: points }, (_, index) => {
    const until = start + Math.round(((index + 1) * (end - start)) / points);
    let won = 0;
    let closed = 0;
    for (const deal of inWindow) {
      if ((closedAt(deal) as number) > until) continue;
      closed += 1;
      if (deal.won_at) won += 1;
    }
    return closed ? won / closed : null;
  });
}

/** Answers are kept as `{ "<field id>": value }`; anything else counts as unanswered. */
function answerOf(answers: Json, fieldId: string): unknown {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return undefined;
  return answers[fieldId];
}

/**
 * Entries of the follow-up table whose date-and-time answer falls before the end
 * of the day, overdue ones included, earliest first.
 */
export function dueFollowUps<T extends { answers: Json }>(
  entries: T[],
  fieldId: string | null,
  dayEnd: Date,
): (T & { dueAt: Date })[] {
  if (!fieldId) return [];
  const due: (T & { dueAt: Date })[] = [];
  for (const entry of entries) {
    const value = answerOf(entry.answers, fieldId);
    if (typeof value !== "string") continue;
    const time = Date.parse(value);
    if (Number.isNaN(time) || time >= dayEnd.getTime()) continue;
    due.push({ ...entry, dueAt: new Date(time) });
  }
  return due.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
