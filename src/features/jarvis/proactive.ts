import { urgencyOf } from "./notice-queue";
import {
  DEFAULT_FORMAT_SETTINGS,
  todayIsoDate,
  toZonedWallClock,
  zonedWallClockToInstant,
  type IsoDate,
} from "@/lib/format";

/**
 * When Jarvis may speak up on his own, as plain functions shared by the
 * server (which decides what there is to say) and the browser (which knows
 * about dialogs, the timer and the page). No zod here: the browser loads it.
 *
 * The rules (CLAUDE.md → Jarvis):
 * - the summary of the day (week, month) at the first arrival of that period,
 *   right after the page loads (summaryDue)
 * - besides it, with "every 2 / 6 hours" only: at most one appearance per
 *   session and never sooner than the frequency's gap after the last
 *   (one appearance carries a queue; its card shows one notice at a time)
 * - never while the call timer runs or a dialog is open
 * - never within 30 seconds of a page loading
 * - Later = the next day; Close = never this one again
 * - the owner's rules from the administration (ProactiveRules) may make the
 *   gap longer, the settling longer or shorter, switch types and questions off
 * The full description for people is docs/jarvis-pravidla.md.
 * - the user's switch, frequency and quiet hours
 * - nothing to say, nothing shown
 */

export const PROACTIVE_KINDS = ["briefing", "suggestion", "question"] as const;
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

export const JARVIS_FREQUENCIES = ["every_2h", "every_6h", "daily", "weekly", "monthly"] as const;
export type JarvisFrequency = (typeof JARVIS_FREQUENCIES)[number];
export const DEFAULT_JARVIS_FREQUENCY: JarvisFrequency = "every_6h";

/** The values before step 18.2; the database maps them too (an old tab may still send one). */
const LEGACY_FREQUENCIES: Record<string, JarvisFrequency> = {
  often: "every_2h",
  sometimes: "every_6h",
  briefing_only: "daily",
};

export function isJarvisFrequency(value: string): value is JarvisFrequency {
  return (JARVIS_FREQUENCIES as readonly string[]).includes(value);
}

/** A stored value as one of today's frequencies; anything unknown is the default. */
export function toJarvisFrequency(value: string | null | undefined): JarvisFrequency {
  if (value && isJarvisFrequency(value)) return value;
  return (value && LEGACY_FREQUENCIES[value]) || DEFAULT_JARVIS_FREQUENCY;
}

/** The floor of every frequency: never two appearances within 2 hours. */
export const MIN_GAP_HOURS = 2;
/**
 * Hours between two appearances besides the summary. Null: Jarvis brings up
 * nothing on his own but the summary (once a day, week or month).
 */
export const GAP_HOURS: Record<JarvisFrequency, number | null> = {
  every_2h: MIN_GAP_HOURS,
  every_6h: 6,
  daily: null,
  weekly: null,
  monthly: null,
};

/** Whether Jarvis speaks up between the summaries (suggestions and questions). */
export function speaksBetweenSummaries(frequency: JarvisFrequency): boolean {
  return GAP_HOURS[frequency] !== null;
}

/** A page has to settle this long before Jarvis appears, so he never startles. */
export const PAGE_SETTLE_MS = 30_000;
/** Questions Jarvis may ask in seven days. */
export const QUESTIONS_PER_WEEK = 2;
/** Suggestions older than this are about a moment that has passed. */
export const SUGGESTION_FRESH_DAYS = 3;

/** Suggestion types worth bringing up on his own; the rest stay in the panel. */
export const PROACTIVE_SUGGESTION_TYPES = [
  "insight",
  "stalledDeal",
  "overdueTask",
  "overdueInvoice",
  "overdueCrmTask",
  "milestoneReady",
  "followUps",
  "pathReady",
  "workerInvite",
  "cashLow",
  "bookingPending",
  "bookingNew",
] as const;
export type ProactiveSuggestionType = (typeof PROACTIVE_SUGGESTION_TYPES)[number];

/**
 * The rules of speaking up that the owner of the app may change in the
 * administration (app_settings 'jarvis_rules', see rules.ts and
 * docs/jarvis-pravidla.md). The defaults are the constants above; every
 * function here takes the rules in force and falls back to them.
 */
export type ProactiveRules = {
  /** The floor of the gap between two appearances, in hours (never below MIN_GAP_HOURS). */
  minGapHours: number;
  /** Questions Jarvis may ask in seven days. */
  questionsPerWeek: number;
  /** A suggestion older than this many days is not brought up any more. */
  suggestionFreshDays: number;
  /** How long a page must settle before Jarvis appears, in milliseconds. */
  pageSettleMs: number;
  /** Which suggestion types may be brought up on his own (the panel lists them all). */
  suggestionTypes: Record<ProactiveSuggestionType, boolean>;
  /** Whether Jarvis asks his questions at all. */
  questions: boolean;
};

