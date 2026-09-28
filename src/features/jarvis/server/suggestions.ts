import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { contactName } from "@/features/contacts/types";
import { stalledCutoff } from "@/features/dashboard/dashboard-logic";
import { todayIsoDate, type FormatSettings } from "@/lib/format";
import type { Database, Json } from "@/types/database";
import {
  calendarDaysBetween,
  daysBetween,
  INSIGHT_TTL_DAYS,
  OVERDUE_AFTER_DAYS,
  PER_RULE_LIMIT,
  RULE_TYPES,
  ruleSuggestions,
  suggestionActionSchema,
  WON_RECENT_DAYS,
  type RuleInputs,
  type Suggestion,
  type SuggestionType,
} from "../suggestions";

type Client = SupabaseClient<Database>;

const FOLLOW_UP_TABLE = "follow_up";
const FOLLOW_UP_FIELD = "follow_up_at";
const ACTIVE_MILESTONE_LIMIT = 50;
const LIST_LIMIT = 12;

function must<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

function list<T>(result: { data: T[] | null; error: unknown }): T[] {
  return must(result) ?? [];
}

/**
 * The data behind the instant triggers. Every query is filtered by the user
 * id, so it is safe with the user's client (RLS on top) and with the admin
 * client of the cron.
 */
export async function loadRuleInputs(
  client: Client,
  userId: string,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<RuleInputs> {
  const today = todayIsoDate(settings, now);
  const day = dayRangeToInstants(today, today, settings.timeZone);
  const overdueBefore = subDays(new Date(`${today}T00:00:00Z`), OVERDUE_AFTER_DAYS)
    .toISOString()
    .slice(0, 10);

  const [won, stalled, stages, overdue, milestones, followUpTable] = await Promise.all([
    client
      .from("deals")
      .select("id, title, contact:contacts(company_name, first_name, last_name)")
      .eq("user_id", userId)
      .gte("won_at", subDays(now, WON_RECENT_DAYS).toISOString())
      .order("won_at", { ascending: false })
      .limit(PER_RULE_LIMIT),
    client
      .from("deals")
      .select("id, title, stage_id, entered_stage_at")
      .eq("user_id", userId)
      .is("won_at", null)
      .is("lost_at", null)
      .lt("entered_stage_at", stalledCutoff(now))
      .order("entered_stage_at")
      .limit(PER_RULE_LIMIT),
    client.from("pipeline_stages").select("id, name").eq("user_id", userId).limit(50),
    client
      .from("tasks")
      .select("id, title, milestone_id, due_date, milestones!inner(status)")
      .eq("user_id", userId)
      .neq("status", "done")
      .lt("due_date", overdueBefore)
      .eq("milestones.status", "active")
      .order("due_date")
      .limit(PER_RULE_LIMIT),
    client
      .from("milestones")
      .select("id, title")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("position")
      .limit(ACTIVE_MILESTONE_LIMIT),
    client
      .from("contact_tables")
      .select("id, contact_table_fields(id, system_key)")
      .eq("user_id", userId)
      .eq("system_key", FOLLOW_UP_TABLE)
      .maybeSingle(),
  ]);

  const stageNames = new Map(list(stages).map((stage) => [stage.id, stage.name]));
  const activeMilestones = list(milestones);

  let readyMilestones: RuleInputs["readyMilestones"] = [];
  if (activeMilestones.length) {
    const counts = list(
      await client
        .from("milestone_task_counts")
        .select("milestone_id, done, total")
        .in(
          "milestone_id",
          activeMilestones.map((m) => m.id),
        ),
    );
    const ready = new Set(
      counts.filter((c) => (c.total ?? 0) > 0 && c.done === c.total).map((c) => c.milestone_id),
    );
    readyMilestones = activeMilestones.filter((m) => ready.has(m.id));
  }

  // Contacts whose follow-up date has come, as on the dashboard.
  const followUps: RuleInputs["followUps"] = { total: 0, firstName: null, tableId: null, today };
  const table = must(followUpTable);
  const fieldId = table?.contact_table_fields.find((f) => f.system_key === FOLLOW_UP_FIELD)?.id;
  if (table && fieldId) {
    const dueAt = `answers->>${fieldId}`;
    const { data, error, count } = await client
      .from("contact_table_entries")
      .select("contact:contacts(company_name, first_name, last_name)", { count: "exact" })
      .eq("user_id", userId)
      .eq("table_id", table.id)
      .lt(dueAt, day.to)
      .order(dueAt)
      .limit(1);
    if (error) throw error;
    followUps.total = count ?? data.length;
    followUps.tableId = table.id;
    followUps.firstName = data[0]?.contact ? contactName(data[0].contact) : null;
  }

  return {
    wonDeals: list(won).map((deal) => ({
      id: deal.id,
      title: deal.title,
      contactName: deal.contact ? contactName(deal.contact) : null,
    })),
    followUps,
    stalledDeals: list(stalled).map((deal) => ({
      id: deal.id,
      title: deal.title,
      stageName: stageNames.get(deal.stage_id) ?? "",
      enteredStageAt: deal.entered_stage_at,
      days: daysBetween(new Date(deal.entered_stage_at), now),
    })),
    overdueTasks: list(overdue).flatMap((task) =>
      task.due_date
        ? [
            {
              id: task.id,
              title: task.title,
              milestoneId: task.milestone_id,
              dueDate: task.due_date,
              daysLate: calendarDaysBetween(task.due_date, today),
            },
          ]
        : [],
    ),
    readyMilestones,
  };
}

/**
 * Writes the rule suggestions of this moment (each event once, thanks to the
 * dedupe key) and retires the ones whose reason is gone: the deal moved on,
 * the task was done, the day changed. Admin client, always with the user id.
 */
export async function syncRuleSuggestions(admin: Client, userId: string, inputs: RuleInputs) {
  const rules = ruleSuggestions(inputs);
  if (rules.length) {
    const { error } = await admin.from("jarvis_suggestions").upsert(
      rules.map((rule) => ({
        user_id: userId,
        type: rule.type,
        text: rule.text.slice(0, 1000),
        action: rule.action as unknown as Json,
        dedupe_key: rule.dedupeKey,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  let stale = admin
    .from("jarvis_suggestions")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .in("type", [...RULE_TYPES]);
  if (rules.length) {
    stale = stale.not("dedupe_key", "in", `(${rules.map((r) => `"${r.dedupeKey}"`).join(",")})`);
  }
  const { error } = await stale;
  if (error) throw error;
}

/** Open suggestions, newest first; old insights are left out. */
export async function listSuggestions(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<Suggestion[]> {
  const insightSince = subDays(now, INSIGHT_TTL_DAYS).toISOString();
  const { data, error } = await client
    .from("jarvis_suggestions")
    .select("id, type, text, action, seen_at, created_at")
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .or(`type.neq.insight,created_at.gte."${insightSince}"`)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data.flatMap((row) => {
    const action = suggestionActionSchema.safeParse(row.action);
    if (!action.success) return [];
    return [
      {
        id: row.id,
        type: row.type as SuggestionType,
        text: row.text,
        action: action.data,
        seen: row.seen_at !== null,
        createdAt: row.created_at,
      },
    ];
  });
}

/** The instant triggers for one user, then the list the panel shows. */
export async function refreshSuggestions(args: {
  supabase: Client;
  admin: Client;
  userId: string;
  settings: FormatSettings;
}): Promise<Suggestion[]> {
  const inputs = await loadRuleInputs(args.supabase, args.userId, args.settings);
  await syncRuleSuggestions(args.admin, args.userId, inputs);
  return listSuggestions(args.supabase, args.userId);
}
