import { addDaysIso, dayRangeToInstants } from "@/features/calendar/calendar-logic";
import type { IsoDate } from "@/lib/format";
import type { Json } from "@/types/database";

/**
 * Activity in the company (28.7): who did what, as the database logged it
 * (activity_log through activity_feed / activity_daily). Pure: the filters
 * in the address, the period in the user's days, the sentence and link of
 * one step, and the daily sums per person. The database decides whom the
 * viewer sees and blanks titles and amounts they may not read.
 */

export const ACTIVITY_KINDS = [
  "deal",
  "contact",
  "crm_task",
  "task",
  "milestone",
  "event",
  "invoice",
  "transaction",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_PERIODS = ["today", "week", "month", "quarter"] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

/** Days each period reaches back, today included. */
const PERIOD_DAYS: Record<ActivityPeriod, number> = { today: 1, week: 7, month: 30, quarter: 90 };

export const ACTIVITY_PAGE = 50;

export type ActivityFilters = {
  person: string | null;
  group: string | null;
  kind: ActivityKind | null;
  period: ActivityPeriod;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseActivityFilters(params: URLSearchParams): ActivityFilters {
  const person = params.get("person");
  const group = params.get("group");
  const kind = params.get("kind");
  const period = params.get("period");
  return {
    person: person && UUID.test(person) ? person.toLowerCase() : null,
    group: group && UUID.test(group) ? group.toLowerCase() : null,
    kind: (ACTIVITY_KINDS as readonly string[]).includes(kind ?? "")
      ? (kind as ActivityKind)
      : null,
    period: (ACTIVITY_PERIODS as readonly string[]).includes(period ?? "")
      ? (period as ActivityPeriod)
      : "week",
  };
}

/** The address of the filters, keeping other parameters; the defaults leave no trace. */
export function activityFiltersSearch(
  params: URLSearchParams,
  next: Partial<ActivityFilters>,
): string {
  const result = new URLSearchParams(params);
  const set = (key: string, value: string | null | undefined, fallback?: string) => {
    if (value === undefined) return;
    if (!value || value === fallback) result.delete(key);
    else result.set(key, value);
  };
  set("person", next.person);
  set("group", next.group);
  set("kind", next.kind);
  set("period", next.period, "week");
  return result.toString();
}

/** [from, until) of a period ending today, in the user's time zone (never UTC days). */
export function periodRange(
  period: ActivityPeriod,
  today: IsoDate,
  timeZone: string,
): { from: string; until: string; firstDay: IsoDate } {
  const firstDay = addDaysIso(today, 1 - PERIOD_DAYS[period]);
  const { from, to } = dayRangeToInstants(firstDay, today, timeZone);
  return { from, until: to, firstDay };
}

/**
 * Whose steps to ask for: one person, the members of a group, or everyone
 * the viewer may see (null). An empty group asks for nobody.
 */
export function actorsFor(
  filters: Pick<ActivityFilters, "person" | "group">,
  people: readonly { userId: string | null; groupIds: readonly string[] }[],
): string[] | null {
  if (filters.person) return [filters.person];
  if (!filters.group) return null;
  return people
    .filter((person) => person.userId && person.groupIds.includes(filters.group!))
    .map((person) => person.userId!);
}

export type ActivityRow = {
  id: string;
  actor_id: string | null;
  via: string;
  verb: string;
  object_kind: string;
  object_id: string | null;
  summary: Json;
  created_at: string;
};

export type ActivitySummary = {
  title: string | null;
  stage: string | null;
  from: string | null;
  table: string | null;
  customer: string | null;
  amount: number | null;
  currency: string | null;
  type: string | null;
  kind: string | null;
};

function text(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function summaryOf(summary: Json): ActivitySummary {
  const record =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, Json | undefined>)
      : {};
  const amount = record.amount;
  return {
    title: text(record.title),
    stage: text(record.stage),
    from: text(record.from),
    table: text(record.table),
    customer: text(record.customer),
    amount:
      typeof amount === "number"
        ? amount
        : typeof amount === "string" && amount !== ""
          ? Number(amount)
          : null,
    currency: text(record.currency),
    type: text(record.type),
    kind: text(record.kind),
  };
}

/** Known sentence keys: `<kind>.<verb>`; anything else reads as a general step. */
const SENTENCES = new Set([
  "deal.created",
  "deal.won",
  "deal.lost",
  "deal.stage_changed",
  "deal.amount_changed",
  "deal.deleted",
  "contact.created",
  "contact.deleted",
  "contact.moved",
  "contact.logged_call",
  "contact.logged_email",
  "contact.logged_meeting",
  "contact.logged_sms",
  "contact.logged_note",
  "crm_task.created",
  "crm_task.completed",
  "crm_task.reopened",
  "crm_task.deleted",
  "task.completed",
  "milestone.completed",
  "event.scheduled",
  "invoice.issued",
  "invoice.paid",
  "invoice.cancelled",
  "transaction.created",
]);

export function sentenceKey(row: Pick<ActivityRow, "object_kind" | "verb">): string {
  const key = `${row.object_kind}.${row.verb}`;
  return SENTENCES.has(key) ? key : "other";
}

/** Where the step leads in the app; null when it is gone or has no page of its own. */
export function activityHref(
  row: Pick<ActivityRow, "object_kind" | "object_id" | "verb">,
): string | null {
  if (!row.object_id || row.verb === "deleted") return null;
  const id = encodeURIComponent(row.object_id);
  switch (row.object_kind) {
    case "deal":
      return `/app/pipeline?deal=${id}`;
    case "contact":
      return `/app/kontakty/${id}`;
    case "crm_task":
      return `/app/ukoly-crm?task=${id}`;
    case "milestone":
      return `/app/milniky/${id}`;
    case "event":
      return `/app/kalendar?event=${id}`;
    case "invoice":
      return `/app/finance/faktury/${id}`;
    case "transaction":
      return "/app/finance?tab=transactions";
    default:
      return null;
  }
}

export type DailyRow = {
  actor_id: string;
  day: string;
  tasks: number;
  deals: number;
  calls: number;
  meetings: number;
  total: number;
};

/** The daily sums grouped by day (newest first), people by how much they did. */
export function dailyByDay(rows: readonly DailyRow[]): { day: string; people: DailyRow[] }[] {
  const days = new Map<string, DailyRow[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, people]) => ({
      day,
      people: [...people].sort((a, b) => b.total - a.total || a.actor_id.localeCompare(b.actor_id)),
    }));
}
