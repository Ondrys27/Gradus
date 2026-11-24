import { z } from "zod";
import { addDaysIso, dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { todayIsoDate } from "@/lib/format";
import type { OpsEnv } from "@/lib/ops";
import type { Json } from "@/types/database";
import type { UndoRecord, UndoTable } from "../records";
import { ToolError, type ToolContext } from "../types";

/** Most rows a reading tool returns at once. */
export const READ_LIMIT = 25;

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
export const instant = z.iso.datetime({ offset: true });

/** The shared writes of the sections (ops.ts) take the tool's client and analytics. */
export function ops(ctx: ToolContext): OpsEnv {
  return { db: ctx.db, track: ctx.track };
}

/** A name in a card: trimmed and short enough for one line. */
export function quoted(text: string | null | undefined, max = 60): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export const hrefs = {
  milestone: (id: string) => `/app/milniky/${id}`,
  contact: (id: string) => `/app/kontakty/${id}`,
  deal: (id: string) => `/app/pipeline?deal=${id}`,
  crmTask: (id: string) => `/app/ukoly-crm?task=${id}`,
  event: (id: string, date?: string) =>
    date ? `/app/kalendar?event=${id}&date=${date}` : `/app/kalendar?event=${id}`,
  note: (id: string) => `/app/poznamky?note=${encodeURIComponent(id)}`,
  transactions: "/app/finance?tab=transactions",
  recurring: "/app/finance?tab=recurring",
  month: (month: string) => `/app/finance?tab=month&month=${month}`,
  invoice: (id: string) => `/app/finance/faktury/${id}`,
  chat: (id: string) => `/app/zpravy?c=${id}`,
  worker: (id: string) => `/app/firma?worker=${id}`,
  company: "/app/firma",
  scheduler: "/app/planovac",
  settings: "/app/nastaveni",
} as const;

/** A row the user can reach (RLS), or notFound: never trust an id from the model unchecked. */
export async function mustFind<T>(
  promise: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  // A malformed id (22P02) is just a record that does not exist.
  if (error && (error as { code?: string }).code !== "22P02") throw error;
  if (!data) throw new ToolError("notFound");
  return data;
}

export function inserted(table: UndoTable, id: string): UndoRecord {
  return { table, match: { id }, op: "insert" };
}

export function updated(table: UndoTable, id: string, before: Record<string, Json>): UndoRecord {
  return { table, match: { id }, op: "update", before };
}

/**
 * A row the tool deletes, as it was: Undo inserts it again (only the columns
 * a client may write; `then` = what the database sets on its own at insert,
 * written right after, e.g. a done task starts open).
 */
export function deleted(
  table: UndoTable,
  id: string,
  row: Record<string, unknown>,
  then?: Record<string, unknown>,
): UndoRecord {
  const values: Record<string, Json> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined && key !== "id") values[key] = value as Json;
  }
  const after: Record<string, Json> = {};
  for (const [key, value] of Object.entries(then ?? {})) {
    if (value !== undefined) after[key] = value as Json;
  }
  return {
    table,
    match: { id },
    op: "delete",
    row: values,
    ...(Object.keys(after).length ? { then: after } : {}),
  };
}

/** The fields of `patch` that are set, and their values before from `row`. */
export function previousOf(row: Record<string, unknown>, patch: Record<string, unknown>) {
  const before: Record<string, Json> = {};
  for (const key of Object.keys(patch)) {
    if (patch[key] !== undefined) before[key] = (row[key] ?? null) as Json;
  }
  return before;
}

/** Only the keys that are set (an absent field means "leave as it is"). */
export function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) (out as Record<string, unknown>)[key] = item;
  }
  return out;
}

/** Today and its bounds in the user's time zone (never UTC). */
export function today(ctx: ToolContext) {
  const day = todayIsoDate(ctx.settings);
  return { day, ...dayRangeToInstants(day, day, ctx.timezone), tomorrow: addDaysIso(day, 1) };
}
