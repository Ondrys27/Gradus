import { addDays, startOfWeek } from "date-fns";
import { z } from "zod";
import {
  instantToZonedParts,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  zonedWallClockToInstant,
  type FormatSettings,
  type IsoDate,
  type IsoTime,
} from "@/lib/format";

/**
 * The rules of sales tasks, shared by the list, the dialog, the calendar and
 * Jarvis: when a task is overdue, which group it falls into, how the list is
 * ordered and what the filters in the address mean. Days are the user's, in
 * their time zone; "overdue" is to the minute.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const NOTE_MAX = 2000;
export const DURATION_MAX = 1440;
export const DURATION_PRESETS = [15, 30, 60, 120] as const;
export const DEFAULT_DURATION = 15;
/** "Do kdy" starts at tomorrow at this time. */
export const DEFAULT_DUE_TIME: IsoTime = "09:00";

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Validation (the database checks the same)
// ---------------------------------------------------------------------------

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, "titleRequired").max(TITLE_MAX, "titleTooLong"),
    description: z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong"),
    due_at: z.iso.datetime({ offset: true, message: "dueRequired" }),
    duration_minutes: z
      .number({ message: "durationInvalid" })
      .int("durationInvalid")
      .min(1, "durationInvalid")
      .max(DURATION_MAX, "durationInvalid"),
    assignee_id: z.uuid().nullable(),
    deal_id: z.uuid().nullable(),
    contact_id: z.uuid().nullable(),
  })
  .refine((input) => input.deal_id !== null || input.contact_id !== null, {
    message: "targetRequired",
    path: ["target"],
  });

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskErrorKey =
  | "titleRequired"
  | "titleTooLong"
  | "descriptionTooLong"
  | "dueRequired"
  | "durationInvalid"
  | "targetRequired";

export function validateTask(
  raw: unknown,
): { ok: true; data: TaskInput } | { ok: false; errors: Partial<Record<string, TaskErrorKey>> } {
  const parsed = taskInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Partial<Record<string, TaskErrorKey>> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message as TaskErrorKey;
  }
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Days and due moments
// ---------------------------------------------------------------------------

export function shiftIsoDate(day: IsoDate, amount: number): IsoDate {
  return localToIsoDate(addDays(isoDateToLocal(day), amount));
}

/** The first day of the week `day` is in, by the user's week start. */
export function weekStartOf(day: IsoDate, settings: FormatSettings): IsoDate {
  return localToIsoDate(startOfWeek(isoDateToLocal(day), { weekStartsOn: settings.weekStartsOn }));
}

/** Midnight at the start of a day in the user's zone. */
export function dayStart(day: IsoDate, timeZone: string): Date {
  return zonedWallClockToInstant(day, "00:00", timeZone);
}

/** The edges the groups and filters are cut at, all in the user's zone. */
export function dayEdges(now: Date, settings: FormatSettings) {
  const today = todayIsoDate(settings, now);
  const tomorrow = shiftIsoDate(today, 1);
  const weekStart = weekStartOf(today, settings);
  const nextWeekStart = shiftIsoDate(weekStart, 7);
  return {
    today,
    tomorrow,
    weekStart,
    nextWeekStart,
    /** The last day of this week (inclusive). */
    weekEnd: shiftIsoDate(nextWeekStart, -1),
    nextWeekEnd: shiftIsoDate(nextWeekStart, 6),
  };
}

/** "Do kdy" of a new task: tomorrow at 9:00 in the user's zone. */
export function defaultDueAt(now: Date, timeZone: string): string {
  const today = instantToZonedParts(now, timeZone).date;
  return zonedWallClockToInstant(shiftIsoDate(today, 1), DEFAULT_DUE_TIME, timeZone).toISOString();
}

export type QuickDue = "today" | "tomorrow" | "nextWeek";

/**
 * The quick choices next to the picker: the day changes, the time picked so
 * far stays. "Today" at a time already gone moves to the next whole hour (or
 * the last quarter of the day), so a new task is never born overdue.
 */
export function quickDueAt(
  quick: QuickDue,
  current: string | null,
  now: Date,
  timeZone: string,
): string {
  const today = instantToZonedParts(now, timeZone).date;
  const time = current ? instantToZonedParts(new Date(current), timeZone).time : DEFAULT_DUE_TIME;
  const day = quick === "today" ? today : shiftIsoDate(today, quick === "tomorrow" ? 1 : 7);
  const at = zonedWallClockToInstant(day, time, timeZone);
  if (quick !== "today" || at > now) return at.toISOString();
  const nextHour = new Date(Math.ceil((now.getTime() + 1) / 3_600_000) * 3_600_000);
  if (instantToZonedParts(nextHour, timeZone).date === today) return nextHour.toISOString();
  return zonedWallClockToInstant(today, "23:45", timeZone).toISOString();
}

// ---------------------------------------------------------------------------
// Overdue, groups and order
// ---------------------------------------------------------------------------

/**
 * What the list needs to know about any task, a sales task (a due moment) or
 * a task from the owner (a due day without a time).
 */
