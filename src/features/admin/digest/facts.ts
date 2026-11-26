/**
 * The daily summary "Gradus včera" to administrators (30.1), without I/O:
 * what one day looked like, what deserves a sentence, whether a day is
 * quiet, and when each administrator gets it. The numbers come from what the
 * administration already counts (server/load-facts.ts); nothing is counted a
 * second way, no model is called.
 */

/** A count of the day with the day before and the same weekday a week before. */
export type DayTrend = { value: number; dayBefore: number; weekAgo: number };

export type DigestRevenue = { currency: string; value: number; dayBefore: number };

export type DigestFacts = {
  /** The reported day, ISO, in the zone of the metrics. */
  day: string;
  newUsers: DayTrend;
  activeUsers: DayTrend;
  money: {
    /** Stripe's test mode: the numbers are the internal accounts' test payments. */
    testMode: boolean;
    /** Per currency (currencies never add up). */
    revenue: DigestRevenue[];
    started: number;
    cancelled: number;
  };
  ai: {
    spentUsd: number;
    dayBeforeUsd: number;
    /** Spend over the day's active users; null without any. */
    perActiveUsd: number | null;
    perActiveDayBeforeUsd: number | null;
  };
  errors: {
    newGroups: number;
    occurrences: number;
    top: { code: string; message: string; occurrences: number }[];
    resolved: number;
  };
  feedback: { reports: number; ideas: number; survey: number };
  /** What waits for an administrator's decision now. */
  waiting: { errors: number; reports: number; payouts: number; draft: number };
  /** Systems that are not fine now (health widget); empty when all is well. */
  health: { key: string; status: "warn" | "bad" }[];
};

/** The parts of the summary only who may see money gets (adminCan "viewMoney"). */
export type DigestAudience = { money: boolean };

/** What the "worth your attention" sentence says, chosen by rules from the numbers. */
export type Attention =
  | { kind: "health"; key: string }
  | { kind: "newErrors"; count: number; code: string }
  | { kind: "signups"; value: number; previous: number; versus: "dayBefore" | "weekAgo" }
  | { kind: "active"; value: number; previous: number; versus: "dayBefore" | "weekAgo" }
  | { kind: "cancelled"; count: number }
  | { kind: "aiCost"; value: number; previous: number }
  | { kind: "reports"; count: number }
  | { kind: "calm" };

/** A change is worth a sentence from this relative size and this absolute size. */
export const CHANGE_MIN_RATIO = 0.25;
export const CHANGE_MIN_ABSOLUTE = 3;

/** -1…∞ relative change, or null when there was nothing before. */
export function relativeChange(value: number, previous: number): number | null {
  if (previous === 0) return value === 0 ? 0 : null;
  return (value - previous) / previous;
}

function biggest(trend: DayTrend): { previous: number; versus: "dayBefore" | "weekAgo"; size: number } | null {
  const options = (["dayBefore", "weekAgo"] as const).map((versus) => {
    const previous = trend[versus];
    const absolute = Math.abs(trend.value - previous);
    const ratio = previous === 0 ? (trend.value === 0 ? 0 : Infinity) : absolute / previous;
    return { previous, versus, absolute, ratio };
  });
  const worth = options.filter(
    (option) => option.absolute >= CHANGE_MIN_ABSOLUTE && option.ratio >= CHANGE_MIN_RATIO,
  );
  if (!worth.length) return null;
  const best = worth.sort((a, b) => b.ratio - a.ratio || b.absolute - a.absolute)[0]!;
  return { previous: best.previous, versus: best.versus, size: Math.min(best.ratio, 10) };
}

/**
 * The one sentence worth reading first, by fixed rules: a system that is
 * broken, new errors, then the largest change of the day (sign-ups, active
 * people, AI cost per active person; cancellations always matter), new
 * reports, otherwise calm. Who may not see money never gets a money reason.
 */
export function attentionOf(facts: DigestFacts, audience: DigestAudience): Attention {
  const broken = facts.health.find((item) => item.status === "bad") ?? facts.health[0];
  if (broken) return { kind: "health", key: broken.key };
  const top = facts.errors.top[0];
  if (facts.errors.newGroups > 0 && top) {
    return { kind: "newErrors", count: facts.errors.newGroups, code: top.code };
  }
  if (audience.money && facts.money.cancelled > 0) {
    return { kind: "cancelled", count: facts.money.cancelled };
  }
  const candidates: { attention: Attention; size: number }[] = [];
  const signups = biggest(facts.newUsers);
  if (signups) {
    candidates.push({
      attention: { kind: "signups", value: facts.newUsers.value, previous: signups.previous, versus: signups.versus },
      size: signups.size,
    });
  }
  const active = biggest(facts.activeUsers);
  if (active) {
    candidates.push({
      attention: { kind: "active", value: facts.activeUsers.value, previous: active.previous, versus: active.versus },
      size: active.size,
    });
  }
  const { perActiveUsd, perActiveDayBeforeUsd } = facts.ai;
  if (audience.money && perActiveUsd !== null && perActiveDayBeforeUsd !== null && perActiveDayBeforeUsd > 0) {
    const change = (perActiveUsd - perActiveDayBeforeUsd) / perActiveDayBeforeUsd;
    // Cents are noise: a sentence only from a cent more per person and a quarter more.
    if (Math.abs(perActiveUsd - perActiveDayBeforeUsd) >= 0.01 && Math.abs(change) >= CHANGE_MIN_RATIO) {
      candidates.push({
        attention: { kind: "aiCost", value: perActiveUsd, previous: perActiveDayBeforeUsd },
        size: Math.min(Math.abs(change), 10),
      });
    }
  }
  const best = candidates.sort((a, b) => b.size - a.size)[0];
  if (best) return best.attention;
  if (facts.feedback.reports > 0) return { kind: "reports", count: facts.feedback.reports };
  return { kind: "calm" };
}

/**
 * Whether the day has something to report, for "only when there is news":
 * new errors, a system not fine now, new reports or ideas, a cancelled
 * subscription (for who sees money). Sign-ups alone are not news, nor is a
 * backlog that was already there the day before.
 */
export function hasNews(facts: DigestFacts, audience: DigestAudience): boolean {
  return (
    facts.errors.newGroups > 0 ||
    facts.health.length > 0 ||
    facts.feedback.reports > 0 ||
    facts.feedback.ideas > 0 ||
    (audience.money && facts.money.cancelled > 0)
  );
}
