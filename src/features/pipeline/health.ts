import { differenceInCalendarDays } from "date-fns";
import {
  instantToZonedParts,
  isoDateToLocal,
  todayIsoDate,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import type { DealContact } from "./types";

/**
 * The three tiles above the pipeline (and on the dashboard) that only ever
 * show what is wrong; the goal is a zero everywhere. Shared by the board,
 * the dashboard and Jarvis, so all of them count the same.
 *
 * - closePast: open deals whose Close Date has passed (won and lost ones are done).
 * - overdueTasks: open tasks of deals past their due moment, counted as tasks,
 *   also on won and lost deals (a task there may still matter).
 * - noTask: open deals without a single open task.
 *
 * A worker counts only what is theirs: deals they look after and tasks given
 * to them. The owner counts the whole space.
 */

export const HEALTH_TILES = ["closePast", "overdueTasks", "noTask"] as const;
export type HealthTile = (typeof HEALTH_TILES)[number];

export function isHealthTile(value: string | null): value is HealthTile {
  return value !== null && (HEALTH_TILES as readonly string[]).includes(value);
}

/** Nothing wrong, a little, or a lot: green, yellow, red. */
export type HealthLevel = "ok" | "warn" | "alert";
/** Up to this many is yellow, more is red. */
export const WARN_MAX = 3;

export function healthLevel(count: number): HealthLevel {
  if (count <= 0) return "ok";
  return count <= WARN_MAX ? "warn" : "alert";
}

/** What the tiles need of a deal; a board deal has all of it. */
export type HealthDeal = {
  id: string;
  title: string;
  stage_id: string;
  expected_close_date: IsoDate | null;
  created_at: string;
  assignee_id: string | null;
  won_at: string | null;
  lost_at: string | null;
  contact: DealContact | null;
};

/** An open task of a deal, with the deal it belongs to (a won or lost one too). */
export type OpenDealTask = {
  id: string;
  deal_id: string;
  due_at: string;
  assignee_id: string | null;
  deal: HealthDeal | null;
};

export type HealthInput = {
  /** The deals of the board; only the open ones count for closePast and noTask. */
  deals: HealthDeal[];
  /** Every open task of a deal the account may see. */
  tasks: OpenDealTask[];
  /** Deal id → when its last task was finished (open deals only). */
  lastDone: Map<string, string>;
  /** Null counts the whole space (the owner); a worker's id counts only theirs. */
  assigneeId: string | null;
  now: Date;
  settings: FormatSettings;
};

export type HealthRow =
  | { tile: "closePast"; deal: HealthDeal; closeDate: IsoDate; days: number }
  | { tile: "overdueTasks"; deal: HealthDeal; tasks: number; oldestDueAt: string; days: number }
  | { tile: "noTask"; deal: HealthDeal; since: string; days: number };

export type ClosePastRow = Extract<HealthRow, { tile: "closePast" }>;
export type OverdueRow = Extract<HealthRow, { tile: "overdueTasks" }>;
export type NoTaskRow = Extract<HealthRow, { tile: "noTask" }>;

export type HealthSummary = { count: number; rows: HealthRow[] };
export type PipelineHealth = Record<HealthTile, HealthSummary>;

export function isOpenDeal(deal: Pick<HealthDeal, "won_at" | "lost_at">): boolean {
  return deal.won_at === null && deal.lost_at === null;
}

/** The day an instant falls on in the user's zone. */
function zonedDay(instant: string, timeZone: string): IsoDate {
  return instantToZonedParts(new Date(instant), timeZone).date;
}

/** Whole calendar days from `from` to `to` (both days in the user's zone), never negative. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.max(0, differenceInCalendarDays(isoDateToLocal(to), isoDateToLocal(from)));
}

/**
 * A task is overdue to the minute (due at 15:00 is overdue at 15:01), the
 * same rule as `isOverdue` in crm-tasks/logic.ts for a task with a time.
 */
export function isTaskOverdue(task: Pick<OpenDealTask, "due_at">, now: Date): boolean {
  return Date.parse(task.due_at) < now.getTime();
}

function byTitle(a: { deal: HealthDeal }, b: { deal: HealthDeal }) {
  return a.deal.title.localeCompare(b.deal.title) || a.deal.id.localeCompare(b.deal.id);
}

export function pipelineHealth(input: HealthInput): PipelineHealth {
  const { deals, tasks, lastDone, assigneeId, now, settings } = input;
  const today = todayIsoDate(settings, now);
  const mine = (owner: string | null) => assigneeId === null || owner === assigneeId;
  const board = new Map(deals.map((deal) => [deal.id, deal]));
  const openDeals = deals.filter((deal) => isOpenDeal(deal) && mine(deal.assignee_id));

  // Close Date in the past: open deals only, the oldest date first.
  const closePast: ClosePastRow[] = [];
  for (const deal of openDeals) {
    const date = deal.expected_close_date;
    if (date && date < today) {
      closePast.push({ tile: "closePast", deal, closeDate: date, days: daysBetween(date, today) });
    }
  }
  closePast.sort((a, b) => a.closeDate.localeCompare(b.closeDate) || byTitle(a, b));

  // Overdue tasks: counted one by one, listed per deal (won and lost ones too).
  const withOpenTask = new Set<string>();
  const overdueByDeal = new Map<string, { deal: HealthDeal; tasks: number; oldest: string }>();
  for (const task of tasks) {
    withOpenTask.add(task.deal_id);
    if (!mine(task.assignee_id) || !isTaskOverdue(task, now)) continue;
    // The board's copy is the freshest; a deal beyond the board comes with the task.
    const deal = board.get(task.deal_id) ?? task.deal;
    if (!deal) continue;
    const entry = overdueByDeal.get(deal.id);
    if (!entry) overdueByDeal.set(deal.id, { deal, tasks: 1, oldest: task.due_at });
    else {
      entry.tasks += 1;
      if (Date.parse(task.due_at) < Date.parse(entry.oldest)) entry.oldest = task.due_at;
    }
  }
  const overdueRows = [...overdueByDeal.values()]
    .map(({ deal, tasks: count, oldest }): OverdueRow => ({
      tile: "overdueTasks",
      deal,
      tasks: count,
      oldestDueAt: oldest,
      days: daysBetween(zonedDay(oldest, settings.timeZone), today),
    }))
    .sort((a, b) => Date.parse(a.oldestDueAt) - Date.parse(b.oldestDueAt) || byTitle(a, b));
  const overdueCount = [...overdueByDeal.values()].reduce((sum, entry) => sum + entry.tasks, 0);

  // Open deals without any open task (whoever it is given to): the longest first.
  const noTask: NoTaskRow[] = [];
  for (const deal of openDeals) {
    if (withOpenTask.has(deal.id)) continue;
    const done = lastDone.get(deal.id);
    const since = done && Date.parse(done) > Date.parse(deal.created_at) ? done : deal.created_at;
    noTask.push({
      tile: "noTask",
      deal,
      since,
      days: daysBetween(zonedDay(since, settings.timeZone), today),
    });
  }
  noTask.sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || byTitle(a, b));

  return {
    closePast: { count: closePast.length, rows: closePast },
    overdueTasks: { count: overdueCount, rows: overdueRows },
    noTask: { count: noTask.length, rows: noTask },
  };
}

