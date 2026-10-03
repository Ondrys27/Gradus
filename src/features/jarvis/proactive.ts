import {
  DEFAULT_FORMAT_SETTINGS,
  todayIsoDate,
  toZonedWallClock,
  zonedWallClockToInstant,
} from "@/lib/format";

/**
 * When Jarvis may speak up on his own, as plain functions shared by the
 * server (which decides what there is to say) and the browser (which knows
 * about dialogs, the timer and the page). No zod here: the browser loads it.
 *
 * The rules (CLAUDE.md → Jarvis):
 * - at most one appearance per session and never sooner than 4 hours after the last
 * - never while the call timer runs or a dialog is open
 * - never within 30 seconds of a page loading
 * - Later = the next day; Close = never this one again
 * - the user's switch, frequency and quiet hours
 * - nothing to say, nothing shown
 */

export const PROACTIVE_KINDS = ["briefing", "suggestion", "question"] as const;
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

export const JARVIS_FREQUENCIES = ["often", "sometimes", "briefing_only"] as const;
export type JarvisFrequency = (typeof JARVIS_FREQUENCIES)[number];

export function isJarvisFrequency(value: string): value is JarvisFrequency {
  return (JARVIS_FREQUENCIES as readonly string[]).includes(value);
}

/** The floor of every frequency: never two appearances within 4 hours. */
export const MIN_GAP_HOURS = 4;
/** Hours between two appearances per frequency; never below the floor. */
export const GAP_HOURS: Record<JarvisFrequency, number> = {
  often: MIN_GAP_HOURS,
  sometimes: 12,
  briefing_only: MIN_GAP_HOURS,
};
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
  "milestoneReady",
  "followUps",
  "pathReady",
] as const;

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
export function nextAllowedAt(lastShownAt: string | null, frequency: JarvisFrequency): number {
  if (!lastShownAt) return 0;
  const gap = Math.max(MIN_GAP_HOURS, GAP_HOURS[frequency]);
  return Date.parse(lastShownAt) + gap * HOUR_MS;
}

export type ServerBlock = "disabled" | "quiet" | "tooSoon";

/** What the server can check on its own: the switch, quiet hours and the gap. */
export function serverBlock(input: {
  now: Date;
  settings: ProactiveSettings;
  lastShownAt: string | null;
}): ServerBlock | null {
  const { now, settings } = input;
  if (!settings.enabled) return "disabled";
  if (inQuietHours(localHour(now, settings.timeZone), settings.quietFrom, settings.quietTo)) {
    return "quiet";
  }
  if (now.getTime() < nextAllowedAt(input.lastShownAt, settings.frequency)) return "tooSoon";
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
}): ClientBlock | null {
  if (input.shownThisSession) return "session";
  if (!input.visible) return "hidden";
  if (input.busy) return "busy";
  if (input.timerRunning) return "timer";
  if (input.dialogOpen) return "dialog";
  if (input.now - input.pageSince < PAGE_SETTLE_MS) return "settling";
  return null;
}

/** Briefing only: no suggestions, no questions. */
export function kindsFor(frequency: JarvisFrequency): ProactiveKind[] {
  return frequency === "briefing_only" ? ["briefing"] : [...PROACTIVE_KINDS];
}

export type ProactiveCandidate = {
  kind: ProactiveKind;
  createdAt: string;
  /** The day a briefing is about (yyyy-MM-dd); null for the other kinds. */
  briefingDate: string | null;
};

const PRIORITY: Record<ProactiveKind, number> = { briefing: 0, suggestion: 1, question: 2 };

/**
 * The one thing worth saying now: today's briefing first (only when the
 * account has it), then the newest suggestion, then a question. Null when
 * there is nothing; Jarvis never comes just to say hello.
 */
export function pickProactive<T extends ProactiveCandidate>(
  candidates: readonly T[],
  options: { frequency: JarvisFrequency; today: string; briefingUnlocked: boolean },
): T | null {
  const kinds = new Set(kindsFor(options.frequency));
  const eligible = candidates.filter((item) => {
    if (!kinds.has(item.kind)) return false;
    if (item.kind === "briefing") {
      return options.briefingUnlocked && item.briefingDate === options.today;
    }
    return true;
  });
  eligible.sort(
    (a, b) =>
      PRIORITY[a.kind] - PRIORITY[b.kind] || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return eligible[0] ?? null;
}

/** "Later": the start of the next day in the user's zone. */
export function snoozeUntil(now: Date, timeZone: string): Date {
  const today = todayIsoDate({ ...DEFAULT_FORMAT_SETTINGS, timeZone }, now);
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
  return zonedWallClockToInstant(next, "00:00", timeZone);
}

/** Whether a question may be asked: fewer than two in the last seven days. */
export function questionAllowed(askedThisWeek: number): boolean {
  return askedThisWeek < QUESTIONS_PER_WEEK;
}