export const DEFAULT_PROACTIVE_RULES: ProactiveRules = {
  minGapHours: MIN_GAP_HOURS,
  questionsPerWeek: QUESTIONS_PER_WEEK,
  suggestionFreshDays: SUGGESTION_FRESH_DAYS,
  pageSettleMs: PAGE_SETTLE_MS,
  suggestionTypes: Object.fromEntries(
    PROACTIVE_SUGGESTION_TYPES.map((type) => [type, true]),
  ) as Record<ProactiveSuggestionType, boolean>,
  questions: true,
};

/** Whether a suggestion type may be brought up on his own under these rules. */
export function proactiveTypeEnabled(
  type: string,
  rules: ProactiveRules = DEFAULT_PROACTIVE_RULES,
): boolean {
  return (
    (PROACTIVE_SUGGESTION_TYPES as readonly string[]).includes(type) &&
    rules.suggestionTypes[type as ProactiveSuggestionType] !== false
  );
}

/** Hours between two appearances for a frequency, never below the rules' floor; null = the summary only. */
export function gapHoursOf(
  frequency: JarvisFrequency,
  rules: ProactiveRules = DEFAULT_PROACTIVE_RULES,
): number | null {
  const gap = GAP_HOURS[frequency];
  if (gap === null) return null;
  return Math.max(MIN_GAP_HOURS, rules.minGapHours, gap);
}

const HOUR_MS = 3_600_000;

export type ProactiveSettings = {
  enabled: boolean;
  frequency: JarvisFrequency;
  /** Whole hours in the user's zone; both null means no quiet hours. */
  quietFrom: number | null;
  quietTo: number | null;
  timeZone: string;
};

/** The hour on the user's wall clock. */
export function localHour(now: Date, timeZone: string): number {
  return toZonedWallClock(now, timeZone).getHours();
}