export type TaskTiming = {
  id: string;
  done: boolean;
  /** ISO instant; a sales task always has one. */
  dueAt: string | null;
  /** Calendar day without a time (a task from the owner). */
  dueDay: IsoDate | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * Overdue = still open and the due moment has passed, to the minute: a task
 * due at 15:00 is overdue at 15:01. A day without a time is overdue the day
 * after.
 */
export function isOverdue(task: TaskTiming, now: Date, settings: FormatSettings): boolean {
  if (task.done) return false;
  if (task.dueAt) return Date.parse(task.dueAt) < now.getTime();
  if (task.dueDay) return task.dueDay < todayIsoDate(settings, now);
  return false;
}

export const TASK_GROUPS = ["overdue", "today", "tomorrow", "thisWeek", "later", "done"] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/** The day a task is due on in the user's zone, or null without a due. */
export function dueDayOf(task: TaskTiming, timeZone: string): IsoDate | null {
  if (task.dueAt) return instantToZonedParts(new Date(task.dueAt), timeZone).date;
  return task.dueDay;
}

export function groupOf(task: TaskTiming, now: Date, settings: FormatSettings): TaskGroup {
  if (task.done) return "done";
  if (isOverdue(task, now, settings)) return "overdue";
  const day = dueDayOf(task, settings.timeZone);
  if (!day) return "later";
  const edges = dayEdges(now, settings);
  if (day <= edges.today) return "today";
  if (day === edges.tomorrow) return "tomorrow";
  if (day <= edges.weekEnd) return "thisWeek";
  return "later";
}

/** The moment a task is due by, for ordering; a day without a time counts until its end. */
function dueKey(task: TaskTiming, timeZone: string): number {
  if (task.dueAt) return Date.parse(task.dueAt);
  if (task.dueDay) return dayStart(shiftIsoDate(task.dueDay, 1), timeZone).getTime() - 1;
  return Number.POSITIVE_INFINITY;
}

/**
 * Open tasks by the oldest due first (what burns comes first), ties by when
 * they were made; done tasks by the latest finish first.
 */
export function compareTasks(a: TaskTiming, b: TaskTiming, timeZone: string): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.done && b.done) {
    const finished = Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? "");
    if (finished) return finished;
  } else {
    const due = dueKey(a, timeZone) - dueKey(b, timeZone);
    if (due) return due;
  }
  const made = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (made) return made;
  return a.id.localeCompare(b.id);
}

export function sortTasks<T>(items: T[], timing: (item: T) => TaskTiming, timeZone: string): T[] {
  return [...items].sort((a, b) => compareTasks(timing(a), timing(b), timeZone));
}

/** The groups of the list in their order, empty ones left out, each one sorted. */
export function groupTasks<T>(
  items: T[],
  timing: (item: T) => TaskTiming,
  now: Date,
  settings: FormatSettings,
): { group: TaskGroup; items: T[] }[] {
  const buckets = new Map<TaskGroup, T[]>();
  for (const item of items) {
    const group = groupOf(timing(item), now, settings);
    buckets.set(group, [...(buckets.get(group) ?? []), item]);
  }
  return TASK_GROUPS.flatMap((group) => {
    const list = buckets.get(group);
    return list?.length ? [{ group, items: sortTasks(list, timing, settings.timeZone) }] : [];
  });
}

/** Minutes a task was finished after its due moment; negative when early. */
export function delayMinutes(dueAt: string, completedAt: Date): number {
  return Math.round((completedAt.getTime() - Date.parse(dueAt)) / MINUTE_MS);
}

// ---------------------------------------------------------------------------
// Filters in the address
// ---------------------------------------------------------------------------

