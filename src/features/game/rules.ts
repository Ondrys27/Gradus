/**
 * The rules of the game, as pure functions. The database decides every XP
 * award (award_xp() in supabase/migrations/20261003090000_game_core.sql);
 * these mirror its numbers so the interface can show progress, caps and
 * levels without a round trip, and so the rules are covered by tests. A
 * PGlite test checks that the two agree.
 */

export const MAX_LEVEL = 30;

/** Total XP needed to reach a level: round(120 · n^1.6); level 1 starts at 0. */
export function xpForLevel(level: number): number {
  const n = Math.min(MAX_LEVEL, Math.floor(level));
  if (n <= 1) return 0;
  return Math.round(120 * Math.pow(n, 1.6));
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= totalXp) level++;
  return level;
}

export type LevelProgress = {
  level: number;
  /** XP earned since this level started. */
  xpIntoLevel: number;
  /** XP between this level and the next; 0 at the top level. */
  xpForNextLevel: number;
  /** 0–1 towards the next level; 1 at the top level. */
  ratio: number;
};

export function levelProgress(totalXp: number): LevelProgress {
  const xp = Math.max(0, totalXp);
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  if (level >= MAX_LEVEL) return { level, xpIntoLevel: xp - floor, xpForNextLevel: 0, ratio: 1 };
  const span = xpForLevel(level + 1) - floor;
  return { level, xpIntoLevel: xp - floor, xpForNextLevel: span, ratio: (xp - floor) / span };
}

/** Level names change every five levels; the visible names live in the locale files. */
export const LEVEL_TIERS = [
  "apprentice",
  "trader",
  "dealmaker",
  "entrepreneur",
  "strategist",
  "legend",
] as const;
export type LevelTier = (typeof LEVEL_TIERS)[number];

export function tierForLevel(level: number): LevelTier {
  const index = Math.floor((Math.min(MAX_LEVEL, Math.max(1, level)) - 1) / 5);
  return LEVEL_TIERS[index]!;
}

// -----------------------------------------------------------------------------
// XP sources
// -----------------------------------------------------------------------------

/** Must match the reasons award_xp() accepts. */
export const XP_REASONS = [
  "task_completed",
  "milestone_completed",
  "deal_won",
  "meeting_booked",
  "contact_moved",
  "contact_generated",
  "call_30min",
  "calendar_event",
  "transaction_added",
  "daily_login",
] as const;
export type XpReason = (typeof XP_REASONS)[number];

export const XP = {
  task: 10,
  subtask: 5,
  customMilestone: 100,
  dealWonBase: 150,
  dealWonBonusMax: 150,
  meeting: 40,
  contactMoved: 5,
  contactGenerated: 1,
  call30min: 30,
  calendarEvent: 5,
  transaction: 5,
  dailyLoginBase: 10,
  dailyLoginMaxMultiplier: 3,
} as const;

/** Seconds on the phone in one day that earn call_30min. */
export const CALL_XP_SECONDS = 30 * 60;

/**
 * Daily caps per cap group, so repeatable actions cannot be farmed. The ones
 * from the brief (moves, generated contacts, events, transactions) plus
 * guards on every other repeatable source. Template milestones are finite and
 * call_30min / daily_login are once a day by key, so they have none.
 */
export const DAILY_CAPS = {
  task_completed: 200,
  milestone_custom: 300,
  deal_won: 900,
  meeting_booked: 200,
  contact_moved: 50,
  contact_generated: 30,
  calendar_event: 25,
  transaction_added: 25,
} as const;
export type CapGroup = keyof typeof DAILY_CAPS;

/** What a new award may add today: trimmed to the rest of the cap, never negative. */
export function cappedXp(xp: number, usedToday: number, cap: number | undefined): number {
  if (cap === undefined) return Math.max(0, xp);
  return Math.max(0, Math.min(xp, cap - usedToday));
}

/** A won deal: 150 plus 1 XP per full 1 000 of its value, the bonus capped at 150. */
export function dealWonXp(value: number | null | undefined): number {
  const bonus = Math.floor(Math.max(0, value ?? 0) / 1000);
  return XP.dealWonBase + Math.min(XP.dealWonBonusMax, bonus);
}

/** 10 × the streak, at least ×1 and at most ×3. */
export function dailyLoginXp(streak: number): number {
  const multiplier = Math.min(XP.dailyLoginMaxMultiplier, Math.max(1, Math.floor(streak)));
  return XP.dailyLoginBase * multiplier;
}

// -----------------------------------------------------------------------------
// Streak
// -----------------------------------------------------------------------------

/** "yyyy-MM-dd" ⇄ a UTC midnight timestamp; days are already in the user's zone. */
function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** The Monday that starts the ISO week of a day number. */
function weekOf(day: number): number {
  const weekday = (new Date(day * 86_400_000).getUTCDay() + 6) % 7; // Monday = 0
  return day - weekday;
}

export type StreakResult = { streak: number; freezeAvailable: boolean };

/**
 * Consecutive days with at least one XP action (the daily login itself does
 * not count). Today may still be empty. One missed day per Monday–Sunday week
 * is bridged by that week's save; a save is only spent when it actually
 * bridges to an earlier active day. Mirrors game_streak() in the database.
 */
export function computeStreak(activeDays: Iterable<string>, today: string): StreakResult {
  const active = new Set<number>();
  for (const day of activeDays) active.add(dayNumber(day));
  const todayNumber = dayNumber(today);

  let streak = active.has(todayNumber) ? 1 : 0;
  const used = new Set<number>();
  let pending: number[] = [];
  for (let day = todayNumber - 1, guard = 0; guard < 400; day--, guard++) {
    const week = weekOf(day);
    if (active.has(day)) {
      streak++;
      for (const w of pending) used.add(w);
      pending = [];
    } else if (!used.has(week) && !pending.includes(week)) {
      pending.push(week);
    } else {
      break;
    }
  }
  return { streak, freezeAvailable: !used.has(weekOf(todayNumber)) };
}

// -----------------------------------------------------------------------------
// Achievements
// -----------------------------------------------------------------------------

/** Names of the numbers game_metrics() returns. */
export type AchievementMetric =
  | "tasks_done"
  | "milestones_completed"
  | "contacts"
  | "call_seconds"
  | "deals_won"
  | "streak"
  | "task_depth"
  | "calendar_events"
  | "meetings"
  | "finance_complete_months"
  | "workers"
  | "chapters_completed"
  | "path_completed";

export type AchievementCondition = { metric: AchievementMetric; gte: number };

export type AchievementRule = { key: string; condition: AchievementCondition };

export type GameMetrics = Partial<Record<AchievementMetric, number>>;

/** Keys of the badges whose condition the metrics meet and that are not earned yet. */
export function newlyEarnedAchievements(
  rules: readonly AchievementRule[],
  metrics: GameMetrics,
  earned: Iterable<string>,
): string[] {
  const have = new Set(earned);
  return rules
    .filter((rule) => !have.has(rule.key))
    .filter((rule) => (metrics[rule.condition.metric] ?? 0) >= rule.condition.gte)
    .map((rule) => rule.key);
}

/** How far a badge is, 0–1, for the grey "not yet" state. */
export function achievementProgress(condition: AchievementCondition, metrics: GameMetrics): number {
  if (condition.gte <= 0) return 1;
  return Math.min(1, Math.max(0, (metrics[condition.metric] ?? 0) / condition.gte));
}
