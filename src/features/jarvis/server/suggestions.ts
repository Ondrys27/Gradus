import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { contactName } from "@/features/contacts/types";
import { stalledCutoff } from "@/features/dashboard/dashboard-logic";
import { todayIsoDate, type FormatSettings } from "@/lib/format";
import type { UserSettings } from "@/lib/user-settings";
import type { Database, Json } from "@/types/database";
import type { TimeWindow } from "../time-window";
import {
  calendarDaysBetween,
  daysBetween,
  INSIGHT_TTL_DAYS,
  OVERDUE_AFTER_DAYS,
  PER_RULE_LIMIT,
  reachesPeople,
  RULE_TYPES,
  ruleSuggestions,
  suggestionActionSchema,
  WON_RECENT_DAYS,
  type RuleInputs,
  type Suggestion,
  type SuggestionType,
} from "../suggestions";
import { loadTimeWindow } from "./time-window";

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

  // A worker's tasks count only in a space they still work in.
  const spaces = list(
    await client
      .from("workers")
      .select("owner_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(5),
  );
  const ownSpaces = [userId, ...spaces.map((space) => space.owner_id)];

  const [won, stalled, stages, overdue, milestones, followUpTable, invoices, crmTasks] =
    await Promise.all([
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
      // Overdue from the day after the due day; RLS leaves them out for a worker without finance.
      client
        .from("invoices")
        .select("id, number, customer_name, due_on")
        .eq("user_id", userId)
        .eq("kind", "invoice")
        .in("status", ["open", "sent", "overdue"])
        .lt("due_on", today)
        .order("due_on")
        .limit(PER_RULE_LIMIT),
      // The user's own sales tasks, overdue to the minute.
      client
        .from("crm_tasks")
        .select(
          "id, title, due_at, deal:deals(title), contact:contacts(company_name, first_name, last_name)",
        )
        .eq("assignee_id", userId)
        .in("user_id", ownSpaces)
        .eq("status", "open")
        .lt("due_at", now.toISOString())
        .order("due_at")
        .limit(PER_RULE_LIMIT),
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
    overdueInvoices: list(invoices).flatMap((invoice) =>
      invoice.number && invoice.due_on
        ? [
            {
              id: invoice.id,
              number: invoice.number,
              customer: invoice.customer_name,
              dueOn: invoice.due_on,
              daysLate: calendarDaysBetween(invoice.due_on, today),
            },
          ]
        : [],
    ),
    overdueCrmTasks: list(crmTasks).map((task) => ({
      id: task.id,
      title: task.title,
      target: task.deal?.title ?? (task.contact ? contactName(task.contact) : null),
      dueAt: task.due_at,
    })),
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

/** Whether a stored suggestion says it means reaching people; anything else in the payload is ignored. */
export function payloadPeople(payload: Json): boolean | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const people = (payload as Record<string, Json | undefined>).people;
    if (typeof people === "boolean") return people;
  }
  return undefined;
}

/**
 * When a stored suggestion may be acted on: null for now, or the next time
 * to reach people for a call or meeting outside the window. Decided at
 * reading time, so a suggestion written in the morning is not offered at night.
 */
export function suggestionNotBefore(
  row: { type: string; text: string; payload: Json },
  window: TimeWindow,
): string | null {
  if (window.open || !reachesPeople(row.type, payloadPeople(row.payload), row.text)) return null;
  return window.nextOpenAt?.toISOString() ?? null;
}

/** Open suggestions, newest first; old insights are left out. */
export async function listSuggestions(
  client: Client,
  userId: string,
  window: TimeWindow,
  now: Date = new Date(),
): Promise<Suggestion[]> {
  const insightSince = subDays(now, INSIGHT_TTL_DAYS).toISOString();
  const { data, error } = await client
    .from("jarvis_suggestions")
    .select("id, type, text, action, payload, seen_at, created_at")
    .eq("user_id", userId)
    // Briefings and questions belong to the bubble, not to the panel's list.
    .eq("kind", "suggestion")
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
        notBefore: suggestionNotBefore(row, window),
      },
    ];
  });
}

/** How long after onboarding Jarvis still points to the milestones the path created. */
export const PATH_READY_DAYS = 14;

/**
 * Once per path, soon after onboarding in game mode: Jarvis points to the
 * milestones the path created. Not a rule suggestion, so it stays until the
 * user opens or dismisses it. Reads with the user's client, writes with the
 * admin client, always for this user.
 */
export async function syncPathReady(
  supabase: Client,
  admin: Client,
  userId: string,
  now: Date = new Date(),
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("mode, path_key, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (
    !profile ||
    profile.mode !== "game" ||
    !profile.path_key ||
    !profile.onboarding_completed_at ||
    new Date(profile.onboarding_completed_at) < subDays(now, PATH_READY_DAYS)
  ) {
    return;
  }

  const {
    data: steps,
    error: stepsError,
    count,
  } = await supabase
    .from("milestones")
    .select("title", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", "active")
    .not("template_id", "is", null)
    .order("position")
    .limit(1);
  if (stepsError) throw stepsError;
  const total = count ?? steps.length;
  if (total === 0) return;

  const { error: insertError } = await admin.from("jarvis_suggestions").upsert(
    {
      user_id: userId,
      type: "pathReady",
      text: `Your path is ready: ${total} milestones`,
      action: {
        kind: "open",
        href: "/app/milniky?view=path",
        params: { count: total, first: steps[0]?.title ?? "" },
      } as unknown as Json,
      dedupe_key: `pathReady:${profile.path_key}`,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
}

/** The instant triggers for one user, then the list the panel shows. */
export async function refreshSuggestions(args: {
  supabase: Client;
  admin: Client;
  userId: string;
  settings: FormatSettings;
  row: UserSettings | null;
}): Promise<Suggestion[]> {
  const inputs = await loadRuleInputs(args.supabase, args.userId, args.settings);
  await syncRuleSuggestions(args.admin, args.userId, inputs);
  await syncPathReady(args.supabase, args.admin, args.userId);
  const window = await loadTimeWindow(args.supabase, {
    timeZone: args.settings.timeZone,
    country: args.row?.country_code ?? null,
  });
  return listSuggestions(args.supabase, args.userId, window);
}