/** Quiet hours may wrap midnight (22 → 7). The end hour itself is no longer quiet. */
export function inQuietHours(hour: number, from: number | null, to: number | null): boolean {
  if (from === null || to === null || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** The first instant after the last appearance at which Jarvis may appear again. */
export function nextAllowedAt(
  lastShownAt: string | null,
  frequency: JarvisFrequency,
  rules: ProactiveRules = DEFAULT_PROACTIVE_RULES,
): number {
  if (!lastShownAt) return 0;
  const gap = gapHoursOf(frequency, rules) ?? Math.max(MIN_GAP_HOURS, rules.minGapHours);
  return Date.parse(lastShownAt) + gap * HOUR_MS;
}

export type ServerBlock = "disabled" | "summaryOnly" | "quiet" | "tooSoon";

/** What the server can check on its own: the switch, the frequency, quiet hours and the gap. */
export function serverBlock(input: {
  now: Date;
  settings: ProactiveSettings;
  lastShownAt: string | null;
  rules?: ProactiveRules;
}): ServerBlock | null {
  const { now, settings } = input;
  if (!settings.enabled) return "disabled";
  if (!speaksBetweenSummaries(settings.frequency)) return "summaryOnly";
  if (inQuietHours(localHour(now, settings.timeZone), settings.quietFrom, settings.quietTo)) {
    return "quiet";
  }
  if (now.getTime() < nextAllowedAt(input.lastShownAt, settings.frequency, input.rules)) {
    return "tooSoon";
  }
  return null;
}

export type ClientBlock = "session" | "settling" | "timer" | "dialog" | "busy" | "hidden";

/** What only the browser knows. `busy`: the tour, onboarding or Jarvis's panel is open. */
export function clientBlock(input: {
  now: number;
  /** When the current page was loaded or last navigated to. */
  pageSince: number;
  shownThisSession: boolean;
  timerRunning: boolean;
  dialogOpen: boolean;
  busy: boolean;
  visible: boolean;
  /** How long a page must settle: the rules' delay (PAGE_SETTLE_MS by default) or a caller's own. */
  settleMs?: number;
}): ClientBlock | null {
  if (input.shownThisSession) return "session";
  if (!input.visible) return "hidden";
  if (input.busy) return "busy";
  if (input.timerRunning) return "timer";
  if (input.dialogOpen) return "dialog";
  if (input.now - input.pageSince < (input.settleMs ?? PAGE_SETTLE_MS)) return "settling";
  return null;
}

/**
 * Jarvis's one-time introduction of Notes: for an account's own space, once
 * the onboarding and the guided tour are behind it (new accounts right after
 * the tour, existing ones on their next visit), and never again once shown.
 */
export function notesIntroDue(input: {
  worker: boolean;
  onboardingCompletedAt: string | null;
  tourCompletedAt: string | null;
  notesIntroSeenAt: string | null;
}): boolean {
  return (
    !input.worker &&
    !!input.onboardingCompletedAt &&
    !!input.tourCompletedAt &&
    !input.notesIntroSeenAt
  );
}

/**
 * The introduction waits until nothing else is on screen (the tour, its
 * celebration or any dialog, Jarvis's panel, a running call timer) and the
 * page has been calm this long, so it always comes after them.
 */
export const NOTES_INTRO_SETTLE_MS = 4_000;

export type ProactiveCandidate = {
  kind: ProactiveKind;
  /** A suggestion's type, for its urgency; the other kinds have none of their own. */
  type?: string;
  createdAt: string;
};

/**
 * What one appearance between the summaries may carry: suggestions and
 * questions. The brief is the summary's (summaryDue), never part of it.
 */
const QUEUE_PRIORITY: Partial<Record<ProactiveKind, number>> = { suggestion: 0, question: 1 };

/** The longest queue one appearance carries; the card shows one notice of it at a time. */
export const PROACTIVE_QUEUE_LIMIT = 10;

/**
 * What is worth saying now, in the order the card shows it: the suggestions,
 * the most urgent and then the newest first, then a question. Empty when
 * there is nothing or the frequency is a summary only; Jarvis never comes
 * just to say hello.
 */
export function orderProactive<T extends ProactiveCandidate>(
  candidates: readonly T[],
  options: { frequency: JarvisFrequency },
): T[] {
  if (!speaksBetweenSummaries(options.frequency)) return [];
  const eligible = candidates.filter((item) => QUEUE_PRIORITY[item.kind] !== undefined);
  return eligible.sort(
    (a, b) =>
      QUEUE_PRIORITY[a.kind]! - QUEUE_PRIORITY[b.kind]! ||
      (a.kind === "suggestion" ? urgencyOf(a.type ?? "") - urgencyOf(b.type ?? "") : 0) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** The first thing of the queue, or null when there is nothing to say. */
export function pickProactive<T extends ProactiveCandidate>(
  candidates: readonly T[],
  options: { frequency: JarvisFrequency },
): T | null {
  return orderProactive(candidates, options)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The summary at the first arrival of the day, week or month
// ---------------------------------------------------------------------------

export const SUMMARY_PERIODS = ["day", "week", "month"] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

/** Every frequency gets a summary; "weekly" and "monthly" one per week or month. */
export function summaryPeriodOf(frequency: JarvisFrequency): SummaryPeriod {
  if (frequency === "weekly") return "week";
  if (frequency === "monthly") return "month";
  return "day";
}

/**
 * The summary waits this long after a page loads: the page is drawn, then he
 * flies in. Far shorter than PAGE_SETTLE_MS: coming in is the moment for it.
 */
export const SUMMARY_SETTLE_MS = 1_500;

function shiftDay(day: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 24 * HOUR_MS).toISOString().slice(0, 10);
}

/** The first day of the day, week (by the user's week start, 0 = Sunday) or month `day` is in. */
export function periodStartOf(day: IsoDate, period: SummaryPeriod, weekStartsOn: number): IsoDate {
  if (period === "day") return day;
  if (period === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday - weekStartsOn + 7) % 7));
}

/** The first day of the period before the one starting on `start`. */
export function previousPeriodStart(start: IsoDate, period: SummaryPeriod): IsoDate {
  if (period === "day") return shiftDay(start, -1);
  if (period === "week") return shiftDay(start, -7);
  return `${shiftDay(start, -1).slice(0, 7)}-01`;
}

/** The first day after the period starting on `start`. */
export function nextPeriodStart(start: IsoDate, period: SummaryPeriod): IsoDate {
  if (period === "day") return shiftDay(start, 1);
  if (period === "week") return shiftDay(start, 7);
  return `${shiftDay(`${start.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
}

export type SummaryDue = {
  period: SummaryPeriod;
  /** Today in the user's zone. */
  today: IsoDate;
  /** The first day of the period the summary is about. */
  start: IsoDate;
};

/**
 * Whether this arrival is the first of the summary's period (day, week or
 * month in the user's zone and week), so the summary is due now. Never when
 * Jarvis is switched off, before the onboarding is done, or on the day it was
 * done (a new account has its welcome; the first summary comes the next
 * day). `lastSummaryOn` is profiles.last_daily_brief_on: the day the summary
 * was last shown, or settled with nothing to say.
 */
export function summaryDue(input: {
  now: Date;
  timeZone: string;
  weekStartsOn: number;
  frequency: JarvisFrequency;
  enabled: boolean;
  onboardingCompletedAt: string | null;
  lastSummaryOn: IsoDate | null;
}): SummaryDue | null {
  if (!input.enabled || !input.onboardingCompletedAt) return null;
  const zone = { ...DEFAULT_FORMAT_SETTINGS, timeZone: input.timeZone };
  const today = todayIsoDate(zone, input.now);
  if (todayIsoDate(zone, new Date(input.onboardingCompletedAt)) >= today) return null;
  const period = summaryPeriodOf(input.frequency);
  const start = periodStartOf(today, period, input.weekStartsOn);
  if (input.lastSummaryOn && input.lastSummaryOn >= start) return null;
  return { period, today, start };
}

/** "Later": the start of the next day in the user's zone. */
export function snoozeUntil(now: Date, timeZone: string): Date {
  const today = todayIsoDate({ ...DEFAULT_FORMAT_SETTINGS, timeZone }, now);
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
  return zonedWallClockToInstant(next, "00:00", timeZone);
}

/** Whether a question may be asked: questions are on and fewer than the week's limit were asked in seven days. */
export function questionAllowed(
  askedThisWeek: number,
  rules: ProactiveRules = DEFAULT_PROACTIVE_RULES,
): boolean {
  return rules.questions && askedThisWeek < rules.questionsPerWeek;
}
