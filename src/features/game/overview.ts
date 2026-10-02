import { dailyLoginXp, DAILY_CAPS, XP, type XpReason } from "./rules";
import type { LockableSection } from "./types";

/**
 * What the level window shows under "How to earn XP": today's XP per source
 * against its daily cap, and three concrete next steps from the state of the
 * app. Pure, so the numbers are covered by tests; the database stays the
 * judge of every award.
 */

export type XpEventRow = { kind: string; xp: number; metadata?: unknown };

export type SourceProgress = {
  key: XpReason;
  /** XP earned from this source today. */
  earned: number;
  /** Today's cap; null when the source has none (template milestones). */
  cap: number | null;
  /** The section the source needs; null when it is always open. */
  section: LockableSection | null;
};

/** The order the window lists them in. */
const SOURCES: { key: XpReason; section: LockableSection | null }[] = [
  { key: "daily_login", section: null },
  { key: "task_completed", section: null },
  { key: "milestone_completed", section: null },
  { key: "contact_moved", section: "contacts" },
  { key: "contact_generated", section: "contacts" },
  { key: "meeting_booked", section: "contacts" },
  { key: "call_30min", section: "coldCalling" },
  { key: "deal_won", section: "pipeline" },
  { key: "calendar_event", section: "calendar" },
  { key: "transaction_added", section: "finance" },
];

function capFor(key: XpReason, streak: number): number | null {
  switch (key) {
    case "daily_login":
      return dailyLoginXp(streak);
    case "call_30min":
      return XP.call30min;
    case "milestone_completed":
      return null;
    default:
      return DAILY_CAPS[key];
  }
}

/** Today's events (already limited to today in the user's zone) summed per source. */
export function todaySources(
  events: readonly XpEventRow[],
  options: { streak: number },
): SourceProgress[] {
  const earned = new Map<string, number>();
  for (const event of events) earned.set(event.kind, (earned.get(event.kind) ?? 0) + event.xp);
  return SOURCES.map(({ key, section }) => ({
    key,
    section,
    earned: earned.get(key) ?? 0,
    cap: capFor(key, options.streak),
  }));
}

/** What is left of a source's cap today; Infinity when it has none. */
export function remainingToday(source: SourceProgress | undefined): number {
  if (!source) return 0;
  if (source.cap === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, source.cap - source.earned);
}

/** The milestone the suggestions point at: the current one of the path, or the first active one. */
export type FocusMilestone = {
  id: string;
  title: string;
  /** Not yet done top-level tasks and subtasks. */
  openTasks: number;
  openSubtasks: number;
  totalTasks: number;
  /** XP for completing the milestone itself (template XP or the custom 100). */
  xp: number;
  /** False when the XP for it was already paid once. */
  paysXp: boolean;
};

export type XpSuggestion =
  | { kind: "completeMilestone"; milestoneId: string; milestone: string; xp: number }
  | { kind: "finishTasks"; milestoneId: string; milestone: string; count: number; xp: number }
  | { kind: "firstTask"; milestoneId: string; milestone: string }
  | { kind: "callToday"; xp: number }
  | { kind: "moveContacts"; count: number; xp: number }
  | { kind: "bookMeeting"; xp: number }
  | { kind: "addEvent"; xp: number }
  | { kind: "addTransaction"; xp: number };

export const SUGGESTION_COUNT = 3;
/** "Move 5 contacts" reads better than the whole rest of the cap. */
const MOVE_BATCH = 5;

/**
 * Up to three next steps, most valuable and most concrete first. A source
 * capped out today or a locked section is never suggested.
 */
export function xpSuggestions(input: {
  focus: FocusMilestone | null;
  sources: readonly SourceProgress[];
  isOpen: (section: LockableSection) => boolean;
}): XpSuggestion[] {
  const { focus, sources, isOpen } = input;
  const source = (key: XpReason) => sources.find((s) => s.key === key);
  const open = (key: XpReason) => {
    const s = source(key);
    return !!s && (s.section === null || isOpen(s.section)) && remainingToday(s) > 0;
  };
  const out: XpSuggestion[] = [];

  if (focus) {
    const done = focus.totalTasks > 0 && focus.openTasks === 0 && focus.openSubtasks === 0;
    if (done) {
      if (focus.paysXp) {
        out.push({
          kind: "completeMilestone",
          milestoneId: focus.id,
          milestone: focus.title,
          xp: focus.xp,
        });
      }
    } else if (focus.totalTasks === 0) {
      out.push({ kind: "firstTask", milestoneId: focus.id, milestone: focus.title });
    } else if (open("task_completed")) {
      const xp = Math.min(
        focus.openTasks * XP.task + focus.openSubtasks * XP.subtask,
        remainingToday(source("task_completed")),
      );
      out.push({
        kind: "finishTasks",
        milestoneId: focus.id,
        milestone: focus.title,
        count: focus.openTasks + focus.openSubtasks,
        xp,
      });
    }
  }

  if (open("call_30min")) out.push({ kind: "callToday", xp: XP.call30min });

  if (open("contact_moved")) {
    const left = remainingToday(source("contact_moved"));
    const count = Math.max(1, Math.min(MOVE_BATCH, Math.floor(left / XP.contactMoved)));
    out.push({ kind: "moveContacts", count, xp: count * XP.contactMoved });
  }

  if (open("meeting_booked")) out.push({ kind: "bookMeeting", xp: XP.meeting });
  if (open("calendar_event")) out.push({ kind: "addEvent", xp: XP.calendarEvent });
  if (open("transaction_added")) out.push({ kind: "addTransaction", xp: XP.transaction });

  return out.slice(0, SUGGESTION_COUNT);
}

/** Open tasks of a milestone from its rows: top-level and subtasks counted apart. */
export function countOpenTasks(
  tasks: readonly { parent_task_id: string | null; status: string }[],
): { openTasks: number; openSubtasks: number; totalTasks: number } {
  let openTasks = 0;
  let openSubtasks = 0;
  for (const task of tasks) {
    if (task.status === "done") continue;
    if (task.parent_task_id) openSubtasks++;
    else openTasks++;
  }
  return { openTasks, openSubtasks, totalTasks: tasks.length };
}