/** Whether anything is wrong at all. */
export function healthIsClear(health: PipelineHealth): boolean {
  return HEALTH_TILES.every((tile) => health[tile].count === 0);
}

/**
 * A few deals of each tile for Jarvis: names, days and dates, nothing more.
 * The id is never shown to the model; it tells later whether the deal still burns.
 */
export type HealthDigest = {
  closePast: {
    count: number;
    top: { id: string; title: string; closeDate: IsoDate; days: number }[];
  };
  overdueTasks: { count: number; top: { id: string; title: string; tasks: number; days: number }[] };
  noTask: { count: number; top: { id: string; title: string; days: number }[] };
};

export function digestHealth(health: PipelineHealth, limit = 3): HealthDigest {
  const top = <R extends HealthRow, T>(rows: HealthRow[], pick: (row: R) => T) =>
    (rows as R[]).slice(0, limit).map(pick);
  return {
    closePast: {
      count: health.closePast.count,
      top: top(health.closePast.rows, (row: ClosePastRow) => ({
        id: row.deal.id,
        title: row.deal.title,
        closeDate: row.closeDate,
        days: row.days,
      })),
    },
    overdueTasks: {
      count: health.overdueTasks.count,
      top: top(health.overdueTasks.rows, (row: OverdueRow) => ({
        id: row.deal.id,
        title: row.deal.title,
        tasks: row.tasks,
        days: row.days,
      })),
    },
    noTask: {
      count: health.noTask.count,
      top: top(health.noTask.rows, (row: NoTaskRow) => ({
        id: row.deal.id,
        title: row.deal.title,
        days: row.days,
      })),
    },
  };
}

export function digestIsClear(digest: HealthDigest): boolean {
  return HEALTH_TILES.every((tile) => digest[tile].count === 0);
}