export const DUE_FILTERS = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "custom",
] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
export const STATUS_FILTERS = ["open", "done", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const DURATION_FILTERS = ["le15", "le30", "le60", "gt60"] as const;
export type DurationFilter = (typeof DURATION_FILTERS)[number];
/** "me", "anyone" or the account id of one person of the space. */
export type WhoFilter = string;

export type TaskFilters = {
  due: DueFilter | null;
  /** Inclusive days of a custom range. */
  from: IsoDate | null;
  to: IsoDate | null;
  who: WhoFilter;
  status: StatusFilter;
  duration: DurationFilter | null;
  deal: string | null;
  contact: string | null;
};

export const DEFAULT_FILTERS: TaskFilters = {
  due: null,
  from: null,
  to: null,
  who: "anyone",
  status: "all",
  duration: null,
  deal: null,
  contact: null,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** Reads the filters from the address; anything unknown falls back to its default. */
export function parseFilters(params: URLSearchParams): TaskFilters {
  const from = params.get("from");
  const to = params.get("to");
  let due = oneOf(DUE_FILTERS, params.get("due"));
  const validFrom = from && ISO_DAY.test(from) ? from : null;
  const validTo = to && ISO_DAY.test(to) ? to : null;
  if (due === "custom" && !validFrom && !validTo) due = null;
  const who = params.get("who");
  const deal = params.get("deal");
  const contact = params.get("contact");
  return {
    due,
    from: due === "custom" ? validFrom : null,
    to: due === "custom" ? validTo : null,
    who: who === "me" || (who && UUID.test(who)) ? who : "anyone",
    status: oneOf(STATUS_FILTERS, params.get("status")) ?? DEFAULT_FILTERS.status,
    duration: oneOf(DURATION_FILTERS, params.get("duration")),
    deal: deal && UUID.test(deal) ? deal : null,
    contact: contact && UUID.test(contact) ? contact : null,
  };
}

/**
 * The filters written into the address, defaults left out, other parameters
 * kept. Returns the query string with its "?" (or "" when nothing is left).
 */
export function filtersToSearch(filters: TaskFilters, base?: URLSearchParams): string {
  const params = new URLSearchParams(base);
  for (const key of ["due", "from", "to", "who", "status", "duration", "deal", "contact"]) {
    params.delete(key);
  }
  if (filters.due) params.set("due", filters.due);
  if (filters.due === "custom" && filters.from) params.set("from", filters.from);
  if (filters.due === "custom" && filters.to) params.set("to", filters.to);
  if (filters.who !== DEFAULT_FILTERS.who) params.set("who", filters.who);
  if (filters.status !== DEFAULT_FILTERS.status) params.set("status", filters.status);
  if (filters.duration) params.set("duration", filters.duration);
  if (filters.deal) params.set("deal", filters.deal);
  if (filters.contact) params.set("contact", filters.contact);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The quick switches above the list, each a set of filters. */
export const QUICK_VIEWS = ["all", "open", "overdue", "today"] as const;
export type QuickView = (typeof QUICK_VIEWS)[number];

export function applyQuickView(filters: TaskFilters, view: QuickView): TaskFilters {
  const base = { ...filters, from: null, to: null };
  switch (view) {
    case "all":
      return { ...base, due: null, status: "all" };
    case "open":
      return { ...base, due: null, status: "open" };
    case "overdue":
      return { ...base, due: "overdue", status: "open" };
    case "today":
      return { ...base, due: "today", status: "all" };
  }
}

/** Which quick switch the current filters are, if any. */
export function quickViewOf(filters: TaskFilters): QuickView | null {
  return (
    QUICK_VIEWS.find((view) => {
      const preset = applyQuickView(filters, view);
      return preset.due === filters.due && preset.status === filters.status;
    }) ?? null
  );
}

/** Done tasks are never overdue, so that filter only ever shows open ones. */
export function effectiveStatus(filters: TaskFilters): StatusFilter {
  return filters.due === "overdue" ? "open" : filters.status;
}

/** The due window of a filter as instants (`to` exclusive), for the database query. */
export function dueRange(
  filters: TaskFilters,
  now: Date,
  settings: FormatSettings,
): { from: Date | null; to: Date | null } {
  const { timeZone } = settings;
  const edges = dayEdges(now, settings);
  const days = (first: IsoDate, last: IsoDate) => ({
    from: dayStart(first, timeZone),
    to: dayStart(shiftIsoDate(last, 1), timeZone),
  });
  switch (filters.due) {
    case null:
      return { from: null, to: null };
    case "overdue":
      return { from: null, to: now };
    case "today":
      return days(edges.today, edges.today);
    case "tomorrow":
      return days(edges.tomorrow, edges.tomorrow);
    case "thisWeek":
      return days(edges.weekStart, edges.weekEnd);
    case "nextWeek":
      return days(edges.nextWeekStart, edges.nextWeekEnd);
    case "custom": {
      const first = filters.from ?? filters.to!;
      const last = filters.to ?? filters.from!;
      return first <= last ? days(first, last) : days(last, first);
    }
  }
}

/** The length bounds of a duration filter: "up to" includes the edge. */
export function durationBounds(filter: DurationFilter | null): {
  max: number | null;
  over: number | null;
} {
  switch (filter) {
    case null:
      return { max: null, over: null };
    case "le15":
      return { max: 15, over: null };
    case "le30":
      return { max: 30, over: null };
    case "le60":
      return { max: 60, over: null };
    case "gt60":
      return { max: null, over: 60 };
  }
}

/**
 * Whether a task from the owner (a day, no time, no length, no deal) passes
 * the filters; they are few, so they are filtered here, not in the database.
 */
export function ownerTaskPasses(
  task: { dueDay: IsoDate | null; done: boolean },
  filters: TaskFilters,
  myUserId: string,
  now: Date,
  settings: FormatSettings,
): boolean {
  if (filters.duration || filters.deal || filters.contact) return false;
  if (filters.who !== "anyone" && filters.who !== "me" && filters.who !== myUserId) return false;
  const status = effectiveStatus(filters);
  if (status === "open" && task.done) return false;
  if (status === "done" && !task.done) return false;
  if (!filters.due) return true;
  if (!task.dueDay) return false;
  const edges = dayEdges(now, settings);
  if (filters.due === "overdue") return task.dueDay < edges.today;
  const range = dueRange(filters, now, settings);
  const first = instantToZonedParts(range.from!, settings.timeZone).date;
  const last = shiftIsoDate(instantToZonedParts(range.to!, settings.timeZone).date, -1);
  return task.dueDay >= first && task.dueDay <= last;
}
