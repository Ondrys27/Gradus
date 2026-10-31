import { instantToZonedParts, todayIsoDate, type FormatSettings, type IsoDate } from "@/lib/format";
import { dayEdges } from "@/features/crm-tasks/logic";
import { isOpenDeal, isTaskOverdue, type OpenDealTask } from "./health";
import type { Deal } from "./types";

/**
 * The filters above the pipeline. They live in the address, so a view can
 * be shared and survives a reload, and they all apply at once (AND). The won
 * and lost columns are filtered too, with the same two exceptions as the
 * tiles: "Close Date in the past" and "no open task" are about open deals,
 * so a won or lost deal never matches them.
 */

export const CLOSE_FILTERS = ["past", "thisWeek", "thisMonth", "custom"] as const;
export type CloseFilter = (typeof CLOSE_FILTERS)[number];
/** Without a change for more than 7 / 14 / 30 days, or a custom range of days. */
export const IDLE_FILTERS = ["d7", "d14", "d30", "custom"] as const;
export type IdleFilter = (typeof IDLE_FILTERS)[number];
export const TASK_FILTERS = ["open", "none", "overdue"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

const IDLE_DAYS: Record<Exclude<IdleFilter, "custom">, number> = { d7: 7, d14: 14, d30: 30 };
const DAY_MS = 86_400_000;

export type DealFilters = {
  close: CloseFilter | null;
  /** Inclusive days of a custom Close Date range. */
  closeFrom: IsoDate | null;
  closeTo: IsoDate | null;
  /** Inclusive days the deal was made on, in the user's zone. */
  createdFrom: IsoDate | null;
  createdTo: IsoDate | null;
  idle: IdleFilter | null;
  idleFrom: IsoDate | null;
  idleTo: IsoDate | null;
  tasks: TaskFilter | null;
  /** "me" or the account id of one person of the space. */
  who: string | null;
  contact: string | null;
  /** Amount from–to, inclusive, whatever the currency (amounts are never converted). */
  min: number | null;
  max: number | null;
};

export const NO_DEAL_FILTERS: DealFilters = {
  close: null,
  closeFrom: null,
  closeTo: null,
  createdFrom: null,
  createdTo: null,
  idle: null,
  idleFrom: null,
  idleTo: null,
  tasks: null,
  who: null,
  contact: null,
  min: null,
  max: null,
};

export const DEAL_FILTER_KEYS = [
  "close",
  "created",
  "idle",
  "tasks",
  "who",
  "contact",
  "amount",
] as const;
export type DealFilterKey = (typeof DEAL_FILTER_KEYS)[number];

/** Every address parameter the filters own; anything else in the address stays. */
const PARAMS = [
  "close",
  "closeFrom",
  "closeTo",
  "createdFrom",
  "createdTo",
  "idle",
  "idleFrom",
  "idleTo",
  "tasks",
  "who",
  "contact",
  "min",
  "max",
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The largest amount a deal can hold (numeric(14,2)). */
const AMOUNT_MAX = 999_999_999_999;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function day(value: string | null): IsoDate | null {
  return value && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

function amount(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= AMOUNT_MAX ? number : null;
}

/** Both ends in order; one end alone stays open on the other side. */
function ordered<T extends string | number>(from: T | null, to: T | null): [T | null, T | null] {
  return from !== null && to !== null && from > to ? [to, from] : [from, to];
}

/** Reads the filters from the address; anything unknown falls back to no filter. */
export function parseDealFilters(params: URLSearchParams): DealFilters {
  let close = oneOf(CLOSE_FILTERS, params.get("close"));
  let [closeFrom, closeTo] = ordered(day(params.get("closeFrom")), day(params.get("closeTo")));
  if (close === "custom" && !closeFrom && !closeTo) close = null;
  if (close !== "custom") [closeFrom, closeTo] = [null, null];

  const [createdFrom, createdTo] = ordered(
    day(params.get("createdFrom")),
    day(params.get("createdTo")),
  );

  let idle = oneOf(IDLE_FILTERS, params.get("idle"));
  let [idleFrom, idleTo] = ordered(day(params.get("idleFrom")), day(params.get("idleTo")));
  if (idle === "custom" && !idleFrom && !idleTo) idle = null;
  if (idle !== "custom") [idleFrom, idleTo] = [null, null];

  const who = params.get("who");
  const contact = params.get("contact");
  const [min, max] = ordered(amount(params.get("min")), amount(params.get("max")));
  return {
    close,
    closeFrom,
    closeTo,
    createdFrom,
    createdTo,
    idle,
    idleFrom,
    idleTo,
    tasks: oneOf(TASK_FILTERS, params.get("tasks")),
    who: who === "me" || (who && UUID.test(who)) ? who : null,
    contact: contact && UUID.test(contact) ? contact : null,
    min,
    max,
  };
}

/**
 * The filters written into the address, empty ones left out and every other
 * parameter kept. Returns the query string with its "?" (or "" when empty).
 */
export function dealFiltersToSearch(filters: DealFilters, base?: URLSearchParams): string {
  const params = new URLSearchParams(base);
  for (const key of PARAMS) params.delete(key);
  const set = (key: (typeof PARAMS)[number], value: string | number | null) => {
    if (value !== null) params.set(key, String(value));
  };
  set("close", filters.close);
  if (filters.close === "custom") {
    set("closeFrom", filters.closeFrom);
    set("closeTo", filters.closeTo);
  }
  set("createdFrom", filters.createdFrom);
  set("createdTo", filters.createdTo);
  set("idle", filters.idle);
  if (filters.idle === "custom") {
    set("idleFrom", filters.idleFrom);
    set("idleTo", filters.idleTo);
  }
  set("tasks", filters.tasks);
  set("who", filters.who);
  set("contact", filters.contact);
  set("min", filters.min);
  set("max", filters.max);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The filters that are set, in the order their chips show. */
export function activeDealFilters(filters: DealFilters): DealFilterKey[] {
  const keys: DealFilterKey[] = [];
  if (filters.close) keys.push("close");
  if (filters.createdFrom || filters.createdTo) keys.push("created");
  if (filters.idle) keys.push("idle");
  if (filters.tasks) keys.push("tasks");
  if (filters.who) keys.push("who");
  if (filters.contact) keys.push("contact");
  if (filters.min !== null || filters.max !== null) keys.push("amount");
  return keys;
}

/** One filter taken off, the others kept. */
export function clearDealFilter(filters: DealFilters, key: DealFilterKey): DealFilters {
  switch (key) {
    case "close":
      return { ...filters, close: null, closeFrom: null, closeTo: null };
    case "created":
      return { ...filters, createdFrom: null, createdTo: null };
    case "idle":
      return { ...filters, idle: null, idleFrom: null, idleTo: null };
    case "tasks":
      return { ...filters, tasks: null };
    case "who":
      return { ...filters, who: null };
    case "contact":
      return { ...filters, contact: null };
    case "amount":
      return { ...filters, min: null, max: null };
  }
}

/** Open and overdue tasks per deal, counted once for the whole board. */
export type DealTaskCounts = Map<string, { open: number; overdue: number }>;

export function countDealTasks(tasks: OpenDealTask[], now: Date): DealTaskCounts {
  const counts: DealTaskCounts = new Map();
  for (const task of tasks) {
    const entry = counts.get(task.deal_id) ?? { open: 0, overdue: 0 };
    entry.open += 1;
    if (isTaskOverdue(task, now)) entry.overdue += 1;
    counts.set(task.deal_id, entry);
  }
  return counts;
}

export type DealFilterContext = {
  now: Date;
  settings: FormatSettings;
  /** The signed-in account, for "me". */
  userId: string;
  tasks: DealTaskCounts;
  /** Deals the filtered contact is on (any role); null while it loads. */
  contactDeals: Set<string> | null;
};

type FilterableDeal = Pick<
  Deal,
  | "id"
  | "contact_id"
  | "value"
  | "expected_close_date"
  | "created_at"
  | "last_activity_at"
  | "assignee_id"
  | "won_at"
  | "lost_at"
>;

function within(value: IsoDate, from: IsoDate | null, to: IsoDate | null): boolean {
  return (from === null || value >= from) && (to === null || value <= to);
}

/** Whether one deal passes every filter that is set. */
export function dealMatches(
  deal: FilterableDeal,
  filters: DealFilters,
  context: DealFilterContext,
): boolean {
  const { now, settings } = context;
  const zone = settings.timeZone;
  const open = isOpenDeal(deal);

  if (filters.close) {
    const date = deal.expected_close_date;
    if (!date) return false;
    const today = todayIsoDate(settings, now);
    switch (filters.close) {
      case "past":
        // A won or lost deal has closed; its Close Date is history, not a problem.
        if (!open || date >= today) return false;
        break;
      case "thisWeek": {
        const edges = dayEdges(now, settings);
        if (!within(date, edges.weekStart, edges.weekEnd)) return false;
        break;
      }
      case "thisMonth":
        if (date.slice(0, 7) !== today.slice(0, 7)) return false;
        break;
      case "custom":
        if (!within(date, filters.closeFrom, filters.closeTo)) return false;
        break;
    }
  }

  if (filters.createdFrom || filters.createdTo) {
    const made = instantToZonedParts(new Date(deal.created_at), zone).date;
    if (!within(made, filters.createdFrom, filters.createdTo)) return false;
  }

  if (filters.idle) {
    const last = Date.parse(deal.last_activity_at);
    if (filters.idle === "custom") {
      const lastDay = instantToZonedParts(new Date(last), zone).date;
      if (!within(lastDay, filters.idleFrom, filters.idleTo)) return false;
    } else if (!(last < now.getTime() - IDLE_DAYS[filters.idle] * DAY_MS)) {
      return false;
    }
  }

  if (filters.tasks) {
    const counts = context.tasks.get(deal.id);
    switch (filters.tasks) {
      case "open":
        if (!counts?.open) return false;
        break;
      case "none":
        // Like the tile: only an open deal can be missing its next step.
        if (!open || counts?.open) return false;
        break;
      case "overdue":
        if (!counts?.overdue) return false;
        break;
    }
  }

  if (filters.who) {
    const who = filters.who === "me" ? context.userId : filters.who;
    if (deal.assignee_id !== who) return false;
  }

  if (filters.contact) {
    const onDeal =
      deal.contact_id === filters.contact || (context.contactDeals?.has(deal.id) ?? false);
    if (!onDeal) return false;
  }

  if (filters.min !== null || filters.max !== null) {
    if (deal.value === null) return false;
    const value = Number(deal.value);
    if (filters.min !== null && value < filters.min) return false;
    if (filters.max !== null && value > filters.max) return false;
  }

  return true;
}

export function filterDeals<T extends FilterableDeal>(
  deals: T[],
  filters: DealFilters,
  context: DealFilterContext,
): T[] {
  if (activeDealFilters(filters).length === 0) return deals;
  return deals.filter((deal) => dealMatches(deal, filters, context));
}
