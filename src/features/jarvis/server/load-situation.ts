import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { contactName } from "@/features/contacts/types";
import { stalledCutoff } from "@/features/dashboard/dashboard-logic";
import { periodRange } from "@/features/finance/finance-logic";
import { todayIsoDate, type FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import type { UserSituation } from "../situation";

type Client = SupabaseClient<Database>;

/** Caps that keep the summary to a few hundred tokens. */
const MILESTONE_LIMIT = 6;
const TASK_LIMIT = 5;
const FOLLOW_UP_LIMIT = 5;
const EVENT_LIMIT = 8;
const STAGE_LIMIT = 30;
const OPEN_DEAL_LIMIT = 2000;

const FOLLOW_UP_TABLE = "follow_up";
const FOLLOW_UP_FIELD = "follow_up_at";

function must<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

function list<T>(result: { data: T[] | null; error: unknown }): T[] {
  return must(result) ?? [];
}

/**
 * Reads the user's situation with their own client, so RLS keeps every query
 * to their rows. Days and the month are the user's, in their time zone.
 */
export async function loadSituation(
  supabase: Client,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<UserSituation> {
  const today = todayIsoDate(settings, now);
  const { timeZone } = settings;
  const day = dayRangeToInstants(today, today, timeZone);
  const month = periodRange("thisMonth", today);

  const [milestones, overdue, stages, openDeals, followUpTable, events, prospecting, finance] =
    await Promise.all([
      supabase
        .from("milestones")
        .select("id, title, target_date", { count: "exact" })
        .eq("status", "active")
        .order("position")
        .limit(MILESTONE_LIMIT),
      supabase
        .from("tasks")
        .select("title, due_date, milestones!inner(status)", { count: "exact" })
        .neq("status", "done")
        .lte("due_date", today)
        .eq("milestones.status", "active")
        .order("due_date")
        .limit(TASK_LIMIT),
      supabase
        .from("pipeline_stages")
        .select("id, name, is_won, is_lost")
        .order("position")
        .limit(STAGE_LIMIT),
      supabase
        .from("deals")
        .select("stage_id, value, entered_stage_at")
        .is("won_at", null)
        .is("lost_at", null)
        .limit(OPEN_DEAL_LIMIT),
      supabase
        .from("contact_tables")
        .select("id, contact_table_fields(id, system_key)")
        .eq("system_key", FOLLOW_UP_TABLE)
        .maybeSingle(),
      supabase
        .from("calendar_events")
        .select("title, starts_at, all_day")
        .gte("starts_at", day.from)
        .lt("starts_at", day.to)
        .order("starts_at")
        .limit(EVENT_LIMIT),
      supabase.rpc("prospecting_seconds_for_day", { _day: today, _timezone: timeZone }),
      supabase.rpc("finance_totals", { _from: month.from, _to: month.to }).maybeSingle(),
    ]);

  const milestoneRows = list(milestones);
  const counts = new Map<string, { done: number; total: number }>();
  if (milestoneRows.length) {
    const rows = list(
      await supabase
        .from("milestone_task_counts")
        .select("milestone_id, done, total")
        .in(
          "milestone_id",
          milestoneRows.map((m) => m.id),
        ),
    );
    for (const row of rows) {
      if (row.milestone_id)
        counts.set(row.milestone_id, { done: row.done ?? 0, total: row.total ?? 0 });
    }
  }

  // Open deals per stage; won and lost stages hold no open deals by definition.
  const perStage = new Map<string, { open: number; value: number }>();
  const cutoff = Date.parse(stalledCutoff(now));
  let stalledDeals = 0;
  for (const deal of list(openDeals)) {
    const entry = perStage.get(deal.stage_id) ?? { open: 0, value: 0 };
    entry.open += 1;
    entry.value += Number(deal.value ?? 0);
    perStage.set(deal.stage_id, entry);
    if (Date.parse(deal.entered_stage_at) < cutoff) stalledDeals += 1;
  }

  // Follow-ups whose date has come: the date is filtered in the database, as on the dashboard.
  let followUps: UserSituation["followUps"] = [];
  let followUpsTotal = 0;
  const table = must(followUpTable);
  const fieldId = table?.contact_table_fields.find((f) => f.system_key === FOLLOW_UP_FIELD)?.id;
  if (table && fieldId) {
    const dueAt = `answers->>${fieldId}`;
    const { data, error, count } = await supabase
      .from("contact_table_entries")
      .select("answers, contact:contacts(company_name, first_name, last_name)", { count: "exact" })
      .eq("table_id", table.id)
      .lt(dueAt, day.to)
      .order(dueAt)
      .limit(FOLLOW_UP_LIMIT);
    if (error) throw error;
    followUps = data.flatMap((entry) => {
      const answers = entry.answers as Record<string, unknown> | null;
      const value = answers?.[fieldId];
      const time = typeof value === "string" ? Date.parse(value) : NaN;
      if (Number.isNaN(time) || !entry.contact) return [];
      return [{ name: contactName(entry.contact), dueAt: new Date(time) }];
    });
    followUpsTotal = count ?? followUps.length;
  }

  const totals = must(finance);

  return {
    today,
    todayStart: new Date(day.from),
    milestones: milestoneRows.map((m) => ({
      title: m.title,
      done: counts.get(m.id)?.done ?? 0,
      total: counts.get(m.id)?.total ?? 0,
      targetDate: m.target_date,
    })),
    milestonesTotal: milestones.count ?? milestoneRows.length,
    overdueTasks: list(overdue).map((t) => ({ title: t.title, dueDate: t.due_date ?? today })),
    overdueTotal: overdue.count ?? 0,
    stages: list(stages)
      .filter((stage) => !stage.is_won && !stage.is_lost)
      .map((stage) => ({
        name: stage.name,
        open: perStage.get(stage.id)?.open ?? 0,
        value: perStage.get(stage.id)?.value ?? 0,
      })),
    stalledDeals,
    followUps,
    followUpsTotal,
    events: list(events).map((e) => ({
      title: e.title,
      startsAt: new Date(e.starts_at),
      allDay: e.all_day,
    })),
    prospectingSeconds: Number(must(prospecting) ?? 0),
    finance: { income: Number(totals?.income ?? 0), expense: Number(totals?.expense ?? 0) },
  };
}
